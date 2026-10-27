import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  apiRequest,
  getStoredToken,
  setStoredToken,
  type ArticleItem,
  type ArticleViewMode,
  type BootstrapResponse,
  type CuratedFeedItem,
  type FolderItem,
  type LayoutMode,
  type ScopeType,
  type SubscriptionItem,
  type ThemeMode,
  type UserProfile,
} from './client/api';
import { LoginView } from './components/LoginView';
import { Sidebar } from './components/Sidebar';
import { HeaderBar } from './components/HeaderBar';
import { ArticleList } from './components/ArticleList';
import { LoadMoreArticles } from './components/LoadMoreArticles';
import { ArticleDrawer } from './components/ArticleDrawer';
import { ResizableWorkspace } from './components/ResizableWorkspace';
import { DiscoverModal } from './components/DiscoverModal';
import { MarkAllReadDialog } from './components/MarkAllReadDialog';
import { ConfirmDialog } from './components/ConfirmDialog';
import { applyTheme, readStoredTheme } from './client/theme';
import { useMobileViewport, useScrollChrome } from './client/mobile';
import { useTextSize } from './client/textSize';
import { useMobileNavigation } from './client/navigation';
import { MobileHeader, MobileDock, type LibraryTab } from './components/MobileChrome';
import { MobileLibrary } from './components/MobileLibrary';
import { ReaderCache, articlePageKey, revalidate, updateCounts, updateSubscription, type ArticlePage } from './client/readerCache';

