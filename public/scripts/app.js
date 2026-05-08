const URL_USER_ID = Number.parseInt(new URLSearchParams(window.location.search).get('telegram_user_id') || '', 10);
const TMA_USER_ID = Number.parseInt(window.Telegram?.WebApp?.initDataUnsafe?.user?.id || '', 10);
const API_USER_ID = Number.isFinite(URL_USER_ID)
  ? URL_USER_ID
  : Number.isFinite(TMA_USER_ID)
    ? TMA_USER_ID
    : 1000000;
const DEFAULT_TAKE_QUANTITY = 1;
const LOW_STOCK_DAYS_DEFAULT = 3;
const UI_TEXT = {
  errors: {
    server: 'Ошибка сервера, попробуйте позже',
  },
  status: {
    all: 'всех',
    active: 'активных',
    archived: 'архивных',
  },
  filters: {
    loading: 'Загрузка...',
  },
};

const medList = document.getElementById('med-list');
const medListEmpty = document.getElementById('med-list-empty');
const searchFilter = document.getElementById('search-filter');
const sortFilter = document.getElementById('sort-filter');
const statusFilter = document.getElementById('status-filter');
const lowStockFilter = document.getElementById('low-stock-filter');
const expiringFilter = document.getElementById('expired-soon-filter');

const navListBtn = document.getElementById('nav-list');
const navCalendarBtn = document.getElementById('nav-calendar');
const viewList = document.getElementById('view-list');
const viewCalendar = document.getElementById('view-calendar');

const calendarTitle = document.getElementById('calendar-title');
const calendarGrid = document.getElementById('calendar-grid');
const calendarPrevBtn = document.getElementById('calendar-prev');
const calendarTodayBtn = document.getElementById('calendar-today');
const calendarNextBtn = document.getElementById('calendar-next');
const calendarDetails = document.getElementById('calendar-details');

const modal = document.getElementById('med-modal');
const modalTitle = document.getElementById('med-modal-title');
const closeModalBtn = document.getElementById('close-med-modal');
const openModalBtn = document.getElementById('open-med-modal');
const medForm = document.getElementById('med-form');
const submitButton = document.getElementById('submit-button');

const timesPerDayInput = document.getElementById('timesPerDay');
const timesPerDaySlots = document.getElementById('timesPerDaySlots');
const everyHoursInput = document.getElementById('everyHours');
const everyStartTimeInput = document.getElementById('everyStartTime');
const everyHoursSlots = document.getElementById('everyHoursSlots');
const weeklyTimesInput = document.getElementById('weeklyTimes');
const weeklySlots = document.getElementById('weeklySlots');
const startAtInput = medForm.elements.start_at;

const frequencyRadios = [...document.querySelectorAll('input[name="frequency_type"]')];
const timesPerDayRow = document.getElementById('timesPerDayRow');
const mealRow = document.getElementById('mealRow');
const hoursRow = document.getElementById('hoursRow');
const weeklyRow = document.getElementById('weeklyRow');
const weekCycleRow = document.getElementById('weekCycleRow');
const monthCycleRow = document.getElementById('monthCycleRow');

const unitSelect = document.getElementById('unit-select');
const doseUnitSelect = document.getElementById('dose-unit-select');

const weekOnWeeksInput = document.getElementById('weekOnWeeks');
const weekOffWeeksInput = document.getElementById('weekOffWeeks');
const weekCycleTimesPerDayInput = document.getElementById('weekCycleTimesPerDay');
const weekCycleSlots = document.getElementById('weekCycleSlots');

const monthOnMonthsInput = document.getElementById('monthOnMonths');
const monthOffMonthsInput = document.getElementById('monthOffMonths');
const monthCycleTimesPerDayInput = document.getElementById('monthCycleTimesPerDay');
const monthCycleSlots = document.getElementById('monthCycleSlots');

const mealCheckboxes = [...document.querySelectorAll('input[name="meal"]')];
const unitLabelByCode = {
  tabs: 'таблетки / шт',
  ml: 'мл',
  mg: 'мг',
  drops: 'капли',
  bottle: 'флакон',
};

let editingMedicationId = null;
let activeView = 'list';
let calendarMonthCursor = new Date();
let calendarMarksByDate = new Map();

