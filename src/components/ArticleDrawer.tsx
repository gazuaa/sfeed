import React, { useEffect, useState } from 'react';
import {
  X,
  Bookmark,
  CheckCircle2,
  Circle,
  Sparkles,
  BookOpen,
  ExternalLink,
  ChevronLeft,
  ChevronRight,
  Globe,
  Loader2,
  RefreshCw,
  Rss,
  Type,
} from 'lucide-react';
import {
  apiRequest,
  formatRelativeTime,
  type ArticleItem,
  type ArticleViewMode as ViewMode,
} from '../client/api';

const VIEW_MODES = [
  { id: 'feed', label: '피드', title: '피드 본문 — RSS에 담긴 내용', Icon: Rss },
  { id: 'reader', label: '리더', title: '전체 본문 — 원문에서 본문만 깔끔하게', Icon: BookOpen },
  { id: 'web', label: '웹', title: '웹 페이지 — 원본 사이트 그대로', Icon: Globe },
] as const;

interface ArticleDrawerProps {
  article: ArticleItem | null;
  onClose: () => void;
  onToggleRead: (article: ArticleItem) => void;
  onToggleSaved: (article: ArticleItem) => void;
  onUpdateArticleFields: (
    articleId: string,
    fields: Partial<ArticleItem>
  ) => void;
  // Body view remembered for this article's feed.
  viewMode: ViewMode;
  onChangeViewMode: (mode: ViewMode) => void;
  onNavigateRelative: (direction: 'prev' | 'next') => void;
  hasPrev: boolean;
  hasNext: boolean;
  isDark: boolean;
}

