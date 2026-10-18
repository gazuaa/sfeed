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

  let insertedCount = 0;
  for (const art of parsed.articles) {
    const existingArt = await db
      .prepare('SELECT id FROM articles WHERE feed_id = ? AND guid = ?')
      .bind(feedId, art.guid)
      .first<{ id: string }>();

    if (!existingArt) {
      const artId = generateId('art');
      await db
        .prepare(
          `INSERT INTO articles (
            id, feed_id, guid, title, url, author, summary, content_html, thumbnail_url, published_at, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          artId,
          feedId,
          art.guid,
          art.title,
          art.url,
          art.author,
          art.summary,
          art.contentHtml,
          art.thumbnailUrl,
          art.publishedAt,
          now
        )
        .run();
      insertedCount++;
    } else {
      // Update thumbnail or content if previously missing
      await db
        .prepare(
          `UPDATE articles
           SET thumbnail_url = COALESCE(thumbnail_url, ?),
               content_html = COALESCE(content_html, ?)
           WHERE id = ?`
        )
        .bind(art.thumbnailUrl, art.contentHtml, existingArt.id)
        .run();
    }
  }

  return { feedId, insertedCount };
}
