import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, truncateSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export function saveJson(path, value) {
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(value, null, 2));
  renameSync(temporary, path);
}

// A downloader may be appending while a writer takes its snapshot. Only expose
// complete lines; a trailing partial entry will be picked up on the next pass.
export function readEntries(path, { repair = false } = {}) {
  if (!existsSync(path)) return [];
  const contents = readFileSync(path);
  const end = contents.lastIndexOf(10) + 1;
  if (repair && end < contents.length) truncateSync(path, end);
  return contents.subarray(0, end).toString('utf8').split('\n').filter(Boolean).map(JSON.parse);
}

export function acquireLock(directory, name) {
  const path = join(directory, `${name}.lock`);
  try {
    mkdirSync(path);
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    let pid;
    try { pid = Number(readFileSync(join(path, 'pid'), 'utf8')); } catch { /* creator may still be writing */ }
    let alive = true;
    if (pid > 0) {
      try { process.kill(pid, 0); } catch (error) { if (error.code === 'ESRCH') alive = false; }
    } else if (Date.now() - statSync(path).mtimeMs > 30_000) {
      alive = false;
    }
    if (alive) throw new Error(`Another Feedly ${name} process is running${pid ? ` (PID ${pid})` : ''}.`);
    rmSync(path, { recursive: true });
    mkdirSync(path);
  }
  writeFileSync(join(path, 'pid'), String(process.pid));
  return () => rmSync(path, { recursive: true, force: true });
}

const MIN_GAP = 5_000;
const BASE_COOLDOWN = 15 * 60_000;
const MAX_COOLDOWN = 6 * 60 * 60_000;
// Successful pages in a row before easing off: halve the spacing and forget
// one strike, so a recovered quota is used at full speed again.
const RECOVERY_STREAK = 20;
export const DAY_MS = 24 * 60 * 60_000;
export const DEFAULT_REQUEST_BUDGET = 0; // No local daily cap; Feedly deadlines still apply.

export function requestDeadline(state, now, budget) {
  const recent = (state.requests || []).filter((at) => at > now - DAY_MS);
  return Math.max(
    state.notBefore || 0,
    budget > 0 && recent.length >= budget ? recent[recent.length - budget] + DAY_MS : 0,
  );
}

// Resume after the last visited feed, including when its download is incomplete.
export function rotateFeeds(feeds, lastUrl) {
  const index = feeds.findIndex((feed) => feed.xml_url === lastUrl);
  return index < 0 ? feeds : [...feeds.slice(index + 1), ...feeds.slice(0, index + 1)];
}

export async function runFeedQueue(feeds, { lastUrl, isDone, step, saveLast }) {
  const queue = rotateFeeds(feeds, lastUrl).filter((feed) => !isDone(feed));
  while (queue.length) {
    const feed = queue.shift();
    await step(feed);
    saveLast(feed.xml_url);
    if (!isDone(feed)) queue.push(feed);
  }
}

export function retryDelay(headers, now) {
  const retryAfter = headers.get('retry-after');
  const seconds = retryAfter == null || retryAfter.trim() === '' ? NaN : Number(retryAfter);
  const retryAt = Number.isFinite(seconds) ? now + Math.max(0, seconds) * 1000 : Date.parse(retryAfter);
  const reset = Number(headers.get('x-ratelimit-reset'));
  return Math.max(0, Number.isFinite(retryAt) ? retryAt - now : 0, Number.isFinite(reset) ? reset * 1000 : 0);
}

