import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { acquireLock, createFeedlyClient, readEntries, retryDelay, saveJson, requestDeadline, runFeedQueue, DAY_MS } from './feedly-import-support.mjs';

test('default mode resumes a full local budget without dropping request history or server waits', async () => {
  let clock = 10_000;
  let saved = { requestBudget: 800, requests: Array.from({ length: 800 }, (_, i) => i), notBefore: 60_000, nextRequestAt: DAY_MS, gapMs: 5000 };
  const requests = [];
  const options = {
    now: () => clock, sleep: async (ms) => { clock += ms; }, log: () => {},
    load: () => saved, save: (state) => { saved = structuredClone(state); },
    fetchImpl: async () => { requests.push(clock); return new Response('{"items":[]}'); },
  };
  await createFeedlyClient(options)('https://example.test/feed');
  await createFeedlyClient(options)('https://example.test/feed');
  assert.deepEqual(requests, [60_000, 65_000]);
  assert.equal(saved.requestBudget, 0);
  assert.equal(saved.requests.length, 802);
});

test('healthy requests run five seconds apart while the rolling cap survives restarts', async () => {
  let clock = 0;
  let saved = {};
  const requests = [];
  const options = {
    requestBudget: 2, now: () => clock, sleep: async (ms) => { clock += ms; }, log: () => {},
    load: () => saved, save: (state) => { saved = structuredClone(state); },
    fetchImpl: async () => { requests.push(clock); return new Response('{"items":[]}'); },
  };
  const client = createFeedlyClient(options);
  await client('https://example.test/feed');
  await client('https://example.test/feed');
  await createFeedlyClient(options)('https://example.test/feed');
  assert.deepEqual(requests, [0, 5000, DAY_MS]);
  assert.equal(saved.totalRequests, 3);
  assert.equal(saved.requests.length, 2);
  assert.equal(requestDeadline({ requests: [0, 60_000] }, 3_600_000, 2), DAY_MS, 'old bursts also obey the rolling budget');
});

test('a full quota reported on a successful response pauses the next request', async () => {
  let clock = 0;
  let saved = {};
  const requests = [];
  const client = createFeedlyClient({
    now: () => clock, sleep: async (ms) => { clock += ms; }, log: () => {},
    save: (state) => { saved = structuredClone(state); },
    fetchImpl: async () => {
      requests.push(clock);
      return new Response('{"items":[]}', { headers: { 'x-ratelimit-count': '900', 'x-ratelimit-limit': '900', 'x-ratelimit-reset': '7200' } });
    },
  });
  await client('https://example.test/feed');
  assert.equal(saved.lastResponse.count, '900');
  await client('https://example.test/feed');
  assert.deepEqual(requests, [0, 7_200_000]);
});

test('large feeds take turns with small feeds and resume after the last visited feed', async () => {
  const feeds = ['large', 'small', 'medium'].map((xml_url) => ({ xml_url }));
  const remaining = { large: 4, small: 1, medium: 2 };
  const visits = [];
  let last;
  await runFeedQueue(feeds, {
    lastUrl: 'large', isDone: (feed) => remaining[feed.xml_url] === 0,
    step: async (feed) => { visits.push(feed.xml_url); remaining[feed.xml_url]--; },
    saveLast: (url) => { last = url; },
  });
  assert.deepEqual(visits, ['small', 'medium', 'large', 'medium', 'large', 'large', 'large']);
  assert.equal(last, 'large');
});

test('Retry-After seconds/date and quota reset are minimum wait times', () => {
  const now = Date.parse('2026-10-19T05:00:00Z');
  assert.equal(retryDelay(new Headers({ 'retry-after': '120' }), now), 120_000);
  assert.equal(retryDelay(new Headers({ 'retry-after': 'Mon, 19 Oct 2026 06:00:00 GMT' }), now), 3_600_000);
  assert.equal(retryDelay(new Headers({ 'retry-after': '30', 'x-ratelimit-reset': '7200' }), now), 7_200_000);
  assert.equal(retryDelay(new Headers({ 'retry-after': 'invalid', 'x-ratelimit-reset': 'invalid' }), now), 0);
});

test('429 backoff persists across pages/restarts and respects long server waits', async () => {
  let clock = Date.parse('2026-10-19T05:00:00Z');
  let saved = {};
  const requests = [];
  const responses = [
    new Response('', { status: 429, headers: { 'retry-after': '7200' } }),
    new Response(JSON.stringify({ items: [{ id: 'first' }] })),
    new Response('', { status: 429 }),
    new Response(JSON.stringify({ items: [{ id: 'second' }] })),
    new Response('', { status: 429 }),
    new Response(JSON.stringify({ items: [] })),
  ];
  const options = {
    now: () => clock, sleep: async (ms) => { clock += ms; }, random: () => 0, requestBudget: 10000,
    load: () => saved, save: (state) => { saved = structuredClone(state); }, log: () => {},
    fetchImpl: async () => { requests.push(clock); return responses.shift(); },
  };
  const client = createFeedlyClient(options);
  assert.equal((await client('https://example.test/feed'))[0].id, 'first');
  assert.equal(requests[1] - requests[0], 7_200_000);
  await client('https://example.test/feed', 100);
  assert.equal(requests[2] - requests[1], 10_000);
  assert.equal(requests[3] - requests[2], 30 * 60_000);
  const restarted = createFeedlyClient(options);
  await restarted('https://example.test/feed', 200);
  assert.equal(requests[4] - requests[3], 20_000);
  assert.equal(requests[5] - requests[4], 60 * 60_000);
  assert.equal(saved.strikes, 3);
});

