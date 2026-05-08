import { expect, test } from '@playwright/test';

function uniqueUserId() {
  return 1_000_000 + Date.now() + Math.floor(Math.random() * 1000);
}

function dateStringOffset(days = 0) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function medicationCard(page, name) {
  return page.locator('#med-list article.card', { hasText: name });
}

async function openApp(page) {
  const telegramUserId = uniqueUserId();
  await page.goto(`/?telegram_user_id=${telegramUserId}`);
  await expect(page.locator('#status-filter')).toBeVisible();
  return telegramUserId;
}

async function fillTimeSlots(container, values) {
  const inputs = container.locator('input[type="time"]');
  const count = await inputs.count();
  const total = Math.min(count, values.length);
  for (let index = 0; index < total; index += 1) {
    await inputs.nth(index).fill(values[index]);
  }
}

async function setInputValue(page, selector, value) {
  const valueString = String(value);
  const field = page.locator(selector);
  if (value === null || value === undefined || valueString === '') {
    return;
  }

  const fieldType = await field.getAttribute('type');
  if (fieldType === 'hidden' || fieldType === 'time') {
    await field.evaluate((element, nextValue) => {
      element.value = nextValue;
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
    }, valueString);
    return;
  }

  try {
    await field.fill(valueString);
  } catch (_error) {
    await field.evaluate((element, nextValue) => {
      element.value = nextValue;
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
    }, valueString);
  }
}

async function waitForMedicationListSort(page, sortValue) {
  return page.waitForResponse((response) => {
    if (!response.url().includes('/api/medications')) {
      return false;
    }
    if (response.request().method() !== 'GET') {
      return false;
    }
    if (response.status() < 200 || response.status() >= 300) {
      return false;
    }

    return response.url().includes(`sort=${encodeURIComponent(sortValue)}`);
  });
}

async function createMedication(page, options) {
  const {
    name,
    totalQuantity,
    doseAmount,
    frequencyType = 'times_per_day',
    quantityUnit = 'tabs',
    doseUnit = 'tabs',
    expiresAt = '',
    startAt = '',
    configure,
  } = options;

  await page.locator('#open-med-modal').click();
  await page.locator('[name="name"]').fill(name);
  await page.locator('[name="total_quantity"]').fill(String(totalQuantity));
  await page.locator('[name="dose_amount"]').fill(String(doseAmount));
  await page.locator('[name="unit"]').selectOption(quantityUnit);
  await page.locator('[name="dose_unit"]').selectOption(doseUnit);
  await page.locator(`[name="frequency_type"][value="${frequencyType}"]`).check();

  if (expiresAt) {
    await setInputValue(page, 'input[name="expires_at"]', expiresAt);
  }
  if (startAt) {
    await setInputValue(page, 'input[name="start_at"]', startAt);
  }

  if (configure) {
    await configure(page);
  }

  const createRequest = page.waitForResponse((response) => {
    return response.url().includes('/api/medications') && response.request().method() === 'POST';
  });

  await page.locator('#med-form button[type="submit"]').click();
  await createRequest;

  await expect(page.locator('#med-modal')).toHaveClass(/hidden/);
  await expect(medicationCard(page, name)).toBeVisible();
}

async function openHistory(page, name) {
  const card = medicationCard(page, name);
  const dialogPromise = page.waitForEvent('dialog');
  await card.locator('[data-action="events"]').click();
  const dialog = await dialogPromise;
  return dialog;
}

async function takeMedicationViaPrompt(page, name, quantity) {
  const card = medicationCard(page, name);
  const promptPromise = page.waitForEvent('dialog');
  await card.locator('[data-action="take"]').click();
  const prompt = await promptPromise;
  expect(prompt.type()).toBe('prompt');
  await prompt.accept(String(quantity));
}

async function createByType(page, options) {
  await createMedication(page, options);
}

test('ui form validation for required fields', async ({ page }) => {
  await openApp(page);
  await page.locator('#open-med-modal').click();
  await page.locator('#med-form button[type="submit"]').click();

  await expect(page.locator('.field-error[data-error-for="name"]')).toHaveText(/.+/);
  await expect(page.locator('.field-error[data-error-for="total_quantity"]')).toHaveText(/.+/);
  await expect(page.locator('.field-error[data-error-for="dose_amount"]')).toHaveText(/.+/);
  await expect(page.locator('#med-modal')).not.toHaveClass(/hidden/);
});

