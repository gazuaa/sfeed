import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

const vite = await createServer({ configFile: false, server: { middlewareMode: true, ws: false }, appType: 'custom', logLevel: 'silent' });
const previousStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
try {
  const values = new Map();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) } });
  const { readCollapsedFolders, writeCollapsedFolders, collapsedFoldersKey } = await vite.ssrLoadModule('/src/client/folderState.ts');
  writeCollapsedFolders('owner', { folder: true, open: false });
  assert.deepEqual(readCollapsedFolders('owner'), { folder: true });
  assert.deepEqual(readCollapsedFolders('other'), {}, 'another account cannot inherit collapsed folders');
  values.set(collapsedFoldersKey('bad'), 'not-json'); assert.deepEqual(readCollapsedFolders('bad'), {});
  values.set(collapsedFoldersKey('bad'), '[true]'); assert.deepEqual(readCollapsedFolders('bad'), {});
  const { Sidebar } = await vite.ssrLoadModule('/src/components/Sidebar.tsx');
  const props = { user: { id: 'owner', name: 'Test' }, folders: [{ id: 'folder', name: 'Folder' }], subscriptions: [{ id: 'sub', feed_id: 'feed', folder_id: 'folder', title: 'Inner feed', total_count: 2 }], counts: { totalArticles: 2, totalUnread: 2, savedCount: 0 }, activeScope: 'all', isDark: true };
  const collapsed = renderToStaticMarkup(React.createElement(Sidebar, props));
  assert.match(collapsed, /Folder 펼치기/); assert.ok(!collapsed.includes('Inner feed'), 'collapsed state is restored before the first paint');
  const expanded = renderToStaticMarkup(React.createElement(Sidebar, { ...props, user: { ...props.user, id: 'other' } }));
  assert.match(expanded, /Folder 접기/); assert.match(expanded, /Inner feed/);
  writeCollapsedFolders('owner', { folder: false }); assert.deepEqual(readCollapsedFolders('owner'), {});

  const { bindAutoRefresh } = await vite.ssrLoadModule('/src/client/autoRefresh.ts');
  const doc = new EventTarget(); doc.visibilityState = 'visible';
  const tasks = new Map(); let id = 0, refreshes = 0, finish;
  const clock = { set(callback, delay) { tasks.set(++id, { callback, delay }); return id; }, clear(key) { tasks.delete(key); } };
  const cleanup = bindAutoRefresh(doc, 15, () => { refreshes++; return new Promise((resolve) => { finish = resolve; }); }, clock);
  assert.equal(tasks.size, 1); assert.equal([...tasks.values()][0].delay, 900_000);
  const [timer, task] = [...tasks][0]; tasks.delete(timer); task.callback(); await Promise.resolve();
  assert.equal(refreshes, 1);
  doc.visibilityState = 'hidden'; doc.dispatchEvent(new Event('visibilitychange')); assert.equal(tasks.size, 0);
  doc.visibilityState = 'visible'; doc.dispatchEvent(new Event('visibilitychange')); assert.equal(tasks.size, 0, 'a running refresh is not duplicated');
  finish(); await new Promise(setImmediate); assert.equal(tasks.size, 1);
  doc.visibilityState = 'hidden'; doc.dispatchEvent(new Event('visibilitychange')); assert.equal(tasks.size, 0);
  doc.visibilityState = 'visible'; doc.dispatchEvent(new Event('visibilitychange')); assert.equal(tasks.size, 1);
  cleanup(); assert.equal(tasks.size, 0);
  for (const minutes of [0, 2, -1]) { bindAutoRefresh(doc, minutes, async () => {}, clock)(); assert.equal(tasks.size, 0); }

  const { app } = await vite.ssrLoadModule('/src/server/app.ts');
  const { LocalD1Database } = await vite.ssrLoadModule('/src/server/localD1.ts');
  const db = new LocalD1Database(':memory:', 'migrations/0001_schema.sql'), env = { DB: db, ALLOW_QUICK_LOGIN: 'true' };
  const { token, user } = await (await app.request('/api/auth/google/quick', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'desktop@example.test' }) }, env)).json();
  assert.equal(user.preferences.autoRefreshMinutes, 15);
  const update = async (body) => (await (await app.request('/api/user/preferences', { method: 'PUT', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) }, env)).json()).preferences;
  assert.equal((await update({ autoRefreshMinutes: 5, markReadOnScroll: true })).autoRefreshMinutes, 5);
  const changed = await update({ theme: 'light' });
  assert.equal(changed.autoRefreshMinutes, 5); assert.equal(changed.markReadOnScroll, true);
  assert.equal((await update({ autoRefreshMinutes: 2 })).autoRefreshMinutes, 5, 'unsupported intervals are ignored');
  assert.equal((await update({ autoRefreshMinutes: 0 })).autoRefreshMinutes, 0, 'manual refresh is retained');
  console.log('PASS: account-scoped folder persistence and first paint; refresh interval settings/defaults; visible-only scheduling, overlap prevention, cleanup and manual mode.');
} finally {
  if (previousStorage) Object.defineProperty(globalThis, 'localStorage', previousStorage); else delete globalThis.localStorage;
  await vite.close();
}
