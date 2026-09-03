CREATE TABLE IF NOT EXISTS morrow_block_secrets (
  block_id TEXT NOT NULL,
  name TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (block_id, name)
);
