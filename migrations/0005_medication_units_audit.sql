CREATE TABLE IF NOT EXISTS medication_units (
  code TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO medication_units (code, label)
VALUES
  ('tabs', 'таблетки / штуки'),
  ('ml', 'миллилитры'),
  ('mg', 'миллиграммы'),
  ('drops', 'капли'),
  ('bottle', 'флаконы');

CREATE TABLE IF NOT EXISTS medication_audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_user_id INTEGER NOT NULL,
  action TEXT NOT NULL,
  medication_id INTEGER NOT NULL,
  payload TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (telegram_user_id) REFERENCES tma_users (telegram_id)
);

CREATE INDEX IF NOT EXISTS idx_medication_audit_medication
  ON medication_audit_logs (medication_id, created_at DESC);
