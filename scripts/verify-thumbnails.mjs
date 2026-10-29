import assert from 'node:assert/strict';
import { indexedDB, IDBKeyRange } from 'fake-indexeddb';
import { createServer } from 'vite';
const vite = await createServer({ configFile: false, server: { middlewareMode: true, ws: false }, appType: 'custom', logLevel: 'silent' });
const originalFetch = globalThis.fetch, originalNow = Date.now;
const originals = new Map(['indexedDB', 'IDBKeyRange'].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
for (const [key, value] of Object.entries({ indexedDB, IDBKeyRange })) Object.defineProperty(globalThis, key, { configurable: true, value });
let now = originalNow(); Date.now = () => now;
try {
  const { ThumbnailLoader } = await vite.ssrLoadModule('/src/client/thumbnails.ts');
  const { readContent, maintainDeviceCache } = await vite.ssrLoadModule('/src/client/deviceContent.ts');
  const article = (id, thumbnail_url = null) => ({ id, url: `https://news.example.test/${id}`, thumbnail_url });
  let requests = 0, running = 0, peak = 0, releases = [], token = 'first';
  const loader = new ThumbnailLoader(async () => {
    requests++; running++; peak = Math.max(peak, running);
    await new Promise((resolve) => releases.push(resolve)); running--;
    return { thumbnailUrl: 'https://cdn.example.test/photo.jpg' };
  }, () => token);
  const jobs = Array.from({ length: 12 }, (_,i) => loader.lookup('owner', article(`row-${i}`)));
  assert.equal(loader.lookup('owner', article('row-0')), jobs[0], 'nearby rows share one in-flight lookup');
  for (let i = 0; i < 12; i++) { while (!releases.length) await new Promise(setImmediate); releases.shift()(); await new Promise(setImmediate); }
  assert.ok((await Promise.all(jobs)).every((url) => url.endsWith('photo.jpg'))); assert.equal(requests, 12); assert.ok(peak <= 4, 'slow page lookups never exceed four at once');
  const offline = new ThumbnailLoader(async () => { throw new Error('Must use local storage'); }, () => token);
  assert.equal(await offline.lookup('owner', article('row-0')), 'https://cdn.example.test/photo.jpg', 'a fresh loader reuses the account device cache');
  assert.equal(await offline.lookup('owner', article('supplied', 'https://cdn.example.test/from-feed.jpg')), 'https://cdn.example.test/from-feed.jpg');
  assert.equal(await readContent('other', 'thumbnail:row-0'), undefined);

  let attempts = 0;
  const transient = new ThumbnailLoader(async () => ++attempts === 1 ? { thumbnailUrl: null, retryable: true } : { thumbnailUrl: 'https://cdn.example.test/recovered.jpg' }, () => token);
  assert.equal(await transient.lookup('owner', article('retry')), undefined);
  assert.equal(await readContent('owner', 'thumbnail:retry'), undefined, 'temporary failures are not cached as missing images');
  await transient.lookup('owner', article('retry')); assert.equal(attempts, 1, 'temporary failures have a short cooldown');
  now += 61_000; assert.match(await transient.lookup('owner', article('retry')), /recovered/); assert.equal(attempts, 2);
  let misses = 0;
  const missing = new ThumbnailLoader(async () => { misses++; return { thumbnailUrl: null }; }, () => token);
  assert.equal(await missing.lookup('owner', article('no-photo', '')), '');
  await missing.lookup('owner', article('no-photo', '')); assert.equal(misses, 1, 'real missing images use the logo without repeated requests');
  now += 86400_001; await missing.lookup('owner', article('no-photo', '')); assert.equal(misses, 2, 'old missing-image answers can recover');
  let finish;
  const late = new ThumbnailLoader(() => new Promise((resolve) => { finish = resolve; }), () => token);
  const pending = late.lookup('owner', article('late'));
  while (!finish) await new Promise(setImmediate);
  token = 'second'; finish({ thumbnailUrl: 'https://cdn.example.test/late.jpg' });
  assert.equal(await pending, undefined); assert.equal(await readContent('owner', 'thumbnail:late'), undefined, 'account/session changes reject late results');

  const { app } = await vite.ssrLoadModule('/src/server/app.ts');
  const { LocalD1Database } = await vite.ssrLoadModule('/src/server/localD1.ts');
  const { upsertFeedAndArticles } = await vite.ssrLoadModule('/src/server/seedService.ts');
  const { fetchPreviewImage } = await vite.ssrLoadModule('/src/server/previewImage.ts');
  const db = new LocalD1Database(':memory:', 'migrations/0001_schema.sql'), env = { DB: db, ALLOW_QUICK_LOGIN: 'true' };
  const login = async (email) => (await app.request('/api/auth/google/quick', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email }) }, env)).json();
  const owner = await login('thumbnail@example.test'), other = await login('other-thumbnail@example.test');
  const { feedId } = await upsertFeedAndArticles(db, { title: 'Photos', xmlUrl: 'https://news.example.test/feed', htmlUrl: null, description: null, faviconUrl: null, articles: [{ guid: 'photo', title: 'Public photo', url: 'https://news.example.test/photo', author: null, summary: null, contentHtml: null, thumbnailUrl: null, publishedAt: new Date(now).toISOString() }] });
  await db.prepare('INSERT INTO subscriptions(id,user_id,feed_id,created_at) VALUES(?,?,?,?)').bind('sub', owner.user.id, feedId, new Date(now).toISOString()).run();
  const stored = await db.prepare('SELECT id FROM articles WHERE feed_id=?').bind(feedId).first();
  const get = (session = owner.token) => app.request(`/api/articles/${stored.id}/thumbnail`, { method: 'POST', headers: { authorization: `Bearer ${session}` } }, env);
  let mode = 'photo', pageRequests = 0, cancelled = false;
  globalThis.fetch = async () => {
    pageRequests++;
    if (typeof mode === 'number') return new Response('', { status: mode });
    if (mode === 'challenge') return new Response('<title>Vercel Security Checkpoint</title>');
    if (mode === 'none') return new Response('<html><head><title>No photo</title></head><body>Public page</body></html>');
    return new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('<html><head><meta property="og:image" content="/real.jpg"></head>')); }, cancel() { cancelled = true; } }));
  };
  const image = await (await get()).json(); assert.equal(image.thumbnailUrl, 'https://news.example.test/real.jpg'); assert.ok(cancelled, 'only the head is read; the page body is cancelled');
  const before = pageRequests; await get(); assert.equal(pageRequests, before, 'a server-saved image never refetches the page');
  await db.prepare("UPDATE articles SET thumbnail_url='' WHERE id=?").bind(stored.id).run();
  assert.equal((await (await get()).json()).thumbnailUrl, image.thumbnailUrl, 'old blank database values can be repaired');
  for (mode of [403, 429, 503, 'challenge']) {
    await db.prepare('UPDATE articles SET thumbnail_url=NULL WHERE id=?').bind(stored.id).run();
    const response = await (await get()).json(); assert.equal(response.retryable, true);
    assert.equal((await db.prepare('SELECT thumbnail_url FROM articles WHERE id=?').bind(stored.id).first()).thumbnail_url, null);
  }
  mode = 'none'; const noImage = await (await get()).json(); assert.equal(noImage.retryable, false); assert.equal(noImage.thumbnailUrl, null);
  assert.equal((await db.prepare('SELECT thumbnail_url FROM articles WHERE id=?').bind(stored.id).first()).thumbnail_url, '');
  mode = 404; assert.equal(await fetchPreviewImage('https://news.example.test/gone'), null);
  const denied = await get(other.token); assert.equal(denied.status, 404);
  await maintainDeviceCache('owner', true);
  console.log('PASS: all nearby thumbnails resolve with four-request limit and dedup; device reuse, known-missing expiry, retry cooldown and session isolation; real head-only metadata, legacy blank repair, no permanent 403/429/challenge poisoning and subscription access.');
} finally {
  globalThis.fetch = originalFetch; Date.now = originalNow;
  for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; }
  await vite.close();
}