function normalizePositiveNumber(value, fallback = 1) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function toStringValue(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function toDisplayUnit(value) {
  const code = toStringValue(value).toLowerCase();
  if (!code) {
    return '';
  }

  if (unitLabelByCode[code]) {
    return unitLabelByCode[code];
  }

  return code;
}

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatDate(dateInput) {
  if (!dateInput) {
    return '\u041d\u0435 \u0443\u043a\u0430\u0437\u0430\u043d\u0430';
  }

  const date = new Date(dateInput);
  if (Number.isNaN(date.getTime())) {
    return dateInput;
  }

  return date.toLocaleDateString('ru-RU');
}

function formatDateTime(dateInput) {
  if (!dateInput) {
    return '\u041d\u0435 \u0443\u043a\u0430\u0437\u0430\u043d\u043e';
  }

  const date = new Date(dateInput);
  if (Number.isNaN(date.getTime())) {
    return dateInput;
  }

  return date.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function toISODateString(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return null;
  }
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function isSameMonth(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}

function escapeHTML(value) {
  const stringValue = String(value ?? '');
  return stringValue
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function computeDailyConsumption(medication) {
  const doseAmount = Number(medicationField(medication, 'dose_amount', 'doseAmount') || 0);
  if (!Number.isFinite(doseAmount) || doseAmount <= 0) {
    return null;
  }

  const type = medicationField(medication, 'frequency_type', 'frequencyType') || 'times_per_day';
  const rawDetails = medicationField(medication, 'frequency_details', 'frequencyDetails')
    ?? medicationField(medication, 'frequency_value', 'frequencyValue')
    ?? {};
  const details = parseFrequencyValue(rawDetails) || {};

  if (type === 'times_per_day') {
    const timesPerDay = Number(details.timesPerDay || details.times_per_day || 1);
    if (!Number.isFinite(timesPerDay) || timesPerDay <= 0) {
      return null;
    }
    return doseAmount * timesPerDay;
  }

  if (type === 'meal_plan') {
    const meals = Array.isArray(details.meals) ? details.meals : [];
    const timesPerDay = meals.length || 1;
    return doseAmount * timesPerDay;
  }

  if (type === 'every_n_hours') {
    const everyHours = Number(details.everyHours || details.every_hours || 8);
    if (!Number.isFinite(everyHours) || everyHours <= 0) {
      return null;
    }
    const timesPerDay = Math.max(1, Math.floor(24 / everyHours));
    return doseAmount * timesPerDay;
  }

  if (type === 'weekly') {
    const days = Array.isArray(details.days) ? details.days : [];
    const timesPerDay = Number(details.timesPerDay || details.times_per_day || 1);
    if (!Number.isFinite(timesPerDay) || timesPerDay <= 0) {
      return null;
    }
    const perWeek = Math.max(1, days.length) * timesPerDay * doseAmount;
    return perWeek / 7;
  }

  if (type === 'week_cycle') {
    const onWeeks = Number(details.onWeeks || 1);
    const offWeeks = Number(details.offWeeks || 0);
    const timesPerDay = Number(details.timesPerDay || 1);
    if (!Number.isFinite(onWeeks) || !Number.isFinite(offWeeks) || !Number.isFinite(timesPerDay)) {
      return null;
    }
    const cycleDays = Math.max(1, (onWeeks + offWeeks) * 7);
    const onDays = Math.max(1, onWeeks * 7);
    const perCycle = onDays * Math.max(1, timesPerDay) * doseAmount;
    return perCycle / cycleDays;
  }

  if (type === 'monthly_cycle') {
    const onMonths = Number(details.onMonths || 1);
    const offMonths = Number(details.offMonths || 0);
    const timesPerDay = Number(details.timesPerDay || 1);
    if (!Number.isFinite(onMonths) || !Number.isFinite(offMonths) || !Number.isFinite(timesPerDay)) {
      return null;
    }
    const cycleDays = Math.max(1, (onMonths + offMonths) * 30);
    const onDays = Math.max(1, onMonths * 30);
    const perCycle = onDays * Math.max(1, timesPerDay) * doseAmount;
    return perCycle / cycleDays;
  }

  return null;
}

function computeEndsOnDate(medication) {
  const estimatedDaysLeft = Number(medicationField(medication, 'estimated_days_left', 'estimatedDaysLeft'));
  if (Number.isFinite(estimatedDaysLeft) && estimatedDaysLeft >= 0) {
    const today = new Date();
    return addDays(today, Math.ceil(estimatedDaysLeft));
  }

  const remaining = Number(medicationField(medication, 'remaining_quantity', 'remainingQuantity'));
  if (!Number.isFinite(remaining) || remaining <= 0) {
    return null;
  }

  const dailyConsumption = computeDailyConsumption(medication);
  if (!Number.isFinite(dailyConsumption) || dailyConsumption <= 0) {
    return null;
  }

  const daysLeft = Math.ceil(remaining / dailyConsumption);
  const startAt = medicationField(medication, 'start_at', 'startAt');
  const startDate = startAt ? new Date(startAt) : new Date();
  if (Number.isNaN(startDate.getTime())) {
    return addDays(new Date(), daysLeft);
  }
  return addDays(startDate, daysLeft);
}

function buildCalendarMarks(medications) {
  const marks = new Map();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  medications.forEach((med) => {
    const endsOn = computeEndsOnDate(med);
    if (!endsOn || Number.isNaN(endsOn.getTime())) {
      return;
    }

    const date = new Date(endsOn);
    date.setHours(0, 0, 0, 0);
    const iso = toISODateString(date);
    if (!iso) {
      return;
    }

    const daysDelta = Math.round((date.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
    const severity = daysDelta <= 0 ? 'danger' : daysDelta <= 3 ? 'warning' : 'normal';

    const list = marks.get(iso) || [];
    list.push({
      id: med.id,
      name: med.name,
      endsOnISO: iso,
      severity,
      daysDelta,
    });
    marks.set(iso, list);
  });

  return marks;
}

function renderCalendar(monthCursor) {
  if (!calendarGrid || !calendarTitle) {
    return;
  }

  const monthStart = startOfMonth(monthCursor);
  const monthTitle = monthStart.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });
  calendarTitle.textContent = monthTitle[0].toUpperCase() + monthTitle.slice(1);

  calendarGrid.innerHTML = '';

  const dowLabels = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
  dowLabels.forEach((label) => {
    const node = document.createElement('div');
    node.className = 'calendar__dow';
    node.textContent = label;
    calendarGrid.appendChild(node);
  });

  const jsDay = monthStart.getDay(); // 0=Sun..6=Sat
  const offset = (jsDay + 6) % 7; // make Monday first
  const gridStart = addDays(monthStart, -offset);

  const totalCells = 6 * 7;
  for (let index = 0; index < totalCells; index += 1) {
    const date = addDays(gridStart, index);
    const iso = toISODateString(date);
    const inMonth = isSameMonth(date, monthStart);
    const items = iso ? (calendarMarksByDate.get(iso) || []) : [];

    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = 'calendar__cell';
    cell.dataset.date = iso || '';
    cell.setAttribute('role', 'gridcell');
    if (!inMonth) {
      cell.setAttribute('aria-disabled', 'true');
    }

    const day = document.createElement('div');
    day.className = 'calendar__day';
    day.textContent = String(date.getDate());
    cell.appendChild(day);

    if (items.length > 0) {
      const mark = document.createElement('div');
      mark.className = 'calendar__mark';
      const top = items.slice(0, 6);
      top.forEach((item) => {
        const dot = document.createElement('span');
        dot.className = `calendar__dot${item.severity === 'warning' ? ' is-warning' : item.severity === 'danger' ? ' is-danger' : ''}`;
        mark.appendChild(dot);
      });
      cell.appendChild(mark);

      const count = document.createElement('div');
      count.className = 'calendar__count';
      count.textContent = items.length === 1 ? '1 препарат' : `${items.length} препаратов`;
      cell.appendChild(count);

      const title = items
        .slice(0, 12)
        .map((item) => `${item.name} — ${formatDate(item.endsOnISO)}`)
        .join('\n');
      cell.title = title;
    }

    calendarGrid.appendChild(cell);
  }
}

function renderCalendarDetails(dateISO) {
  if (!calendarDetails) {
    return;
  }

  const items = calendarMarksByDate.get(dateISO) || [];
  if (!dateISO || items.length === 0) {
    calendarDetails.classList.add('muted');
    calendarDetails.innerHTML = 'На выбранную дату нет отметок.';
    return;
  }

  const dateLabel = formatDate(dateISO);
  calendarDetails.classList.remove('muted');
  calendarDetails.innerHTML = `
    <div><strong>${escapeHTML(dateLabel)}</strong></div>
    <ul>
      ${items
        .sort((a, b) => a.name.localeCompare(b.name, 'ru'))
        .map((item) => `<li>${escapeHTML(item.name)} <span class="muted">(${escapeHTML(item.severity === 'danger' ? 'сегодня/просрочено' : item.severity === 'warning' ? 'скоро' : 'план')})</span></li>`)
        .join('')}
    </ul>
  `;
}

function setActiveView(nextView) {
  activeView = nextView === 'calendar' ? 'calendar' : 'list';

  if (viewList) {
    viewList.classList.toggle('hidden', activeView !== 'list');
  }
  if (viewCalendar) {
    viewCalendar.classList.toggle('hidden', activeView !== 'calendar');
  }

  if (navListBtn) {
    navListBtn.classList.toggle('is-active', activeView === 'list');
    navListBtn.setAttribute('aria-current', activeView === 'list' ? 'page' : 'false');
  }
  if (navCalendarBtn) {
    navCalendarBtn.classList.toggle('is-active', activeView === 'calendar');
    navCalendarBtn.setAttribute('aria-current', activeView === 'calendar' ? 'page' : 'false');
  }

  if (activeView === 'calendar') {
    renderCalendar(calendarMonthCursor);
  }
}

function showModal() {
  modal.classList.remove('hidden');
  modal.setAttribute('aria-hidden', 'false');
}

function hideModal() {
  modal.classList.add('hidden');
  modal.setAttribute('aria-hidden', 'true');
  medForm.reset();
  editingMedicationId = null;
  clearErrors();
  applyFrequencyType('times_per_day');
  updateWeekCheckboxes();
}

function getFrequencyType() {
  const checked = frequencyRadios.find((radio) => radio.checked);
  return checked ? checked.value : 'times_per_day';
}

function applyFrequencyType(type) {
  timesPerDayRow.classList.toggle('hidden', type !== 'times_per_day');
  mealRow.classList.toggle('hidden', type !== 'meal_plan');
  hoursRow.classList.toggle('hidden', type !== 'every_n_hours');
  weeklyRow.classList.toggle('hidden', type !== 'weekly');
  weekCycleRow.classList.toggle('hidden', type !== 'week_cycle');
  monthCycleRow.classList.toggle('hidden', type !== 'monthly_cycle');

  if (type === 'times_per_day') {
    renderSlotsFromCount(timesPerDaySlots, Number(timesPerDayInput.value || 1), '');
  }

  if (type === 'week_cycle') {
    renderSlotsFromCount(weekCycleSlots, Number(weekCycleTimesPerDayInput.value || 1), '');
  }

  if (type === 'monthly_cycle') {
    renderSlotsFromCount(monthCycleSlots, Number(monthCycleTimesPerDayInput.value || 1), '');
  }

  if (type === 'every_n_hours') {
    const normalizedHours = normalizePositiveNumber(everyHoursInput.value, 8);
    const count = Math.max(1, Math.floor(24 / normalizedHours));
    renderSlotsFromCount(everyHoursSlots, count, '');
  }

  if (type === 'weekly') {
    const count = Math.max(1, Number(weeklyTimesInput.value || 1));
    renderSlotsFromCount(weeklySlots, count, '');
  }

  clearErrors();
}

function getTodayDateValue() {
  const date = new Date();
  return formatDateInputValue(date);
}

function formatDateInputValue(rawValue) {
  const date = rawValue ? new Date(rawValue) : null;
  if (!date || Number.isNaN(date.getTime())) {
    return '';
  }

  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = String(date.getFullYear());
  return `${day}.${month}.${year}`;
}

function normalizeDateInputValue(rawValue) {
  const value = toStringValue(rawValue);
  if (!value) {
    return null;
  }

  const date = value.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (date) {
    const day = Number(date[1]);
    const month = Number(date[2]);
    const year = Number(date[3]);
    const parsed = new Date(year, month - 1, day);
    if (
      parsed.getFullYear() === year &&
      parsed.getMonth() + 1 === month &&
      parsed.getDate() === day
    ) {
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }

  const isoDate = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoDate) {
    const day = Number(isoDate[3]);
    const month = Number(isoDate[2]);
    const year = Number(isoDate[1]);
    const parsed = new Date(year, month - 1, day);
    if (
      parsed.getFullYear() === year &&
      parsed.getMonth() + 1 === month &&
      parsed.getDate() === day
    ) {
      return `${isoDate[1]}-${isoDate[2]}-${isoDate[3]}`;
    }
  }

  return null;
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
      const maybeNumber = Number.parseInt(trimmed, 10);
      if (Number.isFinite(maybeNumber) && maybeNumber > 0) {
        return { timesPerDay: maybeNumber };
      }
      return null;
    }
  }

  return rawValue;
}

function updateWeekCheckboxes() {
  const checkbox = document.querySelectorAll('input[name="weeklyDay"]');
  const checkedCount = [...checkbox].filter((row) => row.checked).length;
  checkbox.forEach((item) => {
    item.parentElement.classList.toggle('active', item.checked);
  });
  const anyChecked = checkedCount > 0;
  const warning = weeklyRow.querySelector('[data-error-for="weekly"]');
  if (!anyChecked && warning) {
    warning.textContent = '\u0412\u044b\u0431\u0435\u0440\u0438\u0442\u0435 \u0445\u043e\u0442\u044f \u0431 \u043e\u0434\u0438\u043d \u0434\u0435\u043d\u044c \u043d\u0435\u0434\u0435\u043b\u0438';
  } else if (warning) {
    warning.textContent = '';
  }
}

function setError(id, message) {
  const errorNode = medForm.querySelector(`[data-error-for="${id}"]`);
  if (!errorNode) {
    return;
  }
  errorNode.textContent = message || '';
}

function clearErrors() {
  medForm.querySelectorAll('[data-error-for]').forEach((node) => {
    node.textContent = '';
  });
}

function validateFrequencyPayload(type, details) {
  const errors = {};

  if (type === 'times_per_day') {
    const timesPerDay = Number(details.timesPerDay);
    if (!Number.isFinite(timesPerDay) || timesPerDay < 1 || timesPerDay > 24) {
      errors.times_per_day = '\u0422\u0440\u0435\u0431\u0443\u0435\u0442\u0441\u044f \u0447\u0438\u0441\u043b\u043e timesPerDay \u0434\u043e 24 \u0438 \u043d\u0435 \u043c\u0435\u043d\u0435\u0435 1';
      return errors;
    }
  }

  if (type === 'meal_plan') {
    if (!Array.isArray(details.meals) || details.meals.length === 0) {
      errors.meal_plan = '\u0412\u044b\u0431\u0435\u0440\u0438\u0442\u0435 \u0445\u043e\u0442\u044f \u0431 \u043e\u0434\u0438\u043d \u043f\u0440\u0438\u0451\u043c \u043f\u0438\u0449\u0438';
    }

    const mealTimes = details.mealTimes || {};
    for (const meal of details.meals) {
      if (!mealTimes[meal] || !/^([01]\d|2[0-3]):[0-5]\d$/.test(mealTimes[meal])) {
        errors.meal_plan = '\u0423\u043a\u0430\u0436\u0438\u0442\u0435 \u0432\u0440\u0435\u043c\u044f \u0432 \u0444\u043e\u0440\u043c\u0430\u0442\u0435 HH:mm \u0434\u043b\u044f \u043a\u0430\u0436\u0434\u043e\u0433\u043e \u0432\u044b\u0431\u0440\u0430\u043d\u043d\u043e\u0433\u043e \u043f\u0440\u0438\u0451\u043c\u0430';
        break;
      }
    }
  }

  if (type === 'every_n_hours') {
    const everyHours = Number(details.everyHours);
    if (!Number.isFinite(everyHours) || everyHours < 1 || everyHours > 240) {
      errors.every_n_hours = '\u0412\u044b\u0435\u0437\u0436\u0430\u0435\u043c\u043e\u0441\u0442\u044c everyHours \u0434\u043e 240 \u0438 \u043d\u0435 \u043c\u0435\u043d\u0435\u0435 1';
    }

    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(details.startTime || '')) {
      errors.every_n_hours = '\u0423\u043a\u0430\u0436\u0438\u0442\u0435 \u0432\u0440\u0435\u043c\u044f \u0441\u0442\u0430\u0440\u0442\u0430 \u0432 \u0444\u043e\u0440\u043c\u0430\u0442\u0435 HH:mm';
    }
  }

  if (type === 'weekly') {
    if (!Array.isArray(details.days) || details.days.length === 0) {
      errors.weekly = '\u0412\u044b\u0431\u0435\u0440\u0438\u0442\u0435 \u0445\u043e\u0442\u044f \u0431 \u043e\u0434\u0438\u043d \u0434\u0435\u043d\u044c \u043d\u0435\u0434\u0435\u043b\u0438';
      return errors;
    }

    const timesPerDay = Number(details.timesPerDay);
    if (!Number.isFinite(timesPerDay) || timesPerDay < 1) {
      errors.weekly = 'timesPerDay должен быть целым числом и не меньше 1';
      return errors;
    }

    const dayTimes = details.dayTimes || {};
    for (const day of details.days) {
      const candidate = dayTimes[day];
      if (candidate && !candidate.every((slot) => /^([01]\d|2[0-3]):[0-5]\d$/.test(slot))) {
        errors.weekly = '\u0423\u043a\u0430\u0436\u0438\u0442\u0435 \u0432\u0440\u0435\u043c\u044f HH:mm \u0434\u043b\u044f \u043a\u0430\u0436\u0434\u043e\u0433\u043e \u0432\u044b\u0431\u0440\u0430\u043d\u043d\u043e\u0433\u043e \u0434\u0435\u043d\u044c\u0433\u043e \u043d\u0435\u0434\u0435\u043b\u0438';
        break;
      }
    }
  }

  if (type === 'week_cycle') {
    const onWeeks = Number(details.onWeeks);
    if (!Number.isFinite(onWeeks) || onWeeks < 1 || !Number.isInteger(onWeeks)) {
      errors.week_cycle = 'Неверное значение onWeeks, должно быть целым числом больше 0';
      return errors;
    }

    const offWeeks = Number(details.offWeeks);
    if (!Number.isFinite(offWeeks) || offWeeks < 0 || !Number.isInteger(offWeeks)) {
      errors.week_cycle = 'Неверное значение offWeeks, должно быть целым числом 0 или больше';
      return errors;
    }

    const timesPerDay = Number(details.timesPerDay);
    if (!Number.isFinite(timesPerDay) || timesPerDay < 1 || timesPerDay > 24) {
      errors.week_cycle = 'timesPerDay должен быть целым числом от 1 до 24';
      return errors;
    }

    const times = Array.isArray(details.times) ? details.times : [];
    if (times.length === 0) {
      errors.week_cycle = 'Укажите хотя бы одно время';
      return errors;
    }

    if (times.some((slot) => !/^([01]\d|2[0-3]):[0-5]\d$/.test(slot))) {
      errors.week_cycle = 'Укажите время в формате HH:mm для каждого слота';
    }
  }

  if (type === 'monthly_cycle') {
    const onMonths = Number(details.onMonths);
    if (!Number.isFinite(onMonths) || onMonths < 1 || !Number.isInteger(onMonths)) {
      errors.month_cycle = 'Неверное значение onMonths, должно быть целым числом больше 0';
      return errors;
    }

    const offMonths = Number(details.offMonths);
    if (!Number.isFinite(offMonths) || offMonths < 0 || !Number.isInteger(offMonths)) {
      errors.month_cycle = 'Неверное значение offMonths, должно быть целым числом 0 или больше';
      return errors;
    }

    const timesPerDay = Number(details.timesPerDay);
    if (!Number.isFinite(timesPerDay) || timesPerDay < 1 || timesPerDay > 24) {
      errors.month_cycle = 'timesPerDay должен быть целым числом от 1 до 24';
      return errors;
    }

    const times = Array.isArray(details.times) ? details.times : [];
    if (times.length === 0) {
      errors.month_cycle = 'Укажите хотя бы одно время';
      return errors;
    }

    if (times.some((slot) => !/^([01]\d|2[0-3]):[0-5]\d$/.test(slot))) {
      errors.month_cycle = 'Укажите время в формате HH:mm для каждого слота';
    }
  }

  return errors;
}

