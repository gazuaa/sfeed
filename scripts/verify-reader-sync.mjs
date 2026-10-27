import assert from 'node:assert/strict';
import { createServer } from 'vite';

const vite = await createServer({ configFile: false, server: { middlewareMode: true, ws: false }, appType: 'custom', logLevel: 'silent' });
const originalNow = Date.now; let now = originalNow(); Date.now = () => now;
try {
  const { app } = await vite.ssrLoadModule('/src/server/app.ts');
  const { LocalD1Database } = await vite.ssrLoadModule('/src/server/localD1.ts');
  const { ReaderCache, articlePageKey } = await vite.ssrLoadModule('/src/client/readerCache.ts');
  const { ReaderSync } = await vite.ssrLoadModule('/src/client/readerSync.ts');
  const { pruneReaderChanges } = await vite.ssrLoadModule('/src/server/readerSync.ts');
  const db = new LocalD1Database(':memory:', 'migrations/0001_schema.sql');
  let sql = [];
  const traced = { prepare(query) { sql.push(query); return db.prepare(query); }, batch: (...args) => db.batch(...args), exec: (...args) => db.exec(...args) };
  const env = { DB: traced, ALLOW_QUICK_LOGIN: 'true' };
  const login = async (email) => (await app.request('/api/auth/google/quick', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email }) }, env)).json();
  const owner = await login('sync@example.test'), other = await login('other-sync@example.test');
  const stamp = () => new Date(now).toISOString();
  await db.prepare('INSERT INTO folders(id,user_id,name,created_at) VALUES(?,?,?,?)').bind('folder', owner.user.id, 'Folder', stamp()).run();
  for (const [feed, user] of [['one', owner], ['two', owner], ['outside', other]]) {
    await db.prepare('INSERT INTO feeds(id,xml_url,title,created_at) VALUES(?,?,?,?)').bind(feed, `https://example.test/${feed}`, feed, stamp()).run();
    await db.prepare('INSERT INTO subscriptions(id,user_id,feed_id,folder_id,created_at) VALUES(?,?,?,?,?)').bind(`sub-${feed}`, user.user.id, feed, feed === 'one' ? 'folder' : null, stamp()).run();
  }
  const insert = async (id, feed, time = now - 3600_000) => db.prepare('INSERT INTO articles(id,feed_id,guid,title,url,content_html,published_at,created_at) VALUES(?,?,?,?,?,?,?,?)').bind(id, feed, id, id, `https://example.test/${id}`, `FULL-${id}`, new Date(time).toISOString(), stamp()).run();
  await insert('a', 'one'); await insert('b', 'one', now - 7200_000); await insert('old', 'one', now - 60 * 86400_000); await insert('d', 'two', now - 48 * 3600_000);
  await insert('edge24', 'one', now - 86400_000 + 5000); await insert('edge30', 'two', now - 30 * 86400_000 + 5000);
  await db.prepare('INSERT INTO article_states(user_id,article_id,is_read,is_saved) VALUES(?,?,1,1)').bind(owner.user.id, 'b').run();
  let network = [];
  const request = async (path, options = {}, token = owner.token) => {
    network.push(path);
    const response = await app.request(path, { ...options, headers: { 'content-type': 'application/json', ...options.headers, authorization: `Bearer ${token}` } }, env);
    assert.equal(response.status, 200, `${path}: ${await response.clone().text()}`);
    return response.json();
  };
  const snapshots = new Map(), storage = {
    async read(account, key) { return structuredClone(snapshots.get(`${account}:${key}`)); },
    async write(row) { snapshots.set(`${row.account}:${row.key}`, structuredClone(row)); },
    async remove(account) { for (const [key, row] of snapshots) if (row.account === account) snapshots.delete(key); },
    async keys(account) { return [...snapshots.values()].filter((row) => row.account === account).map((row) => row.key); },
  };
  const cache = new ReaderCache(owner.user.id, storage, () => now), sync = new ReaderSync(cache, request);
  const all = new URLSearchParams('scope=all&unreadOnly=false'), unread = new URLSearchParams('scope=all&unreadOnly=true'), saved = new URLSearchParams('scope=saved&unreadOnly=false');
  let result = await sync.check(() => true, async () => {});
  assert.equal(result.reset, true); assert.ok(result.bootstrap.syncCursor);
  for (const query of [all, unread, saved]) await sync.page(query, () => true, async () => {});
  const ascending = await request('/api/articles?sort=oldest&limit=2');
  assert.deepEqual(ascending.articles.map((article) => article.id), ['old', 'edge30']);
  const after = ascending.articles.at(-1);
  const nextAscending = await request(`/api/articles?sort=oldest&limit=2&before=${encodeURIComponent(after.published_at)}&beforeId=${after.id}`);
  assert.ok(nextAscending.articles.every((article) => article.published_at > after.published_at), 'oldest-first pagination walks forward without duplicates');
  await cache.flushed(); network = []; sql = [];
  await sync.page(all, () => true, async () => {}); await sync.page(unread, () => true, async () => {}); await sync.page(saved, () => true, async () => {});
  assert.deepEqual(network, [], 'switching cached tabs uses the device only');
  result = await sync.check(() => true, async () => {});
  assert.equal(result.changed, false); assert.deepEqual(network, ['/api/sync']);
  assert.equal(sql.length, 2, 'idle polling needs only session authentication and the change clock');
  assert.ok(sql.every((query) => !/COUNT\(|FROM articles/i.test(query)), 'idle sync never counts or loads articles');

  await insert('new-one', 'one', now + 1); await insert('new-two', 'one', now + 2);
  const cursor = (await cache.get('bootstrap')).syncCursor;
  const delta = await request('/api/sync', { method: 'POST', body: JSON.stringify({ cursor }) });
  assert.deepEqual(delta.articles.map((article) => article.id).sort(), ['new-one', 'new-two']);
  assert.equal(delta.articles[0].content_html, null, 'delta lists do not transfer full bodies');
  assert.equal(delta.subscriptionCounts.length, 1, 'only changed feeds have counts recalculated');
  assert.equal(delta.articles[0].body_deferred, true);
  await sync.check(() => true, async () => {});
  assert.equal((await cache.get(articlePageKey(all))).articles.length, 8);
  assert.equal((await cache.get('bootstrap')).counts.totalArticles, 8);
  await request('/api/articles/a/state', { method: 'POST', body: JSON.stringify({ isRead: true, isSaved: true }) });
  await sync.check(() => true, async () => {});
  assert.ok(!(await cache.get(articlePageKey(unread))).articles.some((article) => article.id === 'a'));
  const savedA = (await cache.get(articlePageKey(saved))).articles.find((article) => article.id === 'a');
  assert.equal(savedA.content_html, 'FULL-a', 'state-only changes preserve already cached bodies');
  assert.equal((await cache.get('bootstrap')).counts.savedCount, 2);
  const baseline = await request('/api/bootstrap');
  assert.deepEqual((await cache.get('bootstrap')).counts, baseline.counts);

  await insert('foreign', 'outside'); network = []; sql = [];
  result = await sync.check(() => true, async () => {});
  assert.equal(result.changed, false, 'unsubscribed feeds never transfer another account data');
  assert.ok(sql.every((query) => !/COUNT\(/i.test(query)));
  const otherCursor = (await request('/api/bootstrap', {}, other.token)).syncCursor;
  assert.equal((await request('/api/sync', { method: 'POST', body: JSON.stringify({ cursor: otherCursor }) })).reset, true);
  const anonymous = await app.request('/api/sync', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }, env);
  assert.equal(anonymous.status, 401);
  now += 6000;
  await sync.check(() => true, async () => {});
  assert.deepEqual((await cache.get('bootstrap')).counts, (await request('/api/bootstrap')).counts, '24h and 30d count expiry works without a database mutation');

  await db.prepare('UPDATE folders SET name=? WHERE id=?').bind('Renamed', 'folder').run(); sql = [];
  await sync.check(() => true, async () => {});
  assert.ok(sql.every((query) => !/COUNT\(/i.test(query)), 'renaming a folder transfers metadata without recounting the library');
  assert.equal((await cache.get(articlePageKey(all))).articles.find((article) => article.id === 'a').folder_name, 'Renamed');
  await db.prepare('DELETE FROM articles WHERE id=?').bind('new-one').run(); await sync.check(() => true, async () => {});
  assert.ok(!(await cache.get(articlePageKey(all))).articles.some((article) => article.id === 'new-one'));
  await db.prepare('UPDATE articles SET content_html=? WHERE id=?').bind('CHANGED-BODY', 'a').run(); await sync.check(() => true, async () => {});
  assert.equal((await cache.get(articlePageKey(all))).articles.find((article) => article.id === 'a').body_deferred, true);
  assert.equal((await request('/api/articles?articleId=a')).articles[0].content_html, 'CHANGED-BODY');
  await db.prepare('DELETE FROM subscriptions WHERE id=?').bind('sub-two').run(); await sync.check(() => true, async () => {});
  assert.ok((await cache.get(articlePageKey(all))).articles.every((article) => article.feed_id !== 'two'));
  assert.deepEqual((await cache.get('bootstrap')).counts, (await request('/api/bootstrap')).counts);

  await db.prepare('INSERT INTO subscriptions(id,user_id,feed_id,created_at) VALUES(?,?,?,?)').bind('sub-two-again', owner.user.id, 'two', stamp()).run();
  await sync.check(() => true, async () => {});
  assert.equal((await cache.get(articlePageKey(all))).needsRefresh, true, 'subscribing an existing feed refills affected cached lists');
  assert.ok((await sync.page(all, () => true, async () => {})).articles.some((article) => article.id === 'd'));
  const folderPage = new URLSearchParams('scope=folder&folderId=folder&unreadOnly=false');
  await sync.page(folderPage, () => true, async () => {});
  await db.prepare('UPDATE subscriptions SET folder_id=? WHERE id=?').bind('folder', 'sub-two-again').run();
  await sync.check(() => true, async () => {});
  assert.equal((await cache.get(articlePageKey(all))).needsRefresh, false, 'moving a feed does not redownload an unaffected All list');
  assert.ok((await sync.page(folderPage, () => true, async () => {})).articles.some((article) => article.id === 'd'), 'moving an existing feed refills its new folder');

  await cache.flushed(); await cache.close();
  const reopened = new ReaderCache(owner.user.id, storage, () => now), reopenedSync = new ReaderSync(reopened, request);
  await reopened.get('bootstrap'); network = [];
  assert.ok(await reopenedSync.page(all, () => true, async () => {})); assert.deepEqual(network, [], 'logout/relaunch reuses persisted synchronized pages');
  sql = []; await reopenedSync.check(() => true, async () => {}); assert.equal(sql.length, 2);

  const seq = (await reopened.get('bootstrap')).syncCursor.sequence;
  await db.prepare('UPDATE reader_sync_meta SET floor=? WHERE id=1').bind(seq + 1).run();
  result = await reopenedSync.check(() => true, async () => {});
  assert.equal(result.reset, true, 'a compacted/expired cursor recovers with one current snapshot');
  await db.exec(`WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<50010)
    INSERT INTO reader_sync_changes(kind,owner_id,entity_id) SELECT 'test','other','event-'||x FROM n`);
  await pruneReaderChanges(db);
  const remaining = await db.prepare('SELECT COUNT(*) AS count FROM reader_sync_changes').first();
  assert.ok(remaining.count <= 50000, 'server change storage is bounded');
  console.log('PASS: two indexed reads/no counts for idle sync; delta-only new/state/metadata/deletion updates; local cached tabs and relaunch; count expiry, account isolation, deferred bodies and bounded cursor recovery.');
} finally { Date.now = originalNow; await vite.close(); }
