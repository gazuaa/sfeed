import type { OpmlFeed, OpmlImportResult } from '../shared/opml';
import type { D1DatabaseLike } from './types';
import { fetchAndParseFeed } from './rssParser';
import { generateId, upsertFeedAndArticles } from './seedService';

export async function importOpmlFeed(
  db: D1DatabaseLike,
  userId: string,
  item: OpmlFeed
): Promise<OpmlImportResult> {
  const existing = await db.prepare(
    `SELECT s.id FROM subscriptions s JOIN feeds f ON f.id = s.feed_id
     WHERE s.user_id = ? AND f.xml_url = ?`
  ).bind(userId, item.xmlUrl).first<{ id: string }>();
  if (existing) return { status: 'existing', foldersCreated: 0 };

  // A failed fetch is reported, never replaced with demo articles.
  const parsed = await fetchAndParseFeed(item.xmlUrl, { allowFallback: false });
  const { feedId } = await upsertFeedAndArticles(db, parsed);
  const canonicalSubscription = await db.prepare(
    'SELECT id FROM subscriptions WHERE user_id = ? AND feed_id = ?'
  ).bind(userId, feedId).first<{ id: string }>();
  if (canonicalSubscription) return { status: 'existing', foldersCreated: 0 };

  const now = new Date().toISOString();
  let folderId: string | null = null;
  let foldersCreated = 0;
  if (item.folderName?.trim()) {
    const folderName = item.folderName.trim();
    let folder = await db.prepare(
      'SELECT id FROM folders WHERE user_id = ? AND name = ? COLLATE NOCASE'
    ).bind(userId, folderName).first<{ id: string }>();
    if (!folder) {
      const proposedId = generateId('fld');
      await db.prepare(
        `INSERT OR IGNORE INTO folders (id, user_id, name, color, sort_order, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).bind(proposedId, userId, folderName, '#10b981', 10, now).run();
      folder = await db.prepare(
        'SELECT id FROM folders WHERE user_id = ? AND name = ? COLLATE NOCASE'
      ).bind(userId, folderName).first<{ id: string }>();
      if (!folder) throw new Error('폴더를 만들지 못했습니다.');
      if (folder.id === proposedId) foldersCreated++;
    }
    folderId = folder.id;
  }

  const subscription = await db.prepare(
    `INSERT INTO subscriptions (id, user_id, feed_id, folder_id, custom_title, created_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, feed_id) DO NOTHING RETURNING id`
  ).bind(generateId('sub'), userId, feedId, folderId, item.title?.trim() || null, now)
    .first<{ id: string }>();
  return { status: subscription ? 'imported' : 'existing', foldersCreated };
}