function collectTimeInputs(container) {
  const slots = [...container.querySelectorAll('input[type="time"]')];
  return slots
    .map((slot) => toStringValue(slot.value))
    .filter((time) => /^([01]\d|2[0-3]):[0-5]\d$/.test(time));
}

function force24HourTimeInputs() {
  const timeInputs = [...document.querySelectorAll('input[type="time"]')];
  timeInputs.forEach((input) => {
    input.lang = 'ru';
  });
}

function medicationField(row, snakeField, camelField = null) {
  if (camelField && row?.[camelField] !== undefined && row?.[camelField] !== null) {
    return row[camelField];
  }
  return row?.[snakeField];
}

function renderSlotsFromCount(container, count, initialValues = []) {
  if (!container) {
    return;
  }

  const current = container.querySelectorAll('input[type="time"]').length;
  if (current === Number(count)) {
    return;
  }

  container.innerHTML = '';
  for (let index = 0; index < count; index += 1) {
    const input = document.createElement('input');
    input.type = 'time';
    input.className = 'time-slot';
    input.lang = 'ru';
    const initial = toStringValue(initialValues[index]);
    if (initial) {
      input.value = initial;
    }
    container.appendChild(input);
  }
}

function fillSlotsFromValues(container, values) {
  const times = Array.isArray(values) ? values : [];
  if (!container || !Array.isArray(times) || times.length === 0) {
    return;
  }

  for (let index = 0; index < container.children.length; index += 1) {
    const child = container.children[index];
    if (child instanceof HTMLInputElement) {
      child.value = times[index] || '';
    }
  }
}

