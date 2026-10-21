import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

const vite = await createServer({ configFile: false, server: { middlewareMode: true, ws: false }, appType: 'custom', logLevel: 'silent' });
try {
  const { app } = await vite.ssrLoadModule('/src/server/app.ts');
  const { LocalD1Database } = await vite.ssrLoadModule('/src/server/localD1.ts');
  const { Sidebar } = await vite.ssrLoadModule('/src/components/Sidebar.tsx');
  const db = new LocalD1Database(':memory:', 'migrations/0001_schema.sql');
  const env = { DB: db, ALLOW_QUICK_LOGIN: 'true' };
  const login = async (email) => (await app.request('/api/auth/google/quick', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email }),
  }, env)).json();
  const owner = await login('counts@example.test');
  const other = await login('other-counts@example.test');
  const now = new Date().toISOString();
  await db.prepare('INSERT INTO folders(id,user_id,name,created_at) VALUES(?,?,?,?)').bind('folder', owner.user.id, 'Count folder', now).run();
  for (const [id, title, userId, folder] of [
    ['one', 'Folder feed', owner.user.id, 'folder'],
    ['two', 'Loose feed', owner.user.id, null],
    ['outside', 'Other user feed', other.user.id, null],
  ]) {
    await db.prepare('INSERT INTO feeds(id,xml_url,title,created_at) VALUES(?,?,?,?)').bind(id, `https://example.test/${id}`, title, now).run();
    await db.prepare('INSERT INTO subscriptions(id,user_id,feed_id,folder_id,created_at) VALUES(?,?,?,?,?)').bind(`sub-${id}`, userId, id, folder, now).run();
  }
  for (const [id, feed, hours] of [['a', 'one', 1], ['b', 'one', 2], ['c', 'one', 1440], ['d', 'two', 48], ['e', 'two', 1440], ['outside', 'outside', 1]]) {
    await db.prepare('INSERT INTO articles(id,feed_id,guid,title,url,published_at,created_at) VALUES(?,?,?,?,?,?,?)').bind(id, feed, id, id, `https://example.test/${id}`, new Date(Date.now() - hours * 3600_000).toISOString(), now).run();
  }
  await db.prepare('INSERT INTO article_states(user_id,article_id,is_read,is_saved) VALUES(?,?,1,1)').bind(owner.user.id, 'b').run();
  await db.prepare('INSERT INTO article_states(user_id,article_id,is_read) VALUES(?,?,0)').bind(owner.user.id, 'e').run();
  const bootstrap = async (token) => (await app.request('/api/bootstrap', { headers: { authorization: `Bearer ${token}` } }, env)).json();
  const data = await bootstrap(owner.token);
  assert.deepEqual(data.counts, { totalUnread: 2, totalArticles: 5, savedCount: 1, todayCount: 1, todayTotal: 2 });
  assert.deepEqual(data.subscriptions.map((s) => [s.feed_id, s.total_count, s.unread_count]).sort(), [['one', 3, 1], ['two', 2, 1]]);
  const render = (unreadOnly) => renderToStaticMarkup(React.createElement(Sidebar, {
    ...data, user: owner.user, unreadOnly, activeScope: 'all', activeFolderId: null, activeFeedId: null,
    isDark: true, mobileOpen: false, onSelectScope() {}, onOpenDiscover() {}, onCreateFolder() {},
    onDeleteFolder() {}, onUnsubscribe() {}, onLogout() {}, onCloseMobile() {},
  })).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const all = render(false);
  const unread = render(true);
  for (const text of ['전체 피드 (All) 5', '오늘의 아티클 (Today) 2', 'Count folder 3', 'Folder feed 3', 'Loose feed 2', '나중에 읽기 (Saved) 1']) assert.ok(all.includes(text), text);
  for (const text of ['전체 피드 (All) 2', '오늘의 아티클 (Today) 1', 'Count folder 1', 'Folder feed 1', 'Loose feed 1', '나중에 읽기 (Saved) 1']) assert.ok(unread.includes(text), text);
  const otherData = await bootstrap(other.token);
  assert.equal(otherData.counts.totalArticles, 1);
  assert.equal(otherData.counts.totalUnread, 1);
  assert.equal(otherData.counts.savedCount, 0);
  const markSaved = async () => (await app.request('/api/articles/mark-all-read', {
    method: 'POST', headers: { authorization: `Bearer ${owner.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ scope: 'saved' }),
  }, env)).json();
  assert.equal((await markSaved()).markedCount, 0, 'saved view must not mark unread articles outside bookmarks');
  assert.equal((await bootstrap(owner.token)).counts.totalUnread, 2);
  await db.prepare('INSERT INTO article_states(user_id,article_id,is_read,is_saved) VALUES(?,?,0,1)').bind(owner.user.id, 'a').run();
  assert.equal((await markSaved()).markedCount, 1);
  assert.equal((await bootstrap(owner.token)).counts.totalUnread, 1);
  assert.equal((await db.prepare('SELECT is_read FROM article_states WHERE user_id = ? AND article_id = ?').bind(owner.user.id, 'a').first()).is_read, 1);
  assert.equal((await db.prepare('SELECT is_read FROM article_states WHERE user_id = ? AND article_id = ?').bind(owner.user.id, 'd').first()), null);
  console.log('PASS: total/unread counts across all, today, folders and feeds; old history included only in totals; saved count stable; users isolated.');
} finally {
  await vite.close();
}
