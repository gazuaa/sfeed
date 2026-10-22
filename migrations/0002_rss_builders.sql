CREATE TABLE IF NOT EXISTS rss_builders (
  id TEXT PRIMARY KEY,
  feed_id TEXT UNIQUE NOT NULL REFERENCES feeds(id) ON DELETE CASCADE,
  source_url TEXT NOT NULL,
  selector TEXT NOT NULL,
  title TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
);