function buildFrequencyPayload() {
  const type = getFrequencyType();

  if (type === 'times_per_day') {
    const timesPerDay = Number(timesPerDayInput.value);
    const times = collectTimeInputs(timesPerDaySlots);
    return { type, details: { timesPerDay, times } };
  }

  if (type === 'meal_plan') {
    const meals = mealCheckboxes
      .filter((item) => item.checked)
      .map((item) => item.value);

    const mealTimes = {};
    for (const mealCheckbox of mealCheckboxes) {
      const targetId = mealCheckbox.dataset.timeTarget;
      const input = document.getElementById(targetId);
      if (mealCheckbox.checked && input) {
        mealTimes[mealCheckbox.value] = toStringValue(input.value);
      }
    }

    return {
      type,
      details: {
        meals,
        mealTimes,
      },
    };
  }

  if (type === 'every_n_hours') {
    const everyHours = Number(everyHoursInput.value);
    const startTime = toStringValue(everyStartTimeInput.value);
    const times = collectTimeInputs(everyHoursSlots);
    return {
      type,
      details: {
        everyHours,
        startTime,
        times,
      },
    };
  }

  if (type === 'weekly') {
    const dayInputs = [...document.querySelectorAll('input[name="weeklyDay"]')];
    const days = dayInputs
      .filter((item) => item.checked)
      .map((item) => Number(item.value));

    const timesPerDay = Number(weeklyTimesInput.value);
    const commonTimes = collectTimeInputs(weeklySlots);
    const dayTimes = {};
    days.forEach((day) => {
      dayTimes[day] = commonTimes;
    });

    return {
      type,
      details: {
        days,
        timesPerDay,
        dayTimes,
      },
    };
  }

  if (type === 'week_cycle') {
    const onWeeks = Number(weekOnWeeksInput.value);
    const offWeeks = Number(weekOffWeeksInput.value);
    const timesPerDay = Number(weekCycleTimesPerDayInput.value);
    const times = collectTimeInputs(weekCycleSlots);

    return {
      type,
      details: {
        onWeeks,
        offWeeks,
        timesPerDay,
        times,
      },
    };
  }

  if (type === 'monthly_cycle') {
    const onMonths = Number(monthOnMonthsInput.value);
    const offMonths = Number(monthOffMonthsInput.value);
    const timesPerDay = Number(monthCycleTimesPerDayInput.value);
    const times = collectTimeInputs(monthCycleSlots);

    return {
      type,
      details: {
        onMonths,
        offMonths,
        timesPerDay,
        times,
      },
    };
  }

  return { type: 'times_per_day', details: { timesPerDay: 1, times: [] } };
}

