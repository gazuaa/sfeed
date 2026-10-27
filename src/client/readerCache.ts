import type { ArticleItem, BootstrapResponse } from './api';

export interface ArticlePage { articles: ArticleItem[]; hasMore?: boolean }
export interface Snapshot { account: string; key: string; data: BootstrapResponse | ArticlePage; savedAt: number; size: number }
export interface SnapshotStorage {
  read(account: string, key: string): Promise<Snapshot | undefined>;
  write(snapshot: Snapshot): Promise<void>;
  remove(account: string): Promise<void>;
}
export const CACHE_LIMITS = { entries: 12, bytes: 8 * 1024 * 1024, age: 24 * 60 * 60_000 };
let database: Promise<IDBDatabase | null> | undefined;
function openDatabase() {
  return database ??= new Promise<IDBDatabase | null>((resolve) => {
    let finished = false;
    const finish = (db: IDBDatabase | null) => {
      if (finished) { db?.close(); return; }
      finished = true; clearTimeout(timer); resolve(db);
    };
    const timer = setTimeout(() => finish(null), 1500);
    try {
      if (typeof indexedDB === 'undefined') { finish(null); return; }
      const request = indexedDB.open('sfeed-reader-cache', 1);
      request.onupgradeneeded = () => {
        const store = request.result.createObjectStore('snapshots', { keyPath: ['account', 'key'] });
        store.createIndex('account', 'account');
        // Key cursors can enforce the limit without cloning article bodies.
        store.createIndex('age-size', ['savedAt', 'size']);
      };
      request.onerror = request.onblocked = () => finish(null);
      request.onsuccess = () => {
        request.result.onversionchange = () => request.result.close();
        finish(request.result);
      };
    } catch { finish(null); }
  });
}
export const deviceSnapshots: SnapshotStorage = {
  async read(account, key) {
    const db = await openDatabase();
    if (!db) return;
    return new Promise((resolve) => {
      try {
        const request = db.transaction('snapshots').objectStore('snapshots').get([account, key]);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve(undefined);
      } catch { resolve(undefined); }
    });
  },
  async write(snapshot) {
    const db = await openDatabase();
    if (!db) return;
    await new Promise<void>((resolve) => {
      try {
        const transaction = db.transaction('snapshots', 'readwrite');
        transaction.oncomplete = transaction.onabort = transaction.onerror = () => resolve();
        const store = transaction.objectStore('snapshots');
        store.put(snapshot);
        const rows: { key: IDBValidKey; size: number; at: number }[] = [];
        const cursor = store.index('age-size').openKeyCursor();
        cursor.onsuccess = () => {
          const item = cursor.result;
          if (item) { const [at, size] = item.key as number[]; rows.push({ key: item.primaryKey, size, at }); item.continue(); return; }
          let bytes = rows.reduce((sum, row) => sum + row.size, 0), count = rows.length;
          for (const row of rows) {
            if (row.at + CACHE_LIMITS.age > Date.now() && count <= CACHE_LIMITS.entries && bytes <= CACHE_LIMITS.bytes) break;
            store.delete(row.key); count--; bytes -= row.size;
          }
        };
      } catch { resolve(); }
    });
  },
  async remove(account) {
    const db = await openDatabase();
    if (!db) return;
    await new Promise<void>((resolve) => {
      try {
        const transaction = db.transaction('snapshots', 'readwrite');
        transaction.oncomplete = transaction.onabort = transaction.onerror = () => resolve();
        const store = transaction.objectStore('snapshots');
        const cursor = store.index('account').openKeyCursor(IDBKeyRange.only(account));
        cursor.onsuccess = () => { if (cursor.result) { store.delete(cursor.result.primaryKey); cursor.result.continue(); } };
      } catch { resolve(); }
    });
  },
};

// Estimate without serializing large HTML strings on the rendering thread.
function sizeOf(value: unknown): number {
  if (typeof value === 'string') return value.length * 2;
  if (!value || typeof value !== 'object') return 8;
  return Object.entries(value).reduce((sum, [key, child]) => sum + key.length * 2 + sizeOf(child), 32);
}
export function updateCounts(counts: BootstrapResponse['counts'], before: ArticleItem, after: ArticleItem, now = Date.now()) {
  const age = now - Date.parse(before.published_at);
  const unread = Number(!after.is_read) - Number(!before.is_read);
  return { ...counts,
    totalUnread: Math.max(0, counts.totalUnread + (age <= 30 * 86400_000 ? unread : 0)),
    todayCount: Math.max(0, counts.todayCount + (age <= 86400_000 ? unread : 0)),
    savedCount: Math.max(0, counts.savedCount + Number(after.is_saved) - Number(before.is_saved)),
  };
}
export function updateSubscription<T extends BootstrapResponse['subscriptions'][number]>(subscription: T, before: ArticleItem, after: ArticleItem, now = Date.now()): T {
  if (subscription.feed_id !== before.feed_id) return subscription;
  const unread = now - Date.parse(before.published_at) <= 30 * 86400_000 ? Number(!after.is_read) - Number(!before.is_read) : 0;
  return { ...subscription, unread_count: Math.max(0, subscription.unread_count + unread), saved_count: Math.max(0, subscription.saved_count + Number(after.is_saved) - Number(before.is_saved)) };
}
export const articlePageKey = (query: URLSearchParams) => { const sorted = new URLSearchParams(query); sorted.sort(); return `articles?${sorted}`; };

