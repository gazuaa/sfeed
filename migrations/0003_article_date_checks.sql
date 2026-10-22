CREATE TABLE IF NOT EXISTS article_date_checks (
  article_id TEXT PRIMARY KEY REFERENCES articles(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK(source IN ('original', 'feed', 'updated', 'collected')),
  checked_at TEXT
);
