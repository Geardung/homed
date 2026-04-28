import express from 'express';
import path from 'node:path';
import { parse, validate } from '@tma.js/init-data-node';
import { createDatabase, run, get, all } from './db.js';
import 'dotenv/config';
import { migrate } from './migrations.js';

const {
  BOT_TOKEN,
  PORT = 3000,
  DATABASE_PATH = './homed.sqlite',
  INIT_DATA_MAX_AGE_SECONDS = '86400',
} = process.env;

const LOW_STOCK_DAYS_DEFAULT = 3;
const MONTH_COST_CUTOFF_DAYS = 30;
const REMINDER_LOOKAHEAD_DAYS = 21;
const TIME_RE = /^([01]?\d|2[0-3]):[0-5]\d$/;
const DEFAULT_MEAL_TIMES = {
  breakfast: '08:00',
  lunch: '13:00',
  dinner: '19:00',
  snack: '16:00',
  bedtime: '22:00',
};

const UNIT_LABELS = {
  tabs: 'таблетки',
  ml: 'мл',
  mg: 'мг',
  drops: 'капли',
  bottle: 'флакон',
};

const MEAL_LABELS = {
  breakfast: 'Завтрак',
  lunch: 'Обед',
  dinner: 'Ужин',
  snack: 'Перекус',
  bedtime: 'Перед сном',
};

const WEEKDAY_NAMES = {
  1: 'Пн',
  2: 'Вт',
  3: 'Ср',
  4: 'Чт',
  5: 'Пт',
  6: 'Сб',
  7: 'Вс',
};

const RATE_LIMITS = {
  session: { windowMs: 5_000, maxRequests: 3 },
  take: { windowMs: 10_000, maxRequests: 6 },
};
const RATE_LIMIT_OPTIONS = {
  cleanupIntervalMs: 20_000,
  maxBuckets: 5_000,
};
const USER_ID_HEADER = 'x-telegram-user-id';
const MSG = {
  auth: {
    missingUser: 'Не передан идентификатор Telegram пользователя',
    rateLimitExceeded: 'Слишком много запросов, попробуйте позже',
  },
  tma: {
    initDataMissing: 'initData не передан',
    userMissingInInitData: 'В initData отсутствует пользователь',
    userNotFound: 'Пользователь не найден',
  },
  system: {
    missingBotToken: 'Отсутствует BOT_TOKEN в переменных окружения',
  },
  validation: {
    nameRequired: 'Введите название лекарства',
    totalQuantityInvalid: 'Общее количество должно быть больше 0',
    remainingInvalid: 'Остаток должен быть числом и не меньше 0',
    remainingTooLarge: 'Остаток не должен превышать общее количество',
    unitInvalid: 'Укажите единицу измерения: tabs, ml, mg, drops или bottle',
    doseUnitInvalid: 'Укажите дозу в единице: tabs, ml, mg, drops или bottle',
    doseInvalid: 'Доза должна быть больше 0',
    frequencyInvalid: 'Неверный график приема',
    priceInvalid: 'Цена должна быть числом не меньше 0',
    startDateInvalid: 'Неверный формат даты начала',
    categoryTooLong: 'Название категории слишком длинное',
    expiryDateInvalid: 'Неверный формат даты истечения',
  },
  medication: {
    invalidId: 'Некорректный ID лекарства',
    notFound: 'Лекарство не найдено',
    notFoundForAction: 'Лекарство не найдено для этого действия',
    notFoundForRestore: 'Лекарство для восстановления не найдено',
    quantityZeroOrLess: 'Количество должно быть больше 0',
    insufficientQuantity: 'Взято больше лекарства, чем осталось',
    takenAtInvalid: 'Неверный формат даты приема',
  },
};

if (!BOT_TOKEN) {
  throw new Error(MSG.system.missingBotToken);
}

const app = express();
const publicPath = path.resolve(process.cwd(), 'public');
const indexPath = path.join(publicPath, 'index.html');

app.use(express.static(publicPath));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

const db = await createDatabase(DATABASE_PATH);
await migrate(db);

const maxAge = Number.isFinite(Number(INIT_DATA_MAX_AGE_SECONDS))
  ? Number(INIT_DATA_MAX_AGE_SECONDS)
  : 86_400;

const actionBuckets = new Map();
const rateLimiterState = {
  lastCleanupAt: 0,
};

function parsePagination(query, options = {}) {
  const defaultLimit = Number.isFinite(options.defaultLimit) ? options.defaultLimit : 20;
  const maxLimit = Number.isFinite(options.maxLimit) ? options.maxLimit : 200;
  const limit = toInteger(query?.limit);
  const offset = toInteger(query?.offset);

  return {
    limit: Math.max(1, Math.min(limit || defaultLimit, maxLimit)),
    offset: Math.max(0, offset || 0),
  };
}

function cleanupRateBuckets(now) {
  if (now - rateLimiterState.lastCleanupAt < RATE_LIMIT_OPTIONS.cleanupIntervalMs) {
    return;
  }

  rateLimiterState.lastCleanupAt = now;
  for (const [key, bucket] of actionBuckets) {
    if (!bucket?.expiresAt || bucket.expiresAt <= now) {
      actionBuckets.delete(key);
    }
  }

  if (actionBuckets.size <= RATE_LIMIT_OPTIONS.maxBuckets) {
    return;
  }

  const sorted = [...actionBuckets.entries()].sort((left, right) => left[1].expiresAt - right[1].expiresAt);
  const overflow = actionBuckets.size - RATE_LIMIT_OPTIONS.maxBuckets;
  for (let index = 0; index < overflow; index += 1) {
    actionBuckets.delete(sorted[index][0]);
  }
}

function getRateKey(action, telegramUserId) {
  return `${action}:${telegramUserId || 'unknown'}`;
}

function isRateLimited(action, telegramUserId, options) {
  const opts = options || RATE_LIMITS[action];
  if (!opts) {
    return false;
  }

  const key = getRateKey(action, telegramUserId);
  const now = Date.now();
  cleanupRateBuckets(now);
  const bucket = actionBuckets.get(key) || { times: [] };
  const windowBegin = now - opts.windowMs;
  bucket.times = bucket.times.filter((time) => time >= windowBegin);

  if (bucket.times.length >= opts.maxRequests) {
    bucket.expiresAt = now + opts.windowMs;
    actionBuckets.set(key, bucket);
    return true;
  }

  bucket.times.push(now);
  bucket.expiresAt = now + opts.windowMs;
  actionBuckets.set(key, bucket);
  return false;
}

