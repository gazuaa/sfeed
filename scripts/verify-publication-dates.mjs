import assert from 'node:assert/strict';
import { createServer } from 'vite';

const vite = await createServer({ configFile: false, server: { middlewareMode: true, ws: false }, appType: 'custom', logLevel: 'silent' });
const originalFetch = globalThis.fetch;
try {
  const { parseXmlFeedContent } = await vite.ssrLoadModule('/src/server/rssParser.ts');
  const { extractOriginalPublishedAt, extractSummaryPublishedAt, parsePublicationDate } = await vite.ssrLoadModule('/src/server/publicationDate.ts');
  const { upsertFeedAndArticles } = await vite.ssrLoadModule('/src/server/seedService.ts');
  const { LocalD1Database } = await vite.ssrLoadModule('/src/server/localD1.ts');
  const { app } = await vite.ssrLoadModule('/src/server/app.ts');
  const url = 'https://www.hankyung.com/article/202609117709i';
  const published = '2026-09-10T15:58:00.000Z'; // Sep 11, 00:58 KST
  const updated = '2026-10-21T14:15:13.000Z';
  const card = `<h2 class="news-tit"><a href="${url}">Test title</a></h2><p class="txt-date">2026.09.11 00:58</p>`;
  const rss = (body = card, date = updated) => parseXmlFeedContent(`<rss><channel><title>Reporter</title><link>https://www.hankyung.com/</link><item><guid>stable-guid</guid><link>${url}</link><title>Test title</title><pubDate>${date}</pubDate><description><![CDATA[${body}]]></description></item></channel></rss>`, 'https://example.test/generated-rss');
  assert.equal(rss().articles[0].publishedAt, published);
  assert.equal(rss().articles[0].originalPublishedAt, published);
  assert.equal(extractOriginalPublishedAt(card.replace(url, 'https://www.hankyung.com/article/other'), url), null, 'related card must not date the current article');
  assert.equal(extractOriginalPublishedAt('<p>A meeting on 2026.09.11 00:58</p>', url), null);
  assert.equal(extractOriginalPublishedAt('<time itemprop="dateModified" datetime="2026-10-21T00:00:00Z"></time>', url), null);
  assert.equal(extractOriginalPublishedAt('<meta property="article:modified_time" content="2026-10-21T00:00:00Z">', url), null);
  assert.equal(extractOriginalPublishedAt(`<meta content="2026-09-11T00:58:00+09:00" property="article:published_time"><meta property="article:modified_time" content="${updated}">`, url), published);
  assert.equal(extractOriginalPublishedAt('<time datetime="2026-09-11T00:58:00+09:00" itemprop="datePublished">Yesterday</time>', url), published);
  const structured = (data) => `<script type="application/ld+json">${JSON.stringify(data)}</script>`;
  assert.equal(extractOriginalPublishedAt(structured({ '@graph': [
    { '@type': 'NewsArticle', url: 'https://example.test/related', datePublished: updated },
    { '@type': 'NewsArticle', url, dateModified: updated, datePublished: '2026-09-11T00:58:00+09:00' },
  ] }), url), published);
  assert.equal(extractOriginalPublishedAt(structured({ '@type': 'Event', startDate: updated, datePublished: updated }), url), null);
  assert.equal(extractOriginalPublishedAt('<script type="application/ld+json">broken JSON</script>', url), null);
  assert.equal(extractSummaryPublishedAt('Test title 2026.09.11 00:58 글로벌 증시 Delivered by PolitePaul service', 'Test title', url), published);
  assert.equal(extractSummaryPublishedAt('Related title 2026.09.11 00:58', 'Test title', url), null);
  assert.equal(extractSummaryPublishedAt('Test title 2026.09.11 00:58', 'Test title', 'https://example.test/story'), null);
  assert.equal(parsePublicationDate('2026.02.30 12:00'), null);
  assert.equal(parsePublicationDate('2026-09-11 00:58:00'), published);
  assert.equal(parsePublicationDate('Fri, 11 Sep 2026 00:58:00 +0900'), published);
  assert.equal(parsePublicationDate('2026-09-11T00:58:00+09:00'), published);
  const atom = parseXmlFeedContent(`<feed xmlns="http://www.w3.org/2005/Atom"><title>Atom</title><entry><id>atom-guid</id><title>Atom title</title><link href="https://example.test/article"/><published>2026-09-11T00:58:00+09:00</published><updated>${updated}</updated></entry></feed>`, 'https://example.test/atom');
  assert.equal(atom.articles[0].publishedAt, published, 'published must precede updated');
  const invalid = parseXmlFeedContent(`<rss><channel><title>RSS</title><item><pubDate>invalid</pubDate><published>2026-09-11T00:58:00+09:00</published></item></channel></rss>`, 'https://example.test/rss');
  assert.equal(invalid.articles[0].publishedAt, published, 'invalid first field must not mask a valid publication field');

  const database = new LocalD1Database(':memory:', 'migrations/0001_schema.sql');
  let maxParameters = 0;
  const db = {
    prepare(sql) {
      const statement = database.prepare(sql);
      return new Proxy(statement, { get(target, key) {
        if (key === 'bind') return (...values) => { maxParameters = Math.max(maxParameters, values.length); return target.bind(...values); };
        return typeof target[key] === 'function' ? target[key].bind(target) : target[key];
      } });
    },
    batch: (statements) => database.batch(statements), exec: (sql) => database.exec(sql),
  };
  const env = { DB: db, ALLOW_QUICK_LOGIN: 'true' };
  const login = await app.request('/api/auth/google/quick', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'dates@example.test' }) }, env);
  const { token, user } = await login.json();
  const parsed = rss();
  const legacy = { ...parsed, articles: parsed.articles.map((article) => ({ ...article, publishedAt: updated, originalPublishedAt: null })) };
  const { feedId } = await upsertFeedAndArticles(db, legacy);
  const row = await db.prepare('SELECT * FROM articles WHERE feed_id = ?').bind(feedId).first();
  // The old timestamp is not near created_at, so the old heuristic missed it.
  await db.prepare('UPDATE articles SET created_at = ? WHERE id = ?').bind('2026-10-21T23:30:13.808Z', row.id).run();
  await db.prepare('INSERT INTO article_states(user_id,article_id,is_read,is_saved) VALUES(?,?,1,1)').bind(user.id, row.id).run();
  assert.equal((await upsertFeedAndArticles(db, parsed)).insertedCount, 0);
  assert.equal((await db.prepare('SELECT published_at FROM articles WHERE id = ?').bind(row.id).first()).published_at, published);
  assert.deepEqual({ ...await db.prepare('SELECT is_read,is_saved FROM article_states WHERE article_id = ?').bind(row.id).first() }, { is_read: 1, is_saved: 1 });
  // Repeated generator timestamps cannot push a repaired original date forward.
  await upsertFeedAndArticles(db, legacy);
  assert.equal((await db.prepare('SELECT published_at FROM articles WHERE id = ?').bind(row.id).first()).published_at, published);
  const bulk = { ...parsed, articles: Array.from({ length: 8 }, (_, i) => ({ ...parsed.articles[0], guid: `bulk-${i}` })) };
  await upsertFeedAndArticles(db, bulk);
  assert.ok(maxParameters <= 100, `D1 bind limit exceeded: ${maxParameters}`);

  // Reader View must select datePublished, persist it, and return it for the
  // already-open drawer. Scraping a modified date alone must preserve the date.
  await db.prepare('UPDATE articles SET published_at = ?, content_html = NULL WHERE id = ?').bind(updated, row.id).run();
  globalThis.fetch = async () => new Response(`<html><head><meta property="article:published_time" content="2026-09-11T00:58:00+09:00"><meta property="article:modified_time" content="${updated}"></head><body><article><p>${'Real article content. '.repeat(30)}</p></article></body></html>`);
  const read = async (body = {}) => app.request(`/api/articles/${row.id}/reader-view`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) }, env);
  const response = await read();
  assert.equal(response.status, 200);
  assert.equal((await response.json()).publishedAt, published);
  assert.equal((await db.prepare('SELECT published_at FROM articles WHERE id = ?').bind(row.id).first()).published_at, published);
  globalThis.fetch = async () => new Response(`<meta property="article:modified_time" content="${updated}"><article><p>${'Real article content. '.repeat(30)}</p></article>`);
  assert.equal((await (await read({ force: true })).json()).publishedAt, published);
  assert.equal((await (await read()).json()).publishedAt, published, 'cached reader responses must include the publication date');
  console.log('PASS: original publisher/card dates precede generator and modification times; KST and valid RSS/Atom dates preserved; unrelated/invalid dates rejected; existing IDs/read/bookmarks preserved; Reader View persists and returns original dates; D1 <=100 parameters.');
} finally {
  globalThis.fetch = originalFetch;
  await vite.close();
}