export class ReaderCache {
  private entries = new Map<string, Snapshot>();
  private writes: Promise<unknown> = Promise.resolve();
  private closed = false;
  revision = 0;
  constructor(readonly account: string, private storage: SnapshotStorage = deviceSnapshots, private now = Date.now) {}
  get active() { return !this.closed; }
  private queue(operation: () => Promise<unknown>) { this.writes = this.writes.then(operation).catch(() => {}); return this.writes; }
  private trim() {
    let bytes = [...this.entries.values()].reduce((sum, entry) => sum + entry.size, 0);
    for (const [key, snapshot] of this.entries) {
      if (this.entries.size <= CACHE_LIMITS.entries && bytes <= CACHE_LIMITS.bytes) break;
      this.entries.delete(key); bytes -= snapshot.size;
    }
  }
  async get<T extends Snapshot['data']>(key: string): Promise<T | undefined> {
    if (this.closed) return;
    const revision = this.revision;
    const memory = this.entries.get(key);
    const loaded = memory ?? await this.storage.read(this.account, key).catch(() => undefined);
    // A faster network response may have populated memory while disk was read.
    const snapshot = this.entries.get(key) ?? loaded;
    if (this.closed || revision !== this.revision || snapshot?.account !== this.account || snapshot.savedAt + CACHE_LIMITS.age <= this.now()) return;
    this.entries.delete(key); this.entries.set(key, snapshot);
    this.trim();
    return snapshot.data as T;
  }
  put(key: string, data: Snapshot['data']) {
    if (this.closed) return;
    let size = sizeOf(data);
    // Retain a useful first screen even if a feed includes very large bodies.
    if ('articles' in data) {
      while (size > CACHE_LIMITS.bytes && data.articles.length > 1) {
        data = { ...data, articles: data.articles.slice(0, Math.ceil(data.articles.length / 2)), hasMore: true };
        size = sizeOf(data);
      }
    }
    if (size > CACHE_LIMITS.bytes) return;
    const snapshot: Snapshot = { account: this.account, key, data, savedAt: this.now(), size };
    this.entries.delete(key); this.entries.set(key, snapshot);
    this.trim();
    // Writes accepted before logout must finish; closed instances reject new puts.
    void this.queue(() => this.storage.write(snapshot));
  }
  updateArticle(before: ArticleItem, after: ArticleItem) {
    this.revision++;
    for (const [key, snapshot] of [...this.entries]) {
      if (key === 'bootstrap') {
        const data = snapshot.data as BootstrapResponse;
        this.put(key, { ...data, counts: updateCounts(data.counts, before, after, this.now()), subscriptions: data.subscriptions.map((sub) => updateSubscription(sub, before, after, this.now())) });
      } else {
        const data = snapshot.data as ArticlePage, query = new URLSearchParams(key.slice(9));
        const saved = query.get('scope') === 'saved' || query.get('savedOnly') === 'true';
        const unread = !saved && query.get('unreadOnly') === 'true';
        this.put(key, { ...data, articles: data.articles.map((article) => article.id === after.id ? { ...article, is_read: after.is_read, is_saved: after.is_saved } : article).filter((article) => (!saved || article.is_saved) && (!unread || !article.is_read)) });
      }
    }
  }
  updateFields(articleId: string, fields: Partial<ArticleItem>) {
    this.revision++;
    for (const [key, snapshot] of [...this.entries]) {
      if (key.startsWith('articles?')) {
        const data = snapshot.data as ArticlePage;
        this.put(key, { ...data, articles: data.articles.map((article) => article.id === articleId ? { ...article, ...fields } : article) });
      }
    }
  }
  updateBootstrap(update: (data: BootstrapResponse) => BootstrapResponse) {
    this.revision++;
    const entry = this.entries.get('bootstrap');
    if (entry) this.put('bootstrap', update(entry.data as BootstrapResponse));
  }
  invalidate() { if (this.closed) return; this.revision++; this.entries.clear(); void this.queue(() => this.storage.remove(this.account)); }
  close() { this.closed = true; this.revision++; this.entries.clear(); return this.writes; }
  clear() { this.close(); return this.queue(() => this.storage.remove(this.account)); }
  flushed() { return this.writes; }
}

// Cached data can paint while the request runs. A late disk read or an old
// response must not overwrite fresh data, navigation or optimistic mutations.
export async function revalidate<T extends Snapshot['data']>(cache: ReaderCache, key: string, fetcher: () => Promise<T>, apply: (data: T) => void, current: () => boolean) {
  if (!cache.active || !current()) return false;
  const revision = cache.revision;
  let fresh = false, cached = false;
  const disk = cache.get<T>(key).then((data) => { if (data && !fresh && cache.active && current() && revision === cache.revision) { cached = true; apply(data); } });
  try {
    const data = await fetcher(); fresh = true;
    if (cache.active && current() && revision === cache.revision) { cache.put(key, data); apply(data); }
  } finally { await disk; }
  return cached;
}