function toInteger(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseDate(value) {
  const parsed = value ? new Date(value) : null;
  return parsed && Number.isFinite(parsed.getTime()) ? parsed : null;
}

function normalizeTime(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  if (!TIME_RE.test(normalized)) {
    return null;
  }

  const [hours, minutes] = normalized.split(':');
  return `${hours.padStart(2, '0')}:${minutes.padStart(2, '0')}`;
}

function parseTimeList(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  const set = new Set();
  for (const item of value) {
    const normalized = normalizeTime(item);
    if (normalized) {
      set.add(normalized);
    }
  }

  return [...set];
}

function normalizeMealTimes(value, meals) {
  const input = value && typeof value === 'object' ? value : {};
  const result = {};

  for (const meal of meals) {
    const normalized = normalizeTime(input[meal] || input[String(meal)]);
    result[meal] = normalized || DEFAULT_MEAL_TIMES[meal] || '08:00';
  }

  return result;
}

function fromMinutesOfDay(totalMinutes) {
  const fixed = ((totalMinutes % 1440) + 1440) % 1440;
  const hours = Math.floor(fixed / 60)
    .toString()
    .padStart(2, '0');
  const minutes = (fixed % 60).toString().padStart(2, '0');
  return `${hours}:${minutes}`;
}

function generateEvenlyDistributedTimes(count, startHour = 8) {
  const total = Math.max(1, Math.floor(toNumber(count) || 1));
  const normalizedCount = Math.min(total, 24);
  if (normalizedCount === 1) {
    return [fromMinutesOfDay(startHour * 60)];
  }

  const step = (24 * 60) / normalizedCount;
  const times = [];
  for (let index = 0; index < normalizedCount; index += 1) {
    times.push(fromMinutesOfDay(startHour * 60 + Math.round(step * index)));
  }

  return times;
}

function toMinutesOfDay(timeValue) {
  const normalized = normalizeTime(timeValue);
  if (!normalized) {
    return null;
  }
  const [hours, minutes] = normalized.split(':').map((item) => Number.parseInt(item, 10));
  return hours * 60 + minutes;
}

function parseFrequencyValue(rawValue) {
  if (rawValue == null) {
    return null;
  }

  if (typeof rawValue === 'string') {
    const trimmed = rawValue.trim();
    if (!trimmed) {
      return null;
    }

    try {
      return JSON.parse(trimmed);
    } catch (_error) {
      const legacyNumber = Number.parseInt(trimmed, 10);
      if (Number.isFinite(legacyNumber) && legacyNumber > 0) {
        return { timesPerDay: legacyNumber };
      }
      return null;
    }
  }

  if (typeof rawValue === 'number' && Number.isFinite(rawValue)) {
    return { timesPerDay: rawValue };
  }

  return rawValue;
}

function parseFrequency(payload) {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const details = payload.details || {};

  if (!payload.type) {
    return null;
  }

  const normalizedPayload = normalizeLegacyFrequency(payload.type, details);
  const normalized = normalizedPayload ?? details;
  const payloadDetails = normalized;

  if (payload.type === 'times_per_day') {
    const timesPerDay = toNumber(payloadDetails.timesPerDay ?? payloadDetails.times_per_day);
    if (!timesPerDay || timesPerDay <= 0) {
      return null;
    }

    const times = parseTimeList(payloadDetails.times || payloadDetails.times_in_day || payloadDetails.times_list);
    const finalTimes = times.length ? times : generateEvenlyDistributedTimes(timesPerDay, 8);
    return {
      type: payload.type,
      value: {
        timesPerDay,
        times: finalTimes,
      },
      dosesPerDay: timesPerDay,
      label: `${timesPerDay} раз/день`,
    };
  }

  if (payload.type === 'meal_plan') {
    const meals = Array.isArray(payloadDetails.meals)
      ? payloadDetails.meals.filter((meal) => MEAL_LABELS[meal])
      : [];
    if (!meals.length) {
      return null;
    }

    const mealTimes = normalizeMealTimes(
      payloadDetails.mealTimes || payloadDetails.meal_times || payloadDetails.meal_time || payloadDetails.mealTime,
      meals,
    );
    return {
      type: payload.type,
      value: {
        meals,
        mealTimes,
      },
      dosesPerDay: meals.length,
      label: `Во время еды (${meals.map((meal) => MEAL_LABELS[meal]).join(', ')})`,
    };
  }

  if (payload.type === 'every_n_hours') {
    const everyHours = toNumber(payloadDetails.everyHours || payloadDetails.every_hours || payloadDetails.intervalHours);
    if (!everyHours || everyHours <= 0 || everyHours > 240) {
      return null;
    }

    const startTime = normalizeTime(
      payloadDetails.startTime || payloadDetails.start_time || payloadDetails.start || payloadDetails.anchorTime,
    ) || '08:00';
    const explicitTimes = parseTimeList(payloadDetails.times || payloadDetails.timesInDay || payloadDetails.slots);

    return {
      type: payload.type,
      value: {
        everyHours,
        startTime,
        times: explicitTimes.length
          ? explicitTimes
          : generateTimeOffsetsFromStart(startTime, everyHours),
      },
      dosesPerDay: 24 / everyHours,
      label: `Каждые ${everyHours} часов`,
    };
  }

  if (payload.type === 'weekly') {
    const days = Array.isArray(payloadDetails.days)
      ? payloadDetails.days
          .map((value) => Number(value))
          .filter((day) => Number.isInteger(day) && day >= 1 && day <= 7)
      : [];
    if (!days.length) {
      return null;
    }

    const timesPerDay = toNumber(payloadDetails.timesPerDay || payloadDetails.times_per_day || payloadDetails.dosesPerDay) || 1;
    if (!timesPerDay || timesPerDay <= 0) {
      return null;
    }

    const rawDayTimes = payloadDetails.dayTimes || payloadDetails.day_times || payloadDetails.timesByDay || {};
    const dayTimes = {};
    for (const day of days) {
      const candidate =
        parseTimeList(rawDayTimes[day] || rawDayTimes[String(day)] || rawDayTimes[WEEKDAY_NAMES[day]]);
      dayTimes[day] = candidate.length ? candidate : generateEvenlyDistributedTimes(timesPerDay, 8);
    }

    const sortedDays = [...days].sort((left, right) => left - right);

    return {
      type: payload.type,
      value: {
        days: sortedDays,
        timesPerDay,
        dayTimes,
      },
      dosesPerDay: (sortedDays.length / 7) * timesPerDay,
      label: `Раз в ${sortedDays.length} день недели, ${timesPerDay} раз`,
      daysLabel: sortedDays.map((day) => WEEKDAY_NAMES[day]).join(', '),
    };
  }

  if (payload.type === 'week_cycle') {
    const onWeeks = toNumber(payloadDetails.onWeeks || payloadDetails.on_weeks);
    const offWeeks = toNumber(payloadDetails.offWeeks || payloadDetails.off_weeks || 0) ?? 0;
    const timesPerDay = toNumber(payloadDetails.timesPerDay || payloadDetails.times_per_day || 1) || 0;
    if (!onWeeks || !Number.isFinite(onWeeks) || !Number.isInteger(onWeeks) || onWeeks <= 0) {
      return null;
    }
    if (!Number.isFinite(offWeeks) || offWeeks < 0 || !Number.isInteger(offWeeks)) {
      return null;
    }
    if (!timesPerDay || timesPerDay <= 0) {
      return null;
    }

    const times = parseTimeList(payloadDetails.times || payloadDetails.times_in_day || payloadDetails.times_list);
    const finalTimes = times.length ? times : generateEvenlyDistributedTimes(timesPerDay, 8);
    const cycleLength = onWeeks + offWeeks;
    const activeRatio = cycleLength > 0 ? onWeeks / cycleLength : 1;

    return {
      type: payload.type,
      value: {
        onWeeks,
        offWeeks,
        timesPerDay,
        times: finalTimes,
      },
      dosesPerDay: timesPerDay * activeRatio,
      label: `Через ${onWeeks}/${onWeeks + offWeeks} недель`,
    };
  }

  if (payload.type === 'monthly_cycle') {
    const onMonths = toNumber(payloadDetails.onMonths || payloadDetails.on_months);
    const offMonths = toNumber(payloadDetails.offMonths || payloadDetails.off_months || 0) ?? 0;
    const timesPerDay = toNumber(payloadDetails.timesPerDay || payloadDetails.times_per_day || 1) || 0;
    if (!onMonths || !Number.isFinite(onMonths) || !Number.isInteger(onMonths) || onMonths <= 0) {
      return null;
    }
    if (!Number.isFinite(offMonths) || offMonths < 0 || !Number.isInteger(offMonths)) {
      return null;
    }
    if (!timesPerDay || timesPerDay <= 0) {
      return null;
    }

    const times = parseTimeList(payloadDetails.times || payloadDetails.times_in_day || payloadDetails.times_list);
    const finalTimes = times.length ? times : generateEvenlyDistributedTimes(timesPerDay, 8);
    const cycleLength = onMonths + offMonths;
    const activeRatio = cycleLength > 0 ? onMonths / cycleLength : 1;

    return {
      type: payload.type,
      value: {
        onMonths,
        offMonths,
        timesPerDay,
        times: finalTimes,
      },
      dosesPerDay: timesPerDay * activeRatio,
      label: `Через ${onMonths}/${onMonths + offMonths} месяцев`,
    };
  }

  return null;
}

function normalizeLegacyFrequency(type, details) {
  if (typeof details !== 'object' || details === null) {
    if (type === 'times_per_day' && Number.isFinite(toNumber(details))) {
      return { timesPerDay: toNumber(details) };
    }
    return null;
  }

  if (type === 'times_per_day') {
    if (typeof details.times === 'string') {
      return {
        timesPerDay: toNumber(details.times),
      };
    }
    return details;
  }

  if (type === 'meal_plan') {
    if (!details.meals && Array.isArray(details.mealsList)) {
      return {
        ...details,
        meals: details.mealsList,
      };
    }
    return details;
  }

  if (type === 'every_n_hours') {
    const everyHours = toNumber(details.intervalHours) || toNumber(details.every_hours) || toNumber(details.hours);
    if (everyHours) {
      return {
        ...details,
        everyHours,
      };
    }
    return details;
  }

  if (type === 'weekly') {
    if (details.weekdays && !details.days) {
      const weekdays = Array.isArray(details.weekdays) ? details.weekdays : [];
      return {
        ...details,
        days: weekdays.map((day) => {
          if (typeof day === 'number') {
            return day;
          }

          const parsed = toInteger(day);
          if (parsed && parsed >= 1 && parsed <= 7) {
            return parsed;
          }

          const index = Object.entries(WEEKDAY_NAMES).find((entry) => entry[1] === day)?.[0];
          return index ? Number(index) : null;
        }).filter(Number.isInteger),
      };
    }
    return details;
  }

  return details;
}

function generateTimeOffsetsFromStart(startTime, everyHours) {
  const startMinutes = toMinutesOfDay(startTime) || 0;
  const stepMinutes = everyHours * 60;
  const maxSteps = Math.ceil(24 * 60 / stepMinutes);
  const times = [];

  for (let index = 0; index < maxSteps; index += 1) {
    times.push(fromMinutesOfDay(startMinutes + stepMinutes * index));
  }

  return times;
}

function resolveUserId(req) {
  const headerId = req.headers[USER_ID_HEADER];
  const queryId = req.query?.telegram_user_id || req.query?.telegramUserId || req.query?.userId || req.query?.user;
  const bodyId = req.body?.telegram_user_id || req.body?.telegramUserId || req.body?.userId;
  const fromHeader = toInteger(headerId);
  const fromQueryOrBody = toInteger(queryId ?? bodyId);

  const resolved = fromHeader ?? fromQueryOrBody;
  if (resolved && resolved > 0) {
    return resolved;
  }

  return null;
}

function resolveTelegramUserFromRequest(req, res, next) {
  const telegramUserId = resolveUserId(req);
  if (!telegramUserId) {
    return res.status(401).json({ ok: false, error: MSG.auth.missingUser });
  }

  req.telegramUserId = telegramUserId;
  return next();
}

async function ensureUserById(telegramUserId) {
  if (!telegramUserId || telegramUserId <= 0) {
    return;
  }

  await run(
    db,
    `INSERT INTO tma_users (telegram_id, is_premium, is_bot)
     VALUES (?, 0, 0)
     ON CONFLICT(telegram_id) DO NOTHING`,
    [telegramUserId],
  );

  return get(db, 'SELECT * FROM tma_users WHERE telegram_id = ?', [telegramUserId]);
}

async function ensureUserRecord(user) {
  const insert = `
    INSERT INTO tma_users (
      telegram_id, username, first_name, last_name, language_code, is_premium, is_bot
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(telegram_id) DO UPDATE SET
      username=excluded.username,
      first_name=excluded.first_name,
      last_name=excluded.last_name,
      language_code=excluded.language_code,
      is_premium=excluded.is_premium,
      is_bot=excluded.is_bot,
      updated_at=CURRENT_TIMESTAMP
  `;

  await run(db, insert, [
    user.id,
    user.username ?? null,
    user.first_name ?? null,
    user.last_name ?? null,
    user.language_code ?? null,
    user.is_premium ? 1 : 0,
    user.is_bot ? 1 : 0,
  ]);

  return get(db, 'SELECT * FROM tma_users WHERE telegram_id = ?', [user.id]);
}

function safeUnit(unitCode) {
  return UNIT_LABELS[unitCode] || UNIT_LABELS.tabs;
}

function normalizeUnit(unitCode) {
  return Object.prototype.hasOwnProperty.call(UNIT_LABELS, unitCode) ? unitCode : null;
}

function weekdayFor(date) {
  const day = date.getDay();
  return day === 0 ? 7 : day;
}

function diffWholeDays(fromDate, toDate) {
  const normalizedFrom = new Date(fromDate.getFullYear(), fromDate.getMonth(), fromDate.getDate());
  const normalizedTo = new Date(toDate.getFullYear(), toDate.getMonth(), toDate.getDate());
  return Math.floor((normalizedTo.getTime() - normalizedFrom.getTime()) / (24 * 60 * 60 * 1000));
}

function isWeekCycleActiveForDate(date, startDate, onWeeks, offWeeks) {
  const activeWeeks = Number(onWeeks);
  const inactiveWeeks = Number(offWeeks);
  if (!Number.isFinite(activeWeeks) || activeWeeks < 1) {
    return false;
  }

  const inactiveLength = Number.isFinite(inactiveWeeks) && inactiveWeeks >= 0 ? inactiveWeeks : 0;
  const cycleLength = activeWeeks + inactiveLength;
  if (cycleLength <= 0) {
    return true;
  }

  const diffDays = diffWholeDays(startDate, date);
  const weekIndex = Math.floor(diffDays / 7);
  const phase = ((weekIndex % cycleLength) + cycleLength) % cycleLength;
  return phase < activeWeeks;
}

function isMonthCycleActiveForDate(date, startDate, onMonths, offMonths) {
  const activeMonths = Number(onMonths);
  const inactiveMonths = Number.isFinite(offMonths) && offMonths >= 0 ? offMonths : 0;
  if (!Number.isFinite(activeMonths) || activeMonths < 1) {
    return false;
  }

  const cycleLength = activeMonths + inactiveMonths;
  if (cycleLength <= 0) {
    return true;
  }

  const startMonthIndex = startDate.getFullYear() * 12 + startDate.getMonth();
  const monthIndex = date.getFullYear() * 12 + date.getMonth();
  const phase = ((monthIndex - startMonthIndex) % cycleLength + cycleLength) % cycleLength;
  return phase < activeMonths;
}

function getDefaultStartDate(row) {
  return parseDate(row.start_at) || parseDate(row.created_at) || new Date();
}

function collectReminderCandidates(row, frequency, now = new Date()) {
  const startDate = getDefaultStartDate(row);
  const baseDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const effectiveNow = now < startDate ? startDate : now;
  const candidates = [];

  function timesForDate(date) {
    if (!frequency) {
      return [];
    }

    if (frequency.type === 'times_per_day') {
      return frequency.value.times || [];
    }

    if (frequency.type === 'meal_plan') {
      return (frequency.value.meals || []).map((meal) => frequency.value.mealTimes?.[meal] || DEFAULT_MEAL_TIMES[meal] || '08:00');
    }

    if (frequency.type === 'every_n_hours') {
      return frequency.value.times || [];
    }

    if (frequency.type === 'weekly') {
      const dayNumber = weekdayFor(date);
      return frequency.value.dayTimes?.[dayNumber] || frequency.value.dayTimes?.[String(dayNumber)] || [];
    }

    if (frequency.type === 'week_cycle') {
      if (!isWeekCycleActiveForDate(date, startDate, frequency.value.onWeeks, frequency.value.offWeeks)) {
        return [];
      }
      return frequency.value.times || [];
    }

    if (frequency.type === 'monthly_cycle') {
      if (!isMonthCycleActiveForDate(date, startDate, frequency.value.onMonths, frequency.value.offMonths)) {
        return [];
      }
      return frequency.value.times || [];
    }

    return [];
  }

  for (let offset = 0; offset <= REMINDER_LOOKAHEAD_DAYS; offset += 1) {
    const dayDate = new Date(baseDate);
    dayDate.setDate(baseDate.getDate() + offset);

    const times = timesForDate(dayDate);
    for (const time of times) {
      const minutes = toMinutesOfDay(time);
      if (minutes === null) {
        continue;
      }

      const candidate = new Date(dayDate);
      candidate.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);

      if (candidate >= effectiveNow) {
        candidates.push(candidate);
      }
    }
  }

  candidates.sort((left, right) => left.getTime() - right.getTime());
  return candidates;
}