function parseFormData() {
  const formData = Object.fromEntries(new FormData(medForm).entries());
  const frequency = buildFrequencyPayload();

  const errors = {};

  const name = toStringValue(formData.name);
  if (!name) {
    errors.name = '\u041d\u0430\u0437\u0432\u0430\u043d\u0438\u0435 \u043e\u0431\u044f\u0437\u0430\u0442\u0435\u043b\u044c\u043d\u043e';
  }

  const totalQuantity = toNumber(formData.total_quantity);
  if (!Number.isFinite(totalQuantity) || totalQuantity <= 0) {
    errors.total_quantity = '\u041e\u0431\u0449\u0435\u0435 \u043a\u043e\u043b-\u0432\u043e \u0434\u043e\u043b\u0436\u043d\u043e \u0431\u044b\u0442\u044c \u0431\u043e\u043b\u044c\u0448\u0435 0';
  }

  const remainingQuantityInput = toStringValue(formData.remaining_quantity);
  const remainingQuantity = remainingQuantityInput.length
    ? toNumber(remainingQuantityInput)
    : totalQuantity;
  if (!Number.isFinite(remainingQuantity) || remainingQuantity < 0) {
    errors.remaining_quantity = '\u041e\u0441\u0442\u0430\u0442\u043e\u043a \u0434\u043e\u043b\u0436\u0435\u043d \u0431\u044b\u0442\u044c \u043d\u0435 \u043e\u0442\u0440\u0438\u0446\u0430\u0442\u0435\u043b\u0435\u043d \u0438 \u0431\u043e\u043b\u0435\u0435 0';
  }

  if (Number.isFinite(totalQuantity) && Number.isFinite(remainingQuantity) && remainingQuantity > totalQuantity) {
    errors.remaining_quantity = '\u041e\u0441\u0442\u0430\u0442\u043e\u043a \u043d\u0435 \u0434\u043e\u043b\u0436\u0435\u043d \u043f\u0440\u0438\u043d\u0438\u043c\u0430\u0442\u044c \u043e\u0431\u0449\u0435\u0435 \u043a\u043e\u043b-\u0432\u043e';
  }

  const doseAmount = toNumber(formData.dose_amount);
  if (!Number.isFinite(doseAmount) || doseAmount <= 0) {
    errors.dose_amount = '\u0414\u043e\u0437\u0430 \u0434\u043e\u043b\u0436\u0435\u043d \u0431\u044b\u0442\u044c \u0431\u043e\u043b\u044c\u0448\u0435 0';
  }

  const price = toStringValue(formData.price).length ? toNumber(formData.price) : null;
  if (toStringValue(formData.price).length && (!Number.isFinite(price) || price < 0)) {
    errors.price = '\u0426\u0435\u043d\u0430 \u0434\u043e\u043b\u0436\u043d\u0430 \u0431\u044b\u0442\u044c \u0431\u043e\u043b\u044c\u0448\u0435 \u0438\u043b\u0438 \u0440\u0430\u0432\u043d\u0430 0';
  }

  const frequencyErrors = validateFrequencyPayload(frequency.type, frequency.details);
  Object.assign(errors, frequencyErrors);

  const payload = {
    name,
    total_quantity: totalQuantity,
    remaining_quantity: Number.isFinite(remainingQuantity) ? remainingQuantity : totalQuantity,
    quantity_unit: formData.unit,
    dose_amount: doseAmount,
    dose_unit: formData.dose_unit,
    frequency_type: frequency.type,
    frequency_details: frequency.details,
    price,
    expires_at: toStringValue(formData.expires_at) || null,
    reminder_timezone: toStringValue(formData.reminder_timezone) || null,
    start_at: normalizeDateInputValue(formData.start_at) || null,
  };

  if (formData.start_at && !payload.start_at) {
    errors.start_at = '\u0412\u0432\u0435\u0434\u0438\u0442\u0435 \u0434\u0430\u0442\u0443 \u0432 \u0444\u043e\u0440\u043c\u0430\u0442\u0435 \u0414\u0414.\u041c\u041c.\u0413\u0413\u0413\u0413';
  }

  return { payload, errors };
}

