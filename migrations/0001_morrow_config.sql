CREATE TABLE IF NOT EXISTS morrow_config (
  id TEXT PRIMARY KEY,
  config_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