function getNextDue(row) {
  const frequency = parseFrequency({
    type: row.frequency_type,
    details: parseFrequencyValue(row.frequency_value),
  });

  if (!frequency) {
    return {
      next_due_at: null,
      next_due_in_minutes: null,
      reminder_urgency: 'unknown',
      upcoming_dose_times: [],
    };
  }

  const candidates = collectReminderCandidates(row, frequency);
  if (!candidates.length) {
    return {
      next_due_at: null,
      next_due_in_minutes: null,
      reminder_urgency: 'unknown',
      upcoming_dose_times: [],
    };
  }

  const first = candidates[0];
  const minutesLeft = Math.ceil((first.getTime() - Date.now()) / 60_000);

  let urgency = 'normal';
  if (minutesLeft <= 60) {
    urgency = 'critical';
  } else if (minutesLeft <= 360) {
    urgency = 'high';
  } else if (minutesLeft <= 720) {
    urgency = 'medium';
  }

  return {
    next_due_at: first.toISOString(),
    next_due_in_minutes: minutesLeft,
    reminder_urgency: urgency,
    upcoming_dose_times: candidates.slice(0, 12).map((candidate) => candidate.toISOString()),
  };
}
function buildMedicationStatus(row) {
  const frequency = parseFrequency({
    type: row.frequency_type,
    details: parseFrequencyValue(row.frequency_value),
  });

  const dosesPerDay = frequency?.dosesPerDay || 0;
  const dosePerTake = toNumber(row.dose_amount);
  const remaining = toNumber(row.remaining_quantity);
  const startDate = getDefaultStartDate(row);

  let estimatedDaysLeft = null;
  let estimatedFinishAt = null;
  if (Number.isFinite(startDate.getTime()) && dosesPerDay > 0 && dosePerTake > 0 && remaining !== null && remaining > 0) {
    const takePerDay = dosesPerDay * dosePerTake;
    if (takePerDay > 0) {
      estimatedDaysLeft = Number((remaining / takePerDay).toFixed(2));
      estimatedFinishAt = new Date(startDate.getTime() + estimatedDaysLeft * 24 * 60 * 60 * 1000).toISOString();
    }
  }

  const startQuantity = toNumber(row.total_quantity) || 0;
  const progressUsed = startQuantity > 0 ? Math.min(1, (startQuantity - (remaining || 0)) / startQuantity) : 0;

  const next = getNextDue(row);
  const expiresAt = parseDate(row.expires_at);
  const expiresInDays = expiresAt
    ? Math.ceil((expiresAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000))
    : null;
  const isExpired = expiresInDays !== null && expiresInDays < 0;

  const stockState = isExpired
    ? 'expired'
    : (estimatedDaysLeft !== null && estimatedDaysLeft <= LOW_STOCK_DAYS_DEFAULT) || (remaining || 0) <= 0
      ? 'low'
      : 'ok';

  return {
    ...row,
    frequency_value: parseFrequencyValue(row.frequency_value),
    frequency_label: frequency?.label || row.frequency_type,
    doses_per_day: dosesPerDay,
    estimated_days_left: estimatedDaysLeft,
    estimated_finish_at: estimatedFinishAt,
    progress_used: Number(progressUsed.toFixed(4)),
    next_due_at: next.next_due_at,
    next_due_in_minutes: next.next_due_in_minutes,
    reminder_urgency: next.reminder_urgency,
    upcoming_dose_times: next.upcoming_dose_times,
    stock_state: stockState,
    expires_in_days: expiresInDays,
    is_expired: isExpired,
    unit_label: safeUnit(row.quantity_unit),
  };
}