function setFrequencyFromDetails(type, details = {}) {
  const normalizedDetails = parseFrequencyValue(details) || {};

  if (type === 'times_per_day') {
    const count = Number(normalizedDetails.timesPerDay || normalizedDetails.times_per_day || 1);
    timesPerDayInput.value = String(count);
    renderSlotsFromCount(timesPerDaySlots, count);
    fillSlotsFromValues(timesPerDaySlots, normalizedDetails.times || []);
    return;
  }

  if (type === 'meal_plan') {
    mealCheckboxes.forEach((checkbox) => {
      const selected = Array.isArray(normalizedDetails.meals) && normalizedDetails.meals.includes(checkbox.value);
      checkbox.checked = Boolean(selected);
      const target = document.getElementById(checkbox.dataset.timeTarget);
      if (!target) {
        return;
      }

      const mealValue = normalizedDetails.mealTimes?.[checkbox.value];
      target.value = mealValue || target.value;
      target.disabled = !selected;
    });
    return;
  }

  if (type === 'every_n_hours') {
    const everyHours = Number(normalizedDetails.everyHours || normalizedDetails.every_hours || 8);
    everyHoursInput.value = String(everyHours);
    everyStartTimeInput.value = normalizedDetails.startTime || normalizedDetails.start_time || '08:00';
    const count = Math.max(1, Math.floor(24 / everyHours));
    renderSlotsFromCount(everyHoursSlots, count);
    fillSlotsFromValues(everyHoursSlots, normalizedDetails.times || []);
    return;
  }

  if (type === 'weekly') {
    const dayInputs = [...document.querySelectorAll('input[name="weeklyDay"]')];
    const selectedDays = new Set(Array.isArray(normalizedDetails.days) ? normalizedDetails.days : []);
    dayInputs.forEach((checkbox) => {
      checkbox.checked = selectedDays.has(Number(checkbox.value));
    });

    weeklyTimesInput.value = String(Number(normalizedDetails.timesPerDay || normalizedDetails.times_per_day || 1));
    const count = Number(weeklyTimesInput.value || 1);
    renderSlotsFromCount(weeklySlots, count);
    const dayTimes = normalizedDetails.dayTimes || {};
    const firstDay = selectedDays.values().next().value;
    const values = firstDay ? dayTimes[firstDay] : [];
    fillSlotsFromValues(weeklySlots, values || []);
  }

  if (type === 'week_cycle') {
    weekOnWeeksInput.value = String(Number(normalizedDetails.onWeeks || 1));
    weekOffWeeksInput.value = String(Number(normalizedDetails.offWeeks || 0));
    weekCycleTimesPerDayInput.value = String(Number(normalizedDetails.timesPerDay || 1));
    const times = normalizedDetails.times || [];
    const count = Number(weekCycleTimesPerDayInput.value || 1);
    renderSlotsFromCount(weekCycleSlots, count);
    fillSlotsFromValues(weekCycleSlots, times);
    return;
  }

  if (type === 'monthly_cycle') {
    monthOnMonthsInput.value = String(Number(normalizedDetails.onMonths || 1));
    monthOffMonthsInput.value = String(Number(normalizedDetails.offMonths || 0));
    monthCycleTimesPerDayInput.value = String(Number(normalizedDetails.timesPerDay || 1));
    const times = normalizedDetails.times || [];
    const count = Number(monthCycleTimesPerDayInput.value || 1);
    renderSlotsFromCount(monthCycleSlots, count);
    fillSlotsFromValues(monthCycleSlots, times);
  }
}

function buildMedicationPayload() {
  const { payload, errors } = parseFormData();

  Object.entries(errors).forEach(([id, message]) => setError(id, message));

  if (Object.keys(errors).length > 0) {
    return null;
  }

  return payload;
}

async function apiRequest(path, options = {}) {
  const response = await fetch(path, {
    headers: {
      'x-telegram-user-id': String(API_USER_ID),
      'content-type': 'application/json',
      ...options.headers,
    },
    ...options,
    body: options.body ? JSON.stringify(options.body) : options.body,
  });

  const data = await response.json();
  if (!response.ok || !data?.ok) {
    throw new Error(data?.error || UI_TEXT.errors.server);
  }

  return data;
}

function getMedicationListParams() {
  const params = new URLSearchParams();

  const search = toStringValue(searchFilter.value);
  if (search) {
    params.set('search', search);
  }

  const sort = toStringValue(sortFilter.value);
  if (sort) {
    params.set('sort', sort);
  }

  const status = toStringValue(statusFilter.value);
  if (status === 'active') {
    params.set('status', 'active');
  }
  if (status === 'archived') {
    params.set('status', 'archived');
  }

  if (lowStockFilter.checked) {
    params.set('lowStock', '1');
  }

  if (expiringFilter.checked) {
    params.set('expiring_soon', String(LOW_STOCK_DAYS_DEFAULT));
  }

  return params;
}

function computeUrgencyHint(medication) {
  const urgency = medication.reminderUrgency || medication.reminder_urgency;
  if (urgency === 'critical') {
    return '\u0412\u043d\u0438\u043c\u0430\u043d\u0438\u0435';
  }
  if (urgency === 'high') {
    return '\u0412\u044b\u0441\u043e\u043a\u0430\u044f';
  }
  if (urgency === 'warning') {
    return '\u0423\u0432\u0435\u0434\u043e\u043c\u043b\u0435\u043d\u0438\u0435';
  }
  if (urgency === 'medium') {
    return '\u0421\u0440\u0435\u0434\u043d\u044f\u044f';
  }
  if (urgency === 'expired') {
    return '\u041f\u0440\u043e\u0441\u0440\u043e\u0447\u0435\u043d\u043e';
  }
  return '\u041f\u043e\u043b\u0435';
}

function renderMedicationCard(medication) {
  const status = medicationField(medication, 'stock_state', 'stockState') || 'normal';
  const dosage = `${medicationField(medication, 'dose_amount', 'doseAmount') || 0} ${toDisplayUnit(
    medicationField(medication, 'dose_unit', 'doseUnit') || 'шт.',
  )}`;
  const remaining = Number(medicationField(medication, 'remaining_quantity', 'remainingQuantity') || 0);
  const total = Number(medicationField(medication, 'total_quantity', 'totalQuantity') || 0);
  const percent = total > 0 ? Math.max(0, Math.min(100, Math.round((remaining / total) * 100))) : 0;
  const isActive = medicationField(medication, 'is_active', 'isActive');
  const urgency = computeUrgencyHint(medication);

  const schedule = toStringValue(medicationField(medication, 'next_due_at', 'nextDueAt'));
  const frequencyLabel = medicationField(medication, 'frequency_label', 'frequencyLabel') || '';

  const statusLabel = {
    low: '\u041d\u0438\u0437\u043a\u0438\u0439 \u043e\u0441\u0442\u0430\u0442\u043e\u043a',
    expired: '\u041f\u0440\u043e\u0441\u0440\u043e\u0447\u0435\u043d',
    normal: '\u041d\u043e\u0440\u043c\u0430\u043b\u044c\u043d\u044b\u0439',
  }[status] || '\u041d\u0435\u0438\u0437\u0432\u0435\u0441\u0442\u043d\u043e';

  const urgencyType = medicationField(medication, 'reminder_urgency', 'reminderUrgency') || '';
  const urgencyClass = `urgency-${urgencyType || 'normal'}`;

  const stockClasses = {
    low: 'card-low',
    expired: 'card-danger',
  };
  const card = document.createElement('article');
  card.className = `card ${stockClasses[status] || ''}`;
  card.innerHTML = `
    <header class="card-header">
      <h3>${escapeHTML(medication.name)}</h3>
    </header>
    <p>\u0414\u043e\u0437\u043e\u0432\u043a\u0430: ${escapeHTML(dosage)}</p>
    <p>\u041e\u0441\u0442\u0430\u0442\u043e\u043a: ${escapeHTML(remaining.toFixed(2))} / ${escapeHTML(total.toFixed(2))} ${escapeHTML(toDisplayUnit(
      medicationField(medication, 'quantity_unit', 'quantityUnit') || 'шт.',
    ))}</p>
    <div class="progress">
      <div class="progress-fill" style="width:${percent}%"></div>
    </div>
    <p>\u041e\u0446\u0435\u043d\u043a\u0430 \u0434\u043e: ${escapeHTML((medicationField(medication, 'estimated_days_left', 'estimatedDaysLeft') ?? '-'))} \u0434\u043d.</p>
    <p>\u0420\u0430\u0441\u043f\u0438\u0441\u0430\u043d\u0438\u0435: ${escapeHTML(frequencyLabel || '\u041d\u0435 \u0443\u043a\u0430\u0437\u0430\u043d\u043e')}</p>
    <p>\u0421\u043b\u0435\u0434\u0443\u0449\u0438\u0439 \u043f\u0440\u0438\u0451\u043c: ${escapeHTML(formatDateTime(schedule) || '-') } <span class="urgency ${urgencyClass}">${escapeHTML(urgency)}</span></p>
    <p>\u0418\u0441\u0442\u0435\u043a\u0430\u0435\u0442: ${escapeHTML(formatDate(medicationField(medication, 'expires_at', 'expiresAt') || ''))}</p>
    <p>\u0421\u0442\u0430\u0442\u0443\u0441: ${escapeHTML(statusLabel)}</p>
    <p>\u0414\u043d\u0435\u0439 \u0434\u043e \u043f\u0440\u043e\u0441\u0440\u043e\u0447\u043a\u0438: ${escapeHTML(medicationField(medication, 'expires_in_days', 'expiresInDays') ?? '-')} \u0434\u043d.</p>
    <div class="card-actions">
      ${isActive ? `<button data-action="take" data-id="${medication.id}">\u041f\u0440\u0438\u043d\u044f\u0442\u044c \u0434\u043e\u0437\u0443</button>` : ''}
      <button data-action="edit" data-id="${medication.id}">\u0420\u0435\u0434\u0430\u043a\u0442\u0438\u0440\u043e\u0432\u0430\u0442\u044c</button>
      ${isActive
      ? `<button data-action="archive" data-id="${medication.id}">\u0412 \u0430\u0440\u0445\u0438\u0432</button>`
      : `<button data-action="restore" data-id="${medication.id}">\u0412\u043e\u0441\u0442\u0430\u043d\u043e\u0432\u0438\u0442\u044c</button>`}
      <button data-action="events" data-id="${medication.id}">\u0418\u0441\u0442\u043e\u0440\u0438\u044f</button>
    </div>
  `;

  medList.appendChild(card);
}

