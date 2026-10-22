import React, { useState } from 'react';
import {
  X,
  Compass,
  Plus,
  Check,
  Search,
  FileCode2,
  Download,
  Loader2,
  FolderPlus,
  Eye,
} from 'lucide-react';
import { FeedPreview } from './FeedPreview';
import { OpmlImporter } from './OpmlImporter';
import { matchesFeedSearch, normalizeFeedUrl } from '../shared/feedDiscovery';
import {
  apiRequest,
  getStoredToken,
  type CuratedFeedItem,
  type FolderItem,
  type SubscriptionItem,
  type FeedPreviewResponse,
} from '../client/api';

interface DiscoverModalProps {
  isOpen: boolean;
  initialTab: 'curated' | 'opml';
  onClose: () => void;
  curatedFeeds: CuratedFeedItem[];
  folders: FolderItem[];
  subscriptions: SubscriptionItem[];
  onSubscribed: () => Promise<void>;
  isDark: boolean;
}

export const DiscoverModal: React.FC<DiscoverModalProps> = ({
  isOpen,
  initialTab,
  onClose,
  curatedFeeds,
  folders,
  subscriptions,
  onSubscribed,
  isDark,
}) => {
  const [tab, setTab] = useState<'curated' | 'opml'>(initialTab);
  const [selectedCategory, setSelectedCategory] = useState<string>('전체');
  const [previewFeed, setPreviewFeed] = useState<CuratedFeedItem | null>(null);
  const bodyRef = React.useRef<HTMLDivElement>(null);
  const [busyUrl, setBusyUrl] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [urlPreview, setUrlPreview] = useState<FeedPreviewResponse | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewRetry, setPreviewRetry] = useState(0);
  const [customTitle, setCustomTitle] = useState('');
  const [selectedFolderId, setSelectedFolderId] = useState<string>('');
  const [newFolderName, setNewFolderName] = useState('');
  const [opmlImporting, setOpmlImporting] = useState(false);
  const [feedback, setFeedback] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  React.useEffect(() => {
    setTab(initialTab);
    setFeedback(null);
    setPreviewFeed(null);
    setQuery('');
    setUrlPreview(null);
    setPreviewError(null);
    setCustomTitle('');
    setSelectedFolderId('');
    setNewFolderName('');
  }, [initialTab, isOpen]);

  const previewUrl = normalizeFeedUrl(query);
  React.useEffect(() => {
    setUrlPreview(null);
    setPreviewError(null);
    setPreviewLoading(false);
    if (!isOpen || tab !== 'curated' || !previewUrl) return;
    const controller = new AbortController();
    setPreviewLoading(true);
    const timer = setTimeout(() => {
      apiRequest<FeedPreviewResponse>('/api/discover/preview', {
        method: 'POST', signal: controller.signal, body: JSON.stringify({ url: previewUrl }),
      }).then((result) => {
        if (!controller.signal.aborted) setUrlPreview(result);
      }).catch((error) => {
        if (!controller.signal.aborted) setPreviewError(error instanceof Error ? error.message : '피드를 불러오지 못했습니다.');
      }).finally(() => {
        if (!controller.signal.aborted) setPreviewLoading(false);
      });
    }, 600);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, previewUrl, previewRetry, isOpen, tab]);

  React.useEffect(() => {
    bodyRef.current?.scrollTo({ top: 0 });
  }, [previewFeed, urlPreview, tab]);

  if (!isOpen) return null;

  const categories = [
    '전체',
    ...Array.from(new Set(curatedFeeds.map((f) => f.category))),
  ];

  const filteredCurated = curatedFeeds.filter((feed) =>
    (selectedCategory === '전체' || feed.category === selectedCategory) && matchesFeedSearch(feed, query));

  const resolvedFeed: CuratedFeedItem | null = urlPreview ? {
    id: `url:${urlPreview.feed.xmlUrl}`, title: urlPreview.feed.title,
    xmlUrl: urlPreview.feed.xmlUrl, htmlUrl: urlPreview.feed.htmlUrl || urlPreview.feed.xmlUrl,
    description: urlPreview.feed.description || '', category: '', tags: [], language: 'KO', folderSuggest: '',
  } : null;
  const shownFeed = resolvedFeed || previewFeed;

  const isSubscribedUrl = (xmlUrl: string) =>
    subscriptions.some(
      (s) => s.xml_url.toLowerCase() === xmlUrl.toLowerCase()
    );

  const handleSubscribeCurated = async (feed: CuratedFeedItem) => {
    setBusyUrl(feed.xmlUrl);
    setFeedback(null);
    try {
      await apiRequest('/api/subscriptions', {
        method: 'POST',
        body: JSON.stringify({
          url: feed.xmlUrl,
          folderName: feed.folderSuggest,
        }),
      });
      await onSubscribed();
      setFeedback({
        type: 'success',
        text: `"${feed.title}" 피드를 [${feed.folderSuggest}] 폴더에 추가했습니다.`,
      });
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : '구독 추가에 실패했습니다.',
      });
    } finally {
      setBusyUrl(null);
    }
  };

  const handleSubscribeCustom = async () => {
    if (!resolvedFeed) return;
    setBusyUrl(resolvedFeed.xmlUrl);
    setFeedback(null);

    try {
      const res = await apiRequest<{ title: string }>('/api/subscriptions', {
        method: 'POST',
        body: JSON.stringify({
          url: resolvedFeed.xmlUrl,
          folderId: selectedFolderId || null,
          folderName: newFolderName.trim() || null,
          customTitle: customTitle.trim() || null,
        }),
      });
      await onSubscribed();
      setFeedback({
        type: 'success',
        text: `"${customTitle.trim() || res.title}" 피드가 성공적으로 구독되었습니다!`,
      });
    } catch (err) {
      setFeedback({
        type: 'error',
        text:
          err instanceof Error
            ? err.message
            : 'RSS 피드를 가져오지 못했습니다.',
      });
    } finally {
      setBusyUrl(null);
    }
  };

  const handleExportOpml = () => {
    const token = getStoredToken();
    const url = `/api/opml/export${
      token ? `?token=${encodeURIComponent(token)}` : ''
    }`;
    window.open(url, '_blank');
  };

  const subscribeButton = (feed: CuratedFeedItem) => {
    const subscribed = isSubscribedUrl(feed.xmlUrl);
    return (
      <button
        type="button"
        disabled={subscribed || busyUrl !== null}
        onClick={() => resolvedFeed?.id === feed.id ? handleSubscribeCustom() : handleSubscribeCurated(feed)}
        className={`relative z-10 pointer-events-auto px-3 py-1.5 rounded-xl text-xs font-semibold inline-flex items-center gap-1 transition cursor-pointer shrink-0 disabled:cursor-default ${
          subscribed
            ? 'bg-emerald-500/15 text-emerald-400'
            : 'bg-emerald-500 hover:bg-emerald-400 text-slate-950'
        }`}
      >
        {busyUrl === feed.xmlUrl ? (
          <><Loader2 className="w-3.5 h-3.5 animate-spin" /><span>구독 중…</span></>
        ) : subscribed ? (
          <><Check className="w-3.5 h-3.5" /><span>구독 중</span></>
        ) : (
          <><Plus className="w-3.5 h-3.5" /><span>구독하기</span></>
        )}
      </button>
    );
  };

  const subscriptionOptions = (
    <details className={`rounded-xl border p-4 ${isDark ? 'border-slate-800' : 'border-slate-200'}`}>
      <summary className="text-xs font-semibold cursor-pointer">구독 설정 (선택사항)</summary>
      <div className="space-y-4 mt-4">
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <label htmlFor="preview-folder" className="block text-xs font-semibold mb-1.5">
              기존 폴더 선택 (선택사항)
            </label>
            <select
              id="preview-folder"
              value={selectedFolderId}
              onChange={(e) => setSelectedFolderId(e.target.value)}
              className={`w-full px-3 py-2.5 rounded-xl text-sm border focus:outline-none focus:border-emerald-500 ${
                isDark
                  ? 'bg-slate-950 border-slate-800 text-white'
                  : 'bg-slate-50 border-slate-300 text-slate-900'
              }`}
            >
              <option value="">미분류 (폴더 없음)</option>
              {folders.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="preview-new-folder" className="block text-xs font-semibold mb-1.5">
              또는 새 폴더 이름으로 생성
            </label>
            <div className="relative">
              <FolderPlus className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                id="preview-new-folder"
                type="text"
                placeholder="예: AI 논문, 개발 블로그..."
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                className={`w-full pl-9 pr-3 py-2.5 rounded-xl text-sm border focus:outline-none focus:border-emerald-500 ${
                  isDark
                    ? 'bg-slate-950 border-slate-800 text-white'
                    : 'bg-slate-50 border-slate-300 text-slate-900'
                }`}
              />
            </div>
          </div>
        </div>

        <div>
          <label htmlFor="preview-custom-title" className="block text-xs font-semibold mb-1.5">
            사용자 지정 피드 이름 (선택사항)
          </label>
          <input
            id="preview-custom-title"
            type="text"
            placeholder="비워두면 RSS 피드 원본 제목을 사용합니다"
            value={customTitle}
            onChange={(e) => setCustomTitle(e.target.value)}
            className={`w-full px-3.5 py-2.5 rounded-xl text-sm border focus:outline-none focus:border-emerald-500 ${
              isDark
                ? 'bg-slate-950 border-slate-800 text-white'
                : 'bg-slate-50 border-slate-300 text-slate-900'
            }`}
          />
        </div>

      </div>
    </details>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="fixed inset-0 bg-black/65 backdrop-blur-xs"
        onClick={() => { if (!opmlImporting) onClose(); }}
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="discovery-title"
        className={`relative z-10 w-full max-w-3xl max-h-[88dvh] rounded-2xl border shadow-2xl flex flex-col overflow-hidden ${
          isDark
            ? 'bg-slate-900 border-slate-800 text-slate-100'
            : 'bg-white border-slate-200 text-slate-900'
        }`}
      >
        {/* Modal Header */}
        <div
          className={`px-4 sm:px-6 py-4 shrink-0 border-b flex items-center justify-between gap-3 ${
            isDark ? 'border-slate-800 bg-slate-950/60' : 'border-slate-200 bg-slate-50'
          }`}
        >
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/15 text-emerald-400 flex items-center justify-center">
              <Compass className="w-5 h-5" />
            </div>
            <div>
              <h2 id="discovery-title" className="text-base font-bold">
                피드 추가
              </h2>
              <p className="text-xs text-slate-400">
                피드 이름이나 RSS·웹사이트 주소를 검색하고 미리본 뒤 구독하세요
              </p>
            </div>
          </div>

          <button
            type="button"
            aria-label="닫기"
            disabled={opmlImporting}
            onClick={() => { if (!opmlImporting) onClose(); }}
            className="p-2 rounded-lg text-slate-400 hover:text-white cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Tabs */}
        <div
          className={`px-4 sm:px-6 pt-3 shrink-0 border-b flex items-center gap-2 ${
            isDark ? 'border-slate-800' : 'border-slate-200'
          }`}
        >
          <button
            type="button"
            disabled={opmlImporting}
            onClick={() => { setTab('curated'); setPreviewFeed(null); }}
            className={`px-3 sm:px-4 py-2.5 shrink-0 whitespace-nowrap text-xs font-semibold border-b-2 flex items-center gap-1.5 transition cursor-pointer ${
              tab === 'curated'
                ? 'border-emerald-500 text-emerald-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Compass className="w-4 h-4" />
            <span>피드 검색 · 추가</span>
          </button>

          <button
            type="button"
            disabled={opmlImporting}
            onClick={() => setTab('opml')}
            className={`px-3 sm:px-4 py-2.5 shrink-0 whitespace-nowrap text-xs font-semibold border-b-2 flex items-center gap-1.5 transition cursor-pointer ${
              tab === 'opml'
                ? 'border-emerald-500 text-emerald-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <FileCode2 className="w-4 h-4" />
            <span>OPML<span className="hidden sm:inline"> 가져오기 / 내보내기</span></span>
          </button>
        </div>

        {/* Feedback Banner */}
        {feedback && (
          <div
            className={`mx-6 mt-4 p-3 rounded-xl text-xs font-medium border ${
              feedback.type === 'success'
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                : 'bg-rose-500/10 border-rose-500/30 text-rose-300'
            }`}
          >
            {feedback.text}
          </div>
        )}

        {/* Modal Body */}
        <div ref={bodyRef} className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-6">
          {/* Unified feed search and URL preview */}
          {tab === 'curated' && <form role="search" aria-label="피드 검색" onSubmit={(event) => { event.preventDefault(); if (previewUrl) setPreviewRetry((value) => value + 1); }} className="mb-5">
            <label htmlFor="feed-discovery-search" className="sr-only">피드 이름 또는 RSS·웹사이트 주소</label>
            <div className="relative">
              <Search aria-hidden="true" className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input id="feed-discovery-search" type="search" value={query} disabled={busyUrl !== null} onChange={(event) => { setQuery(event.target.value); setPreviewFeed(null); setUrlPreview(null); setPreviewError(null); setFeedback(null); }} placeholder="피드 이름 검색 또는 RSS·웹사이트 URL 입력" autoComplete="off" className={`w-full pl-10 pr-4 py-3 rounded-xl text-sm border focus:outline-none focus:border-emerald-500 ${isDark ? 'bg-slate-950 border-slate-800 text-white' : 'bg-slate-50 border-slate-300 text-slate-900'}`} />
            </div>
            <p className="text-[11px] text-slate-400 mt-2">이름으로 추천 피드를 찾거나, 주소를 입력해 최근 글을 미리보세요.</p>
          </form>}
          {tab === 'curated' && (
            shownFeed ? (
              <FeedPreview
                key={shownFeed.id}
                feed={shownFeed}
                preview={urlPreview || undefined}
                subscriptionOptions={resolvedFeed ? subscriptionOptions : undefined}
                onBack={() => { setPreviewFeed(null); if (resolvedFeed) { setQuery(''); setUrlPreview(null); } }}
                subscribeButton={subscribeButton(shownFeed)}
                isDark={isDark}
              />
            ) : previewUrl ? (
              <div aria-live="polite" aria-busy={previewLoading} className="py-10 text-center">
                {previewLoading ? <p role="status" className="inline-flex items-center gap-2 text-sm text-slate-400"><Loader2 className="w-5 h-5 animate-spin" />피드를 찾고 최근 글을 불러오는 중입니다…</p> : previewError ? <><p role="alert" className="text-sm text-rose-500">{previewError}</p><button type="button" onClick={() => setPreviewRetry((value) => value + 1)} className="mt-3 px-3 py-2 rounded-lg text-xs text-emerald-500 border border-emerald-500/40 cursor-pointer">다시 시도</button></> : null}
              </div>
            ) : <div className="space-y-5">
              {/* Category Filter Pills */}
              <div className="flex flex-wrap gap-2">
                {categories.map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setSelectedCategory(cat)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-medium transition cursor-pointer ${
                      selectedCategory === cat
                        ? 'bg-emerald-500 text-slate-950 font-semibold'
                        : isDark
                        ? 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                        : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>

              <div className="grid sm:grid-cols-2 gap-3.5">
                {filteredCurated.length === 0 && <p className="sm:col-span-2 py-10 text-center text-sm text-slate-400">검색 결과가 없습니다. RSS 또는 웹사이트 주소로도 찾아보세요.</p>}
                {filteredCurated.map((feed) => {
                  return (
                    <div
                      key={feed.id}
                      className={`relative group p-4 rounded-2xl border flex flex-col justify-between gap-3 transition hover:border-emerald-500/50 ${
                        isDark
                          ? 'bg-slate-950/60 border-slate-800'
                          : 'bg-slate-50 border-slate-200'
                      }`}
                    >
                      <button
                        type="button"
                        aria-label={`${feed.title} 미리보기`}
                        onClick={() => setPreviewFeed(feed)}
                        className="absolute inset-0 rounded-2xl cursor-pointer focus-visible:outline-2 focus-visible:outline-emerald-500 focus-visible:outline-offset-2"
                      />
                      <div className="relative pointer-events-none">
                        <div className="flex items-start justify-between gap-2 mb-1.5">
                          <div className="flex items-center gap-2 min-w-0">
                            <img
                              src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(
                                new URL(feed.htmlUrl).hostname
                              )}&sz=64`}
                              alt=""
                              className="w-4 h-4 rounded-sm shrink-0"
                            />
                            <h3 className="font-bold text-sm truncate">
                              {feed.title}
                            </h3>
                          </div>
                          <span
                            className={`text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 ${
                              feed.language === 'KO'
                                ? 'bg-emerald-500/15 text-emerald-400'
                                : 'bg-blue-500/15 text-blue-400'
                            }`}
                          >
                            {feed.language}
                          </span>
                        </div>

                        <p className="text-xs text-slate-400 leading-relaxed mb-3">
                          {feed.description}
                        </p>
                        <span className="inline-flex items-center gap-1 text-[11px] text-emerald-500 group-hover:text-emerald-400">
                          <Eye className="w-3.5 h-3.5" /> 최근 글 미리보기
                        </span>
                      </div>

                      <div className="relative pointer-events-none flex items-center justify-between gap-2 pt-2 border-t border-slate-800/50">
                        <div className="flex flex-wrap gap-1">
                          {feed.tags.slice(0, 3).map((tag) => (
                            <span
                              key={tag}
                              className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800/80 text-slate-400"
                            >
                              #{tag}
                            </span>
                          ))}
                        </div>

                        {subscribeButton(feed)}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* TAB 3: OPML Import / Export */}
          <div className={tab === 'opml' ? 'space-y-6' : 'hidden'}>
              {/* Export Card */}
              <div
                className={`p-4 rounded-2xl border flex flex-col sm:flex-row sm:items-center justify-between gap-4 ${
                  isDark
                    ? 'bg-slate-950/60 border-slate-800'
                    : 'bg-slate-50 border-slate-200'
                }`}
              >
                <div>
                  <h3 className="text-sm font-bold mb-1">
                    내 구독 목록 OPML 내보내기 (Export)
                  </h3>
                  <p className="text-xs text-slate-400">
                    현재 구독 중인 모든 폴더와 RSS 피드 목록을 표준 OPML 2.0 XML 파일로
                    다운로드합니다.
                  </p>
                </div>
                <button
                  type="button"
                  disabled={opmlImporting}
                  onClick={handleExportOpml}
                  className="px-4 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold text-xs inline-flex items-center gap-1.5 shrink-0 cursor-pointer"
                >
                  <Download className="w-4 h-4" />
                  <span>OPML 다운로드 (.opml)</span>
                </button>
              </div>

              <OpmlImporter
                isDark={isDark}
                onBusyChange={setOpmlImporting}
                onSubscribed={onSubscribed}
              />
          </div>
        </div>
      </div>
    </div>
  );
};