export const App: React.FC = () => {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [authChecking, setAuthChecking] = useState(true);
  const authenticatedToken = useRef<string | null>(null);
  const readerCache = useMemo(() => user ? new ReaderCache(user.id) : null, [user?.id]);
  const activeCache = useRef(readerCache);
  activeCache.current = readerCache;
  const stateWrites = useRef(new Map<string, Promise<unknown>>());
  const confirmedStates = useRef(new Map<string, ArticleItem>());
  const bootstrapFlight = useRef<{ cache: ReaderCache; revision: number; promise: Promise<void> } | null>(null);
  const bootstrapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (bootstrapTimer.current) clearTimeout(bootstrapTimer.current); bootstrapTimer.current = null; }, [readerCache]);

  // Bootstrap data
  const [folders, setFolders] = useState<FolderItem[]>([]);
  const [subscriptions, setSubscriptions] = useState<SubscriptionItem[]>([]);
  const [counts, setCounts] = useState({
    totalUnread: 0,
    totalArticles: 0,
    savedCount: 0,
    todayCount: 0,
    todayTotal: 0,
  });
  const [curatedFeeds, setCuratedFeeds] = useState<CuratedFeedItem[]>([]);
  const [loadingBootstrap, setLoadingBootstrap] = useState(true);

  // Active Navigation & Filters
  const [activeScope, setActiveScope] = useState<ScopeType>('all');
  const [activeFolderId, setActiveFolderId] = useState<string | null>(null);
  const [activeFeedId, setActiveFeedId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [committedSearch, setCommittedSearch] = useState('');
  useEffect(() => {
    if (!searchQuery) { setCommittedSearch(''); return; }
    const timer = setTimeout(() => setCommittedSearch(searchQuery), 200);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // User Preferences
  const [layout, setLayout] = useState<LayoutMode>('magazine');
  const [theme, setTheme] = useState<ThemeMode>(readStoredTheme);
  const [unreadOnly, setUnreadOnly] = useState(false);
  // Phones only: the 저장 tab inside a folder or feed list keeps that list.
  const [savedOnly, setSavedOnly] = useState(false);

  // Articles & Reader State
  const [articles, setArticles] = useState<ArticleItem[]>([]);
  const [loadingArticles, setLoadingArticles] = useState(false);
  const [hasMoreArticles, setHasMoreArticles] = useState(false);
  const [loadingMoreArticles, setLoadingMoreArticles] = useState(false);
  // Query of the list currently shown; an older page is dropped if the view changed meanwhile.
  const articleQueryRef = useRef('');
  const articleRequestRef = useRef(0);
  const articleListRef = useRef<HTMLElement>(null);
  const pendingScroll = useRef<number | null>(null);
  const articleCache = useRef(new Map<string, ArticleItem>());
  const [restoredArticle, setRestoredArticle] = useState<ArticleItem | null>(null);
  const [refreshingFeeds, setRefreshingFeeds] = useState(false);
  const [selectedArticleId, setSelectedArticleId] = useState<string | null>(null);

  // Modals & Mobile Sidebar
  const [discoverOpen, setDiscoverOpen] = useState(false);
  const [discoverTab, setDiscoverTab] = useState<'curated' | 'opml'>(
    'curated'
  );
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 1023px)').matches);
  const isMobile = useMobileViewport();
  const chromeHidden = useScrollChrome(articleListRef, isMobile && Boolean(user) && !mobileSidebarOpen && !selectedArticleId, `${activeScope}:${activeFolderId}:${activeFeedId}:${unreadOnly}:${savedOnly}:${searchQuery}`);
  const [textSize] = useTextSize();
  useEffect(() => { document.documentElement.style.setProperty('--sfeed-text-scale', String(textSize)); }, [textSize]);
  // The desktop sidebar has its own 저장 list; drop the phone-only filter there.
  useEffect(() => { if (!isMobile) setSavedOnly(false); }, [isMobile]);
  useMobileNavigation(isMobile && !authChecking ? user?.id ?? null : null, {
    scope: activeScope, folderId: activeFolderId, feedId: activeFeedId,
    search: searchQuery, unread: unreadOnly, saved: savedOnly, articleId: selectedArticleId, library: mobileSidebarOpen,
  }, (location, scroll) => {
    pendingScroll.current = scroll;
    setActiveScope(location.scope);
    setActiveFolderId(location.folderId);
    setActiveFeedId(location.feedId);
    setSearchQuery(location.search);
    setUnreadOnly(location.unread);
    setSavedOnly(location.saved === true);
    setSelectedArticleId(location.articleId);
    setMobileSidebarOpen(location.library);
    setDiscoverOpen(false);
  }, () => articleListRef.current?.scrollTop ?? 0);
  const [markReadTarget, setMarkReadTarget] = useState<{
    scope: ScopeType;
    folderId: string | null;
    feedId: string | null;
    name: string;
    searching: boolean;
  } | null>(null);
  const [markingAllRead, setMarkingAllRead] = useState(false);
  const markingAllReadRef = useRef(false);
  const [markReadError, setMarkReadError] = useState<string | null>(null);

  useEffect(() => {
    if (pendingScroll.current === null) articleListRef.current?.scrollTo({ top: 0 });
  }, [activeScope, activeFolderId, activeFeedId, unreadOnly, savedOnly, searchQuery]);

  useLayoutEffect(() => {
    for (const article of articles) articleCache.current.set(article.id, article);
  }, [articles]);

  useEffect(() => {
    articleCache.current.clear();
    stateWrites.current.clear();
    confirmedStates.current.clear();
    setRestoredArticle(null);
    return () => { articleRequestRef.current++; articleQueryRef.current = ''; };
  }, [user?.id]);

  // Sync HTML root class with theme
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  // Check OAuth callback token or stored token on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const callbackToken = params.get('session_token');
    if (callbackToken) {
      setStoredToken(callbackToken);
      window.history.replaceState({}, document.title, window.location.pathname);
    }

    const token = getStoredToken();
    if (!token) {
      setAuthChecking(false);
      return;
    }

    apiRequest<{ user: UserProfile }>('/api/user/me')
      .then((res) => {
        if (getStoredToken() !== token) return;
        authenticatedToken.current = token;
        setUser(res.user);
        setLayout(res.user.preferences.layout);
        setTheme(res.user.preferences.theme);
        setUnreadOnly(res.user.preferences.unreadOnly);
      })
      .catch(() => {
        if (getStoredToken() === token) setStoredToken(null);
      })
      .finally(() => {
        setAuthChecking(false);
      });
  }, []);

  const fetchBootstrap = useCallback((): Promise<void> => {
    const cache = readerCache;
    if (!cache?.active || activeCache.current !== cache) return Promise.resolve();
    if (bootstrapFlight.current?.cache === cache) {
      const flight = bootstrapFlight.current;
      return flight.revision === cache.revision ? flight.promise : flight.promise.then(() => fetchBootstrap());
    }
    const token = getStoredToken();
    const current = () => activeCache.current === cache && getStoredToken() === token && token === authenticatedToken.current;
    const revision = cache.revision;
    const promise = revalidate(cache, 'bootstrap', async () => {
      await Promise.allSettled([...stateWrites.current.values()]);
      return apiRequest<BootstrapResponse>('/api/bootstrap');
    }, (data) => {
      setFolders(data.folders);
      setSubscriptions(data.subscriptions);
      setCounts(data.counts);
      setCuratedFeeds(data.curatedFeeds);
      setLoadingBootstrap(false);
    }, current).then(() => {}, () => {}).finally(() => {
      if (current()) setLoadingBootstrap(false);
      if (bootstrapFlight.current?.promise === promise) bootstrapFlight.current = null;
      // If a mutation invalidated an in-flight count, reconcile once the
      // previous request completes instead of accepting its stale result.
      if (current() && cache.revision !== revision) void fetchBootstrap();
    });
    bootstrapFlight.current = { cache, revision, promise };
    return promise;
  }, [readerCache]);

  const scheduleBootstrap = useCallback(() => {
    if (bootstrapTimer.current) return;
    bootstrapTimer.current = setTimeout(() => { bootstrapTimer.current = null; void fetchBootstrap(); }, 10_000);
  }, [fetchBootstrap]);

  // Refresh another device's changes when returning to the app, without
  // making every article click run the expensive full-library counts query.
  useEffect(() => {
    if (!readerCache) return;
    const visible = () => { if (document.visibilityState === 'visible') void fetchBootstrap(); };
    const sessionChanged = (event: StorageEvent) => {
      if (event.key === 'sfeed_session_token' && event.newValue !== event.oldValue) {
        void readerCache.close().finally(() => window.location.reload());
      }
    };
    document.addEventListener('visibilitychange', visible);
    window.addEventListener('storage', sessionChanged);
    return () => { document.removeEventListener('visibilitychange', visible); window.removeEventListener('storage', sessionChanged); };
  }, [readerCache, fetchBootstrap]);

  const buildArticleQuery = useCallback(() => {
    const qs = new URLSearchParams({
      scope: activeScope,
      unreadOnly: String(unreadOnly),
    });
    if (activeScope === 'folder' && activeFolderId) {
      qs.set('folderId', activeFolderId);
    }
    if (activeScope === 'feed' && activeFeedId) {
      qs.set('feedId', activeFeedId);
    }
    if (savedOnly && activeScope !== 'saved') {
      qs.set('savedOnly', 'true');
    }
    if (committedSearch.trim()) {
      qs.set('search', committedSearch.trim());
    }
    return qs;
  }, [activeScope, activeFolderId, activeFeedId, unreadOnly, savedOnly, committedSearch]);

  const fetchArticles = useCallback(async () => {
    const cache = readerCache;
    if (!cache?.active || activeCache.current !== cache) return;
    const request = ++articleRequestRef.current;
    const token = getStoredToken();
    const current = () => request === articleRequestRef.current && activeCache.current === cache && getStoredToken() === token && token === authenticatedToken.current;
    setLoadingArticles(true);
    const qs = buildArticleQuery();
    articleQueryRef.current = qs.toString();
    try {
      await revalidate<ArticlePage>(cache, articlePageKey(qs), async () => {
        await Promise.allSettled([...stateWrites.current.values()]);
        return apiRequest<ArticlePage>(`/api/articles?${qs}`);
      }, (res) => {
        setArticles(res.articles);
        setHasMoreArticles(Boolean(res.hasMore));
        setLoadingArticles(false);
      }, current);
    } catch {
      // ignore
    } finally {
      if (current()) setLoadingArticles(false);
    }
  }, [readerCache, buildArticleQuery]);

  useEffect(() => {
    if (pendingScroll.current === null || loadingArticles || mobileSidebarOpen || selectedArticleId || articleQueryRef.current !== buildArticleQuery().toString()) return;
    articleListRef.current?.scrollTo({ top: pendingScroll.current });
    pendingScroll.current = null;
  }, [articles, loadingArticles, mobileSidebarOpen, selectedArticleId, buildArticleQuery]);

  useEffect(() => {
    if (!user || !selectedArticleId || articleCache.current.has(selectedArticleId)) return;
    let active = true;
    // A read article may no longer be in the unread list or the loaded page.
    // Restore it by ID without changing its read/save state.
    apiRequest<{ articles: ArticleItem[] }>(`/api/articles?articleId=${encodeURIComponent(selectedArticleId)}`)
      .then(({ articles: found }) => {
        if (!active) return;
        if (found[0]) { articleCache.current.set(found[0].id, found[0]); setRestoredArticle(found[0]); }
        else setSelectedArticleId(null);
      }).catch(() => { if (active) setSelectedArticleId(null); });
    return () => { active = false; };
  }, [user?.id, selectedArticleId]);

  const loadMoreArticles = useCallback(async () => {
    const last = articles[articles.length - 1];
    if (!user || !last || !hasMoreArticles || loadingMoreArticles) return;
    setLoadingMoreArticles(true);
    const query = articleQueryRef.current;
    try {
      const qs = new URLSearchParams(query);
      qs.set('before', last.published_at);
      qs.set('beforeId', last.id);
      const res = await apiRequest<{ articles: ArticleItem[]; hasMore?: boolean }>(
        `/api/articles?${qs.toString()}`
      );
      if (articleQueryRef.current !== query) return;
      setArticles((prev) => {
        const seen = new Set(prev.map((a) => a.id));
        return [...prev, ...res.articles.filter((a) => !seen.has(a.id))];
      });
      setHasMoreArticles(Boolean(res.hasMore));
    } catch {
      // ignore; the button stays available for another try
    } finally {
      setLoadingMoreArticles(false);
    }
  }, [user, articles, hasMoreArticles, loadingMoreArticles]);

  useEffect(() => {
    if (user) {
      fetchBootstrap();
    }
  }, [user, fetchBootstrap]);

  useEffect(() => {
    if (user) {
      fetchArticles();
    }
  }, [user, fetchArticles]);

  const savePreferences = async (next: Partial<{
    layout: LayoutMode;
    theme: ThemeMode;
    unreadOnly: boolean;
  }>) => {
    try {
      await apiRequest('/api/user/preferences', {
        method: 'PUT',
        body: JSON.stringify(next),
      });
    } catch {
      // ignore
    }
  };

  const handleChangeLayout = (nextLayout: LayoutMode) => {
    setLayout(nextLayout);
    savePreferences({ layout: nextLayout });
  };

  const handleChangeTheme = (nextTheme: ThemeMode) => {
    setTheme(nextTheme);
    savePreferences({ theme: nextTheme });
  };

  const handleSelectScope = (
    scope: ScopeType,
    folderId: string | null = null,
    feedId: string | null = null
  ) => {
    setActiveScope(scope);
    setActiveFolderId(folderId);
    setActiveFeedId(feedId);
    setSelectedArticleId(null);
  };

  const handleSelectLibraryTab = (tab: 'all' | 'unread' | 'saved') => {
    const unread = tab === 'unread';
    setUnreadOnly(unread);
    savePreferences({ unreadOnly: unread });
    handleSelectScope(tab === 'saved' ? 'saved' : 'all');
  };

  const handleUpdateArticleState = useCallback(
    async (
      article: ArticleItem,
      changes: { isRead?: boolean; isSaved?: boolean }
    ) => {
      const cache = readerCache;
      if (!cache) return;
      const token = authenticatedToken.current;
      article = articleCache.current.get(article.id) ?? article;
      const nextRead =
        typeof changes.isRead === 'boolean' ? changes.isRead : article.is_read;
      const nextSaved =
        typeof changes.isSaved === 'boolean' ? changes.isSaved : article.is_saved;
      const nextArticle = { ...article, is_read: nextRead, is_saved: nextSaved };
      cache.updateArticle(article, nextArticle);
      setCounts((prev) => updateCounts(prev, article, nextArticle));
      setSubscriptions((prev) => prev.map((sub) => updateSubscription(sub, article, nextArticle)));
      articleCache.current.set(article.id, nextArticle);
      setRestoredArticle((prev) => prev?.id === article.id ? nextArticle : prev);

      // Optimistic UI update
      setArticles((prev) =>
        prev.map((a) =>
          a.id === article.id
            ? { ...a, is_read: nextRead, is_saved: nextSaved }
            : a
        )
      );

      // Preserve the user's toggle order if several updates happen quickly.
      const previous = stateWrites.current.get(article.id);
      if (!previous) confirmedStates.current.set(article.id, article);
      let precedingFailed = false;
      const operation = (previous ?? Promise.resolve()).catch(() => { precedingFailed = true; }).then(() => {
        if (activeCache.current !== cache || getStoredToken() !== token) return;
        return apiRequest(`/api/articles/${article.id}/state`, {
          method: 'POST',
          body: JSON.stringify(precedingFailed ? { isRead: nextRead, isSaved: nextSaved } : changes),
        });
      });
      stateWrites.current.set(article.id, operation);
      try {
        await operation;
        if (activeCache.current === cache) { confirmedStates.current.set(article.id, nextArticle); scheduleBootstrap(); }
      } catch {
        if (activeCache.current !== cache || stateWrites.current.get(article.id) !== operation) return;
        // Revert on failure
        const confirmed = confirmedStates.current.get(article.id) ?? article;
        const latest = articleCache.current.get(article.id) ?? nextArticle;
        const rollback = { ...latest, is_read: confirmed.is_read, is_saved: confirmed.is_saved };
        cache.updateArticle(latest, rollback);
        setCounts((prev) => updateCounts(prev, latest, rollback));
        setSubscriptions((prev) => prev.map((sub) => updateSubscription(sub, latest, rollback)));
        articleCache.current.set(article.id, rollback);
        setRestoredArticle((prev) => prev?.id === article.id ? rollback : prev);
        void fetchArticles();
        scheduleBootstrap();
      } finally {
        if (stateWrites.current.get(article.id) === operation) { stateWrites.current.delete(article.id); confirmedStates.current.delete(article.id); }
      }
    },
    [readerCache, scheduleBootstrap, fetchArticles]
  );

  const handleSelectArticle = useCallback(
    (article: ArticleItem) => {
      articleCache.current.set(article.id, article);
      setSelectedArticleId(article.id);
      if (!article.is_read) {
        handleUpdateArticleState(article, { isRead: true });
      }
    },
    [handleUpdateArticleState]
  );

  const handleToggleRead = useCallback(
    (article: ArticleItem, e?: React.MouseEvent) => {
      if (e) e.stopPropagation();
      handleUpdateArticleState(article, { isRead: !article.is_read });
    },
    [handleUpdateArticleState]
  );

  const handleToggleSaved = useCallback(
    (article: ArticleItem, e?: React.MouseEvent) => {
      if (e) e.stopPropagation();
      handleUpdateArticleState(article, { isSaved: !article.is_saved });
    },
    [handleUpdateArticleState]
  );

  const handleUpdateArticleFields = (
    articleId: string,
    fields: Partial<ArticleItem>
  ) => {
    readerCache?.updateFields(articleId, fields);
    if (fields.published_at) scheduleBootstrap();
    const cached = articleCache.current.get(articleId);
    if (cached) articleCache.current.set(articleId, { ...cached, ...fields });
    setRestoredArticle((prev) => prev?.id === articleId ? { ...prev, ...fields } : prev);
    setArticles((prev) =>
      prev.map((a) => (a.id === articleId ? { ...a, ...fields } : a))
    );
  };

  // The body view is remembered per feed (and per account, on the server).
  const handleChangeViewMode = (feedId: string, viewMode: ArticleViewMode) => {
    readerCache?.updateBootstrap((data) => ({ ...data, subscriptions: data.subscriptions.map((sub) => sub.feed_id === feedId ? { ...sub, view_mode: viewMode } : sub) }));
    setSubscriptions((prev) =>
      prev.map((s) => (s.feed_id === feedId ? { ...s, view_mode: viewMode } : s))
    );
    const pending = apiRequest(`/api/feeds/${feedId}/view-mode`, {
      method: 'PUT',
      body: JSON.stringify({ viewMode }),
    }).catch(() => {
      // keeps the choice for this session; the next bootstrap shows what was saved
    });
    stateWrites.current.set(`view:${feedId}`, pending);
    void pending.finally(() => { if (stateWrites.current.get(`view:${feedId}`) === pending) stateWrites.current.delete(`view:${feedId}`); });
  };

  const handleRefreshFeeds = useCallback(async () => {
    readerCache?.invalidate();
    setRefreshingFeeds(true);
    try {
      await apiRequest('/api/feeds/refresh', {
        method: 'POST',
        body: JSON.stringify({
          feedId: activeScope === 'feed' ? activeFeedId : undefined,
        }),
      });
      readerCache?.invalidate();
      await Promise.all([fetchBootstrap(), fetchArticles()]);
    } catch {
      // ignore
    } finally {
      setRefreshingFeeds(false);
    }
  }, [readerCache, activeScope, activeFeedId, fetchBootstrap, fetchArticles]);

  const handleMarkAllRead = () => {
    setMarkReadError(null);
    setMarkReadTarget({
      scope: activeScope, folderId: activeFolderId, feedId: activeFeedId,
      name: headerInfo.title, searching: Boolean(searchQuery.trim()),
    });
  };

  const confirmMarkAllRead = async () => {
    if (!markReadTarget || markingAllReadRef.current) return;
    markingAllReadRef.current = true;
    setMarkingAllRead(true);
    setMarkReadError(null);
    readerCache?.invalidate();
    try {
      await apiRequest('/api/articles/mark-all-read', {
        method: 'POST',
        body: JSON.stringify({
          scope: markReadTarget.scope,
          folderId: markReadTarget.folderId,
          feedId: markReadTarget.feedId,
        }),
      });
      readerCache?.invalidate();
      await Promise.all([fetchBootstrap(), fetchArticles()]);
      setMarkReadTarget(null);
    } catch {
      setMarkReadError('읽음 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.');
    } finally {
      markingAllReadRef.current = false;
      setMarkingAllRead(false);
    }
  };

  const handleCreateFolder = async (name: string) => {
    readerCache?.invalidate();
    await apiRequest('/api/folders', {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
    readerCache?.invalidate();
    await fetchBootstrap();
  };

  // Deleting a folder or a subscription waits for a confirmation dialog.
  const [deleteTarget, setDeleteTarget] = useState<{ kind: 'folder' | 'feed'; id: string; name: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const handleDeleteFolder = async (folderId: string) => {
    setDeleteError(null);
    setDeleteTarget({ kind: 'folder', id: folderId, name: folders.find((folder) => folder.id === folderId)?.name || '이 폴더' });
  };

  const handleUnsubscribe = async (subscriptionId: string, title: string) => {
    setDeleteError(null);
    setDeleteTarget({ kind: 'feed', id: subscriptionId, name: title });
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    setDeleteError(null);
    readerCache?.invalidate();
    try {
      if (deleteTarget.kind === 'folder') {
        await apiRequest(`/api/folders/${deleteTarget.id}`, { method: 'DELETE' });
        readerCache?.invalidate();
        if (activeFolderId === deleteTarget.id) handleSelectScope('all', null, null);
        await fetchBootstrap();
      } else {
        const feedId = subscriptions.find((sub) => sub.id === deleteTarget.id)?.feed_id;
        await apiRequest(`/api/subscriptions/${deleteTarget.id}`, { method: 'DELETE' });
        readerCache?.invalidate();
        if (activeScope === 'feed' && feedId && activeFeedId === feedId) handleSelectScope('all', null, null);
        await Promise.all([fetchBootstrap(), fetchArticles()]);
      }
      setDeleteTarget(null);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : '삭제하지 못했습니다.');
    } finally {
      setDeleting(false);
    }
  };

  const handleLogout = async () => {
    const flushed = readerCache?.close();
    activeCache.current = null;
    try {
      await apiRequest('/api/user/logout', { method: 'POST' });
    } catch {
      // ignore
    }
    setStoredToken(null);
    authenticatedToken.current = null;
    await flushed;
    setUser(null);
    setArticles([]);
    setFolders([]);
    setSubscriptions([]);
    setCounts({ totalUnread: 0, totalArticles: 0, savedCount: 0, todayCount: 0, todayTotal: 0 });
    setActiveScope('all'); setActiveFeedId(null); setActiveFolderId(null); setSearchQuery(''); setSavedOnly(false);
    setMobileSidebarOpen(isMobile);
    setLoadingBootstrap(true);
    setSelectedArticleId(null);
  };

  const selectedArticle = useMemo(
    () => articles.find((a) => a.id === selectedArticleId) || (selectedArticleId ? articleCache.current.get(selectedArticleId) : null) || (restoredArticle?.id === selectedArticleId ? restoredArticle : null) || null,
    [articles, selectedArticleId, restoredArticle]
  );
  const selectedViewMode: ArticleViewMode =
    subscriptions.find((s) => s.feed_id === selectedArticle?.feed_id)?.view_mode ?? 'feed';

  const selectedIndex = useMemo(
    () => articles.findIndex((a) => a.id === selectedArticleId),
    [articles, selectedArticleId]
  );

  const handleNavigateRelative = useCallback(
    (direction: 'prev' | 'next') => {
      if (articles.length === 0) return;
      if (selectedIndex === -1) {
        handleSelectArticle(articles[0]);
        return;
      }
      const nextIdx =
        direction === 'next'
          ? Math.min(articles.length - 1, selectedIndex + 1)
          : Math.max(0, selectedIndex - 1);
      if (nextIdx !== selectedIndex) {
        handleSelectArticle(articles[nextIdx]);
      }
    },
    [articles, selectedIndex, handleSelectArticle]
  );

  // Global Keyboard Shortcuts (J/K/M/S/R/ESC)
  useEffect(() => {
    if (!user || markReadTarget) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (document.querySelector('dialog[open]')) return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }

      if (e.key === 'Escape') {
        if (selectedArticleId) setSelectedArticleId(null);
        else if (discoverOpen) setDiscoverOpen(false);
      } else if (e.key === 'j' || e.key === 'J') {
        e.preventDefault();
        handleNavigateRelative('next');
      } else if (e.key === 'k' || e.key === 'K') {
        e.preventDefault();
        handleNavigateRelative('prev');
      } else if ((e.key === 'm' || e.key === 'M') && selectedArticle) {
        e.preventDefault();
        handleToggleRead(selectedArticle);
      } else if ((e.key === 's' || e.key === 'S') && selectedArticle) {
        e.preventDefault();
        handleToggleSaved(selectedArticle);
      } else if (e.key === 'r' || e.key === 'R') {
        e.preventDefault();
        handleRefreshFeeds();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    user,
    selectedArticleId,
    selectedArticle,
    discoverOpen,
    markReadTarget,
    handleNavigateRelative,
    handleToggleRead,
    handleToggleSaved,
    handleRefreshFeeds,
  ]);

  const headerInfo = useMemo(() => {
    if (activeScope === 'today') {
      return {
        title: '오늘의 아티클 (Today)',
        subtitle: '최근 24시간 동안 발행된 새로운 소식',
      };
    }
    if (activeScope === 'saved') {
      return {
        title: '나중에 읽기 (Read Later)',
        subtitle: '북마크로 저장해 둔 아티클 모음',
      };
    }
    if (activeScope === 'folder' && activeFolderId) {
      const folder = folders.find((f) => f.id === activeFolderId);
      return {
        title: folder ? folder.name : '폴더',
        subtitle: '카테고리 폴더 내 전체 피드 아티클',
      };
    }
    if (activeScope === 'feed' && activeFeedId) {
      const sub = subscriptions.find((s) => s.feed_id === activeFeedId);
      return {
        title: sub ? sub.title : '피드',
        subtitle: sub?.description || sub?.xml_url || '',
      };
    }
    return {
      title: unreadOnly ? '안 읽은 글' : '전체 피드 (All Feeds)',
      subtitle: `구독 중인 ${subscriptions.length}개 피드의 최신 아티클 스트림`,
    };
  }, [activeScope, activeFolderId, activeFeedId, folders, subscriptions, unreadOnly]);

  if (authChecking) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center text-slate-400 text-sm">
        SFeed 워크스페이스를 불러오는 중...
      </div>
    );
  }

  if (!user) {
    return (
      <LoginView
        theme={theme}
        onChangeTheme={handleChangeTheme}
        onLoginSuccess={(loggedInUser) => {
          authenticatedToken.current = getStoredToken();
          setUser(loggedInUser);
          setLayout(loggedInUser.preferences.layout);
          setTheme(loggedInUser.preferences.theme);
          setUnreadOnly(loggedInUser.preferences.unreadOnly);
        }}
      />
    );
  }

  const isDark = theme === 'dark';
  const mobileTab: LibraryTab = activeScope === 'saved' || savedOnly ? 'saved' : unreadOnly ? 'unread' : 'all';
  const openMobileDiscover = (tab: 'curated' | 'opml' = 'curated') => { setDiscoverTab(tab); setDiscoverOpen(true); };
  const selectMobileTab = (tab: LibraryTab) => { setSearchQuery(''); setSavedOnly(false); handleSelectLibraryTab(tab); setMobileSidebarOpen(false); };
  // The dock tabs filter what is on screen instead of opening another list:
  // on the library they switch which count each feed shows, and inside a
  // folder or feed they filter that list.
  const applyMobileFilter = (tab: LibraryTab) => {
    if (activeScope === 'saved') setActiveScope('all');
    const unread = tab === 'unread';
    setSavedOnly(tab === 'saved');
    if (tab !== 'saved' && unread !== unreadOnly) {
      setUnreadOnly(unread);
      savePreferences({ unreadOnly: unread });
    }
    setSelectedArticleId(null);
  };
  const filterMobileList = (tab: LibraryTab) => {
    if (activeScope === 'folder' || activeScope === 'feed') applyMobileFilter(tab);
    else selectMobileTab(tab);
  };
  const mobileSettings = { theme, onChangeTheme: handleChangeTheme, layout, onChangeLayout: handleChangeLayout, onOpenOpml: () => openMobileDiscover('opml') };

  return (
    <>
      <ResizableWorkspace
        key={user.id}
        userId={user.id}
        isDark={isDark}
        inactive={isMobile && mobileSidebarOpen}
        mobileReaderOpen={isMobile && Boolean(selectedArticle)}
        listRef={articleListRef}
        sidebar={
          <Sidebar
            user={user}
            folders={folders}
            subscriptions={subscriptions}
            counts={counts}
            unreadOnly={unreadOnly}
            activeScope={activeScope}
            activeFolderId={activeFolderId}
            activeFeedId={activeFeedId}
            onSelectScope={handleSelectScope}
            onSelectLibraryTab={handleSelectLibraryTab}
            onOpenDiscover={(tab = 'curated') => {
              setDiscoverTab(tab);
              setDiscoverOpen(true);
            }}
            onCreateFolder={handleCreateFolder}
            onDeleteFolder={handleDeleteFolder}
            onUnsubscribe={handleUnsubscribe}
            onLogout={handleLogout}
            isDark={isDark}
            mobileOpen={false}
            onCloseMobile={() => setMobileSidebarOpen(false)}
          />
        }
        header={
          <>
          <div className="lg:hidden"><MobileHeader hidden={chromeHidden} title={headerInfo.title.replace(/\s*\([^)]*\)/g, '')} search={searchQuery} onSearch={setSearchQuery} onBack={() => setMobileSidebarOpen(true)} onAdd={() => openMobileDiscover()} {...mobileSettings} /></div>
          <div className="hidden lg:block"><HeaderBar
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            layout={layout}
            onChangeLayout={handleChangeLayout}
            theme={theme}
            onChangeTheme={handleChangeTheme}
            onRefresh={handleRefreshFeeds}
            refreshing={refreshingFeeds}
            onMarkAllRead={handleMarkAllRead}
            onOpenMobileSidebar={() => setMobileSidebarOpen(true)}
          /></div>
          </>
        }
        reader={
          <ArticleDrawer
            key={selectedArticle?.id || 'empty-reader'}
            article={selectedArticle}
            onClose={() => setSelectedArticleId(null)}
            onToggleRead={handleToggleRead}
            onToggleSaved={handleToggleSaved}
            onUpdateArticleFields={handleUpdateArticleFields}
            viewMode={selectedViewMode}
            onChangeViewMode={(mode) => selectedArticle && handleChangeViewMode(selectedArticle.feed_id, mode)}
            onNavigateRelative={handleNavigateRelative}
            hasPrev={selectedIndex > 0}
            hasNext={selectedIndex >= 0 && selectedIndex < articles.length - 1}
            isDark={isDark}
          />
        }
        footer={
          <footer
            className={`hidden lg:flex shrink-0 flex-wrap gap-2 items-center justify-between px-8 py-2 border-t text-[11px] ${
              isDark
                ? 'bg-slate-950 border-slate-900 text-slate-500'
                : 'bg-white border-slate-200 text-slate-400'
            }`}
          >
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <span>
                <strong className="text-slate-400">J / K</strong> 이전·다음 아티클
              </span>
              <span>
                <strong className="text-slate-400">M</strong> 읽음/안읽음 토글
              </span>
              <span>
                <strong className="text-slate-400">S</strong> 나중에 읽기 북마크
              </span>
              <span>
                <strong className="text-slate-400">R</strong> 피드 새로고침
              </span>
              <span>
                <strong className="text-slate-400">ESC</strong> 리더 뷰 닫기
              </span>
            </div>
            <div>Cloudflare Workers · D1 SQLite · Workers AI</div>
          </footer>
        }
      >
        <ArticleList
          articles={articles}
          layout={layout}
          selectedArticleId={selectedArticleId}
          onSelectArticle={handleSelectArticle}
          onToggleRead={handleToggleRead}
          onToggleSaved={handleToggleSaved}
          onOpenDiscover={() => {
            setDiscoverTab('curated');
            setDiscoverOpen(true);
          }}
          isDark={isDark}
          loading={loadingArticles || loadingBootstrap}
          hasSubscriptions={subscriptions.length > 0}
        />
        {hasMoreArticles && articles.length > 0 && !loadingArticles && !loadingBootstrap && (
          <LoadMoreArticles
            loading={loadingMoreArticles}
            isDark={isDark}
            onLoadMore={loadMoreArticles}
          />
        )}
      </ResizableWorkspace>

      {isMobile && <div className="sfeed-mobile-library-host" data-open={mobileSidebarOpen || undefined}><MobileLibrary visible={mobileSidebarOpen} user={user} folders={folders} subscriptions={subscriptions} counts={counts} countTab={mobileTab} onChangeCountTab={applyMobileFilter} onSelectTab={selectMobileTab} onSelectFolder={(id) => { setSearchQuery(''); handleSelectScope('folder', id); setMobileSidebarOpen(false); }} onSelectFeed={(id) => { setSearchQuery(''); handleSelectScope('feed', null, id); setMobileSidebarOpen(false); }} onAdd={() => openMobileDiscover()} onRefresh={handleRefreshFeeds} refreshing={refreshingFeeds} onCreateFolder={handleCreateFolder} onDeleteFolder={handleDeleteFolder} onUnsubscribe={handleUnsubscribe} onLogout={handleLogout} {...mobileSettings} /></div>}
      {!mobileSidebarOpen && !selectedArticle && <MobileDock hidden={chromeHidden} active={mobileTab} onSelect={filterMobileList} onRefresh={handleRefreshFeeds} refreshing={refreshingFeeds} onMarkAllRead={handleMarkAllRead} onAdd={() => openMobileDiscover()} />}

      {markReadTarget && (
        <MarkAllReadDialog
          scopeName={markReadTarget.name}
          searching={markReadTarget.searching}
          isDark={isDark}
          busy={markingAllRead}
          error={markReadError}
          onCancel={() => { if (!markingAllRead) setMarkReadTarget(null); }}
          onConfirm={confirmMarkAllRead}
        />
      )}

      {deleteTarget && (
        <ConfirmDialog
          title={deleteTarget.kind === 'folder' ? '폴더를 삭제할까요?' : '구독을 취소할까요?'}
          confirmLabel={deleteTarget.kind === 'folder' ? '폴더 삭제' : '구독 취소'}
          busyLabel="삭제 중…"
          tone="danger"
          isDark={isDark}
          busy={deleting}
          error={deleteError}
          onCancel={() => { if (!deleting) setDeleteTarget(null); }}
          onConfirm={confirmDelete}
        >
          {deleteTarget.kind === 'folder' ? (
            <p><strong>{deleteTarget.name}</strong> 폴더를 삭제합니다. 안에 있던 피드 {subscriptions.filter((sub) => sub.folder_id === deleteTarget.id).length}개는 구독을 유지한 채 미분류로 옮겨집니다.</p>
          ) : (
            <p><strong>{deleteTarget.name}</strong> 피드를 목록에서 뺍니다. 나중에 다시 구독하면 지금까지의 글과 읽음·저장 기록이 그대로 돌아옵니다.</p>
          )}
        </ConfirmDialog>
      )}

      {/* Discover / Add Feed / OPML Modal */}
      <DiscoverModal
        isOpen={discoverOpen}
        initialTab={discoverTab}
        onClose={() => setDiscoverOpen(false)}
        curatedFeeds={curatedFeeds}
        folders={folders}
        subscriptions={subscriptions}
        onSubscribed={async () => {
          readerCache?.invalidate();
          await Promise.all([fetchBootstrap(), fetchArticles()]);
        }}
        isDark={isDark}
      />
    </>
  );
};
