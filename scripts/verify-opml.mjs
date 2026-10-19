import assert from 'node:assert/strict';
import { createServer } from 'vite';

const vite = await createServer({
  configFile: false, server: { middlewareMode: true, ws: false }, appType: 'custom', logLevel: 'silent',
});
const originalFetch = globalThis.fetch;
try {
  const { app } = await vite.ssrLoadModule('/src/server/app.ts');
  const { LocalD1Database } = await vite.ssrLoadModule('/src/server/localD1.ts');
  const database = new LocalD1Database(':memory:', 'migrations/0001_schema.sql');
  let queries = 0;
  let maxParameters = 0;
  const db = {
    prepare(sql) {
      queries++;
      const statement = database.prepare(sql);
      return new Proxy(statement, {
        get(target, property) {
          if (property === 'bind') return (...values) => {
            maxParameters = Math.max(maxParameters, values.length);
            return target.bind(...values);
          };
          const value = target[property];
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
    },
    batch: (statements) => database.batch(statements),
    exec: (sql) => database.exec(sql),
  };
  const env = { DB: db, ALLOW_QUICK_LOGIN: 'true' };
  const login = await app.request('/api/auth/google/quick', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'opml-test@example.test' }),
  }, env);
  const { token, user } = await login.json();
  async function request(path, body) {
    return app.request(path, {
      method: body ? 'POST' : 'GET',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }, env);
  }

  let fetches = 0;
  let broken = true;
  let fillMissingContent = false;
  globalThis.fetch = async (url) => {
    fetches++;
    if (String(url).endsWith('/broken') && broken) return new Response('unavailable', { status: 503 });
    const articles = Array.from({ length: 40 }, (_, index) => `<item><guid>${url}/article/${index}</guid><title>Article ${index}</title><link>${url}/article/${index}</link>${fillMissingContent ? '<description>Real article content</description>' : ''}</item>`).join('');
    return new Response(`<rss version="2.0"><channel><title>Fixture feed</title><link>https://example.test</link>${articles}</channel></rss>`);
  };

  const outlines = Array.from({ length: 125 }, (_, index) => `<outline text="Feed ${index}" xmlUrl="https://example.test/feed/${index}" />`).join('');
  const xml = `<?xml version="1.0"?><opml version="2.0"><body><outline text="Tech &amp; News">${outlines}<outline text="Duplicate" xmlUrl="https://example.test/feed/0" /></outline><outline text="Broken" xmlUrl="https://example.test/broken" /><outline text="Invalid" xmlUrl="not a URL" /></body></opml>`;
  assert.equal((await request('/api/opml/parse', { opmlXml: '<opml><body>' })).status, 400);
  assert.equal((await request('/api/opml/parse', { opmlXml: '<opml><body /></opml>' })).status, 400);
  assert.equal((await request('/api/opml/import', { opmlXml: xml })).status, 400, 'Old clients must be rejected before writing, not silently truncated');
  assert.equal((await app.request('/api/opml/parse', { method: 'POST', body: '{}' }, env)).status, 401);
  const parsed = await (await request('/api/opml/parse', { opmlXml: xml })).json();
  assert.equal(parsed.totalFound, 128);
  assert.equal(parsed.items.length, 128);
  assert.equal(parsed.items[0].folderName, 'Tech & News');

  const counts = { imported: 0, existing: 0, failed: 0, folders: 0 };
  const failed = [];
  for (const item of parsed.items) {
    const beforeQueries = queries;
    const response = await request('/api/opml/import', { item });
    const result = await response.json();
    if (item.xmlUrl.endsWith('/broken')) assert.match(result.error, /HTTP 503/, 'Upstream failure reason must reach the UI');
    const status = response.ok ? result.status : 'failed';
    counts[status]++;
    counts.folders += result.foldersCreated || 0;
    if (status === 'failed') failed.push(item);
    assert.ok(queries - beforeQueries < 25, 'One feed must fit comfortably within a Worker query budget');
  }
  assert.deepEqual(counts, { imported: 125, existing: 1, failed: 2, folders: 1 });
  let state = await (await request('/api/bootstrap')).json();
  assert.equal(state.subscriptions.length, 125);
  assert.equal(state.folders.length, 1, 'A failed feed must not create an empty folder');
  assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM articles').first()).count, 5000);
  assert.ok(maxParameters <= 100, `Too many bound parameters: ${maxParameters}`);

  const beforeFetches = fetches;
  assert.equal((await (await request('/api/opml/import', { item: parsed.items[124] })).json()).status, 'existing');
  assert.equal(fetches, beforeFetches, 'Existing subscriptions must not be fetched again');
  broken = false;
  assert.equal((await (await request('/api/opml/import', { item: failed[0] })).json()).status, 'imported');
  state = await (await request('/api/bootstrap')).json();
  assert.equal(state.subscriptions.length, 126);

  // Bulk article writes must preserve IDs, saved/read state and fill missing content.
  const article = await db.prepare('SELECT id FROM articles ORDER BY id LIMIT 1').first();
  await db.prepare('INSERT INTO article_states (user_id, article_id, is_read, is_saved) VALUES (?, ?, 1, 1)').bind(user.id, article.id).run();
  const { feed_id: feedId } = await db.prepare('SELECT feed_id FROM articles WHERE id = ?').bind(article.id).first();
  const { xml_url: feedUrl } = await db.prepare('SELECT xml_url FROM feeds WHERE id = ?').bind(feedId).first();
  const { fetchAndParseFeed } = await vite.ssrLoadModule('/src/server/rssParser.ts');
  const { upsertFeedAndArticles } = await vite.ssrLoadModule('/src/server/seedService.ts');
  fillMissingContent = true;
  const refreshed = await upsertFeedAndArticles(db, await fetchAndParseFeed(feedUrl, { allowFallback: false }));
  assert.equal(refreshed.insertedCount, 0);
  assert.equal((await db.prepare('SELECT content_html FROM articles WHERE id = ?').bind(article.id).first()).content_html, 'Real article content');
  const saved = await db.prepare('SELECT is_read, is_saved FROM article_states WHERE article_id = ?').bind(article.id).first();
  assert.deepEqual({ ...saved }, { is_read: 1, is_saved: 1 });
  console.log('PASS: all 128 OPML entries processed; 125 new, 1 existing, 2 reported failures; retry works; folders preserved; 5,000 articles fit query/parameter budgets; refresh preserves read/bookmark state.');
} finally {
  globalThis.fetch = originalFetch;
  await vite.close();
}