export const ArticleDrawer: React.FC<ArticleDrawerProps> = ({
  article,
  onClose,
  onToggleRead,
  onToggleSaved,
  onUpdateArticleFields,
  viewMode,
  onChangeViewMode,
  onNavigateRelative,
  hasPrev,
  hasNext,
  isDark,
}) => {
  const [readerFailedFor, setReaderFailedFor] = useState<string | null>(null);
  const [frame, setFrame] = useState<{ articleId: string; embeddable: boolean; url: string } | null>(null);
  const [checkingDate, setCheckingDate] = useState(false);
  const [scrapingReader, setScrapingReader] = useState(false);
  const [summarizing, setSummarizing] = useState(false);
  const [aiMeta, setAiMeta] = useState<{ provider?: string; model?: string } | null>(
    null
  );
  const [fontSize, setFontSize] = useState<'sm' | 'base' | 'lg'>('base');

  // Reader view: extract the full article once; the server caches it.
  useEffect(() => {
    if (!article || viewMode !== 'reader' || article.full_content_html || readerFailedFor === article.id) return;
    let active = true;
    setScrapingReader(true);
    apiRequest<{ fullContentHtml: string; publishedAt?: string }>(`/api/articles/${article.id}/reader-view`, {
      method: 'POST',
      body: JSON.stringify({}),
    })
      .then((res) => {
        if (!active) return;
        onUpdateArticleFields(article.id, {
          full_content_html: res.fullContentHtml,
          ...(res.publishedAt ? { published_at: res.publishedAt } : {}),
        });
      })
      .catch(() => { if (active) setReaderFailedFor(article.id); })
      .finally(() => { if (active) setScrapingReader(false); });
    return () => { active = false; setScrapingReader(false); };
  }, [article?.id, viewMode]);

  // Web view: ask the server whether the site allows being framed.
  useEffect(() => {
    if (!article || viewMode !== 'web' || frame?.articleId === article.id) return;
    let active = true;
    apiRequest<{ embeddable: boolean; url: string }>(`/api/articles/${article.id}/embeddable`)
      .then((res) => { if (active) setFrame({ articleId: article.id, ...res }); })
      .catch(() => { if (active) setFrame({ articleId: article.id, embeddable: true, url: article.url }); });
    return () => { active = false; };
  }, [article?.id, viewMode]);

  useEffect(() => {
    if (!article || article.date_source === 'original') { setCheckingDate(false); return; }
    let active = true;
    setCheckingDate(true);
    apiRequest<{ publishedAt: string; dateSource: ArticleItem['date_source'] }>(`/api/articles/${article.id}/publication-date`, { method: 'POST' })
      .then((result) => { if (active) onUpdateArticleFields(article.id, { published_at: result.publishedAt, date_source: result.dateSource }); })
      .catch(() => {})
      .finally(() => { if (active) setCheckingDate(false); });
    return () => { active = false; };
  }, [article?.id]);

  if (!article) return <div className={`hidden lg:flex h-full flex-col items-center justify-center gap-3 px-8 text-center ${isDark ? 'bg-slate-950 text-slate-400' : 'bg-white text-slate-500'}`}>
    <BookOpen className="w-10 h-10 text-emerald-500/60" aria-hidden="true" />
    <h2 className="text-base font-semibold">읽을 글을 선택해 주세요</h2>
    <p className="text-sm">왼쪽 목록에서 글을 누르면 여기에 표시됩니다.</p>
  </div>;

  const chooseViewMode = (mode: ViewMode) => {
    if (mode === 'reader') setReaderFailedFor(null);
    onChangeViewMode(mode);
  };

  const showingReader = viewMode === 'reader' && Boolean(article.full_content_html);
  const readerFailed = viewMode === 'reader' && readerFailedFor === article.id;

  const handleSummarizeAI = async (force = false) => {
    setSummarizing(true);
    try {
      const res = await apiRequest<{
        aiSummary: string;
        provider: string;
        model: string;
      }>(`/api/articles/${article.id}/summarize`, {
        method: 'POST',
        body: JSON.stringify({ force }),
      });
      onUpdateArticleFields(article.id, {
        ai_summary: res.aiSummary,
      });
      setAiMeta({ provider: res.provider, model: res.model });
    } catch {
      // ignore
    } finally {
      setSummarizing(false);
    }
  };

  const cycleFontSize = () => {
    setFontSize((prev) => (prev === 'sm' ? 'base' : prev === 'base' ? 'lg' : 'sm'));
  };

  const activeHtml =
    showingReader && article.full_content_html
      ? article.full_content_html
      : article.content_html || `<p>${article.summary || article.title}</p>`;

  const fontSizeClass =
    fontSize === 'sm'
      ? 'text-sm'
      : fontSize === 'lg'
      ? 'text-lg'
      : 'text-base';

  return (
    <div className="sfeed-article-reader fixed inset-0 z-50 lg:relative lg:inset-auto lg:z-auto h-full min-w-0 min-h-0 flex justify-end">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-xs transition-opacity lg:hidden"
        onClick={onClose}
      />

      {/* Inline desktop reader and full-screen mobile reader */}
      <div
        className={`sfeed-reader relative z-10 w-full max-w-3xl lg:max-w-none h-full min-w-0 min-h-0 flex flex-col border-l lg:border-l-0 shadow-2xl lg:shadow-none overflow-hidden ${
          isDark
            ? 'bg-slate-950 border-slate-800 text-slate-100'
            : 'bg-white border-slate-200 text-slate-900'
        }`}
      >
        {/* Top Action Bar */}
        <div
          className={`sfeed-reader-toolbar px-4 sm:px-6 py-3 border-b flex flex-wrap items-center justify-between gap-2 shrink-0 ${
            isDark
              ? 'bg-slate-900/90 border-slate-800'
              : 'bg-slate-50 border-slate-200'
          }`}
        >
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={onClose}
              title="닫기 (ESC)"
              className={`p-2 rounded-xl border transition cursor-pointer ${
                isDark
                  ? 'border-slate-800 text-slate-300 hover:bg-slate-800'
                  : 'border-slate-200 text-slate-700 hover:bg-slate-200/70'
              }`}
            >
              <X className="w-4 h-4" />
            </button>

            <div className="flex items-center gap-1 ml-1">
              <button
                type="button"
                disabled={!hasPrev}
                onClick={() => onNavigateRelative('prev')}
                title="이전 아티클 (K)"
                className={`p-2 rounded-xl border transition cursor-pointer disabled:opacity-30 ${
                  isDark
                    ? 'border-slate-800 text-slate-300 hover:bg-slate-800'
                    : 'border-slate-200 text-slate-700 hover:bg-slate-200/70'
                }`}
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                type="button"
                disabled={!hasNext}
                onClick={() => onNavigateRelative('next')}
                title="다음 아티클 (J)"
                className={`p-2 rounded-xl border transition cursor-pointer disabled:opacity-30 ${
                  isDark
                    ? 'border-slate-800 text-slate-300 hover:bg-slate-800'
                    : 'border-slate-200 text-slate-700 hover:bg-slate-200/70'
                }`}
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Right Reader Controls */}
          <div className="flex flex-wrap items-center gap-1.5">
            {/* Body view: feed content / reader (full article) / web page */}
            <div
              role="radiogroup"
              aria-label="본문 보기 방식"
              className={`flex items-center rounded-xl border p-0.5 ${
                isDark ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'
              }`}
            >
              {VIEW_MODES.map(({ id, label, title, Icon }) => {
                const selected = viewMode === id;
                return (
                  <button
                    key={id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    title={title}
                    onClick={() => chooseViewMode(id)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-medium flex items-center gap-1 transition cursor-pointer ${
                      selected
                        ? isDark
                          ? 'bg-slate-700 text-white'
                          : 'bg-slate-900 text-white'
                        : isDark
                        ? 'text-slate-400 hover:text-white'
                        : 'text-slate-500 hover:text-slate-900'
                    }`}
                  >
                    {id === 'reader' && scrapingReader ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Icon className="w-3.5 h-3.5" />
                    )}
                    <span className="sfeed-reader-control-label">{label}</span>
                  </button>
                );
              })}
            </div>

            {/* AI Summary Trigger */}
            {viewMode !== 'web' && <button
              type="button"
              onClick={() => handleSummarizeAI(false)}
              disabled={summarizing}
              aria-label={article.ai_summary ? 'AI 요약 완료' : 'AI 핵심 요약'}
              title="AI 핵심 요약"
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 border transition cursor-pointer ${
                article.ai_summary
                  ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-400'
                  : 'bg-emerald-500 hover:bg-emerald-400 border-emerald-500 text-slate-950 shadow-xs'
              }`}
            >
              {summarizing ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Sparkles className="w-3.5 h-3.5" />
              )}
              <span className="sfeed-reader-control-label">{article.ai_summary ? 'AI 요약 완료' : 'AI 핵심 요약'}</span>
            </button>}

            {/* Read/Unread Toggle */}
            <button
              type="button"
              onClick={() => onToggleRead(article)}
              title={article.is_read ? '안읽음으로 표시 (M)' : '읽음으로 표시 (M)'}
              className={`p-2 rounded-xl border transition cursor-pointer ${
                isDark
                  ? 'bg-slate-900 border-slate-800 text-slate-300 hover:bg-slate-800'
                  : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-100'
              }`}
            >
              {article.is_read ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              ) : (
                <Circle className="w-4 h-4" />
              )}
            </button>

            {/* Save / Bookmark Toggle */}
            <button
              type="button"
              onClick={() => onToggleSaved(article)}
              title="나중에 읽기 북마크 (S)"
              className={`p-2 rounded-xl border transition cursor-pointer ${
                article.is_saved
                  ? 'bg-indigo-500/15 border-indigo-500/40 text-indigo-400'
                  : isDark
                  ? 'bg-slate-900 border-slate-800 text-slate-300 hover:bg-slate-800'
                  : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-100'
              }`}
            >
              <Bookmark
                className={`w-4 h-4 ${article.is_saved ? 'fill-current' : ''}`}
              />
            </button>

            {/* Font Size Toggle */}
            {viewMode !== 'web' && <button
              type="button"
              onClick={cycleFontSize}
              title="글자 크기 변경"
              className={`p-2 rounded-xl border transition cursor-pointer ${
                isDark
                  ? 'bg-slate-900 border-slate-800 text-slate-300 hover:bg-slate-800'
                  : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-100'
              }`}
            >
              <Type className="w-4 h-4" />
            </button>}

            {/* Open Original Link */}
            <a
              href={article.url}
              target="_blank"
              rel="noopener noreferrer"
              title="원문 사이트 새 탭에서 열기"
              className={`p-2 rounded-xl border transition ${
                isDark
                  ? 'bg-slate-900 border-slate-800 text-slate-300 hover:bg-slate-800 hover:text-emerald-400'
                  : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-100'
              }`}
            >
              <ExternalLink className="w-4 h-4" />
            </a>
          </div>
        </div>

        {viewMode === 'web' ? (
          <div className="flex-1 min-h-0 flex flex-col">
            {!frame || frame.articleId !== article.id ? (
              <div className="flex-1 flex items-center justify-center gap-2 text-sm text-slate-400">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>원본 사이트를 여는 중…</span>
              </div>
            ) : frame.embeddable ? (
              <>
                <div
                  className={`px-4 py-1.5 border-b text-[11px] flex items-center justify-between gap-2 shrink-0 ${
                    isDark ? 'border-slate-800 text-slate-400' : 'border-slate-200 text-slate-500'
                  }`}
                >
                  <span className="truncate min-w-0">{frame.url}</span>
                  <a
                    href={frame.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="shrink-0 inline-flex items-center gap-1 hover:underline"
                  >
                    사이트가 보이지 않으면 새 창에서 열기
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
                <iframe
                  key={article.id}
                  src={frame.url}
                  title={article.title}
                  className="flex-1 w-full min-h-0 border-0 bg-white"
                  sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-forms"
                  referrerPolicy="strict-origin-when-cross-origin"
                />
              </>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center gap-4 px-8 text-center">
                <Globe className="w-9 h-9 text-slate-400" aria-hidden="true" />
                <p className={`text-sm ${isDark ? 'text-slate-300' : 'text-slate-600'}`}>
                  이 사이트는 다른 서비스 안에서 열리지 않도록 막아 두었어요.
                </p>
                <div className="flex flex-wrap items-center justify-center gap-2">
                  <a
                    href={frame.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-semibold inline-flex items-center gap-1.5 transition"
                  >
                    새 창에서 열기
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                  <button
                    type="button"
                    onClick={() => chooseViewMode('reader')}
                    className={`px-4 py-2 rounded-xl border text-xs font-medium inline-flex items-center gap-1.5 transition cursor-pointer ${
                      isDark
                        ? 'border-slate-700 text-slate-200 hover:bg-slate-800'
                        : 'border-slate-200 text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    <BookOpen className="w-3.5 h-3.5" />
                    리더로 보기
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : (
        <div tabIndex={0} aria-label="본문 내용" className="sfeed-reader-content flex-1 min-h-0 overflow-y-auto overscroll-contain px-5 sm:px-8 py-6 space-y-6">
          {/* Article Metadata Header */}
          <div className="space-y-3 border-b pb-6 border-slate-800/60">
            <div className="flex flex-wrap items-center gap-2 text-xs text-emerald-400 font-medium">
              {article.feed_favicon ? (
                <img
                  src={article.feed_favicon}
                  alt=""
                  className="w-4 h-4 rounded-sm"
                />
              ) : (
                <Rss className="w-4 h-4" />
              )}
              <span>{article.feed_title}</span>
              {article.folder_name && (
                <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300">
                  {article.folder_name}
                </span>
              )}
              <span className="text-slate-500">·</span>
              <span className="text-slate-400" title={article.date_source === 'original' ? '원문 발행일' : '피드에서 제공한 발행일'}>
                {checkingDate ? '원문 발행일 확인 중…' : article.date_source === 'updated' || article.date_source === 'collected' ? '발행일 미제공' : <>
                {article.date_source !== 'original' && '피드 제공 · '}
                {new Date(article.published_at).toLocaleString('ko-KR', {
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })}{' '}
                ({formatRelativeTime(article.published_at)})
                </>}
              </span>
              {article.author && (
                <>
                  <span className="text-slate-500">·</span>
                  <span className="text-slate-300">{article.author}</span>
                </>
              )}
            </div>

            <h1
              className={`text-2xl sm:text-3xl font-extrabold leading-tight tracking-tight ${
                isDark ? 'text-white' : 'text-slate-900'
              }`}
            >
              {article.title}
            </h1>
          </div>

          {/* Cloudflare Workers AI Summary Card */}
          {(article.ai_summary || summarizing) && (
            <div
              className={`p-5 rounded-2xl border relative overflow-hidden ${
                isDark
                  ? 'bg-gradient-to-br from-emerald-950/40 via-slate-900 to-slate-900 border-emerald-500/30'
                  : 'bg-emerald-50/70 border-emerald-200'
              }`}
            >
              <div className="flex items-center justify-between gap-2 mb-3">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 rounded-lg bg-emerald-500 text-slate-950">
                    <Sparkles className="w-4 h-4" />
                  </div>
                  <div>
                    <h3
                      className={`text-sm font-bold ${
                        isDark ? 'text-emerald-300' : 'text-emerald-900'
                      }`}
                    >
                      Cloudflare Workers AI 핵심 요약
                    </h3>
                    <p className="text-[11px] text-slate-400">
                      {aiMeta?.model || '@cf/meta/llama-3.1-8b-instruct'}
                    </p>
                  </div>
                </div>

                {!summarizing && (
                  <button
                    type="button"
                    onClick={() => handleSummarizeAI(true)}
                    title="다시 요약하기"
                    className="text-xs text-emerald-400 hover:text-emerald-300 inline-flex items-center gap-1 cursor-pointer"
                  >
                    <RefreshCw className="w-3 h-3" />
                    <span>재생성</span>
                  </button>
                )}
              </div>

              {summarizing ? (
                <div className="py-4 flex items-center gap-2.5 text-xs text-emerald-400">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>
                    Cloudflare Workers AI가 아티클의 핵심 내용을 분석하고 있습니다...
                  </span>
                </div>
              ) : (
                <div
                  className={`text-sm whitespace-pre-line leading-relaxed ${
                    isDark ? 'text-slate-200' : 'text-slate-800'
                  }`}
                >
                  {article.ai_summary}
                </div>
              )}
            </div>
          )}

          {/* Lead Thumbnail Image (if not already embedded in contentHtml) */}
          {article.thumbnail_url &&
            !activeHtml.includes(article.thumbnail_url) && (
              <div className="rounded-2xl overflow-hidden border border-slate-800/60">
                <img
                  src={article.thumbnail_url}
                  alt={article.title}
                  className="w-full max-h-96 object-cover"
                  onError={(e) => {
                    (e.currentTarget as HTMLImageElement).style.display = 'none';
                  }}
                />
              </div>
            )}

          {/* Reader view status: loading, or fell back to the feed body */}
          {viewMode === 'reader' && !showingReader && (scrapingReader || readerFailed) && (
            <div
              className={`px-3.5 py-2 rounded-xl border text-xs flex items-center gap-2 ${
                isDark ? 'border-slate-800 text-slate-400' : 'border-slate-200 text-slate-500'
              }`}
            >
              {scrapingReader ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>원문에서 전체 본문을 불러오는 중이에요. 그동안 피드 본문을 보여드려요.</span>
                </>
              ) : (
                <span>원문 전체 본문을 불러오지 못해 피드 본문을 보여드려요.</span>
              )}
            </div>
          )}

          {/* Main HTML Body */}
          <div
            className={`sfeed-article-content ${fontSizeClass} ${
              isDark ? 'text-slate-200' : 'text-slate-800'
            }`}
            dangerouslySetInnerHTML={{ __html: activeHtml }}
          />

          {/* Bottom Callout to Original Article */}
          <div
            className={`mt-10 pt-6 border-t flex flex-wrap items-center justify-between gap-4 ${
              isDark ? 'border-slate-800' : 'border-slate-200'
            }`}
          >
            <div className="text-xs text-slate-400">
              원문 출처: <span className="font-medium">{article.feed_title}</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <a
                href={article.url}
                target="_blank"
                rel="noopener noreferrer"
                className="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-semibold inline-flex items-center gap-1.5 transition"
              >
                <span>원문 사이트에서 보기</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>
          </div>
        </div>
        )}
      </div>
    </div>
  );
};
