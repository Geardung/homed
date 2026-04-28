CREATE TABLE IF NOT EXISTS medications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  total_quantity REAL NOT NULL CHECK(total_quantity >= 0),
  remaining_quantity REAL NOT NULL CHECK(remaining_quantity >= 0),
  quantity_unit TEXT NOT NULL,
  dose_amount REAL NOT NULL CHECK(dose_amount > 0),
  dose_unit TEXT NOT NULL,
  frequency_type TEXT NOT NULL,
  frequency_value TEXT NOT NULL,
  price REAL,
  is_active INTEGER NOT NULL DEFAULT 1,
  start_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (telegram_user_id) REFERENCES tma_users (telegram_id)
);

CREATE INDEX IF NOT EXISTS idx_medications_user
  ON medications(telegram_user_id, is_active);
