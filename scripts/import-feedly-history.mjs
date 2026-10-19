// One-off import of a user's feed history from Feedly's public stream API.
//
// Feedly keeps years of entries for every feed, while RSS only carries the
// latest few. Its unauthenticated stream endpoint returns at most 50 entries
// and no continuation token, but `ranked=oldest` plus `newerThan` (Feedly's
// crawl time in ms) walks a stream from its first entry to now. Entries map to
// Sfeed rows by originId == articles.guid, so existing articles are skipped.
//
//   npm run import:feedly -- download  --db remote --user <userId> [--feed <url part>]
//   npm run import:feedly -- write     --db remote --user <userId>
//
// `--db local` targets .local/sfeed.sqlite instead of the production D1.
// Downloads live under .local/feedly-import/ (keyed by feed URL, shared by
// both databases) and every step resumes where it stopped. No read states are
// written: the app already treats articles older than 30 days as read.

import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createServer } from 'vite';

const FEEDLY_STREAM = 'https://cloud.feedly.com/v3/streams/contents';
const PAGE_SIZE = 50; // the unauthenticated maximum
const REQUEST_GAP_MS = 1000;
const DIR = '.local/feedly-import';
const LOCAL_DB = '.local/sfeed.sqlite';
const ROWS_PER_STATEMENT = 25; // keeps each INSERT well under D1's 100 KB statement limit
const ROWS_PER_REMOTE_FILE = 4000;

const [command, ...rest] = process.argv.slice(2);
const opts = {};
for (let i = 0; i < rest.length; i += 2) opts[rest[i].replace(/^--/, '')] = rest[i + 1];
if (!['download', 'write'].includes(command) || !opts.user || !['local', 'remote'].includes(opts.db)) {
  console.error('usage: import-feedly-history.mjs <download|write> --db <local|remote> --user <userId> [--feed <url part>]');
  process.exit(1);
}
mkdirSync(DIR, { recursive: true });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const sql = (value) => (value == null ? 'NULL' : `'${String(value).replace(/\u0000/g, '').replace(/'/g, "''")}'`);
const feedKey = (xmlUrl) => createHash('sha1').update(xmlUrl).digest('hex').slice(0, 16);
const statePath = (xmlUrl) => join(DIR, `${feedKey(xmlUrl)}.state.json`);
const dataPath = (xmlUrl) => join(DIR, `${feedKey(xmlUrl)}.jsonl`);
const readState = (xmlUrl) =>
  existsSync(statePath(xmlUrl)) ? JSON.parse(readFileSync(statePath(xmlUrl), 'utf8')) : { xmlUrl, cursor: null, done: false, count: 0, written: {} };
const saveState = (state) => writeFileSync(statePath(state.xmlUrl), JSON.stringify(state, null, 2));
const readEntries = (xmlUrl) =>
  existsSync(dataPath(xmlUrl)) ? readFileSync(dataPath(xmlUrl), 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line)) : [];

function query(statement) {
  if (opts.db === 'local') {
    const db = new DatabaseSync(LOCAL_DB, { readOnly: true });
    try {
      return db.prepare(statement).all();
    } finally {
      db.close();
    }
  }
  const out = execFileSync('npx', ['wrangler', 'd1', 'execute', 'sfeed', '--remote', '--json', '--command', statement], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024,
  });
  return JSON.parse(out)[0].results;
}

function execute(statements) {
  if (opts.db === 'local') {
    const db = new DatabaseSync(LOCAL_DB);
    try {
      db.exec('PRAGMA foreign_keys = ON');
      for (const statement of statements) db.exec(statement);
    } finally {
      db.close();
    }
    return;
  }
  const file = join(DIR, 'batch.sql');
  writeFileSync(file, statements.join('\n'));
  execFileSync('npx', ['wrangler', 'd1', 'execute', 'sfeed', '--remote', '--file', file], {
    stdio: ['ignore', 'ignore', 'inherit'],
  });
}

function subscribedFeeds() {
  const feeds = query(
    `SELECT f.id, f.xml_url, f.title FROM feeds f JOIN subscriptions s ON s.feed_id = f.id
     WHERE s.user_id = ${sql(opts.user)} ORDER BY f.title`
  );
  return opts.feed ? feeds.filter((feed) => feed.xml_url.includes(opts.feed)) : feeds;
}

async function fetchPage(xmlUrl, newerThan) {
  const params = new URLSearchParams({ streamId: `feed/${xmlUrl}`, count: String(PAGE_SIZE), ranked: 'oldest' });
  if (newerThan != null) params.set('newerThan', String(newerThan));
  for (let attempt = 0; ; attempt++) {
    await sleep(REQUEST_GAP_MS);
    let res;
    try {
      res = await fetch(`${FEEDLY_STREAM}?${params}`, { headers: { 'User-Agent': 'Mozilla/5.0 (Sfeed history import)' } });
    } catch (error) {
      if (attempt >= 5) throw error;
      await sleep(15_000);
      continue;
    }
    if (res.status === 429) {
      // Feedly throttles anonymous bursts for a few minutes; back off and resume.
      const wait = Math.min(10 * 60_000, 60_000 * 2 ** Math.min(attempt, 3));
      console.log(`  ⏸  rate limited, waiting ${wait / 1000}s`);
      await sleep(wait);
      continue;
    }
    if (res.status === 404) return [];
    if (!res.ok) {
      if (attempt >= 3) throw new Error(`Feedly HTTP ${res.status}`);
      await sleep(5_000);
      continue;
    }
    return (await res.json()).items || [];
  }
}

