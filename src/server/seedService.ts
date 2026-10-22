import type { D1DatabaseLike } from './types';
import type { ParsedFeed } from './rssParser';

export function generateId(prefix = ''): string {
  const uuid = crypto.randomUUID();
  return prefix ? `${prefix}_${uuid}` : uuid;
}

interface ExistingArticle {
  id: string;
  guid: string;
  date_source: string | null;
  published_at: string;
  created_at: string;
  no_thumbnail: number;
  no_content: number;
}

const FETCH_TIME_TOLERANCE_MS = 5 * 60_000;
const FUTURE_AT_FETCH_MS = 10 * 60_000;
const DATE_REPAIR_MIN_SHIFT_MS = 60 * 60_000;
const KST_OFFSET_MS = 9 * 60 * 60_000;

// Mirrors the published_at CASE in the upsert below.
function needsDateRepair(row: ExistingArticle, feedDate: string): boolean {
  const stored = Date.parse(row.published_at);
  const fetched = Date.parse(row.created_at);
  const fromFeed = Date.parse(feedDate);
  const suspect =
    Math.abs(stored - fetched) < FETCH_TIME_TOLERANCE_MS || stored > fetched + FUTURE_AT_FETCH_MS;
  return (
    (suspect && fromFeed < stored - DATE_REPAIR_MIN_SHIFT_MS) ||
    Math.abs(stored - fromFeed - KST_OFFSET_MS) < 1000
  );
}

