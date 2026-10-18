import type { D1DatabaseLike } from './types';
import { fetchAndParseFeed, type ParsedFeed } from './rssParser';

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

export async function seedStarterDataForNewUser(
  db: D1DatabaseLike,
  userId: string
): Promise<void> {
  const now = new Date().toISOString();

  // Check if user already has folders or subscriptions
  const countRow = await db
    .prepare('SELECT COUNT(*) as cnt FROM subscriptions WHERE user_id = ?')
    .bind(userId)
    .first<{ cnt: number }>();

  if (countRow && Number(countRow.cnt) > 0) {
    return;
  }

  const starterFolders = [
    { id: generateId('fld'), name: '국내 테크', color: '#10b981', sortOrder: 1 },
    { id: generateId('fld'), name: 'Global Tech & AI', color: '#3b82f6', sortOrder: 2 },
    { id: generateId('fld'), name: '디자인 & 프로덕트', color: '#8b5cf6', sortOrder: 3 },
  ];

  const folderMap = new Map<string, string>();
  for (const f of starterFolders) {
    await db
      .prepare(
        `INSERT OR IGNORE INTO folders (id, user_id, name, color, sort_order, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .bind(f.id, userId, f.name, f.color, f.sortOrder, now)
      .run();
    folderMap.set(f.name, f.id);
  }

  const starterFeeds = [
    { xmlUrl: 'https://news.hada.io/rss/news', folderName: '국내 테크' },
    { xmlUrl: 'https://toss.tech/rss.xml', folderName: '국내 테크' },
    { xmlUrl: 'https://blog.cloudflare.com/rss/', folderName: 'Global Tech & AI' },
    { xmlUrl: 'https://hnrss.org/frontpage', folderName: 'Global Tech & AI' },
    { xmlUrl: 'https://www.smashingmagazine.com/feed/', folderName: '디자인 & 프로덕트' },
  ];

  await Promise.all(
    starterFeeds.map(async (item) => {
      try {
        const parsed = await fetchAndParseFeed(item.xmlUrl);
        const { feedId } = await upsertFeedAndArticles(db, parsed);
        const folderId = folderMap.get(item.folderName) || null;
        await db
          .prepare(
            `INSERT OR IGNORE INTO subscriptions (id, user_id, feed_id, folder_id, created_at)
             VALUES (?, ?, ?, ?, ?)`
          )
          .bind(generateId('sub'), userId, feedId, folderId, now)
          .run();
      } catch {
        // Ignore individual starter feed errors
      }
    })
  );
}
