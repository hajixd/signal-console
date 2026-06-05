CREATE TABLE IF NOT EXISTS schema_migrations (
  name TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS app_documents (
  collection TEXT NOT NULL,
  id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  sort_time_millis INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (collection, id)
);

CREATE INDEX IF NOT EXISTS idx_app_documents_collection_sort
  ON app_documents (collection, sort_time_millis DESC, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_app_documents_updated
  ON app_documents (updated_at DESC);

CREATE TABLE IF NOT EXISTS object_index (
  key TEXT PRIMARY KEY,
  byte_size INTEGER,
  etag TEXT,
  content_type TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_object_index_updated
  ON object_index (updated_at DESC);
