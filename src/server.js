import express from 'express';
import { parse, validate } from '@tma.js/init-data-node';
import { createDatabase, run, get } from './db.js';
import 'dotenv/config';
import { migrate } from './migrations.js';

const {
  BOT_TOKEN,
  PORT = 3000,
  DATABASE_PATH = './homed.sqlite',
  INIT_DATA_MAX_AGE_SECONDS = '86400',
} = process.env;

if (!BOT_TOKEN) {
  throw new Error('Missing BOT_TOKEN in environment variables');
}

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

const db = await createDatabase(DATABASE_PATH);
await migrate(db);
const maxAge = Number.isFinite(Number(INIT_DATA_MAX_AGE_SECONDS))
  ? Number(INIT_DATA_MAX_AGE_SECONDS)
  : 86400;

function toNumber(value) {
  return value ? 1 : 0;
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
    toNumber(user.is_premium),
    toNumber(user.is_bot),
  ]);

  return get(db, 'SELECT * FROM tma_users WHERE telegram_id = ?', [user.id]);
}

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.post('/api/tma/session', async (req, res) => {
  const initData = req.body?.initData ?? req.query.initData ?? req.query.tgWebAppData;

  if (typeof initData !== 'string' || initData.length === 0) {
    return res.status(400).json({ ok: false, error: 'initData is missing' });
  }

  try {
    validate(initData, BOT_TOKEN, { expiresIn: maxAge });
    const parsed = parse(initData);
    const user = parsed.user;

    if (!user?.id) {
      return res.status(422).json({ ok: false, error: 'initData does not contain user object' });
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
  const user = await get(db, 'SELECT * FROM tma_users WHERE telegram_id = ?', [req.params.telegramId]);

  if (!user) {
    return res.status(404).json({ ok: false, error: 'User not found' });
  }

  return res.json({ ok: true, user });
});

app.listen(PORT, () => {
  console.log(`TMA backend is running on http://localhost:${PORT}`);
});
