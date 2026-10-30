import { apiRequest, type ArticleItem } from './api';
import { cachedArticle, readContent, writeContent } from './deviceContent';
import { cacheGeneration } from './cachePolicy';
import { revealCopyImages } from './articleImages';
import { publicDeviceArticle } from '../shared/publicWebPage';
import { loadPublicWebCopy } from './publicWebCopy';

type ReaderResult = { fullContentHtml: string; publishedAt?: string };
type WebResult = { html: string; url: string; phone?: boolean };
export class ArticleResources {
  private requests = new Map<string, Promise<unknown>>();
  private failures = new Map<string, number>();
  constructor(readonly account: string, private current: () => boolean, private request = apiRequest) {}
  hydrate(article: ArticleItem) { return cachedArticle(this.account, article); }
  async cachedWeb(article: ArticleItem): Promise<WebResult | undefined> {
    const stored = await readContent(this.account, `web:${article.id}`);
    return stored && 'html' in stored.data ? { ...stored.data, html: revealCopyImages(stored.data.html) } : undefined;
  }
  private async once<T>(key: string, load: () => Promise<T>): Promise<T> {
    const running = this.requests.get(key); if (running) return running as Promise<T>;
    const work = load().finally(() => this.requests.delete(key)); this.requests.set(key, work); return work;
  }
  reader(article: ArticleItem): Promise<ArticleItem> {
    return this.once(`reader:${article.id}`, async () => {
      const generation = cacheGeneration.get(this.account), cached = await this.hydrate(article);
      if (cached.full_content_html) return cached;
      if (!this.current()) throw new Error('Session changed');
      const result = await this.request<ReaderResult>(`/api/articles/${article.id}/reader-view`, { method: 'POST', body: '{}' });
      const updated = { ...cached, full_content_html: result.fullContentHtml, body_deferred: false, ...(result.publishedAt ? { published_at: result.publishedAt } : {}) };
      if (this.current() && generation === cacheGeneration.get(this.account)) await writeContent(this.account, `article:${article.id}`, { id: article.id, url: article.url, content_html: updated.content_html, full_content_html: updated.full_content_html, published_at: updated.published_at, date_source: updated.date_source });
      return updated;
    });
  }
  web(article: ArticleItem): Promise<WebResult> {
    return this.once(`web:${article.id}`, async () => {
      const generation = cacheGeneration.get(this.account), stored = await this.cachedWeb(article);
      if (stored) return stored;
      if (!this.current()) throw new Error('Session changed');
      let result: WebResult | null = null;
      let deviceError: unknown;
      // The device's request succeeds even when the publisher blocks the
      // server network. Keep the original page layout and cache it locally.
      if (publicDeviceArticle(article.url)) {
        try { result = await loadPublicWebCopy(article.url); } catch (error) { deviceError = error; }
      }
      if (!this.current()) throw new Error('Session changed');
      if (!result) {
        try { result = await this.request<WebResult>(`/api/articles/${article.id}/web-copy`); }
        catch (error) { throw deviceError || error; }
      }
      if (this.current() && generation === cacheGeneration.get(this.account)) await writeContent(this.account, `web:${article.id}`, result);
      return result;
    });
  }
  /** A copy laid out at phone width, replacing a saved one that only fits a desktop. */
  phoneWeb(article: ArticleItem): Promise<WebResult> {
    return this.once(`phone:${article.id}`, async () => {
      const generation = cacheGeneration.get(this.account);
      if (!this.current()) throw new Error('Session changed');
      const result = { ...await this.request<WebResult>(`/api/articles/${article.id}/web-copy?layout=phone`), phone: true };
      if (this.current() && generation === cacheGeneration.get(this.account)) await writeContent(this.account, `web:${article.id}`, result);
      return result;
    });
  }
  async preload(articles: ArticleItem[], current: () => boolean) {
    // One extraction at a time, only the next five visible articles. Never walk
    // an entire imported archive or repeat failures on every list render.
    for (const article of articles.slice(0, 5)) {
      if (!this.current() || !current()) return;
      if (article.full_content_html || (this.failures.get(article.id) || 0) > Date.now()) continue;
      try { await this.reader(article); } catch { this.failures.set(article.id, Date.now() + 3600_000); }
    }
  }
}
