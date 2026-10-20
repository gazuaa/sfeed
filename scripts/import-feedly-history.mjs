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
import { acquireLock, createFeedlyClient, readEntries as readCompleteEntries, runFeedQueue, saveJson } from './feedly-import-support.mjs';

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

const sql = (value) => (value == null ? 'NULL' : `'${String(value).replace(/\u0000/g, '').replace(/'/g, "''")}'`);
const feedKey = (xmlUrl) => createHash('sha1').update(xmlUrl).digest('hex').slice(0, 16);
const statePath = (xmlUrl) => join(DIR, `${feedKey(xmlUrl)}.state.json`);
const dataPath = (xmlUrl) => join(DIR, `${feedKey(xmlUrl)}.jsonl`);
const readState = (xmlUrl) =>
  existsSync(statePath(xmlUrl)) ? JSON.parse(readFileSync(statePath(xmlUrl), 'utf8')) : { xmlUrl, cursor: null, done: false, count: 0, written: {} };
const saveState = (state) => saveJson(statePath(state.xmlUrl), state);
const readEntries = (xmlUrl) => readCompleteEntries(dataPath(xmlUrl));
const ratePath = join(DIR, 'rate-limit.json');
const fetchPage = createFeedlyClient({
  load: () => existsSync(ratePath) ? JSON.parse(readFileSync(ratePath, 'utf8')) : {},
  save: (state) => saveJson(ratePath, state),
  ...(opts['requests-per-day'] ? { requestBudget: Number(opts['requests-per-day']) } : {}),
});
const manifestPath = join(DIR, `${opts.db}.${feedKey(opts.user)}.feeds.json`);

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
  saveJson(manifestPath, feeds);
  return opts.feed ? feeds.filter((feed) => feed.xml_url.includes(opts.feed)) : feeds;
}

async function download(stripHtmlToSummary, decodeHtmlEntities) {
  const feeds = subscribedFeeds();
  console.log(`${feeds.length} subscribed feeds`);
  const schedulePath = join(DIR, `${opts.db}.${feedKey(opts.user)}.schedule.json`);
  const schedule = existsSync(schedulePath) ? JSON.parse(readFileSync(schedulePath, 'utf8')) : {};
  await runFeedQueue(feeds, {
    lastUrl: schedule.lastUrl,
    isDone: (feed) => readState(feed.xml_url).done,
    saveLast: (lastUrl) => saveJson(schedulePath, { lastUrl, updatedAt: new Date().toISOString() }),
    step: async (feed) => {
      const state = readState(feed.xml_url);
      state.title = feed.title;
      const existing = readCompleteEntries(dataPath(feed.xml_url), { repair: true });
      const seen = new Set(existing.map((entry) => entry.feedlyId));
      state.count = existing.length;
      console.log(`↓ ${feed.title}`);
      const page = await fetchPage(feed.xml_url, state.cursor);
      if (page.length === 0) {
        state.done = true;
        saveState(state);
        console.log(`✓ ${feed.title}: ${state.count} entries`);
        return;
      }
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
      state.stalled = next <= (state.cursor ?? -1) ? (state.stalled || 0) + 1 : 0;
      state.cursor = Math.max(next, state.cursor ?? -1);
      saveState(state);
      if (state.stalled >= 3) {
        // Keep the feed visibly incomplete instead of silently losing history.
        throw new Error(`${feed.title}: cursor stopped advancing; saved progress retained`);
      }
      const last = page.reduce((a, b) => ((a.crawled || 0) > (b.crawled || 0) ? a : b));
      console.log(`  ${state.count} entries, now at ${new Date(last.crawled || last.published).toISOString().slice(0, 10)}`);
    },
  });
}

function write() {
  const now = new Date().toISOString();
  if (existsSync(manifestPath)) {
    const cached = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const selected = opts.feed ? cached.filter((feed) => feed.xml_url.includes(opts.feed)) : cached;
    const pending = selected.some((feed) => {
      const state = readState(feed.xml_url);
      const path = join(DIR, `${feedKey(feed.xml_url)}.${opts.db}.written.json`);
      const offset = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')).offset : state.written?.[opts.db] || 0;
      return (state.count || 0) > offset;
    });
    if (!pending) {
      console.log('All downloaded entries have already been published.');
      return;
    }
  }
  for (const feed of subscribedFeeds()) {
    const state = readState(feed.xml_url);
    // Writers own a separate checkpoint: downloading may continue and replace
    // its state without rolling back the committed database offset.
    const progressPath = join(DIR, `${feedKey(feed.xml_url)}.${opts.db}.written.json`);
    const progress = existsSync(progressPath) ? JSON.parse(readFileSync(progressPath, 'utf8')) : {};
    const entries = readEntries(feed.xml_url).slice(0, state.count);
    let offset = progress.offset ?? state.written?.[opts.db] ?? 0;
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
      saveJson(progressPath, { offset, updatedAt: new Date().toISOString() });
      process.stdout.write(`  ${offset}/${entries.length}\r`);
    }
    console.log('');
  }
}

const release = acquireLock(DIR, command);
try {
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
} finally {
  release();
}