test('can create medication and show it in list', async ({ page }) => {
  const userId = await openApp(page);
  const name = `med-basic-${userId}`;

  await createMedication(page, {
    name,
    totalQuantity: 10,
    doseAmount: 1,
  });

  const card = medicationCard(page, name);
  await expect(card).toBeVisible();
  await expect(card).toContainText('10.00');
});

test('can create times_per_day schedule', async ({ page }) => {
  const userId = await openApp(page);
  const name = `med-times-${userId}`;

  await createMedication(page, {
    name,
    totalQuantity: 30,
    doseAmount: 2,
    frequencyType: 'times_per_day',
    configure: async (currentPage) => {
      await currentPage.locator('#timesPerDay').fill('3');
      await currentPage.locator('#timesPerDay').dispatchEvent('input');
      await fillTimeSlots(currentPage.locator('#timesPerDaySlots'), ['07:30', '13:00', '19:00']);
    },
  });

  await expect(medicationCard(page, name)).toBeVisible();
});

test('can create meal plan schedule', async ({ page }) => {
  const userId = await openApp(page);
  const name = `med-meal-${userId}`;

  await createMedication(page, {
    name,
    totalQuantity: 20,
    doseAmount: 1,
    frequencyType: 'meal_plan',
    configure: async (currentPage) => {
      await currentPage.locator('input[name="meal"][value="breakfast"]').check();
      await currentPage.locator('input[name="meal"][value="dinner"]').check();
      await setInputValue(currentPage, '#meal-breakfast', '07:30');
      await setInputValue(currentPage, '#meal-dinner', '20:10');
    },
  });

  await expect(medicationCard(page, name)).toBeVisible();
});

test('can create weekly schedule', async ({ page }) => {
  const userId = await openApp(page);
  const name = `med-weekly-${userId}`;

  await createMedication(page, {
    name,
    totalQuantity: 30,
    doseAmount: 1,
    frequencyType: 'weekly',
    configure: async (currentPage) => {
      await currentPage.locator('input[name="weeklyDay"][value="1"]').check();
      await currentPage.locator('input[name="weeklyDay"][value="3"]').check();
      await currentPage.locator('#weeklyTimes').fill('2');
      await currentPage.locator('#weeklyTimes').dispatchEvent('input');
      await fillTimeSlots(currentPage.locator('#weeklySlots'), ['08:00', '20:00']);
    },
  });

  await expect(medicationCard(page, name)).toBeVisible();
});

test('can create every_n_hours schedule', async ({ page }) => {
  const userId = await openApp(page);
  const name = `med-every-${userId}`;

  await createMedication(page, {
    name,
    totalQuantity: 24,
    doseAmount: 1,
    frequencyType: 'every_n_hours',
    configure: async (currentPage) => {
      await setInputValue(currentPage, '#everyHours', '6');
      await setInputValue(currentPage, '#everyStartTime', '08:00');
      await currentPage.locator('#everyHours').dispatchEvent('input');
      await fillTimeSlots(currentPage.locator('#everyHoursSlots'), ['08:00', '14:00', '20:00', '02:00']);
    },
  });

  await expect(medicationCard(page, name)).toBeVisible();
});

test('can create week cycle schedule', async ({ page }) => {
  const userId = await openApp(page);
  const name = `med-week-cycle-${userId}`;

  await createMedication(page, {
    name,
    totalQuantity: 25,
    doseAmount: 2,
    frequencyType: 'week_cycle',
    configure: async (currentPage) => {
      await currentPage.locator('#weekOnWeeks').fill('2');
      await currentPage.locator('#weekOffWeeks').fill('1');
      await currentPage.locator('#weekCycleTimesPerDay').fill('2');
      await currentPage.locator('#weekCycleTimesPerDay').dispatchEvent('input');
      await fillTimeSlots(currentPage.locator('#weekCycleSlots'), ['08:00', '20:00']);
    },
  });

  await expect(medicationCard(page, name)).toBeVisible();
});