async function download(stripHtmlToSummary, decodeHtmlEntities) {
  const feeds = subscribedFeeds();
  console.log(`${feeds.length} subscribed feeds`);
  for (const feed of feeds) {
    const state = readState(feed.xml_url);
    state.title = feed.title;
    if (state.done) {
      console.log(`✓ ${feed.title}: ${state.count} entries (already downloaded)`);
      continue;
    }
    const seen = new Set(readEntries(feed.xml_url).map((entry) => entry.feedlyId));
    let stalled = 0;
    console.log(`↓ ${feed.title}`);
    for (;;) {
      const page = await fetchPage(feed.xml_url, state.cursor);
      if (page.length === 0) break;
      const fresh = page.filter((entry) => !seen.has(entry.id));
      const lines = fresh.map((entry) => {
        seen.add(entry.id);
        const alternate = entry.alternate?.find((link) => link.href)?.href;
        const visual = entry.visual?.url;
        return JSON.stringify({
          feedlyId: entry.id,
          guid: entry.originId || alternate || entry.id,
          url: alternate || entry.canonicalUrl || entry.originId,
          title: decodeHtmlEntities(entry.title || '') || 'Untitled Article',
          author: entry.author || null,
          summary: stripHtmlToSummary(entry.summary?.content || entry.content?.content || '') || null,
          thumbnailUrl: visual && /^https?:\/\//.test(visual) ? visual : null,
          publishedAt: new Date(entry.published || entry.crawled).toISOString(),
        });
      });
      if (lines.length) appendFileSync(dataPath(feed.xml_url), lines.join('\n') + '\n');
      state.count += lines.length;

      // newerThan is exclusive, so restart one ms before the newest crawl time
      // to keep entries that share it; once a page brings nothing new, step past.
      const newest = Math.max(...page.map((entry) => entry.crawled || entry.published || 0));
      const next = fresh.length > 0 ? newest - 1 : newest;
      stalled = next <= (state.cursor ?? -1) ? stalled + 1 : 0;
      state.cursor = Math.max(next, state.cursor ?? -1);
      saveState(state);
      if (stalled >= 3) {
        console.log('  ! cursor stopped advancing; ending this feed early');
        break;
      }
      const last = page.reduce((a, b) => ((a.crawled || 0) > (b.crawled || 0) ? a : b));
      process.stdout.write(`  ${state.count} entries, now at ${new Date(last.crawled || last.published).toISOString().slice(0, 10)}\r`);
    }
    state.done = true;
    saveState(state);
    console.log(`\n✓ ${feed.title}: ${state.count} entries`);
  }
}

function write() {
  const now = new Date().toISOString();
  let downloading = 0;
  for (const feed of subscribedFeeds()) {
    const state = readState(feed.xml_url);
    // Skip feeds still downloading: the download process keeps rewriting their
    // state file, which would drop the write offset recorded here.
    if (!state.done) {
      if (existsSync(dataPath(feed.xml_url))) downloading++;
      continue;
    }
    const entries = readEntries(feed.xml_url);
    let offset = state.written[opts.db] || 0;
    if (offset >= entries.length) continue;
    console.log(`→ ${feed.title}: writing ${entries.length - offset} entries`);
    const fileRows = opts.db === 'remote' ? ROWS_PER_REMOTE_FILE : entries.length;
    while (offset < entries.length) {
      const chunk = entries.slice(offset, offset + fileRows);
      const statements = [];
      for (let i = 0; i < chunk.length; i += ROWS_PER_STATEMENT) {
        const values = chunk.slice(i, i + ROWS_PER_STATEMENT).map((entry) =>
          `(${[
            `art_${randomUUID()}`, feed.id, entry.guid, entry.title, entry.url, entry.author, entry.summary,
            null, entry.thumbnailUrl, entry.publishedAt, now,
          ].map(sql).join(', ')})`
        );
        statements.push(
          `INSERT INTO articles (id, feed_id, guid, title, url, author, summary, content_html, thumbnail_url, published_at, created_at)
           VALUES ${values.join(', ')} ON CONFLICT(feed_id, guid) DO NOTHING;`
        );
      }
      execute(statements);
      offset += chunk.length;
      state.written[opts.db] = offset;
      saveState(state);
      process.stdout.write(`  ${offset}/${entries.length}\r`);
    }
    console.log('');
  }
  if (downloading) console.log(`${downloading} feed(s) still downloading; run write again once they finish.`);
}

if (command === 'download') {
  const vite = await createServer({ configFile: false, server: { middlewareMode: true, ws: false }, appType: 'custom', logLevel: 'silent' });
  try {
    const { stripHtmlToSummary, decodeHtmlEntities } = await vite.ssrLoadModule('/src/server/rssParser.ts');
    await download(stripHtmlToSummary, decodeHtmlEntities);
  } finally {
    await vite.close();
  }
} else {
  write();
}