function renderEmpty() {
  medList.innerHTML = '';
  const mode = statusFilter.value === 'archived' ? 'archived' : statusFilter.value === 'active' ? 'active' : 'all';
  const parts = [];
  const search = toStringValue(searchFilter.value);
  if (search) {
    parts.push(`name "${search}"`);
  }
  const label = parts.length ? ` (${parts.join(', ')})` : '';
  const modeLabel = mode === 'active' ? UI_TEXT.status.active : mode === 'archived' ? UI_TEXT.status.archived : UI_TEXT.status.all;
  medListEmpty.textContent = `\u041d\u0435\u0442 \u043d\u0430\u0439\u0434\u0435\u043d\u043e ${modeLabel} \u043b\u0435\u043a\u0430\u0440\u0441\u0442\u0432${label}.`;
}

async function loadMedications() {
  medListEmpty.textContent = UI_TEXT.filters.loading;

  try {
    const response = await apiRequest(`/api/medications?${getMedicationListParams().toString()}`);
    const medications = response.data || [];

    medList.innerHTML = '';

    medsCache = medications;
    calendarMarksByDate = buildCalendarMarks(medications);
    if (activeView === 'calendar') {
      renderCalendar(calendarMonthCursor);
    }

    if (!medications.length) {
      renderEmpty();
      return;
    }

    medListEmpty.textContent = '';
    medications.forEach(renderMedicationCard);
  } catch (error) {
    medListEmpty.textContent = error.message;
  }
}

let medsCache = [];

function findMedicationById(id) {
  const numberId = Number(id);
  return medsCache.find((item) => item.id === numberId);
}

function openEditModal(medication) {
  editingMedicationId = medication.id;
  modalTitle.textContent = '\u0420\u0435\u0434\u0430\u043a\u0442\u0438\u0440\u043e\u0432\u0430\u043d\u0438\u0435 \u043b\u0435\u043a\u0430\u0440\u0441\u0442\u0432\u0430';
  submitButton.textContent = '\u0421\u043e\u0445\u0440\u0430\u043d\u0438\u0442\u044c';

  medForm.elements.name.value = medication.name || '';
  medForm.elements.total_quantity.value = medicationField(medication, 'total_quantity', 'totalQuantity') ?? '';
  if (medForm.elements.remaining_quantity) {
    medForm.elements.remaining_quantity.value = medicationField(medication, 'remaining_quantity', 'remainingQuantity') ?? '';
  }
  unitSelect.value = medicationField(medication, 'quantity_unit', 'quantityUnit') || unitSelect.value;
  medForm.elements.dose_amount.value = medicationField(medication, 'dose_amount', 'doseAmount') ?? '';
  doseUnitSelect.value = medicationField(medication, 'dose_unit', 'doseUnit') || doseUnitSelect.value;
  medForm.elements.price.value = medication.price ?? '';
  const expiresAt = medicationField(medication, 'expires_at', 'expiresAt');
  medForm.elements.expires_at.value = expiresAt ? expiresAt.slice(0, 10) : '';
  medForm.elements.reminder_timezone.value = medicationField(medication, 'reminder_timezone', 'reminderTimezone') || '';
  const startAt = medicationField(medication, 'start_at', 'startAt');
  medForm.elements.start_at.value = startAt ? formatDateInputValue(startAt) : '';

  const frequencyType = medicationField(medication, 'frequency_type', 'frequencyType') || 'times_per_day';
  const radio = frequencyRadios.find((item) => item.value === frequencyType);
  if (radio) {
    radio.checked = true;
  }

  applyFrequencyType(frequencyType);
  setFrequencyFromDetails(frequencyType, medicationField(medication, 'frequency_value', 'frequencyValue') || {});
  updateWeekCheckboxes();

  showModal();
}

async function archiveMedication(id) {
  try {
    await apiRequest(`/api/medications/${id}`, { method: 'DELETE' });
    await loadMedications();
  } catch (error) {
    alert(error.message);
  }
}

async function restoreMedication(id) {
  try {
    await apiRequest(`/api/medications/${id}/restore`, { method: 'POST' });
    await loadMedications();
  } catch (error) {
    alert(error.message);
  }
}

async function takeMedication(id, medication) {
  const defaultQuantity = Number(medicationField(medication, 'dose_amount', 'doseAmount') || DEFAULT_TAKE_QUANTITY);
  const doseUnit = toDisplayUnit(medicationField(medication, 'dose_unit', 'doseUnit') || 'шт.');
  const rawQuantity = window.prompt(`\u0412\u0432\u0435\u0434\u0438\u0442\u0435 \u0434\u043e\u0437\u0443 (${doseUnit}):`, String(defaultQuantity));
  const quantity = Number(rawQuantity);
  if (!Number.isFinite(quantity) || quantity <= 0) {
    return;
  }

  try {
    await apiRequest(`/api/medications/${id}/take`, {
      method: 'POST',
      body: {
        quantity,
      },
    });
    await loadMedications();
  } catch (error) {
    alert(error.message);
  }
}

