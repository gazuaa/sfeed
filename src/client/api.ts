import type { ReaderSyncCursor } from '../shared/readerSync';
export type LayoutMode = 'magazine' | 'cards' | 'list';
export type ThemeMode = 'dark' | 'light';
export type ScopeType = 'all' | 'today' | 'saved' | 'folder' | 'feed';

export interface UserPreferences {
  layout: LayoutMode;
  theme: ThemeMode;
  unreadOnly: boolean;
  markReadOnScroll: boolean;
  autoRefreshMinutes: number;
}

export interface UserProfile {
  id: string;
  email: string;
  name: string;
  picture: string | null;
  preferences: UserPreferences;
}

export interface FolderItem {
  id: string;
  user_id: string;
  name: string;
  color: string;
  sort_order: number;
  created_at: string;
}

export interface SubscriptionItem {
  id: string;
  feed_id: string;
  folder_id: string | null;
  custom_title: string | null;
  xml_url: string;
  html_url: string | null;
  title: string;
  description: string | null;
  favicon_url: string | null;
  last_fetched_at: string | null;
  last_error: string | null;
  unread_count: number;
  total_count: number;
  saved_count: number;
  view_mode?: ArticleViewMode | null;
}

// Body views RSS readers offer: the feed's content, the full article
// extracted from the original page, or the original page itself.
export type ArticleViewMode = 'feed' | 'reader' | 'web';

export interface ArticleItem {
  id: string;
  feed_id: string;
  feed_title: string;
  feed_favicon: string | null;
  feed_html_url: string | null;
  folder_id: string | null;
  folder_name: string | null;
  guid: string;
  title: string;
  url: string;
  author: string | null;
  summary: string | null;
  content_html: string | null;
  full_content_html: string | null;
  ai_summary: string | null;
  thumbnail_url: string | null;
  published_at: string;
  date_source?: 'original' | 'feed' | 'updated' | 'collected';
  is_read: boolean;
  is_saved: boolean;
  body_deferred?: boolean;
  body_load_error?: boolean;
}

export interface CuratedFeedItem {
  id: string;
  title: string;
  xmlUrl: string;
  htmlUrl: string;
  description: string;
  category: string;
  folderSuggest: string;
  language: 'KO' | 'EN';
  tags: string[];
}

export interface BootstrapResponse {
  syncCursor?: ReaderSyncCursor;
  cacheEpoch?: string;
  folders: FolderItem[];
  subscriptions: SubscriptionItem[];
  counts: {
    totalUnread: number;
    totalArticles: number;
    savedCount: number;
    todayCount: number;
    todayTotal: number;
  };
  curatedFeeds: CuratedFeedItem[];
}

export interface FeedPreviewResponse {
  feed: { title: string; xmlUrl: string; htmlUrl: string | null; description: string | null };
  articles: {
    title: string;
    url: string;
    summary: string | null;
    publishedAt: string;
    dateSource?: ArticleItem['date_source'];
  }[];
}

const SESSION_STORAGE_KEY = 'sfeed_session_token';

export function getStoredToken(): string | null {
  return localStorage.getItem(SESSION_STORAGE_KEY);
}

export function setStoredToken(token: string | null): void {
  if (token) {
    localStorage.setItem(SESSION_STORAGE_KEY, token);
  } else {
    localStorage.removeItem(SESSION_STORAGE_KEY);
  }
}

export async function apiRequest<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const token = getStoredToken();
  const headers = new Headers(options.headers || {});
  if (!headers.has('Content-Type') && options.body) {
    headers.set('Content-Type', 'application/json');
  }
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const res = await fetch(path, {
    ...options,
    headers,
  });

  if (!res.ok) {
    let errorMsg = `HTTP ${res.status}`;
    try {
      const data = await res.json();
      if (data?.error) errorMsg = data.error;
    } catch {
      // ignore
    }
    throw new Error(errorMsg);
  }

  return res.json() as Promise<T>;
}

export function formatRelativeTime(isoDate: string): string {
  try {
    const date = new Date(isoDate);
    const diffMs = Date.now() - date.getTime();
    const diffMinutes = Math.floor(diffMs / 60_000);
    if (diffMinutes < 1) return '방금 전';
    if (diffMinutes < 60) return `${diffMinutes}분 전`;
    const diffHours = Math.floor(diffMinutes / 60);
    if (diffHours < 24) return `${diffHours}시간 전`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 7) return `${diffDays}일 전`;
    // Older posts from past years need the year, or 2018 reads as this year.
    return date.toLocaleDateString('ko-KR', {
      ...(date.getFullYear() !== new Date().getFullYear() && { year: 'numeric' }),
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return '';
  }
}

export function formatArticleDate(article: Pick<ArticleItem, 'published_at' | 'date_source'>): string {
  if (article.date_source === 'updated' || article.date_source === 'collected') return '발행일 미제공';
  return formatRelativeTime(article.published_at);
}
