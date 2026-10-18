import type { D1DatabaseLike } from './types';
import type { ParsedFeed } from './rssParser';

export function generateId(prefix = ''): string {
  const uuid = crypto.randomUUID();
  return prefix ? `${prefix}_${uuid}` : uuid;
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

  // Fetch existing GUIDs together and write up to eight articles per statement.
  // This keeps a feed refresh well below Workers/D1 query limits (88 parameters).
  const existingGuids = new Set<string>();
  for (let offset = 0; offset < parsed.articles.length; offset += 80) {
    const chunk = parsed.articles.slice(offset, offset + 80);
    const rows = await db.prepare(
      `SELECT guid FROM articles WHERE feed_id = ? AND guid IN (${chunk.map(() => '?').join(', ')})`
    ).bind(feedId, ...chunk.map((article) => article.guid)).all<{ guid: string }>();
    for (const row of rows.results || []) existingGuids.add(row.guid);
  }

  let insertedCount = 0;
  const statements = [];
  for (let offset = 0; offset < parsed.articles.length; offset += 8) {
    const chunk = parsed.articles.slice(offset, offset + 8);
    const values: unknown[] = [];
    for (const article of chunk) {
      if (!existingGuids.has(article.guid)) insertedCount++;
      existingGuids.add(article.guid);
      values.push(
        generateId('art'), feedId, article.guid, article.title, article.url,
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
        content_html = COALESCE(articles.content_html, excluded.content_html)`
    ).bind(...values));
  }
  if (statements.length > 0) await db.batch(statements);

  return { feedId, insertedCount };
}