function validateMedicationPayload(payload = {}) {
  const errors = [];

  const name = typeof payload.name === 'string' ? payload.name.trim() : '';
  if (!name) {
    errors.push(MSG.validation.nameRequired);
  }

  const totalQuantity = toNumber(payload.total_quantity);
  if (!totalQuantity || totalQuantity <= 0) {
    errors.push(MSG.validation.totalQuantityInvalid);
  }

  const remainingQuantityRaw = payload.remaining_quantity === undefined
    ? null
    : toNumber(payload.remaining_quantity);
  const remainingQuantity = remainingQuantityRaw === null
    ? totalQuantity
    : remainingQuantityRaw;
  if (remainingQuantity === null || remainingQuantity < 0) {
    errors.push(MSG.validation.remainingInvalid);
  }
  if (totalQuantity !== null && remainingQuantity !== null && remainingQuantity > totalQuantity) {
    errors.push(MSG.validation.remainingTooLarge);
  }

  const quantityUnit = normalizeUnit(payload.quantity_unit || payload.unit);
  if (!quantityUnit) {
    errors.push(MSG.validation.unitInvalid);
  }

  const doseUnit = normalizeUnit(payload.dose_unit || payload.unit);
  if (!doseUnit) {
    errors.push(MSG.validation.doseUnitInvalid);
  }

  const doseAmount = toNumber(payload.dose_amount);
  if (!doseAmount || doseAmount <= 0) {
    errors.push(MSG.validation.doseInvalid);
  }

  const frequency = parseFrequency({
    type: payload.frequency_type,
    details: payload.frequency_details || payload.frequencyValue || payload.frequency,
  });
  if (!frequency) {
    errors.push(MSG.validation.frequencyInvalid);
  }

  const price = payload.price === '' || payload.price == null ? null : toNumber(payload.price);
  if (price !== null && (!Number.isFinite(price) || price < 0)) {
    errors.push(MSG.validation.priceInvalid);
  }

  let startAt = null;
  if (payload.start_at) {
    const parsed = parseDate(payload.start_at);
    if (!parsed) {
      errors.push(MSG.validation.startDateInvalid);
    } else {
      startAt = parsed.toISOString();
    }
  }

  const category = payload.category == null ? null : String(payload.category).trim() || null;
  if (category && category.length > 120) {
    errors.push(MSG.validation.categoryTooLong);
  }

  const expiresAtValue = payload.expires_at == null ? null : parseDate(payload.expires_at);
  if (payload.expires_at && !expiresAtValue) {
    errors.push(MSG.validation.expiryDateInvalid);
  }

  if (errors.length > 0) {
    return { errors, payload: null };
  }

  return {
    errors: [],
    payload: {
      name,
      totalQuantity,
      remainingQuantity,
      quantityUnit,
      doseAmount,
      doseUnit,
      frequency,
      price,
      startAt,
      category,
      expiresAt: expiresAtValue ? expiresAtValue.toISOString() : null,
      reminderTimezone: payload.reminder_timezone == null ? null : String(payload.reminder_timezone).trim() || null,
      frequencyTimeOverrides: payload.frequency_time_overrides ?? payload.reminder_payload ?? null,
    },
  };
}

