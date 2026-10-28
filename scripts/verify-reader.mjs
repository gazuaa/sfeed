import assert from 'node:assert/strict';
import { createServer } from 'vite';

const vite = await createServer({ configFile: false, server: { middlewareMode: true, ws: false }, appType: 'custom', logLevel: 'silent' });
const originalFetch = globalThis.fetch;
try {
  const { extractReaderContent, scrapeFullArticle } = await vite.ssrLoadModule('/src/server/readerScraper.ts');
  const { checkEmbeddable } = await vite.ssrLoadModule('/src/server/framing.ts');
  const { app } = await vite.ssrLoadModule('/src/server/app.ts');
  const { LocalD1Database } = await vite.ssrLoadModule('/src/server/localD1.ts');
  const { upsertFeedAndArticles } = await vite.ssrLoadModule('/src/server/seedService.ts');
  const url = 'https://reader.example.test/post';
  const body = '<p>A public article with meaningful text and a source link. '.repeat(8) + '<a href="/reference">Reference</a></p>';
  const html = `<html><head><title>Public article</title><meta property="article:published_time" content="2026-10-21T10:00:00+09:00"><meta property="og:image" content="https://reader.example.test/cover.jpg"></head><body><nav>Navigation</nav><main><article><section>${body}<img src="/inline.jpg" onerror=alert(1)><a href="javascript:alert(1)">Unsafe</a><script>alert(1)</script><iframe src="https://other.example.test"></iframe><div hidden>Hidden content</div></section></article></main><footer>Footer links</footer></body></html>`;
  const result = extractReaderContent(html, url, null);
  assert.equal(result.originalPublishedAt, '2026-10-21T01:00:00.000Z');
  assert.equal(result.leadImageUrl, 'https://reader.example.test/cover.jpg');
  assert.match(result.fullContentHtml, /https:\/\/reader.example.test\/reference/);
  assert.match(result.fullContentHtml, /https:\/\/reader.example.test\/inline.jpg/);
  assert.doesNotMatch(result.fullContentHtml, /onerror|javascript:|<script|<iframe|Navigation|Footer links|Hidden content/i);
  assert.equal(extractReaderContent('<title>Vercel Security Checkpoint</title><main>' + body + '</main>', url, null), null);
  assert.equal(extractReaderContent('<title>Sign in</title><main>' + body + '</main>', url, null), null);
  assert.equal(extractReaderContent('<title>Premium</title><script type="application/ld+json">{"isAccessibleForFree":false}</script><article>' + body + '</article>', url, null), null);
  assert.equal(extractReaderContent('<html><body><div id="app"></div></body></html>', url, null), null);

  // Decenter-style lazy images: a 1×1 stand-in sized to the photo, the real one in data-src.
  const lazyPage = `<html><head><title>Lazy</title></head><body><article>${body}<figure><img loading="lazy" data-src="/photo_P1.webp" src="https://static.example.test/img/1X1.png" width="649" height="392"></figure><img src="/spacer.gif" width="600" height="300"><img data-lazy-src="/wide.jpg" data-srcset="/wide-800.jpg 800w, /wide-1600.jpg 1600w" src="data:image/gif;base64,R0lGODlhAQABAAAAACw="><img src="/loading-dock.jpg"><img data-src="/lazy.png" src="/blank.gif"><p>${'More body text. '.repeat(10)}</p></article></body></html>`;
  const lazy = extractReaderContent(lazyPage, url, null).fullContentHtml;
  assert.match(lazy, /src="https:\/\/reader.example.test\/photo_P1.webp"/, 'the real photo replaces its stand-in, so no blank gap remains');
  assert.doesNotMatch(lazy, /1X1\.png|spacer\.gif|data:image\/gif/, 'a bare stand-in with no real image is dropped');
  assert.match(lazy, /src="https:\/\/reader.example.test\/wide.jpg"/);
  assert.match(lazy, /srcset="https:\/\/reader.example.test\/wide-800.jpg 800w, https:\/\/reader.example.test\/wide-1600.jpg 1600w"/, 'lazy srcsets resolve against the article, not the app');
  assert.match(lazy, /loading-dock\.jpg/, 'an ordinary photo whose name merely starts with a placeholder word stays');
  assert.match(lazy, /src="https:\/\/reader.example.test\/lazy.png"/, 'the lazy loader\'s own address is the real image, whatever it is called');
  const { webCopy } = await vite.ssrLoadModule('/src/server/rssBuilder.ts');
  const lazyCopy = webCopy(lazyPage, url);
  assert.match(lazyCopy, /src="\/photo_P1.webp"/, 'the web copy shows the real photo too');
  assert.doesNotMatch(lazyCopy, /1X1\.png|spacer\.gif/);

  const { bodyShowsImage } = await vite.ssrLoadModule('/src/client/articleImages.ts');
  const lead = 'https://wimg.sedaily.com/news/cms/2026/10/28/news-p.v1.20261028.998e09ea2f92490cba5940754a0bad19_T1.jpg';
  assert.equal(bodyShowsImage(`<img src="${lead.replace('_T1', '_P1')}">`, lead), true, 'the lead image is not shown again when the body has it in another size');
  assert.equal(bodyShowsImage('<img src="https://cdn.example.test/uploads/harbor-sunrise-1024x683.jpg">', 'https://cdn.example.test/uploads/harbor-sunrise.jpg'), true);
  assert.equal(bodyShowsImage('<img src="https://cdn.example.test/uploads/harbor-sunset.jpg">', 'https://cdn.example.test/uploads/harbor-sunrise.jpg'), false);
  assert.equal(bodyShowsImage('<img src="https://cdn.example.test/a/img_1.jpg">', 'https://cdn.example.test/b/img_2.jpg'), false, 'short generic names are never treated as the same picture');
  globalThis.fetch = async () => new Response('challenge', { status: 429, headers: { 'x-vercel-mitigated': 'challenge' } });
  assert.equal((await checkEmbeddable(url, 'https://sfeed.example.test')).reason, 'challenge');
  assert.equal((await scrapeFullArticle(url, '<p>Short feed preview</p>', 'Title')).fullContentHtml, null);
  globalThis.fetch = async () => new Response(html, { headers: { 'x-frame-options': 'DENY' } });
  assert.equal((await checkEmbeddable(url, 'https://sfeed.example.test')).reason, 'framing');
  assert.ok((await scrapeFullArticle(url, null, 'Title')).fullContentHtml, 'framing restrictions must not prevent ordinary public reader extraction');
  globalThis.fetch = async () => new Response('Gone', { status: 404 });
  assert.equal((await checkEmbeddable(url, 'https://sfeed.example.test')).reason, 'http');

  const db = new LocalD1Database(':memory:', 'migrations/0001_schema.sql');
  const env = { DB: db, ALLOW_QUICK_LOGIN: 'true' };
  const { token, user } = await (await app.request('/api/auth/google/quick', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'reader@example.test' }) }, env)).json();
  const feed = await upsertFeedAndArticles(db, { title: 'Reader fixture', xmlUrl: 'https://reader.example.test/feed', htmlUrl: url, description: null, faviconUrl: null, articles: [{ guid: url, title: 'Public article', url, author: null, summary: null, contentHtml: null, thumbnailUrl: null, publishedAt: new Date().toISOString(), dateSource: 'collected' }] });
  await db.prepare('INSERT INTO subscriptions(id,user_id,feed_id,created_at) VALUES(?,?,?,?)').bind('reader-sub', user.id, feed.feedId, new Date().toISOString()).run();
  const row = await db.prepare('SELECT * FROM articles WHERE feed_id=?').bind(feed.feedId).first();
  await db.prepare('INSERT INTO article_states(user_id,article_id,is_read,is_saved) VALUES(?,?,0,1)').bind(user.id, row.id).run();
  const request = (body = {}) => app.request(`/api/articles/${row.id}/reader-view`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) }, env);
  assert.equal((await app.request(`/api/articles/${row.id}/reader-view`, { method: 'POST', body: '{}' }, env)).status, 401);
  globalThis.fetch = async () => new Response('<title>Vercel Security Checkpoint</title>' + body, { headers: { 'x-vercel-mitigated': 'challenge' } });
  assert.equal((await request()).status, 502);
  assert.equal((await db.prepare('SELECT full_content_html FROM articles WHERE id=?').bind(row.id).first()).full_content_html, null, 'a challenge must never be saved as an article body');
  let fetches = 0;
  globalThis.fetch = async () => { fetches++; return new Response(html); };
  const recovered = await request();
  assert.equal(recovered.status, 200);
  assert.equal((await recovered.json()).publishedAt, '2026-10-21T01:00:00.000Z');
  assert.equal((await (await request()).json()).cached, true);
  assert.equal(fetches, 1, 'reopening should reuse the real cached body');
  globalThis.fetch = async () => new Response('Unavailable', { status: 503 });
  assert.equal((await request({ force: true })).status, 502);
  assert.ok((await db.prepare('SELECT full_content_html FROM articles WHERE id=?').bind(row.id).first()).full_content_html, 'a failed refresh must retain a previously read body');
  assert.deepEqual({ ...await db.prepare('SELECT is_read,is_saved FROM article_states WHERE article_id=?').bind(row.id).first() }, { is_read: 0, is_saved: 1 });
  // Web view stand-in for sites that refuse framing: a script-free copy for
  // subscribers only, with links opening in a new tab.
  const stranger = await (await app.request('/api/auth/google/quick', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'stranger@example.test' }) }, env)).json();
  const copyRequest = (auth = token) => app.request(`/api/articles/${row.id}/web-copy`, { headers: { authorization: `Bearer ${auth}` } }, env);
  globalThis.fetch = async () => new Response(html, { headers: { 'x-frame-options': 'DENY' } });
  const copy = await (await copyRequest()).json();
  const baseTag = copy.html.match(/<base [^>]*>/)?.[0] || '';
  assert.ok(baseTag.includes('href="https://reader.example.test/post"') && baseTag.includes('target="_blank"'), baseTag);
  assert.match(copy.html, /meaningful text/);
  assert.doesNotMatch(copy.html, /<script|onerror|javascript:|<iframe/i);
  assert.equal((await copyRequest(stranger.token)).status, 404, 'only subscribers get a copy');
  globalThis.fetch = async () => new Response('challenge', { status: 429, headers: { 'x-vercel-mitigated': 'challenge' } });
  assert.equal((await copyRequest()).status, 502);
  console.log('PASS: public body extraction, relative assets, original date, safe markup, framing/challenge/HTTP distinction, no fake challenge or paywall body, authenticated reader cache/retry, preserved saved/read state and a script-free web copy for subscribers; lazy images revealed, blank stand-ins dropped and the lead image shown once.');
} finally { globalThis.fetch = originalFetch; await vite.close(); }
