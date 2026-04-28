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
    allCategories: 'Все категории',
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
const categoryFilter = document.getElementById('category-filter');

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

let editingMedicationId = null;

function toStringValue(value) {
  return typeof value === 'string' ? value.trim() : '';
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

function escapeHTML(value) {
  const stringValue = String(value ?? '');
  return stringValue
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
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
    const count = Math.max(1, Math.floor(24 / Number(everyHoursInput.value || 8)));
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
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
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
    category: toStringValue(formData.category) || null,
    expires_at: toStringValue(formData.expires_at) || null,
    reminder_timezone: toStringValue(formData.reminder_timezone) || null,
    start_at: toStringValue(formData.start_at) || null,
  };

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

  const category = toStringValue(categoryFilter?.value);
  if (category) {
    params.set('category', category);
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
  const dosage = `${medicationField(medication, 'dose_amount', 'doseAmount') || 0} ${medicationField(medication, 'dose_unit', 'doseUnit') || 'pcs.'}`;
  const remaining = Number(medicationField(medication, 'remaining_quantity', 'remainingQuantity') || 0);
  const total = Number(medicationField(medication, 'total_quantity', 'totalQuantity') || 0);
  const percent = total > 0 ? Math.max(0, Math.min(100, Math.round((remaining / total) * 100))) : 0;
  const isActive = medicationField(medication, 'is_active', 'isActive');
  const urgency = computeUrgencyHint(medication);

  const schedule = toStringValue(medicationField(medication, 'next_due_at', 'nextDueAt'));
  const frequencyLabel = medicationField(medication, 'frequency_label', 'frequencyLabel') || '';

  const category = medication.category || '\u0411\u0435\u0437 \u043a\u0430\u0442\u0435\u0433\u043e\u0440\u0438\u0438';

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
      <span>${escapeHTML(category)}</span>
    </header>
    <p>\u0414\u043e\u0437\u043e\u0432\u043a\u0430: ${escapeHTML(dosage)}</p>
    <p>\u041e\u0441\u0442\u0430\u0442\u043e\u043a: ${escapeHTML(remaining.toFixed(2))} / ${escapeHTML(total.toFixed(2))} ${escapeHTML(medicationField(medication, 'quantity_unit', 'quantityUnit') || 'pcs.')}</p>
    <div class="progress">
      <div class="progress-fill" style="width:${percent}%"></div>
    </div>
    <p>\u041e\u0446\u0435\u043d\u043a\u0430 \u0434\u043e: ${escapeHTML((medicationField(medication, 'estimated_days_left', 'estimatedDaysLeft') ?? '-'))} \u0434\u043d.</p>
    <p>\u0420\u0430\u0441\u043f\u0438\u0441\u0430\u043d\u0438\u0435: ${escapeHTML(frequencyLabel || '\u041d\u0435 \u0443\u043a\u0430\u0437\u0430\u043d\u043e')}</p>
    <p>\u0421\u043b\u0435\u0434\u0443\u0449\u0438\u0439 \u043f\u0440\u0438\u0451\u043c: ${escapeHTML(schedule || '-') } <span class="urgency ${urgencyClass}">${escapeHTML(urgency)}</span></p>
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

function updateCategoryFilterOptions(medications) {
  if (!categoryFilter) {
    return;
  }

  const categories = new Set();
  medications.forEach((medication) => {
    const category = medicationField(medication, 'category', 'category');
    if (category) {
      categories.add(category);
    }
  });

  const previous = categoryFilter.value || '';
  categoryFilter.innerHTML = `<option value="">${UI_TEXT.filters.allCategories}</option>${[...categories]
    .sort((left, right) => left.localeCompare(right))
    .map((category) => `<option value="${category}">${category}</option>`)
    .join('')}`;

  if ([...categoryFilter.options].some((option) => option.value === previous)) {
    categoryFilter.value = previous;
  }
}

async function loadMedications() {
  medListEmpty.textContent = UI_TEXT.filters.loading;

  try {
    const response = await apiRequest(`/api/medications?${getMedicationListParams().toString()}`);
    const medications = response.data || [];
    updateCategoryFilterOptions(medications);

    medList.innerHTML = '';

    if (!medications.length) {
      renderEmpty();
      return;
    }

    medListEmpty.textContent = '';
    medsCache = medications;
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
  if (medForm.elements.category) {
    medForm.elements.category.value = medication.category || '';
  }
  const expiresAt = medicationField(medication, 'expires_at', 'expiresAt');
  medForm.elements.expires_at.value = expiresAt ? expiresAt.slice(0, 10) : '';
  medForm.elements.reminder_timezone.value = medicationField(medication, 'reminder_timezone', 'reminderTimezone') || '';
  const startAt = medicationField(medication, 'start_at', 'startAt');
  medForm.elements.start_at.value = startAt ? startAt.slice(0, 10) : '';

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
  const doseUnit = medicationField(medication, 'dose_unit', 'doseUnit') || 'pcs.';
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
    await takeMedication(id, medication);
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
  if (startAtInput) {
    startAtInput.lang = 'ru';
  }
  loadUnits();
  await loadMedications();
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
  renderSlotsFromCount(everyHoursSlots, Math.max(1, Math.floor(24 / Number(everyHoursInput.value || 1))));
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
if (categoryFilter) {
  categoryFilter.addEventListener('change', loadMedications);
}

init();