test('can create month cycle schedule', async ({ page }) => {
  const userId = await openApp(page);
  const name = `med-month-cycle-${userId}`;

  await createMedication(page, {
    name,
    totalQuantity: 18,
    doseAmount: 1,
    frequencyType: 'monthly_cycle',
    configure: async (currentPage) => {
      await currentPage.locator('#monthOnMonths').fill('1');
      await currentPage.locator('#monthOffMonths').fill('1');
      await currentPage.locator('#monthCycleTimesPerDay').fill('1');
      await currentPage.locator('#monthCycleTimesPerDay').dispatchEvent('input');
      await fillTimeSlots(currentPage.locator('#monthCycleSlots'), ['09:00']);
    },
  });

  await expect(medicationCard(page, name)).toBeVisible();
});

test('invalid every_n_hours configuration stays in form', async ({ page }) => {
  await openApp(page);
  await page.locator('#open-med-modal').click();
  await page.locator('[name="name"]').fill('validation-frequency');
  await page.locator('[name="total_quantity"]').fill('10');
  await page.locator('[name="dose_amount"]').fill('1');
  await page.locator('[name="frequency_type"][value="every_n_hours"]').check();
  await setInputValue(page, '#everyHours', '0');
  await setInputValue(page, '#everyStartTime', '25:00');

  await page.locator('#med-form button[type="submit"]').click();
  await expect(page.locator('.field-error[data-error-for="every_n_hours"]')).toContainText(/.+/);
  await expect(page.locator('#med-modal')).not.toHaveClass(/hidden/);
});

test('editing medication updates card', async ({ page }) => {
  const userId = await openApp(page);
  const before = `med-before-${userId}`;
  const after = `med-after-${userId}`;

  await createMedication(page, {
    name: before,
    totalQuantity: 12,
    doseAmount: 1,
  });

  const card = medicationCard(page, before);
  await card.locator('[data-action="edit"]').click();

  await page.locator('[name="name"]').fill(after);

  const updateRequest = page.waitForResponse((response) => {
    return response.url().includes('/api/medications') && response.request().method() === 'PUT';
  });

  await page.locator('#med-form button[type="submit"]').click();
  await updateRequest;

  await expect(page.locator('#med-modal')).toHaveClass(/hidden/);
  await expect(medicationCard(page, after)).toBeVisible();
  await expect(medicationCard(page, before)).toHaveCount(0);
});

test('taking dose decreases remaining value', async ({ page }) => {
  const userId = await openApp(page);
  const name = `med-take-${userId}`;

  await createMedication(page, {
    name,
    totalQuantity: 10,
    doseAmount: 2,
  });

  await takeMedicationViaPrompt(page, name, 1);
  await expect(medicationCard(page, name)).toContainText('9.00');
});

test('cannot take more than remaining', async ({ page }) => {
  const userId = await openApp(page);
  const name = `med-take-error-${userId}`;

  await createMedication(page, {
    name,
    totalQuantity: 2,
    doseAmount: 1,
  });

  const promptPromise = page.waitForEvent('dialog');
  await medicationCard(page, name).locator('[data-action="take"]').click();
  const prompt = await promptPromise;
  await prompt.accept('100');

  const alertDialog = await page.waitForEvent('dialog');
  const message = await alertDialog.message();
  await alertDialog.accept();
  expect(message.length).toBeGreaterThan(0);
});

test('history dialog opens for med and contains actions', async ({ page }) => {
  const userId = await openApp(page);
  const name = `med-history-${userId}`;

  await createMedication(page, {
    name,
    totalQuantity: 8,
    doseAmount: 1,
  });

  const dialog = await openHistory(page, name);
  const message = await dialog.message();
  expect(message).toContain('create');
  await dialog.accept();
});

test('search by name filters list', async ({ page }) => {
  const userId = await openApp(page);
  const first = `search-target-${userId}`;
  const second = `search-other-${userId}`;

  await createMedication(page, {
    name: first,
    totalQuantity: 8,
    doseAmount: 1,
  });
  await createMedication(page, {
    name: second,
    totalQuantity: 6,
    doseAmount: 1,
  });

  await page.locator('#search-filter').fill('target');
  await expect(medicationCard(page, first)).toBeVisible();
  await expect(medicationCard(page, second)).toHaveCount(0);
});

