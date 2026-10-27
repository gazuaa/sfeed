import type { BootstrapResponse } from './api';
import { articlePageKey, ReaderCache, type ArticlePage } from './readerCache';

export const PRELOAD_ARTICLE_LIMIT = 20;

// Read/save changes do not require downloading every list again.
export function feedCacheVersion(data: BootstrapResponse): string {
  return JSON.stringify(data.subscriptions.map((sub) => [sub.feed_id, sub.folder_id, sub.total_count, sub.last_fetched_at]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
}

export function preloadArticleQueries(current: URLSearchParams): URLSearchParams[] {
  if (current.get('search')) return [];
  const queries = [
    new URLSearchParams({ scope: 'all', unreadOnly: 'false' }),
    new URLSearchParams({ scope: 'all', unreadOnly: 'true' }),
    new URLSearchParams({ scope: 'saved', unreadOnly: 'false' }),
  ];
  const scope = current.get('scope');
  const field = scope === 'folder' ? 'folderId' : scope === 'feed' ? 'feedId' : null;
  if (field && current.get(field)) {
    const base = { scope: scope!, [field]: current.get(field)! };
    queries.push(new URLSearchParams({ ...base, unreadOnly: 'false' }), new URLSearchParams({ ...base, unreadOnly: 'true' }), new URLSearchParams({ ...base, unreadOnly: 'false', savedOnly: 'true' }));
  }
  const active = articlePageKey(current);
  return queries.filter((query) => articlePageKey(query) !== active);
}

// One background request at a time, after the visible screen has loaded.
// Foreground navigation shares any in-flight request through ReaderCache.
export class ReaderPreloader {
  private queue: Promise<void> = Promise.resolve();
  private versions = new Map<string, string>();
  constructor(private cache: ReaderCache) {}
  run(queries: URLSearchParams[], version: string, fetcher: (query: URLSearchParams) => Promise<ArticlePage>, current: () => boolean): Promise<void> {
    const revision = this.cache.revision;
    const valid = () => this.cache.active && this.cache.revision === revision && current();
    this.queue = this.queue.then(async () => {
      for (const query of queries) {
        if (!valid()) return;
        const key = articlePageKey(query);
        if (this.versions.get(key) === version && this.cache.has(key)) continue;
        try {
          // A first screen is enough to make navigation instant. The normal
          // cursor loads the rest, including when navigation shares this request.
          const requestQuery = new URLSearchParams(query);
          requestQuery.set('limit', String(PRELOAD_ARTICLE_LIMIT));
          const data = await this.cache.request(key, () => fetcher(requestQuery));
          if (!valid()) return;
          this.cache.put(key, data);
          this.versions.set(key, version);
        } catch {
          // A failed speculative request must not block another list or the UI.
        }
      }
    });
    return this.queue;
  }
}
