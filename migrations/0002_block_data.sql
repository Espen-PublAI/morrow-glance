CREATE TABLE IF NOT EXISTS morrow_block_data (
  block_id TEXT PRIMARY KEY,
  data_json TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  error TEXT
);
