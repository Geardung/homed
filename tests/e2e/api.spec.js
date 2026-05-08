import { expect, test } from '@playwright/test';

function uniqueUserId() {
  return 1_000_000 + Date.now() + Math.floor(Math.random() * 1000);
}

function headers(userId) {
  return {
    'x-telegram-user-id': String(userId),
    'content-type': 'application/json',
  };
}

function medicationPayload(baseName) {
  return {
    name: baseName,
    total_quantity: 10,
    remaining_quantity: 10,
    quantity_unit: 'tabs',
    dose_amount: 1,
    dose_unit: 'tabs',
    frequency_type: 'times_per_day',
    frequency_details: {
      timesPerDay: 1,
      times: ['08:00'],
    },
    category: 'E2E',
    price: 100,
  };
}

test('health endpoint accessible', async ({ request }) => {
  const response = await request.get('/health');
  const body = await response.json();

  expect(response.status()).toBe(200);
  expect(body).toEqual({ ok: true });
});

test('medication list requires telegram id', async ({ request }) => {
  const response = await request.get('/api/medications');
  const body = await response.json();

  expect(response.status()).toBe(401);
  expect(body.ok).toBe(false);
  expect(body.error).toBeTruthy();
});

test('medication actions require telegram id', async ({ request }) => {
  const response = await request.post('/api/medications/1/take', {
    data: { quantity: 1 },
  });
  const body = await response.json();

  expect(response.status()).toBe(401);
  expect(body.ok).toBe(false);
});

test('invalid payload returns validation error', async ({ request }) => {
  const userId = uniqueUserId();

  const response = await request.post('/api/medications', {
    headers: headers(userId),
    data: {},
  });
  const body = await response.json();

  expect(response.status()).toBe(400);
  expect(body.ok).toBe(false);
  expect(body.error).toBeTruthy();
});

test('api lifecycle create -> list -> take -> events -> archive -> restore', async ({ request }) => {
  const userId = uniqueUserId();
  const baseName = `api-med-${userId}`;

  const createdResponse = await request.post('/api/medications', {
    headers: headers(userId),
    data: medicationPayload(baseName),
  });
  const createdBody = await createdResponse.json();

  expect(createdResponse.status()).toBe(201);
  expect(createdBody.ok).toBe(true);
  const medId = createdBody.data.id;

  const listResponse = await request.get('/api/medications', {
    headers: headers(userId),
    params: { search: baseName },
  });
  const listBody = await listResponse.json();
  expect(listResponse.status()).toBe(200);
  expect(listBody.ok).toBe(true);
  expect(listBody.data.some((item) => item.id === medId)).toBe(true);

  const byIdResponse = await request.get(`/api/medications/${medId}`, {
    headers: headers(userId),
  });
  const byIdBody = await byIdResponse.json();
  expect(byIdResponse.status()).toBe(200);
  expect(byIdBody.ok).toBe(true);
  expect(byIdBody.data.id).toBe(medId);

  const scheduleResponse = await request.get(`/api/medications/${medId}/schedule`, {
    headers: headers(userId),
  });
  const scheduleBody = await scheduleResponse.json();
  expect(scheduleResponse.status()).toBe(200);
  expect(scheduleBody.ok).toBe(true);
  expect(scheduleBody.data.frequency_type).toBe('times_per_day');

  const intakesBefore = await request.get(`/api/medications/${medId}/intakes`, {
    headers: headers(userId),
  });
  const intakesBeforeBody = await intakesBefore.json();
  expect(intakesBefore.status()).toBe(200);
  expect(intakesBeforeBody.ok).toBe(true);
  expect(intakesBeforeBody.data).toHaveLength(0);

  const takeResponse = await request.post(`/api/medications/${medId}/take`, {
    headers: headers(userId),
    data: {
      quantity: 2,
    },
  });
  const takeBody = await takeResponse.json();
  expect(takeResponse.status()).toBe(200);
  expect(takeBody.ok).toBe(true);

  const takeOverResponse = await request.post(`/api/medications/${medId}/take`, {
    headers: headers(userId),
    data: {
      quantity: 999,
    },
  });
  const takeOverBody = await takeOverResponse.json();
  expect(takeOverResponse.status()).toBe(400);
  expect(takeOverBody.ok).toBe(false);

  const intakesAfter = await request.get(`/api/medications/${medId}/intakes`, {
    headers: headers(userId),
    params: {
      limit: 10,
      offset: 0,
    },
  });
  const intakesAfterBody = await intakesAfter.json();
  expect(intakesAfter.status()).toBe(200);
  expect(intakesAfterBody.ok).toBe(true);
  expect(intakesAfterBody.data).toHaveLength(1);
  expect(intakesAfterBody.data[0].quantity).toBe(2);

  const eventsResponse = await request.get(`/api/medications/${medId}/events`, {
    headers: headers(userId),
    params: {
      limit: 10,
      offset: 0,
    },
  });
  const eventsBody = await eventsResponse.json();
  expect(eventsResponse.status()).toBe(200);
  expect(eventsBody.ok).toBe(true);
  expect(eventsBody.data.some((event) => event.kind === 'take')).toBe(true);
  expect(eventsBody.data.some((event) => event.kind === 'create')).toBe(true);

  const archiveResponse = await request.delete(`/api/medications/${medId}`, {
    headers: headers(userId),
  });
  const archiveBody = await archiveResponse.json();
  expect(archiveResponse.status()).toBe(200);
  expect(archiveBody.ok).toBe(true);

  const activeAfterArchive = await request.get('/api/medications', {
    headers: headers(userId),
  });
  const activeAfterArchiveBody = await activeAfterArchive.json();
  expect(activeAfterArchive.status()).toBe(200);
  expect(activeAfterArchiveBody.data.some((item) => item.id === medId)).toBe(false);

  const archivedResponse = await request.get('/api/medications', {
    headers: headers(userId),
    params: { status: 'archived' },
  });
  const archivedBody = await archivedResponse.json();
  expect(archivedResponse.status()).toBe(200);
  expect(archivedBody.data.some((item) => item.id === medId)).toBe(true);

  const restoreResponse = await request.post(`/api/medications/${medId}/restore`, {
    headers: headers(userId),
  });
  const restoreBody = await restoreResponse.json();
  expect(restoreResponse.status()).toBe(200);
  expect(restoreBody.ok).toBe(true);

  const activeAfterRestore = await request.get('/api/medications', {
    headers: headers(userId),
  });
  const activeAfterRestoreBody = await activeAfterRestore.json();
  expect(activeAfterRestore.status()).toBe(200);
  expect(activeAfterRestoreBody.data.some((item) => item.id === medId)).toBe(true);
});

test('units endpoint returns default dictionary', async ({ request }) => {
  const response = await request.get('/api/units');
  const body = await response.json();

  expect(response.status()).toBe(200);
  expect(body.ok).toBe(true);
  expect(Array.isArray(body.data)).toBe(true);
  expect(body.data.length).toBeGreaterThan(0);

  const codes = body.data.map((row) => row.code);
  expect(codes).toContain('tabs');
});
