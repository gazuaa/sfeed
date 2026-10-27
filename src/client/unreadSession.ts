import type { ArticleItem } from './api';

// Unread lists stay stable while reading, including during revalidation.
// This session is memory-only; the regular device cache still excludes read rows.
export class UnreadSession {
  private articles = new Map<string, ArticleItem>();
  merge(incoming: ArticleItem[], sort: 'newest' | 'oldest' = 'newest') {
    for (const article of incoming) {
      const previous = this.articles.get(article.id);
      this.articles.set(article.id, { ...article, is_read: previous?.is_read || article.is_read });
    }
    return [...this.articles.values()].sort((a, b) => (sort === 'oldest' ? -1 : 1) * (b.published_at.localeCompare(a.published_at) || b.id.localeCompare(a.id)));
  }
  update(article: ArticleItem) { this.articles.set(article.id, article); }
  patch(id: string, fields: Partial<ArticleItem>) { const article = this.articles.get(id); if (article) this.articles.set(id, { ...article, ...fields }); }
  clear() { this.articles.clear(); }
  remove(id: string) { this.articles.delete(id); }
}
