import assert from 'node:assert/strict';
import { createServer } from 'vite';

const vite = await createServer({ configFile: false, server: { middlewareMode: true, ws: false }, appType: 'custom', logLevel: 'silent' });
const originalFetch = globalThis.fetch;
try {
  const { analyseBuilderHtml, publicPageUrl } = await vite.ssrLoadModule('/src/server/rssBuilder.ts');
  const { parseXmlFeedContent } = await vite.ssrLoadModule('/src/server/rssParser.ts');
  const { LocalD1Database } = await vite.ssrLoadModule('/src/server/localD1.ts');
  const { app } = await vite.ssrLoadModule('/src/server/app.ts');
  const { default: worker } = await vite.ssrLoadModule('/src/worker.ts');
  const source = 'https://builder.example.test/ko/research';
  let count = 2;
  let unavailable = false;
  const html = () => `<html><head><title>Research &amp; reports</title></head><body>
    <nav><a href="/ko/research/not-an-article">Navigation link</a></nav>
    ${Array.from({ length: count }, (_, i) => `<div class="group flex flex-col"><a href="/ko/research/post-${i}"> <img src="/image-${i}.png" alt="Report number ${i}"> </a><a href="/ko/research/post-${i}?utm_source=test"><h3>Report number ${i}</h3></a><a href="/ko/researchers/author">Author profile</a>${i ? '' : '<time datetime="2026-10-21T15:00:00+09:00">2026.10.21</time>'}</div>`).join('')}
    <section><a href="/other/first">Other section first</a><a href="/other/second">Other section second</a></section>
    <footer><a href="/ko/research/not-a-post">Footer link</a></footer></body></html>`;
  const parsed = analyseBuilderHtml(html(), source);
  assert.equal(parsed.title, 'Research & reports');
  assert.equal(parsed.groups.length, 2);
  const group = parsed.groups[0];
  assert.equal(group.articles.length, 2, 'image and heading links must be deduplicated');
  assert.equal(group.articles[0].title, 'Report number 0');
  assert.equal(group.articles[0].publishedAt, '2026-10-21T06:00:00.000Z');
  assert.equal(group.articles[0].thumbnailUrl, 'https://builder.example.test/image-0.png');
  assert.equal(group.articles[1].dateSource, 'collected');
  assert.equal(analyseBuilderHtml(html(), source, group.selector).groups.length, 1);
  assert.throws(() => analyseBuilderHtml(html(), source, 'a['), /선택/);
  assert.throws(() => analyseBuilderHtml('<title>Vercel Security Checkpoint</title>', source), /차단/);
  for (const url of ['http://localhost/page', 'http://127.0.0.1/page', 'http://[::1]/page', 'file:///etc/passwd', 'https://user:pass@example.com', 'https://metadata.internal/page']) assert.throws(() => publicPageUrl(url));
  const noImage = analyseBuilderHtml('<a href="/post/1"><img>First real article</a><a href="/post/2">Second real article</a>', source);
  assert.equal(noImage.groups[0].articles[0].thumbnailUrl, null);

  const db = new LocalD1Database(':memory:', 'migrations/0001_schema.sql');
  const env = { DB: db, ALLOW_QUICK_LOGIN: 'true' };
  const login = async (email) => (await app.request('https://sfeed.example.test/api/auth/google/quick', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email }) }, env)).json();
  const { token, user } = await login('builder@example.test');
  const other = await login('another-builder@example.test');
  const request = (path, body, auth = token) => app.request(`https://sfeed.example.test${path}`, { method: body ? 'POST' : 'GET', headers: { authorization: `Bearer ${auth}`, 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) }, env);
  let fetches = 0;
  const blocked = 'https://blocked.example.test/ko/research';
  const blockedFetches = [];
  let sitemapPosts = [['lombard-s-grand-roadmap', '2026-10-16T04:16:51.007Z'], ['monthly-eip-sep-2026', '2026-10-15T07:30:37.614Z'], ...['old-a', 'old-b', 'old-c'].map((slug) => [slug, '2026-04-21T07:28:58.513Z'])];
  const urlset = (entries) => `<?xml version="1.0"?><urlset>${entries.map(([loc, lastmod]) => `<url><loc>${loc}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ''}</url>`).join('')}</urlset>`;
  globalThis.fetch = async (input) => {
    fetches++;
    const url = String(input);
    if (url.startsWith('https://blocked.example.test/') || url.startsWith('https://elsewhere.example.test/')) {
      blockedFetches.push(url);
      if (url === 'https://blocked.example.test/robots.txt') return new Response('User-Agent: *\nSitemap: https://blocked.example.test/sitemap-index.xml\nSitemap: https://elsewhere.example.test/sitemap.xml\n');
      if (url.endsWith('/sitemap-index.xml')) return new Response('<sitemapindex><sitemap><loc>https://blocked.example.test/pages.xml</loc></sitemap><sitemap><loc>https://blocked.example.test/research.xml</loc></sitemap></sitemapindex>');
      if (url.endsWith('/pages.xml')) return new Response(urlset([['https://blocked.example.test/about']]));
      if (url.endsWith('/research.xml')) return new Response(urlset([
        ['https://blocked.example.test/ko/research/crypto'],
        ...sitemapPosts.map(([slug, lastmod]) => [`https://blocked.example.test/ko/research/${slug}`, lastmod]),
        ['https://blocked.example.test/en/research/lombard-s-grand-roadmap', '2026-10-16T04:16:51.007Z'],
      ]));
      return new Response('<title>Vercel Security Checkpoint</title>', { status: 429, headers: { 'x-vercel-mitigated': 'challenge' } });
    }
    if (unavailable) return new Response('Unavailable', { status: 503 });
    if (url.startsWith(source)) return new Response(html(), { headers: { 'content-type': 'text/html' } });
    if (url.includes('/empty')) return new Response('<html><title>No posts</title></html>');
    return new Response('<html><title>Article</title></html>');
  };
  assert.equal((await app.request('/api/rss-builder/analyse', { method: 'POST', body: '{}' }, env)).status, 401);
  for (const url of ['bad value', 'http://127.0.0.1/', 'http://metadata.internal/']) assert.equal((await request('/api/rss-builder/analyse', { url })).status, 400);
  assert.equal(fetches, 0);
  assert.equal((await request('/api/rss-builder/analyse', { url: 'https://builder.example.test/empty' })).status, 422);
  const preview = await request('/api/rss-builder/analyse', { url: source });
  assert.equal(preview.status, 200);
  assert.equal((await preview.json()).groups[0].articles.length, 2);
  for (const table of ['feeds', 'articles', 'subscriptions', 'rss_builders', 'folders']) assert.equal((await db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first()).n, 0, `analysis must not create ${table}`);
  await db.prepare('INSERT INTO folders(id,user_id,name,color,sort_order,created_at) VALUES(?,?,?,?,?,?)').bind('other-folder', other.user.id, 'Private', '#fff', 0, new Date().toISOString()).run();
  assert.equal((await request('/api/rss-builder', { url: source, selector: group.selector, folderId: 'other-folder' })).status, 404);
  assert.equal((await request('/api/rss-builder', { url: source, selector: group.selector, folderId: {} })).status, 400);
  const body = { url: source, selector: group.selector, title: 'My research', folderName: 'Research' };
  const response = await request('/api/rss-builder', body);
  assert.equal(response.status, 200, await response.clone().text());
  const built = await response.json();
  assert.equal(built.insertedCount, 2);
  assert.match(built.rssUrl, /^https:\/\/sfeed.example.test\/rss\/rss_/);
  const duplicate = await (await request('/api/rss-builder', body)).json();
  assert.equal(duplicate.rssUrl, built.rssUrl);
  assert.equal(duplicate.insertedCount, 0);
  assert.equal((await db.prepare('SELECT count(*) AS n FROM subscriptions').first()).n, 1);
  assert.equal((await db.prepare('SELECT count(*) AS n FROM rss_builders').first()).n, 1);
  assert.equal((await db.prepare('SELECT name FROM folders WHERE user_id=?').bind(user.id).first()).name, 'Research');
  const row = await db.prepare('SELECT id FROM articles WHERE feed_id=? ORDER BY guid').bind(built.feedId).first();
  await db.prepare('INSERT INTO article_states(user_id,article_id,is_read,is_saved) VALUES(?,?,1,1)').bind(user.id, row.id).run();
  const rssResponse = await worker.fetch(new Request(built.rssUrl), env, {});
  assert.equal(rssResponse.status, 200);
  assert.match(rssResponse.headers.get('content-type'), /application\/rss\+xml/);
  const xml = await rssResponse.text();
  assert.equal((xml.match(/<pubDate>/g) || []).length, 1, 'undated posts must not claim a publication date');
  assert.equal(parseXmlFeedContent(xml, built.rssUrl).articles.length, 2);
  assert.ok(!xml.includes(user.email) && !xml.includes('is_read') && !xml.includes('is_saved'));
  assert.equal((await worker.fetch(new Request('https://sfeed.example.test/rss/unknown.xml'), env, {})).status, 404);
  assert.ok((await (await request('/api/opml/export')).text()).includes(built.rssUrl));
  count = 3;
  assert.equal((await (await request('/api/feeds/refresh', { feedId: built.feedId })).json()).newArticles, 1);
  count = 4;
  await worker.scheduled({}, env, {});
  assert.equal((await db.prepare('SELECT count(*) AS n FROM articles WHERE feed_id=?').bind(built.feedId).first()).n, 4, 'scheduled refresh must ingest new website posts');
  assert.deepEqual({ ...await db.prepare('SELECT is_read,is_saved FROM article_states WHERE article_id=?').bind(row.id).first() }, { is_read: 1, is_saved: 1 });
  count = 2;
  await request('/api/feeds/refresh', { feedId: built.feedId });
  assert.equal((await db.prepare('SELECT count(*) AS n FROM articles WHERE feed_id=?').bind(built.feedId).first()).n, 4, 'posts that leave the listing must remain readable');
  unavailable = true;
  await request('/api/feeds/refresh', { feedId: built.feedId });
  assert.match((await db.prepare('SELECT last_error FROM feeds WHERE id=?').bind(built.feedId).first()).last_error, /503/);
  assert.equal((await worker.fetch(new Request(built.rssUrl), env, {})).status, 200, 'stored RSS must remain available during upstream failure');
  unavailable = false;

  // A site that challenges automated visits: build the list from its sitemap.
  const fromSitemap = await (await request('/api/rss-builder/analyse', { url: blocked })).json();
  assert.equal(fromSitemap.fromSitemap, true);
  assert.equal(fromSitemap.groups.length, 1);
  const sitemapGroup = fromSitemap.groups[0];
  assert.equal(sitemapGroup.selector, 'sitemap:/ko/research/');
  assert.deepEqual(sitemapGroup.articles.map((article) => article.title), ["Lombard's grand roadmap", 'Monthly eip sep 2026'], 'newest first; no category page, bulk-dated posts or other sections');
  assert.equal(sitemapGroup.articles[0].publishedAt, '2026-10-16T04:16:51.007Z');
  assert.equal(sitemapGroup.articles[0].dateSource, 'feed');
  assert.ok(!blockedFetches.some((url) => url.startsWith('https://elsewhere.example.test/')), 'sitemaps on other hosts are ignored');
  const sitemapBuilt = await (await request('/api/rss-builder', { url: blocked, selector: sitemapGroup.selector, title: '4Pillars' })).json();
  assert.equal(sitemapBuilt.insertedCount, 2);
  sitemapPosts = [['newest-report', '2026-10-21T01:00:00.000Z'], ...sitemapPosts];
  blockedFetches.length = 0;
  assert.equal((await (await request('/api/feeds/refresh', { feedId: sitemapBuilt.feedId })).json()).newArticles, 1);
  assert.ok(!blockedFetches.includes(blocked), 'a sitemap feed refreshes from the sitemap without retrying the blocked page');
  assert.equal((await db.prepare('SELECT title FROM articles WHERE feed_id=? ORDER BY published_at DESC').bind(sitemapBuilt.feedId).first()).title, 'Newest report');
  console.log('PASS: public URL validation, structured list discovery, deduplication, accurate/missing dates, read-only analysis, opt-in creation, folder ownership, stable RSS URL, public XML/OPML, idempotency, manual and scheduled new-post ingestion, retained history/read/save states, upstream failure recovery and sitemap fallback for sites that block automated visits.');
} finally { globalThis.fetch = originalFetch; await vite.close(); }
