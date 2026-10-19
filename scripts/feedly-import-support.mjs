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
} = {}) {
  const state = { notBefore: 0, gapMs: MIN_GAP, strikes: 0, ...load() };
  state.gapMs = Math.max(MIN_GAP, state.gapMs);
  return async function fetchPage(xmlUrl, newerThan) {
    const params = new URLSearchParams({ streamId: `feed/${xmlUrl}`, count: '50', ranked: 'oldest' });
    if (newerThan != null) params.set('newerThan', String(newerThan));
    let transientErrors = 0;
    for (;;) {
      const wait = Math.max(0, state.notBefore - now());
      if (wait) {
        if (wait > 60_000) log(`  ⏸ Feedly next request at ${new Date(state.notBefore).toISOString()}`);
        // Node timers overflow above ~24 days. Chunking also handles long quota resets.
        while (state.notBefore > now()) await sleep(Math.min(60_000, state.notBefore - now()));
      }
      let response;
      // Persist before making the request, so a restart cannot discard spacing.
      state.notBefore = now() + state.gapMs;
      save(state);
      try {
        response = await fetchImpl(`https://cloud.feedly.com/v3/streams/contents?${params}`, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Sfeed history import)' },
          signal: AbortSignal.timeout(30_000),
        });
      } catch (error) {
        if (++transientErrors > 5) throw error;
        state.notBefore = now() + 30_000 * transientErrors;
        save(state);
        continue;
      }
      if (response.status === 429) {
        state.strikes++;
        state.gapMs = Math.min(60_000, Math.max(MIN_GAP, state.gapMs * 2));
        const backoff = Math.min(MAX_COOLDOWN, BASE_COOLDOWN * 2 ** Math.min(state.strikes - 1, 5));
        // Server deadlines are a minimum, even when longer than our own cap.
        const delay = Math.max(backoff, retryDelay(response.headers, now())) + Math.floor(random() * 30_000);
        state.notBefore = now() + delay;
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
      state.notBefore = now() + state.gapMs;
      save(state);
      return items;
    }
  };
}
