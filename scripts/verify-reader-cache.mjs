import assert from 'node:assert/strict';
import { createServer } from 'vite';

const vite = await createServer({ configFile: false, server: { middlewareMode: true, ws: false }, appType: 'custom', logLevel: 'silent' });
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };
try {
  const { ReaderCache, revalidate, articlePageKey, CACHE_LIMITS, updateCounts, updateSubscription } = await vite.ssrLoadModule('/src/client/readerCache.ts');
  const rows = new Map(), storage = {
    async read(account, key) { return structuredClone(rows.get(JSON.stringify([account, key]))); },
    async write(snapshot) { rows.set(JSON.stringify([snapshot.account, snapshot.key]), structuredClone(snapshot)); },
    async remove(account) { for (const [key, row] of rows) if (row.account === account) rows.delete(key); },
  };
  let now = Date.now();
  const article = { id: 'one', feed_id: 'feed', title: 'Cached article', published_at: new Date(now - 3600_000).toISOString(), is_read: false, is_saved: false };
  const counts = { totalUnread: 2, totalArticles: 5, savedCount: 0, todayCount: 1, todayTotal: 2 };
  const sub = { feed_id: 'feed', unread_count: 2, total_count: 5, saved_count: 0 };
  const bootstrap = { folders: [], subscriptions: [sub], curatedFeeds: [], counts };
  const allKey = articlePageKey(new URLSearchParams('scope=all&unreadOnly=false'));
  assert.equal(allKey, articlePageKey(new URLSearchParams('unreadOnly=false&scope=all')));
  const cache = new ReaderCache('alice', storage, () => now);
  cache.put('bootstrap', bootstrap); cache.put(allKey, { articles: [article], hasMore: false }); await cache.flushed();
  const bob = new ReaderCache('bob', storage, () => now);
  assert.equal(await bob.get(allKey), undefined, 'another account never reads this snapshot');
  bob.put(allKey, { articles: [{ ...article, title: 'Bob' }] }); await bob.flushed();
  const reload = new ReaderCache('alice', storage, () => now);
  assert.equal((await reload.get(allKey)).articles[0].title, 'Cached article', 'device data survives an app restart');
  const network = deferred(), painted = deferred(), shown = [];
  const load = revalidate(reload, allKey, () => network.promise, (value) => { shown.push(value.articles[0].title); painted.resolve(); }, () => true);
  await painted.promise;
  assert.deepEqual(shown, ['Cached article'], 'the cached screen paints before the network responds');
  network.resolve({ articles: [{ ...article, title: 'Fresh article' }], hasMore: true }); await load;
  assert.deepEqual(shown, ['Cached article', 'Fresh article']);

  const disk = deferred(), slowDisk = new ReaderCache('alice', { ...storage, read: () => disk.promise }, () => now);
  const latest = [], racing = revalidate(slowDisk, allKey, async () => ({ articles: [{ ...article, title: 'New' }] }), (data) => latest.push(data.articles[0].title), () => true);
  await Promise.resolve(); await Promise.resolve();
  disk.resolve({ account: 'alice', key: allKey, savedAt: now, size: 100, data: { articles: [article] } }); await racing;
  assert.deepEqual(latest, ['New'], 'a late disk read never replaces a fresh response');
  assert.equal((await slowDisk.get(allKey)).articles[0].title, 'New', 'the in-memory cache also retains the newer network value');

  const unreadKey = articlePageKey(new URLSearchParams('scope=all&unreadOnly=true'));
  const savedKey = articlePageKey(new URLSearchParams('scope=saved'));
  cache.put(unreadKey, { articles: [article] }); cache.put(savedKey, { articles: [{ ...article, is_saved: true }] });
  const readSaved = { ...article, is_read: true, is_saved: true };
  cache.updateArticle(article, readSaved);
  assert.equal((await cache.get(unreadKey)).articles.length, 0);
  assert.equal((await cache.get(allKey)).articles[0].is_saved, true);
  assert.deepEqual((await cache.get('bootstrap')).counts, { ...counts, totalUnread: 1, todayCount: 0, savedCount: 1 });
  assert.equal((await cache.get('bootstrap')).subscriptions[0].saved_count, 1);
  cache.updateArticle(readSaved, { ...readSaved, is_saved: false });
  assert.equal((await cache.get(savedKey)).articles.length, 0, 'unsaving also updates stored saved lists');
  cache.updateFields(article.id, { full_content_html: '<p>Cached full body</p>' }); await cache.flushed();
  assert.equal((await new ReaderCache('alice', storage, () => now).get(allKey)).articles[0].full_content_html, '<p>Cached full body</p>');
  const old = { ...article, published_at: new Date(now - 60 * 86400_000).toISOString(), is_read: true };
  assert.equal(updateCounts(counts, old, { ...old, is_read: false }, now).totalUnread, 2);
  assert.equal(updateSubscription(sub, old, { ...old, is_read: false }, now).unread_count, 2);

  const stale = deferred(), ignored = [];
  const pending = revalidate(cache, allKey, () => stale.promise, (data) => ignored.push(data), () => true);
  await Promise.resolve(); await Promise.resolve();
  cache.updateArticle(readSaved, article); const beforeResponse = ignored.length;
  stale.resolve({ articles: [readSaved] }); await pending;
  assert.equal(ignored.length, beforeResponse, 'an earlier GET cannot overwrite optimistic state');
  const leaving = deferred(), afterLogout = [];
  const oldRequest = revalidate(cache, allKey, () => leaving.promise, (data) => afterLogout.push(data), () => true);
  await cache.clear(); const visibleAtLogout = afterLogout.length;
  leaving.resolve({ articles: [article] }); await oldRequest;
  assert.equal(afterLogout.length, visibleAtLogout);
  assert.equal(await cache.get(allKey), undefined);
  assert.ok([...rows.values()].every((row) => row.account !== 'alice'));
  assert.equal((await bob.get(allKey)).articles[0].title, 'Bob', 'logout clears only the departing account');

  now += CACHE_LIMITS.age + 1;
  assert.equal(await new ReaderCache('bob', storage, () => now).get(allKey), undefined, 'old device data expires');
  const noDisk = new ReaderCache('offline-storage', { read: async () => { throw Error('blocked'); }, write: async () => { throw Error('quota'); }, remove: async () => {} });
  const online = [];
  await revalidate(noDisk, allKey, async () => ({ articles: [article] }), (data) => online.push(data), () => true);
  await noDisk.flushed(); assert.equal(online.length, 1); assert.equal((await noDisk.get(allKey)).articles.length, 1);
  const large = new ReaderCache('large', storage);
  large.put(allKey, { articles: Array.from({ length: 32 }, () => ({ ...article, content_html: 'a'.repeat(200_000) })) });
  await large.flushed();
  const bounded = await large.get(allKey);
  assert.ok(bounded.articles.length < 32); assert.equal(bounded.hasMore, true);
  assert.ok([...rows.values()].filter((row) => row.account === 'large').every((row) => row.size <= CACHE_LIMITS.bytes));
  console.log('PASS: instant cached paint then fresh data, reload, account isolation/logout, stale response protection, read/save counts and filters, age/size limits and storage-failure fallback.');
} finally { await vite.close(); }