async function openEvents(id) {
  try {
    const response = await apiRequest(`/api/medications/${id}/events`);
    const events = response.data || [];
    if (!events.length) {
      alert('\u041d\u0435\u0442 \u0441\u043e\u0431\u044b\u0442\u0438\u0439 \u0434\u043b\u044f \u044d\u0442\u043e\u0433\u043e \u043b\u0435\u043a\u0430\u0440\u0441\u0442\u0432\u0430');
      return;
    }

    const text = events
      .slice(0, 20)
      .map((event) => `${event.kind} ${new Date(event.at).toLocaleString('ru-RU')}`)
      .join('\n');
    alert(text);
  } catch (error) {
    alert(error.message);
  }
}

async function onSubmit(event) {
  event.preventDefault();
  clearErrors();

  const payload = buildMedicationPayload();
  if (!payload) {
    return;
  }

  const path = editingMedicationId ? `/api/medications/${editingMedicationId}` : '/api/medications';
  const method = editingMedicationId ? 'PUT' : 'POST';

  try {
    await apiRequest(path, { method, body: payload });
    hideModal();
    await loadMedications();
  } catch (error) {
    alert(error.message);
  }
}

async function onMedicationAction(event) {
  const button = event.target.closest('button[data-action]');
  if (!button) {
    return;
  }

  const id = button.dataset.id;
  const action = button.dataset.action;
  const medication = findMedicationById(id);

  if (action === 'edit') {
    if (!medication) {
      return;
    }
    openEditModal(medication);
    return;
  }

  if (action === 'archive') {
    await archiveMedication(id);
    return;
  }

  if (action === 'restore') {
    await restoreMedication(id);
    return;
  }

  if (action === 'take') {
    window.setTimeout(() => {
      void takeMedication(id, medication);
    }, 0);
    return;
  }

  if (action === 'events') {
    await openEvents(id);
  }
}

async function loadUnits() {
  try {
    const response = await apiRequest('/api/units');
    const units = response.data || [];
    if (!units.length) {
      return;
    }

    for (const unit of units) {
      const code = toStringValue(unit.code).toLowerCase();
      const label = toStringValue(unit.label);
      if (code) {
        unitLabelByCode[code] = label || code;
      }
    }

    unitSelect.innerHTML = '';
    doseUnitSelect.innerHTML = '';
    for (const unit of units) {
      const option = document.createElement('option');
      option.value = unit.code;
      option.textContent = unit.label;
      unitSelect.appendChild(option);

      const doseOption = option.cloneNode(true);
      doseUnitSelect.appendChild(doseOption);
    }
  } catch (_error) {
    // keep defaults
  }
}

async function init() {
  document.documentElement.lang = 'ru';
  force24HourTimeInputs();
  if (startAtInput) {
    startAtInput.lang = 'ru';
  }
  loadUnits();
  await loadMedications();
  setActiveView('list');
}

if (navListBtn) {
  navListBtn.addEventListener('click', () => setActiveView('list'));
}

if (navCalendarBtn) {
  navCalendarBtn.addEventListener('click', () => setActiveView('calendar'));
}

if (calendarPrevBtn) {
  calendarPrevBtn.addEventListener('click', () => {
    calendarMonthCursor = new Date(calendarMonthCursor.getFullYear(), calendarMonthCursor.getMonth() - 1, 1);
    renderCalendar(calendarMonthCursor);
  });
}

if (calendarNextBtn) {
  calendarNextBtn.addEventListener('click', () => {
    calendarMonthCursor = new Date(calendarMonthCursor.getFullYear(), calendarMonthCursor.getMonth() + 1, 1);
    renderCalendar(calendarMonthCursor);
  });
}

if (calendarTodayBtn) {
  calendarTodayBtn.addEventListener('click', () => {
    calendarMonthCursor = new Date();
    renderCalendar(calendarMonthCursor);
  });
}

if (calendarGrid) {
  calendarGrid.addEventListener('click', (event) => {
    const target = event.target.closest('.calendar__cell');
    if (!target) {
      return;
    }
    const dateISO = toStringValue(target.dataset.date);
    if (!dateISO) {
      return;
    }
    renderCalendarDetails(dateISO);
  });
}

openModalBtn.addEventListener('click', () => {
  editingMedicationId = null;
  modalTitle.textContent = '\u0414\u043e\u0431\u0430\u0432\u0438\u0442\u044c \u043b\u0435\u043a\u0430\u0440\u0441\u0442\u0432\u043e';
  submitButton.textContent = '\u0421\u043e\u0437\u0434\u0430\u0442\u044c';
  medForm.reset();
  if (medForm.elements.start_at) {
    medForm.elements.start_at.value = getTodayDateValue();
  }
  applyFrequencyType('times_per_day');
  updateWeekCheckboxes();
  clearErrors();
  showModal();
});

closeModalBtn.addEventListener('click', hideModal);

modal.addEventListener('click', (event) => {
  if (event.target === modal) {
    hideModal();
  }
});

frequencyRadios.forEach((radio) => {
  radio.addEventListener('change', (event) => {
    applyFrequencyType(event.target.value);
  });
});

timesPerDayInput.addEventListener('input', () => {
  renderSlotsFromCount(timesPerDaySlots, Number(timesPerDayInput.value || 1));
});

everyHoursInput.addEventListener('input', () => {
  const normalizedHours = normalizePositiveNumber(everyHoursInput.value, 1);
  renderSlotsFromCount(everyHoursSlots, Math.max(1, Math.floor(24 / normalizedHours)));
});

weeklyTimesInput.addEventListener('input', () => {
  renderSlotsFromCount(weeklySlots, Number(weeklyTimesInput.value || 1));
});

weekCycleTimesPerDayInput.addEventListener('input', () => {
  renderSlotsFromCount(weekCycleSlots, Number(weekCycleTimesPerDayInput.value || 1));
});

monthCycleTimesPerDayInput.addEventListener('input', () => {
  renderSlotsFromCount(monthCycleSlots, Number(monthCycleTimesPerDayInput.value || 1));
});

document.querySelectorAll('input[name="meal"]')
  .forEach((checkbox) => {
    checkbox.addEventListener('change', (event) => {
      const field = document.getElementById(event.currentTarget.dataset.timeTarget);
      if (field) {
        field.disabled = !event.currentTarget.checked;
      }
    });
  });

document.querySelectorAll('input[name="weeklyDay"]').forEach((checkbox) => {
  checkbox.addEventListener('change', updateWeekCheckboxes);
});

medForm.addEventListener('submit', onSubmit);
medList.addEventListener('click', onMedicationAction);

searchFilter.addEventListener('input', loadMedications);
sortFilter.addEventListener('change', loadMedications);
statusFilter.addEventListener('change', loadMedications);
lowStockFilter.addEventListener('change', loadMedications);
expiringFilter.addEventListener('change', loadMedications);

init();