test('a sustained run of successes eases spacing and strikes back down', async () => {
  let clock = 0;
  let saved = { gapMs: 40_000, strikes: 3, okStreak: 0 };
  const requests = [];
  const client = createFeedlyClient({
    now: () => clock, sleep: async (ms) => { clock += ms; }, random: () => 0, requestBudget: 10000, log: () => {},
    load: () => saved, save: (state) => { saved = structuredClone(state); },
    fetchImpl: async () => { requests.push(clock); return new Response('{"items":[]}'); },
  });
  for (let i = 0; i < 19; i++) await client('https://example.test/feed', i);
  assert.equal(saved.gapMs, 40_000, 'fewer than 20 successes keep the spacing');
  assert.equal(saved.strikes, 3);
  await client('https://example.test/feed', 19);
  assert.equal(saved.gapMs, 20_000);
  assert.equal(saved.strikes, 2);
  await client('https://example.test/feed', 20);
  assert.equal(requests[20] - requests[19], 20_000, 'the next request uses the halved spacing');
  for (let i = 0; i < 100; i++) await client('https://example.test/feed', 21 + i);
  assert.equal(saved.gapMs, 5_000, 'spacing never drops below the minimum');
  assert.equal(saved.strikes, 0);
});

test('a persisted cooldown is honored before the first request', async () => {
  let clock = 1000;
  let requestedAt;
  const client = createFeedlyClient({
    load: () => ({ notBefore: 900_000 }), now: () => clock,
    sleep: async (ms) => { clock += ms; }, log: () => {},
    fetchImpl: async () => { requestedAt = clock; return new Response('{"items":[]}'); },
  });
  await client('https://example.test/feed');
  assert.equal(requestedAt, 900_000);
});

test('publish an unfinished feed, resume checkpoints, and preserve existing articles', () => {
  const directory = mkdtempSync(join(tmpdir(), 'sfeed-feedly-test-'));
  const dataDir = join(directory, '.local/feedly-import');
  mkdirSync(dataDir, { recursive: true });
  const xmlUrl = 'https://example.test/feed';
  const key = createHash('sha1').update(xmlUrl).digest('hex').slice(0, 16);
  const statePath = join(dataDir, `${key}.state.json`);
  const dataPath = join(dataDir, `${key}.jsonl`);
  const progressPath = join(dataDir, `${key}.local.written.json`);
  const script = fileURLToPath(new URL('./import-feedly-history.mjs', import.meta.url));
  const db = new DatabaseSync(join(directory, '.local/sfeed.sqlite'));
  try {
    db.exec(`CREATE TABLE feeds(id TEXT, xml_url TEXT, title TEXT);
      CREATE TABLE subscriptions(user_id TEXT, feed_id TEXT);
      CREATE TABLE articles(id TEXT PRIMARY KEY, feed_id TEXT, guid TEXT, title TEXT NOT NULL,
        url TEXT, author TEXT, summary TEXT, content_html TEXT, thumbnail_url TEXT,
        published_at TEXT, created_at TEXT, UNIQUE(feed_id,guid));
      INSERT INTO feeds VALUES('f1','https://example.test/feed','Example');
      INSERT INTO subscriptions VALUES('u1','f1');
      INSERT INTO articles(id,feed_id,guid,title) VALUES('keep-original','f1','g1','Existing');`);
    const entry = (number) => ({ feedlyId: `e${number}`, guid: `g${number}`, title: `Entry ${number}`, url: `https://example.test/${number}`, publishedAt: '2026-10-01T00:00:00Z' });
    const state = { xmlUrl, count: 2, done: false, cursor: 100, written: { local: 1, remote: 0 } };
    saveJson(statePath, state);
    writeFileSync(dataPath, [entry(1), entry(2)].map(JSON.stringify).join('\n') + '\n{"partial":');
    assert.equal(readEntries(dataPath).length, 2);
    assert.equal(readEntries(dataPath, { repair: true }).length, 2);
    assert.ok(readFileSync(dataPath, 'utf8').endsWith('\n'));
    const run = () => execFileSync(process.execPath, [script, 'write', '--db', 'local', '--user', 'u1'], { cwd: directory, stdio: 'pipe' });
    run();
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM articles').get().n, 2);
    assert.deepEqual(JSON.parse(readFileSync(statePath)), state);
    assert.equal(JSON.parse(readFileSync(progressPath)).offset, 2);
    // Downloader replaces its checkpoint as it progresses. Writer keeps offset 2.
    state.count = 3; state.cursor = 200;
    saveJson(statePath, state);
    writeFileSync(dataPath, [entry(1), entry(2), { ...entry(3), title: null }].map(JSON.stringify).join('\n') + '\n');
    assert.throws(run);
    assert.equal(JSON.parse(readFileSync(progressPath)).offset, 2, 'failed database write must not advance checkpoint');
    writeFileSync(dataPath, [entry(1), entry(2), entry(3)].map(JSON.stringify).join('\n') + '\n');
    run(); run();
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM articles').get().n, 3);
    assert.equal(db.prepare("SELECT id FROM articles WHERE guid='g1'").get().id, 'keep-original');
    assert.equal(JSON.parse(readFileSync(progressPath)).offset, 3);
    assert.deepEqual(JSON.parse(readFileSync(statePath)), state);
    db.exec('ALTER TABLE subscriptions RENAME TO subscriptions_temporarily_unavailable');
    run(); // Nothing new: do not query the database just to discover that again.
    db.exec('ALTER TABLE subscriptions_temporarily_unavailable RENAME TO subscriptions');
    const release = acquireLock(dataDir, 'write');
    assert.throws(() => acquireLock(dataDir, 'write'), /Another Feedly write/);
    release();
    acquireLock(dataDir, 'write')();
  } finally {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
