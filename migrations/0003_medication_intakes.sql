CREATE TABLE IF NOT EXISTS medication_intakes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  medication_id INTEGER NOT NULL,
  telegram_user_id INTEGER NOT NULL,
  taken_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  quantity REAL NOT NULL CHECK(quantity > 0),
  dose_unit TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (medication_id) REFERENCES medications (id),
  FOREIGN KEY (telegram_user_id) REFERENCES tma_users (telegram_id)
);

CREATE INDEX IF NOT EXISTS idx_medication_intakes_medication
  ON medication_intakes (medication_id, taken_at DESC);