test('status active and archived filters work', async ({ page }) => {
  const userId = await openApp(page);
  const name = `status-${userId}`;

  await createMedication(page, {
    name,
    totalQuantity: 10,
    doseAmount: 1,
  });

  const card = medicationCard(page, name);
  await card.locator('[data-action="archive"]').click();

  await page.locator('#status-filter').selectOption('archived');
  await expect(medicationCard(page, name)).toBeVisible();

  await page.locator('#status-filter').selectOption('active');
  await expect(medicationCard(page, name)).toHaveCount(0);
});

test('status archived can be restored', async ({ page }) => {
  const userId = await openApp(page);
  const name = `restore-${userId}`;

  await createMedication(page, {
    name,
    totalQuantity: 10,
    doseAmount: 1,
  });

  const card = medicationCard(page, name);
  await card.locator('[data-action="archive"]').click();

  await page.locator('#status-filter').selectOption('archived');
  const archivedCard = medicationCard(page, name);
  await expect(archivedCard).toBeVisible();

  await archivedCard.locator('[data-action="restore"]').click();
  await page.locator('#status-filter').selectOption('active');
  await expect(medicationCard(page, name)).toBeVisible();
});

test('low stock filter keeps low remaining meds', async ({ page }) => {
  const userId = await openApp(page);
  const name = `low-${userId}`;

  await createMedication(page, {
    name,
    totalQuantity: 1,
    doseAmount: 1,
  });

  await page.locator('#low-stock-filter').check();
  await expect(medicationCard(page, name)).toBeVisible();
});

test('expiring soon filter keeps near expiry meds', async ({ page }) => {
  const userId = await openApp(page);
  const name = `exp-${userId}`;

  await createMedication(page, {
    name,
    totalQuantity: 10,
    doseAmount: 1,
    expiresAt: dateStringOffset(2),
  });

  await page.locator('#expired-soon-filter').check();
  await expect(medicationCard(page, name)).toBeVisible();
});

test('sort by name asc/desc changes card order', async ({ page }) => {
  const userId = await openApp(page);
  const first = `aaa-${userId}`;
  const second = `zzz-${userId}`;

  await createMedication(page, {
    name: second,
    totalQuantity: 10,
    doseAmount: 1,
  });
  await createMedication(page, {
    name: first,
    totalQuantity: 10,
    doseAmount: 1,
  });

  await Promise.all([
    waitForMedicationListSort(page, 'name_asc'),
    page.locator('#sort-filter').selectOption('name_asc'),
  ]);
  const firstAfterAsc = await page.locator('#med-list article.card').first().locator('h3').textContent();
  expect(firstAfterAsc).toContain(first);

  await Promise.all([
    waitForMedicationListSort(page, 'name_desc'),
    page.locator('#sort-filter').selectOption('name_desc'),
  ]);
  const firstAfterDesc = await page.locator('#med-list article.card').first().locator('h3').textContent();
  expect(firstAfterDesc).toContain(second);
});

test('can close modal without saving and keep data unchanged', async ({ page }) => {
  await openApp(page);

  await page.locator('#open-med-modal').click();
  await page.locator('[name="name"]').fill('not-saved');
  await page.locator('#close-med-modal').click();

  await expect(page.locator('#med-modal')).toHaveClass(/hidden/);
  await expect(medicationCard(page, 'not-saved')).toHaveCount(0);
});

async function createWithInvalidFrequencyData(page, data) {
  await page.locator('#open-med-modal').click();
  await page.locator('[name="name"]').fill(data.name);
  await page.locator('[name="total_quantity"]').fill(String(data.total));
  await page.locator('[name="dose_amount"]').fill(String(data.dose));
  await page.locator(`[name="frequency_type"][value="${data.type}"]`).check();

  if (data.configure) {
    await data.configure(page);
  }

  await page.locator('#med-form button[type="submit"]').click();
}

test('save is blocked when frequency is not selected correctly', async ({ page }) => {
  const userId = await openApp(page);
  await createWithInvalidFrequencyData(page, {
    name: `invalid-freq-${userId}`,
    total: 10,
    dose: 1,
    type: 'weekly',
    configure: async (currentPage) => {
      await currentPage.locator('#weeklyTimes').fill('0');
    },
  });

  await expect(page.locator('.field-error[data-error-for="weekly"]').or(page.locator('.field-error[data-error-for="weekly"]').first())).toContainText(/.+/);
  await expect(page.locator('#med-modal')).not.toHaveClass(/hidden/);
});
