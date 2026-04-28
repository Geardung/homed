ALTER TABLE medications ADD COLUMN category TEXT;
ALTER TABLE medications ADD COLUMN expires_at TEXT;
ALTER TABLE medications ADD COLUMN reminder_timezone TEXT;
ALTER TABLE medications ADD COLUMN frequency_time_overrides TEXT;

CREATE INDEX IF NOT EXISTS idx_medications_category
  ON medications (category);