export async function upsertFeedAndArticles(
  db: D1DatabaseLike,
  parsed: ParsedFeed
): Promise<{ feedId: string; insertedCount: number }> {
  const now = new Date().toISOString();

  // Check if feed already exists by xml_url
  const existingFeed = await db
    .prepare('SELECT id FROM feeds WHERE xml_url = ?')
    .bind(parsed.xmlUrl)
    .first<{ id: string }>();

  let feedId: string;
  if (existingFeed) {
    feedId = existingFeed.id;
    await db
      .prepare(
        `UPDATE feeds
         SET title = ?, description = COALESCE(?, description), html_url = COALESCE(?, html_url),
             favicon_url = COALESCE(?, favicon_url), last_fetched_at = ?, last_error = NULL
         WHERE id = ?`
      )
      .bind(
        parsed.title,
        parsed.description,
        parsed.htmlUrl,
        parsed.faviconUrl,
        now,
        feedId
      )
      .run();
  } else {
    feedId = generateId('feed');
    await db
      .prepare(
        `INSERT INTO feeds (id, xml_url, html_url, title, description, favicon_url, last_fetched_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        feedId,
        parsed.xmlUrl,
        parsed.htmlUrl,
        parsed.title,
        parsed.description,
        parsed.faviconUrl,
        now,
        now
      )
      .run();
  }

  // Fetch existing rows together and write up to eight articles per statement.
  // This keeps a feed refresh below Workers/D1 query limits (at most 96 parameters).
  const existing = new Map<string, ExistingArticle>();
  for (let offset = 0; offset < parsed.articles.length; offset += 80) {
    const chunk = parsed.articles.slice(offset, offset + 80);
    const rows = await db.prepare(
      `SELECT a.id,a.guid,a.published_at,a.created_at,d.source AS date_source,
              a.thumbnail_url IS NULL AS no_thumbnail,a.content_html IS NULL AS no_content
       FROM articles a LEFT JOIN article_date_checks d ON d.article_id=a.id WHERE a.feed_id = ? AND a.guid IN (${chunk.map(() => '?').join(', ')})`
    ).bind(feedId, ...chunk.map((article) => article.guid)).all<ExistingArticle>();
    for (const row of rows.results || []) existing.set(row.guid, row);
  }

  // Feeds are refreshed every few minutes, so only write what changes: new
  // articles and existing rows the ON CONFLICT clause below would improve.
  // Rewriting every item on every refresh would cost a D1 row write each time.
  const toWrite = parsed.articles.filter((article) => {
    const row = existing.get(article.guid);
    if (!row) return true;
    return (
      (Boolean(row.no_thumbnail) && Boolean(article.thumbnailUrl)) ||
      (Boolean(row.no_content) && Boolean(article.contentHtml)) ||
      (Boolean(article.originalPublishedAt) && row.published_at !== article.publishedAt) ||
      (row.date_source !== 'original' && needsDateRepair(row, article.publishedAt))
    );
  });

  // Explicit original publication metadata also repairs generator timestamps,
  // even when the old time does not resemble our own fetch/created_at time.
  // Other published_at repairs: rows saved before a feed's date field was recognised
  // carry their fetch time (published_at ≈ created_at), and rows whose zone-less
  // KST time was read as UTC sit after their own fetch time. Once the feed
  // yields a real, clearly earlier date, move them back to it. A stored date
  // exactly 9 hours past the feed's is that same KST misread, even when it is
  // already in the past. Undated items fall back to "now", which is never
  // earlier, so they never overwrite a date.
  let insertedCount = 0;
  const seenGuids = new Set(existing.keys());
  const articleIds = new Map([...existing].map(([guid, row]) => [guid, row.id]));
  const statements = [];
  for (let offset = 0; offset < toWrite.length; offset += 8) {
    const chunk = toWrite.slice(offset, offset + 8);
    const originalDateGuids = chunk.filter((article) => article.originalPublishedAt).map((article) => article.guid);
    const values: unknown[] = [];
    for (const article of chunk) {
      if (!seenGuids.has(article.guid)) insertedCount++;
      seenGuids.add(article.guid);
      const id = articleIds.get(article.guid) || generateId('art');
      articleIds.set(article.guid, id);
      values.push(
        id, feedId, article.guid, article.title, article.url,
        article.author, article.summary, article.contentHtml, article.thumbnailUrl,
        article.publishedAt, now
      );
    }
    statements.push(db.prepare(
      `INSERT INTO articles (
        id, feed_id, guid, title, url, author, summary, content_html, thumbnail_url, published_at, created_at
      ) VALUES ${chunk.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ')}
      ON CONFLICT(feed_id, guid) DO UPDATE SET
        thumbnail_url = COALESCE(articles.thumbnail_url, excluded.thumbnail_url),
        content_html = COALESCE(articles.content_html, excluded.content_html),
        published_at = CASE
          ${originalDateGuids.length ? `WHEN articles.guid IN (${originalDateGuids.map(() => '?').join(', ')}) THEN excluded.published_at` : ''}
          WHEN EXISTS(SELECT 1 FROM article_date_checks d WHERE d.article_id=articles.id AND d.source='original') THEN articles.published_at
          WHEN ((abs(julianday(articles.published_at) - julianday(articles.created_at)) < 5.0 / 1440
                OR julianday(articles.published_at) > julianday(articles.created_at) + 10.0 / 1440)
              AND julianday(excluded.published_at) < julianday(articles.published_at) - 1.0 / 24)
            OR abs(julianday(articles.published_at) - julianday(excluded.published_at) - 9.0 / 24) < 1.0 / 86400
          THEN excluded.published_at
          ELSE articles.published_at
        END`
    ).bind(...values, ...originalDateGuids));
  }
  if (statements.length > 0) await db.batch(statements);

  const dates = parsed.articles.filter((article) => {
    const previous = existing.get(article.guid)?.date_source;
    return !previous || (previous !== 'original' && previous !== (article.dateSource || 'feed'));
  });
  const dateStatements = [];
  for (let offset = 0; offset < dates.length; offset += 30) {
    const chunk = dates.slice(offset, offset + 30);
    dateStatements.push(db.prepare(`INSERT INTO article_date_checks(article_id,source,checked_at) VALUES ${chunk.map(() => '(?,?,?)').join(',')} ON CONFLICT(article_id) DO UPDATE SET source=excluded.source,checked_at=COALESCE(excluded.checked_at,article_date_checks.checked_at)`).bind(...chunk.flatMap((article) => [articleIds.get(article.guid), article.dateSource || 'feed', article.originalPublishedAt ? now : null])));
  }
  if (dateStatements.length) await db.batch(dateStatements);

  return { feedId, insertedCount };
}
