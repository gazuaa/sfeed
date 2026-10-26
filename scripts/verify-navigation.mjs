import assert from 'node:assert/strict';
import { createServer } from 'vite';

const vite = await createServer({ configFile: false, server: { middlewareMode: true, ws: false }, appType: 'custom', logLevel: 'silent' });
try {
  const { MobileNavigation } = await vite.ssrLoadModule('/src/client/navigation.ts');
  const library = { scope: 'all', folderId: null, feedId: null, search: '', unread: false, articleId: null, library: true };
  const list = { ...library, scope: 'folder', folderId: 'crypto', library: false };
  const a = { ...list, articleId: 'article-a' }, b = { ...list, articleId: 'article-b' };
  const entries = [null]; let index = 0, location = library, scroll = 0, navigation;
  const history = {
    get state() { return entries[index]; },
    replaceState(state) { entries[index] = structuredClone(state); },
    pushState(state) { entries.splice(index + 1); entries.push(structuredClone(state)); index++; },
    go(delta) { assert.ok(index + delta >= 0 && index + delta < entries.length); index += delta; navigation.pop(this.state); },
  };
  const restore = (next, position) => { location = next; scroll = position; };
  navigation = new MobileNavigation(history, 'owner', library, restore);
  const open = (next, top = 0) => { location = next; navigation.record(next, top); };
  const back = () => { history.go(-1); navigation.record(location); };
  const forward = () => { history.go(1); navigation.record(location); };
  open(list); open(a, 620); open(b);
  assert.equal(entries.length, 4);
  back(); assert.deepEqual(location, a);
  back(); assert.deepEqual(location, list); assert.equal(scroll, 620);
  back(); assert.deepEqual(location, library);
  forward(); assert.deepEqual(location, list);
  forward(); assert.deepEqual(location, a);
  forward(); assert.deepEqual(location, b);
  // The reader's close button returns straight to its list, skipping articles.
  open(list);
  assert.equal(index, 1); assert.equal(scroll, 620);
  open(library); assert.equal(index, 0);
  forward();
  open({ ...list, unread: true });
  const unread = location;
  open({ ...unread, search: 'b' }); open({ ...unread, search: 'bitcoin' });
  const count = entries.length;
  assert.equal(index, 2); assert.equal(count, 3, 'typing replaces the list entry');
  open({ ...location, articleId: 'read-article' }, 300);
  back(); assert.equal(location.search, 'bitcoin'); assert.equal(location.unread, true); assert.equal(scroll, 300);
  back(); assert.deepEqual(location, list);
  forward(); forward();
  // A reload can recover the current reader using IDs without storing content.
  navigation = new MobileNavigation(history, 'owner', library, restore);
  assert.equal(location.articleId, 'read-article'); navigation.record(location);
  assert.ok(!JSON.stringify(history.state).includes('content_html'));
  // Logging into another account does not restore the former account's reader.
  navigation = new MobileNavigation(history, 'another-account', library, restore);
  assert.equal(history.state.sfeedNavigation.account, 'another-account');
  assert.deepEqual(history.state.sfeedNavigation.location, library);
  back(); assert.equal(location.articleId, null); assert.equal(location.library, true);

  const { app } = await vite.ssrLoadModule('/src/server/app.ts');
  const { LocalD1Database } = await vite.ssrLoadModule('/src/server/localD1.ts');
  const db = new LocalD1Database(':memory:', 'migrations/0001_schema.sql');
  const env = { DB: db, ALLOW_QUICK_LOGIN: 'true' };
  const login = async (email) => (await app.request('/api/auth/google/quick', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email }) }, env)).json();
  const owner = await login('history@example.test'), other = await login('other-history@example.test');
  const now = new Date().toISOString();
  await db.prepare('INSERT INTO feeds(id,xml_url,title,created_at) VALUES(?,?,?,?)').bind('history-feed', 'https://example.test/feed', 'History', now).run();
  await db.prepare('INSERT INTO subscriptions(id,user_id,feed_id,created_at) VALUES(?,?,?,?)').bind('history-sub', owner.user.id, 'history-feed', now).run();
  await db.prepare('INSERT INTO articles(id,feed_id,guid,title,url,published_at,created_at) VALUES(?,?,?,?,?,?,?)').bind('history-article', 'history-feed', 'history', 'Restored article', 'https://example.test/post', now, now).run();
  await db.prepare('INSERT INTO article_states(user_id,article_id,is_read,is_saved) VALUES(?,?,1,1)').bind(owner.user.id, 'history-article').run();
  const query = '/api/articles?articleId=history-article&scope=saved&unreadOnly=true&search=does-not-match&before=1900';
  const get = async (token, url = query) => (await app.request(url, { headers: { authorization: `Bearer ${token}` } }, env)).json();
  const restored = await get(owner.token);
  assert.equal(restored.articles[0].id, 'history-article');
  assert.equal(restored.articles[0].is_read, true); assert.equal(restored.articles[0].is_saved, true);
  assert.equal((await get(other.token)).articles.length, 0, 'a single-article lookup still requires a subscription');
  assert.equal((await get(owner.token, '/api/articles?unreadOnly=true')).articles.length, 0, 'history restoration must not mark read articles unread');
  assert.equal((await app.request(query, {}, env)).status, 401);
  console.log('PASS: mobile Back/Forward, article/list/library order, close shortcuts, scroll/filter/search restoration, reload, account isolation and read/saved article recovery.');
} finally { await vite.close(); }