function medicationInsertData(valid) {
  return {
    name: valid.name,
    totalQuantity: valid.totalQuantity,
    remainingQuantity: valid.remainingQuantity,
    quantityUnit: valid.quantityUnit,
    doseAmount: valid.doseAmount,
    doseUnit: valid.doseUnit,
    frequencyType: valid.frequency.type,
    frequencyValue: JSON.stringify(valid.frequency.value),
    price: valid.price,
    category: valid.category,
    expiresAt: valid.expiresAt,
    reminderTimezone: valid.reminderTimezone,
    frequencyTimeOverrides: valid.frequencyTimeOverrides,
  };
}

async function getMedicationById(telegramUserId, id, options = {}) {
  const requireActive = options.requireActive ?? true;
  const query = `
    SELECT
      id,
      telegram_user_id,
      name,
      total_quantity,
      remaining_quantity,
      quantity_unit,
      dose_amount,
      dose_unit,
      frequency_type,
      frequency_value,
      frequency_time_overrides,
      category,
      expires_at,
      reminder_timezone,
      price,
      is_active,
      start_at,
      created_at,
      updated_at
    FROM medications
    WHERE id = ? AND telegram_user_id = ?${requireActive ? ' AND is_active = 1' : ''}`;

  return get(db, query, [id, telegramUserId]);
}