export function createFeedlyClient({
  load = () => ({}), save = () => {}, fetchImpl = fetch,
  now = Date.now, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  random = Math.random, log = console.log,
  requestBudget = DEFAULT_REQUEST_BUDGET,
} = {}) {
  if (!Number.isInteger(requestBudget) || requestBudget < 0 || requestBudget > 10_000) {
    throw new Error('requests-per-day must be an integer from 0 to 10000 (0 disables the local cap)');
  }
  const state = { notBefore: 0, gapMs: MIN_GAP, strikes: 0, okStreak: 0, ...load() };
  state.gapMs = Math.max(MIN_GAP, state.gapMs);
  return async function fetchPage(xmlUrl, newerThan) {
    const params = new URLSearchParams({ streamId: `feed/${xmlUrl}`, count: '50', ranked: 'oldest' });
    if (newerThan != null) params.set('newerThan', String(newerThan));
    let transientErrors = 0;
    for (;;) {
      state.requests = (state.requests || []).filter((at) => at > now() - DAY_MS);
      state.requestBudget = requestBudget;
      const deadline = requestDeadline(state, now(), requestBudget);
      const wait = Math.max(0, deadline - now());
      if (wait) {
        state.nextRequestAt = deadline;
        save(state);
        if (wait > 60_000) log(`  ⏸ Feedly next request at ${new Date(deadline).toISOString()} (${state.requests.length} requests in 24h; local cap: ${requestBudget || 'off'})`);
        // Node timers overflow above ~24 days. Chunking also handles long quota resets.
        while (deadline > now()) await sleep(Math.min(60_000, deadline - now()));
      }
      let response;
      // Persist before making the request, so a restart cannot discard spacing.
      state.notBefore = now() + state.gapMs;
      state.requests = (state.requests || []).filter((at) => at > now() - DAY_MS);
      state.requests.push(now());
      state.totalRequests = (state.totalRequests || 0) + 1;
      state.nextRequestAt = requestDeadline(state, now(), requestBudget);
      save(state);
      try {
        response = await fetchImpl(`https://cloud.feedly.com/v3/streams/contents?${params}`, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Sfeed history import)' },
          signal: AbortSignal.timeout(30_000),
        });
      } catch (error) {
        if (++transientErrors > 5) throw error;
        state.notBefore = now() + 30_000 * transientErrors;
        state.lastError = { at: now(), message: error.message };
        save(state);
        continue;
      }
      state.lastResponse = {
        at: now(), status: response.status,
        retryAfter: response.headers.get('retry-after'),
        count: response.headers.get('x-ratelimit-count'),
        limit: response.headers.get('x-ratelimit-limit'),
        reset: response.headers.get('x-ratelimit-reset'),
      };
      const limit = Number(state.lastResponse.limit);
      const count = Number(state.lastResponse.count);
      const quotaNotBefore = limit > 0 && count >= limit ? now() + retryDelay(response.headers, now()) : 0;
      save(state);
      if (response.status === 429) {
        state.strikes++;
        state.okStreak = 0;
        state.gapMs = Math.min(60_000, Math.max(MIN_GAP, state.gapMs * 2));
        const backoff = Math.min(MAX_COOLDOWN, BASE_COOLDOWN * 2 ** Math.min(state.strikes - 1, 5));
        // Server deadlines are a minimum, even when longer than our own cap.
        const delay = Math.max(backoff, retryDelay(response.headers, now())) + Math.floor(random() * 30_000);
        state.notBefore = now() + delay;
        state.nextRequestAt = requestDeadline(state, now(), requestBudget);
        save(state);
        log(`  ⏸ Feedly HTTP 429 (#${state.strikes}); retry at ${new Date(state.notBefore).toISOString()}`);
        await response.body?.cancel();
        continue;
      }
      if (response.status === 404) return [];
      if (!response.ok) {
        await response.body?.cancel();
        if (++transientErrors > 3) throw new Error(`Feedly HTTP ${response.status}`);
        state.notBefore = now() + Math.max(30_000 * transientErrors, retryDelay(response.headers, now()));
        save(state);
        continue;
      }
      const items = (await response.json()).items || [];
      transientErrors = 0;
      // Retain strikes across successful pages: one success does not mean the
      // anonymous quota has recovered. This also survives process restarts.
      // Only a sustained run of successes eases the spacing back down.
      state.okStreak = (state.okStreak || 0) + 1;
      if (state.okStreak >= RECOVERY_STREAK && (state.strikes > 0 || state.gapMs > MIN_GAP)) {
        state.gapMs = Math.max(MIN_GAP, Math.floor(state.gapMs / 2));
        state.strikes = Math.max(0, state.strikes - 1);
        state.okStreak = 0;
      }
      state.notBefore = Math.max(quotaNotBefore, now() + state.gapMs);
      state.nextRequestAt = requestDeadline(state, now(), requestBudget);
      save(state);
      return items;
    }
  };
}
