import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import vm from 'node:vm';
import { createServer } from 'vite';

const manifest = JSON.parse(readFileSync('public/manifest.webmanifest', 'utf8'));
assert.equal(manifest.short_name, 'SFeed');
assert.ok(manifest.name.startsWith('SFeed'));
assert.equal(manifest.display, 'standalone');
assert.equal(manifest.start_url, '/');
assert.equal(manifest.id, '/');
for (const icon of [...manifest.icons, { src: '/icons/apple-touch-icon.png', sizes: '180x180' }]) {
  const bytes = readFileSync('public' + icon.src);
  assert.equal(bytes.subarray(1, 4).toString(), 'PNG');
  assert.equal(bytes.readUInt32BE(16) + 'x' + bytes.readUInt32BE(20), icon.sizes);
}
const html = readFileSync('dist/index.html', 'utf8');
assert.match(html, /rel="manifest" href="\/manifest.webmanifest"/);
assert.match(html, /viewport-fit=cover/);
assert.match(html, /apple-mobile-web-app-capable/);
const handlers = {}, storage = new Map(), deleted = [], fetched = [];
const cache = { addAll: async (paths) => { for (const path of paths) { assert.ok(existsSync('public' + path)); storage.set(path, new Response(readFileSync('public' + path))); } }, match: async (path) => storage.get(path)?.clone() };
let offline = false, skipped = 0, claimed = 0;
vm.runInNewContext(readFileSync('public/sw.js', 'utf8'), {
  self: { location: { origin: 'https://sfeed.test' }, addEventListener: (key, handler) => { handlers[key] = handler; }, skipWaiting: async () => { skipped++; }, clients: { claim: async () => { claimed++; } } },
  caches: { open: async () => cache, keys: async () => ['sfeed-public-v1', 'sfeed-public-v2', 'another-app-cache'], delete: async (key) => { deleted.push(key); } },
  fetch: async (request) => { fetched.push(request.url); if (offline) throw new Error('offline'); return new Response('fresh network page'); },
  URL, Response,
});
for (const name of ['install', 'activate']) { let work; handlers[name]({ waitUntil: (promise) => { work = promise; } }); await work; }
assert.equal(skipped, 1); assert.equal(claimed, 1); assert.deepEqual(deleted, ['sfeed-public-v1']);
assert.ok(!storage.has('/'), 'the authenticated app shell must not be cached');
const runFetch = (path, mode = 'navigate', method = 'GET') => {
  let result;
  handlers.fetch({ request: { url: new URL(path, 'https://sfeed.test').href, method, mode }, respondWith: (promise) => { result = promise; } });
  return result;
};
assert.equal(await (await runFetch('/?session_token=private')).text(), 'fresh network page');
assert.equal(storage.size, 7, 'navigation must not write to the public cache');
for (const path of ['/api/articles', '/api/auth/google/credential', '/auth/callback', 'https://accounts.google.com/gsi/client']) assert.equal(runFetch(path), undefined, 'auth/API/cross-origin requests must not be intercepted');
assert.equal(runFetch('/anything', 'navigate', 'POST'), undefined);
assert.equal(runFetch('/assets/app.js', 'cors'), undefined, 'do not hold an old app bundle in a service worker');
offline = true;
assert.match(await (await runFetch('/')).text(), /인터넷 연결을 기다리고 있어요/);
assert.ok(![...storage.keys()].some((path) => path.includes('session_token')));
assert.equal(runFetch('/api/articles'), undefined, 'offline must not masquerade as a successful article response');
assert.equal((await runFetch('/icons/icon-192.png', 'cors')).status, 200);

const vite = await createServer({ configFile: false, server: { middlewareMode: true, ws: false }, appType: 'custom', logLevel: 'silent' });
try {
  const { default: worker } = await vite.ssrLoadModule('/src/worker.ts');
  for (const path of ['/', '/sw.js', '/manifest.webmanifest', '/offline.js']) {
    const response = await worker.fetch(new Request('https://sfeed.test' + path), { ASSETS: { fetch: async () => new Response('asset') } }, {});
    assert.equal(response.headers.get('cache-control'), 'no-store');
    if (path === '/sw.js') assert.equal(response.headers.get('service-worker-allowed'), '/');
  }
  const fakeWindow = new EventTarget();
  fakeWindow.matchMedia = () => ({ matches: false, addEventListener() {} });
  globalThis.window = fakeWindow;
  const { installState, promptInstall } = await vite.ssrLoadModule('/src/client/pwa.ts');
  assert.equal(installState(), 'manual');
  assert.equal(await promptInstall(), false);
  let prompts = 0;
  const event = new Event('beforeinstallprompt', { cancelable: true });
  event.prompt = async () => { prompts++; };
  event.userChoice = Promise.resolve({ outcome: 'dismissed' });
  fakeWindow.dispatchEvent(event);
  assert.equal(event.defaultPrevented, true);
  assert.equal(prompts, 0, 'native prompts require a user click');
  assert.equal(installState(), 'prompt');
  assert.equal(await promptInstall(), true);
  assert.equal(prompts, 1);
  assert.equal(installState(), 'manual');
  assert.equal(await promptInstall(), false, 'a browser prompt can only be used once');
  fakeWindow.dispatchEvent(new Event('appinstalled'));
  assert.equal(installState(), 'installed');
  delete globalThis.window;
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { createElement } = await import('react');
  const { PwaInstall } = await vite.ssrLoadModule('/src/components/PwaInstall.tsx');
  const previousAgent = Object.getOwnPropertyDescriptor(navigator, 'userAgent');
  try {
    Object.defineProperty(navigator, 'userAgent', { configurable: true, value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 CriOS/144 Mobile/15E148 Safari/604.1' });
    const iosHelp = renderToStaticMarkup(createElement(PwaInstall));
    assert.match(iosHelp, /홈 화면에 추가/);
    assert.match(iosHelp, /웹 앱으로 열기/);
    assert.ok(!iosHelp.includes('이 브라우저에는'), 'modern iOS browsers must not be incorrectly told they cannot install');
  } finally { if (previousAgent) Object.defineProperty(navigator, 'userAgent', previousAgent); else delete navigator.userAgent; }
  console.log('PASS: install manifest, PNG dimensions, iOS metadata, native prompt lifecycle, safe public-only offline caching, API/auth exclusion, fresh app shell, upgrade cleanup and deployment headers.');
} finally { delete globalThis.window; await vite.close(); }