function sortMedications(data, sortMode = 'created_at_desc') {
  const list = [...data];

  if (sortMode === 'created_at_desc') {
    list.sort((left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime());
    return list;
  }

  if (sortMode === 'created_at_asc') {
    list.sort((left, right) => new Date(left.created_at).getTime() - new Date(right.created_at).getTime());
    return list;
  }

  if (sortMode === 'name_asc') {
    list.sort((left, right) => left.name.localeCompare(right.name));
    return list;
  }

  if (sortMode === 'name_desc') {
    list.sort((left, right) => right.name.localeCompare(left.name));
    return list;
  }

  if (sortMode === 'remaining_asc') {
    list.sort((left, right) => toNumber(left.remaining_quantity) - toNumber(right.remaining_quantity));
    return list;
  }

  if (sortMode === 'remaining_desc') {
    list.sort((left, right) => toNumber(right.remaining_quantity) - toNumber(left.remaining_quantity));
    return list;
  }

  if (sortMode === 'finish_asc') {
    list.sort((left, right) => {
      const leftValue = left.estimated_days_left;
      const rightValue = right.estimated_days_left;
      if (leftValue === null || rightValue === null) {
        return leftValue === null ? 1 : -1;
      }
      return leftValue - rightValue;
    });
    return list;
  }

  if (sortMode === 'finish_desc') {
    list.sort((left, right) => {
      const leftValue = left.estimated_days_left;
      const rightValue = right.estimated_days_left;
      if (leftValue === null || rightValue === null) {
        return leftValue === null ? 1 : -1;
      }
      return rightValue - leftValue;
    });
    return list;
  }

  return list;
}

function buildMedicationStatusMap(rows) {
  return rows.map((row) => buildMedicationStatus(row));
}

function applyFilters(rows, options = {}) {
  let filtered = [...rows];

  if (options.lowStock) {
    const threshold = Number(options.lowStockDays) || LOW_STOCK_DAYS_DEFAULT;
    filtered = filtered.filter((row) => {
      if (row.estimated_days_left === null) {
        return row.stock_state === 'low';
      }

      return row.estimated_days_left <= threshold;
    });
  }

  if (options.expiringSoon !== null) {
    filtered = filtered.filter((row) => {
      if (row.expires_in_days === null) {
        return false;
      }

      return row.expires_in_days <= options.expiringSoon;
    });
  }

  return filtered;
}

async function logAudit(telegramUserId, action, medicationId, payload = {}) {
  await run(
    db,
    `INSERT INTO medication_audit_logs (telegram_user_id, action, medication_id, payload)
     VALUES (?, ?, ?, ?)`,
    [telegramUserId, action, medicationId, JSON.stringify(payload)],
  );
}

async function monthlyCostSpent(telegramUserId) {
  const start = new Date();
  start.setDate(1);
  start.setHours(0, 0, 0, 0);

  const rows = await all(
    db,
    `SELECT i.quantity, i.medication_id, m.price, m.total_quantity
     FROM medication_intakes i
     JOIN medications m ON m.id = i.medication_id
     WHERE i.telegram_user_id = ? AND i.taken_at >= ?`,
    [telegramUserId, start.toISOString()],
  );

  let total = 0;
  for (const row of rows) {
    const price = toNumber(row.price);
    const totalQuantity = toNumber(row.total_quantity);
    const quantity = toNumber(row.quantity) || 0;

    if (!Number.isFinite(price) || price < 0 || !Number.isFinite(totalQuantity) || totalQuantity <= 0) {
      continue;
    }

    total += (price * quantity) / totalQuantity;
  }

  return Number(total.toFixed(2));
}

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.get('/api/units', async (_req, res) => {
  const rows = await all(db, 'SELECT code, label FROM medication_units WHERE is_active = 1 ORDER BY code');
  const data = rows.length
    ? rows.map((row) => ({ code: row.code, label: row.label }))
    : Object.entries(UNIT_LABELS).map(([code, label]) => ({ code, label }));

  res.json({ ok: true, data });
});

app.use('/api/medications', resolveTelegramUserFromRequest);

app.get('/api/medications', async (req, res) => {
  try {
    const telegramUserId = req.telegramUserId;
    await ensureUserById(telegramUserId);

    const search = typeof req.query.search === 'string' ? req.query.search.trim().toLowerCase() : '';
    const category = typeof req.query.category === 'string' ? req.query.category.trim() : '';
    const status = req.query.status || (req.query.isActive === '1' ? 'active' : req.query.isActive === '0' ? 'archived' : null);
    const lowStock = req.query.low_stock === '1' || req.query.low_stock === 'true';
    const expiringSoon = req.query.expiring_soon != null
      ? req.query.expiring_soon
      : req.query.expiringSoon ? String(LOW_STOCK_DAYS_DEFAULT) : null;
    const expiringSoonDays = expiringSoon ? toInteger(expiringSoon) : null;
    const sort = typeof req.query.sort === 'string' ? req.query.sort : 'created_at_desc';
    const lowStockDays = toInteger(req.query.low_stock_days);
    const limit = toInteger(req.query.limit) || 500;

    const whereParts = ['telegram_user_id = ?'];
    const params = [telegramUserId];

    if (status === 'archived') {
      whereParts.push('is_active = 0');
    } else if (status === 'all') {
      // no filter by is_active
    } else {
      whereParts.push('is_active = 1');
    }

    if (search) {
      whereParts.push('LOWER(name) LIKE ?');
      params.push(`%${search}%`);
    }

    if (category) {
      whereParts.push('category = ?');
      params.push(category);
    }

    params.push(limit);
    const rows = await all(
      db,
      `SELECT
        id,
        telegram_user_id,
        name,
        total_quantity,
        remaining_quantity,
        quantity_unit,
        dose_amount,
        dose_unit,
        frequency_type,
        frequency_value,
        frequency_time_overrides,
        category,
        expires_at,
        reminder_timezone,
        price,
        is_active,
        start_at,
        created_at,
        updated_at
       FROM medications
       WHERE ${whereParts.join(' AND ')}
       ORDER BY created_at DESC
       LIMIT ?`,
      params,
    );

    let data = buildMedicationStatusMap(rows);
    data = applyFilters(data, {
      lowStock,
      lowStockDays,
      expiringSoon: expiringSoonDays,
    });

    data = sortMedications(data, sort);

    const spentThisMonth = await monthlyCostSpent(telegramUserId);
    const stats = {
      total_items: data.length,
      low_stock_count: data.filter((item) => item.stock_state === 'low').length,
      expiring_soon_count: data.filter(
        (item) => item.expires_in_days !== null && item.expires_in_days <= LOW_STOCK_DAYS_DEFAULT,
      ).length,
      expired_count: data.filter((item) => item.is_expired).length,
      monthly_spent: spentThisMonth,
      avg_days_left: (() => {
        const finiteDays = data
          .map((item) => Number(item.estimated_days_left))
          .filter((value) => Number.isFinite(value));
        if (!finiteDays.length) {
          return 0;
        }
        const avg = finiteDays.reduce((sum, value) => sum + value, 0) / finiteDays.length;
        return Number(avg.toFixed(1));
      })(),
      month_from: new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString(),
      month_window_days: MONTH_COST_CUTOFF_DAYS,
    };

    return res.json({
      ok: true,
      data,
      unitLabels: UNIT_LABELS,
      stats,
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
});

app.get('/api/medications/:id', async (req, res) => {
  try {
    const telegramUserId = req.telegramUserId;
    const medicationId = toInteger(req.params.id);
    if (!medicationId) {
      return res.status(400).json({ ok: false, error: MSG.medication.invalidId });
    }

    const medication = await getMedicationById(
      telegramUserId,
      medicationId,
      { requireActive: req.query.status !== 'archived' },
    );
    if (!medication) {
      return res.status(404).json({ ok: false, error: MSG.medication.notFound });
    }

    return res.json({ ok: true, data: buildMedicationStatus(medication) });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
});

app.post('/api/medications', async (req, res) => {
  const telegramUserId = req.telegramUserId;
  const validation = validateMedicationPayload(req.body || {});

  if (validation.errors.length > 0) {
    return res.status(400).json({ ok: false, error: validation.errors.join('. ') });
  }

  try {
    await ensureUserById(telegramUserId);
    const v = validation.payload;
    const values = medicationInsertData(v);

    const result = await run(
      db,
      `INSERT INTO medications (
        telegram_user_id,
        name,
        total_quantity,
        remaining_quantity,
        quantity_unit,
        dose_amount,
        dose_unit,
        frequency_type,
        frequency_value,
        price,
        category,
        expires_at,
        reminder_timezone,
        frequency_time_overrides,
        start_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP))`,
      [
        telegramUserId,
        values.name,
        values.totalQuantity,
        values.remainingQuantity,
        values.quantityUnit,
        values.doseAmount,
        values.doseUnit,
        values.frequencyType,
        values.frequencyValue,
        values.price,
        values.category,
        values.expiresAt,
        values.reminderTimezone,
        values.frequencyTimeOverrides,
        v.startAt,
      ],
    );

    const created = await get(db, 'SELECT * FROM medications WHERE id = ?', [result.lastID]);
    await logAudit(telegramUserId, 'create', result.lastID, {
      name: values.name,
      quantity: values.totalQuantity,
    });

    return res.status(201).json({ ok: true, data: buildMedicationStatus(created) });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
});

app.put('/api/medications/:id', async (req, res) => {
  const telegramUserId = req.telegramUserId;
  const medicationId = toInteger(req.params.id);
  if (!medicationId) {
    return res.status(400).json({ ok: false, error: MSG.medication.invalidId });
  }

  const medication = await getMedicationById(telegramUserId, medicationId, { requireActive: false });
  if (!medication) {
    return res.status(404).json({ ok: false, error: MSG.medication.notFoundForAction });
  }

  const validation = validateMedicationPayload(req.body || {});
  if (validation.errors.length > 0) {
    return res.status(400).json({ ok: false, error: validation.errors.join('. ') });
  }

  try {
    const v = validation.payload;
    const values = medicationInsertData(v);

    const updateSql = `
      UPDATE medications SET
        name = ?,
        total_quantity = ?,
        remaining_quantity = ?,
        quantity_unit = ?,
        dose_amount = ?,
        dose_unit = ?,
        frequency_type = ?,
        frequency_value = ?,
        price = ?,
        category = ?,
        expires_at = ?,
        reminder_timezone = ?,
        frequency_time_overrides = ?,
        start_at = COALESCE(?, start_at),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND telegram_user_id = ?
    `;

    await run(db, updateSql, [
      values.name,
      values.totalQuantity,
      values.remainingQuantity,
      values.quantityUnit,
      values.doseAmount,
      values.doseUnit,
      values.frequencyType,
      values.frequencyValue,
      values.price,
      values.category,
      values.expiresAt,
      values.reminderTimezone,
      values.frequencyTimeOverrides,
      v.startAt,
      medicationId,
      telegramUserId,
    ]);

    await logAudit(telegramUserId, 'update', medicationId, {
      name: values.name,
      frequency_type: values.frequencyType,
    });

    const updated = await getMedicationById(telegramUserId, medicationId, { requireActive: false });
    return res.json({ ok: true, data: buildMedicationStatus(updated) });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
});

app.delete('/api/medications/:id', async (req, res) => {
  const telegramUserId = req.telegramUserId;
  const medicationId = toInteger(req.params.id);
  if (!medicationId) {
    return res.status(400).json({ ok: false, error: MSG.medication.invalidId });
  }

  try {
    await ensureUserById(telegramUserId);

    const result = await run(
      db,
      `UPDATE medications
       SET is_active = 0, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND telegram_user_id = ? AND is_active = 1`,
      [medicationId, telegramUserId],
    );

    if (!result.changes) {
      return res.status(404).json({ ok: false, error: MSG.medication.notFoundForAction });
    }

    await logAudit(telegramUserId, 'delete', medicationId, {});
    return res.json({ ok: true });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
});

app.post('/api/medications/:id/restore', async (req, res) => {
  const telegramUserId = req.telegramUserId;
  const medicationId = toInteger(req.params.id);
  if (!medicationId) {
    return res.status(400).json({ ok: false, error: MSG.medication.invalidId });
  }

  try {
    const result = await run(
      db,
      `UPDATE medications
       SET is_active = 1, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND telegram_user_id = ? AND is_active = 0`,
      [medicationId, telegramUserId],
    );

    if (!result.changes) {
      return res.status(404).json({ ok: false, error: MSG.medication.notFoundForRestore });
    }

    await logAudit(telegramUserId, 'restore', medicationId, {});

    const medication = await getMedicationById(telegramUserId, medicationId, { requireActive: false });
    return res.json({ ok: true, data: buildMedicationStatus(medication) });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
});

app.post('/api/medications/:id/take', async (req, res) => {
  const telegramUserId = req.telegramUserId;
  const medicationId = toInteger(req.params.id);
  if (!medicationId) {
    return res.status(400).json({ ok: false, error: MSG.medication.invalidId });
  }

  if (isRateLimited('take', telegramUserId, RATE_LIMITS.take)) {
    return res.status(429).json({ ok: false, error: MSG.auth.rateLimitExceeded });
  }

  const quantity = toNumber(req.body?.quantity);
  if (!quantity || quantity <= 0) {
    return res.status(400).json({ ok: false, error: MSG.medication.quantityZeroOrLess });
  }

  const medication = await getMedicationById(telegramUserId, medicationId, { requireActive: true });
  if (!medication) {
    return res.status(404).json({ ok: false, error: MSG.medication.notFoundForAction });
  }

  const remaining = toNumber(medication.remaining_quantity) || 0;
  if (quantity > remaining) {
    return res.status(400).json({ ok: false, error: MSG.medication.insufficientQuantity });
  }

  const takenAt = req.body?.taken_at ? parseDate(req.body.taken_at) : new Date();
  if (req.body?.taken_at && !takenAt) {
    return res.status(400).json({ ok: false, error: MSG.medication.takenAtInvalid });
  }

  const note = typeof req.body?.note === 'string' ? req.body.note.trim() || null : null;

  try {
    await run(db, 'BEGIN');
    await run(
      db,
      `INSERT INTO medication_intakes (
        medication_id,
        telegram_user_id,
        taken_at,
        quantity,
        dose_unit,
        note
      ) VALUES (?, ?, ?, ?, ?, ?)`,
      [
        medicationId,
        telegramUserId,
        (takenAt || new Date()).toISOString(),
        quantity,
        medication.dose_unit,
        note,
      ],
    );

    await run(
      db,
      'UPDATE medications SET remaining_quantity = remaining_quantity - ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND telegram_user_id = ?',
      [quantity, medicationId, telegramUserId],
    );

    await logAudit(telegramUserId, 'take', medicationId, {
      quantity,
      taken_at: (takenAt || new Date()).toISOString(),
    });

    await run(db, 'COMMIT');

    const updated = await getMedicationById(telegramUserId, medicationId, { requireActive: false });
    return res.json({ ok: true, data: buildMedicationStatus(updated) });
  } catch (error) {
    await run(db, 'ROLLBACK');
    return res.status(500).json({ ok: false, error: error.message });
  }
});

app.get('/api/medications/:id/intakes', async (req, res) => {
  const telegramUserId = req.telegramUserId;
  const medicationId = toInteger(req.params.id);
  if (!medicationId) {
    return res.status(400).json({ ok: false, error: MSG.medication.invalidId });
  }

  const medication = await getMedicationById(telegramUserId, medicationId, { requireActive: false });
  if (!medication) {
    return res.status(404).json({ ok: false, error: MSG.medication.notFoundForAction });
  }

  try {
    const { limit, offset } = parsePagination(req.query, { defaultLimit: 20, maxLimit: 100 });
    const rows = await all(
      db,
      `SELECT id, taken_at, quantity, dose_unit, note, created_at
       FROM medication_intakes
       WHERE medication_id = ? AND telegram_user_id = ?
       ORDER BY taken_at DESC
       LIMIT ? OFFSET ?`,
      [medicationId, telegramUserId, limit, offset],
    );

    return res.json({
      ok: true,
      data: rows,
      pagination: { limit, offset },
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
});
app.get('/api/medications/:id/events', async (req, res) => {
  const telegramUserId = req.telegramUserId;
  const medicationId = toInteger(req.params.id);
  if (!medicationId) {
    return res.status(400).json({ ok: false, error: MSG.medication.invalidId });
  }

  const medication = await getMedicationById(telegramUserId, medicationId, { requireActive: false });
  if (!medication) {
    return res.status(404).json({ ok: false, error: MSG.medication.notFoundForAction });
  }

  try {
    const { limit, offset } = parsePagination(req.query, { defaultLimit: 20, maxLimit: 100 });
    const queryLimit = limit + offset;
    const [intakes, audits] = await Promise.all([
      all(
        db,
        `SELECT id, taken_at, quantity, dose_unit, note
         FROM medication_intakes
         WHERE medication_id = ? AND telegram_user_id = ?
         ORDER BY taken_at DESC
         LIMIT ?`,
        [medicationId, telegramUserId, queryLimit],
      ),
      all(
        db,
        `SELECT id, created_at, action, payload
         FROM medication_audit_logs
         WHERE medication_id = ? AND telegram_user_id = ?
         ORDER BY created_at DESC
         LIMIT ?`,
        [medicationId, telegramUserId, queryLimit],
      ),
    ]);

    const events = [
      ...intakes.map((row) => ({
        id: `intake:${row.id}`,
        kind: 'take',
        at: row.taken_at,
        payload: row,
      })),
      ...audits.map((row) => ({
        id: `audit:${row.id}`,
        kind: row.action,
        at: row.created_at,
        payload: row.payload ? JSON.parse(row.payload) : null,
      })),
    ].sort((left, right) => new Date(right.at).getTime() - new Date(left.at).getTime());

    const paged = events.slice(offset, offset + limit);
    return res.json({ ok: true, data: paged, pagination: { limit, offset, total: paged.length } });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
});

app.get('/api/medications/:id/schedule', async (req, res) => {
  const telegramUserId = req.telegramUserId;
  const medicationId = toInteger(req.params.id);
  if (!medicationId) {
    return res.status(400).json({ ok: false, error: MSG.medication.invalidId });
  }

  const medication = await getMedicationById(telegramUserId, medicationId, { requireActive: false });
  if (!medication) {
    return res.status(404).json({ ok: false, error: MSG.medication.notFoundForAction });
  }

  const next = getNextDue(medication);
  return res.json({
    ok: true,
    data: {
      id: medicationId,
      frequency_type: medication.frequency_type,
      frequency_value: parseFrequencyValue(medication.frequency_value),
      ...next,
    },
  });
});

app.post('/api/tma/session', async (req, res) => {
  const initData = req.body?.initData ?? req.query.initData ?? req.query.tgWebAppData;

  if (typeof initData !== 'string' || initData.length === 0) {
    return res.status(400).json({ ok: false, error: MSG.tma.initDataMissing });
  }

  const rateKey = req.ip || req.headers['x-forwarded-for'] || 'unknown';
  if (isRateLimited('session', rateKey, RATE_LIMITS.session)) {
    return res.status(429).json({ ok: false, error: MSG.auth.rateLimitExceeded });
  }

  try {
    validate(initData, BOT_TOKEN, { expiresIn: maxAge });
    const parsed = parse(initData);
    const user = parsed.user;

    if (!user?.id) {
      return res.status(422).json({ ok: false, error: MSG.tma.userMissingInInitData });
    }

    const storedUser = await ensureUserRecord(user);
    await run(db, 'INSERT INTO tma_webapp_sessions (telegram_user_id, launch_query_id) VALUES (?, ?)', [
      storedUser.telegram_id,
      parsed.query_id ?? '',
    ]);

    return res.json({
      ok: true,
      user: storedUser,
      initData: parsed,
    });
  } catch (error) {
    return res.status(401).json({ ok: false, error: error.message });
  }
});

app.get('/api/tma/user/:telegramId', async (req, res) => {
  const telegramId = toInteger(req.params.telegramId);
  if (!telegramId) {
    return res.status(400).json({ ok: false, error: 'Некорректный Telegram id' });
  }

  const user = await get(db, 'SELECT * FROM tma_users WHERE telegram_id = ?', [telegramId]);
  if (!user) {
    return res.status(404).json({ ok: false, error: MSG.tma.userNotFound });
  }

  return res.json({ ok: true, user });
});

app.get(/^\/(?!api(?:\/|$))/, (_req, res) => {
  res.sendFile(indexPath);
});

app.listen(PORT, () => {
  console.log(`TMA backend is running on http://localhost:${PORT}`);
});
