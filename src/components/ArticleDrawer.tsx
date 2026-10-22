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
  Loader2,
  RefreshCw,
  Rss,
  Type,
} from 'lucide-react';
import {
  apiRequest,
  formatRelativeTime,
  type ArticleItem,
} from '../client/api';

interface ArticleDrawerProps {
  article: ArticleItem | null;
  onClose: () => void;
  onToggleRead: (article: ArticleItem) => void;
  onToggleSaved: (article: ArticleItem) => void;
  onUpdateArticleFields: (
    articleId: string,
    fields: Partial<ArticleItem>
  ) => void;
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
  onNavigateRelative,
  hasPrev,
  hasNext,
  isDark,
}) => {
  const [readerMode, setReaderMode] = useState(false);
  const [checkingDate, setCheckingDate] = useState(false);
  const [scrapingReader, setScrapingReader] = useState(false);
  const [summarizing, setSummarizing] = useState(false);
  const [aiMeta, setAiMeta] = useState<{ provider?: string; model?: string } | null>(
    null
  );
  const [fontSize, setFontSize] = useState<'sm' | 'base' | 'lg'>('base');

  useEffect(() => {
    if (article) {
      setReaderMode(Boolean(article.full_content_html));
    }
  }, [article?.id]);

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

  if (!article) return null;

  const handleToggleReaderView = async () => {
    if (readerMode) {
      setReaderMode(false);
      return;
    }

    if (article.full_content_html) {
      setReaderMode(true);
      return;
    }

    setScrapingReader(true);
    try {
      const res = await apiRequest<{
        fullContentHtml: string;
        scrapedFromWeb?: boolean;
        publishedAt?: string;
      }>(`/api/articles/${article.id}/reader-view`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      onUpdateArticleFields(article.id, {
        full_content_html: res.fullContentHtml,
        ...(res.publishedAt ? { published_at: res.publishedAt } : {}),
      });
      setReaderMode(true);
    } catch {
      // ignore
    } finally {
      setScrapingReader(false);
    }
  };

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
    readerMode && article.full_content_html
      ? article.full_content_html
      : article.content_html || `<p>${article.summary || article.title}</p>`;

  const fontSizeClass =
    fontSize === 'sm'
      ? 'text-sm'
      : fontSize === 'lg'
      ? 'text-lg'
      : 'text-base';

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-xs transition-opacity"
        onClick={onClose}
      />

      {/* Slide-over Reader Panel */}
      <div
        className={`sfeed-reader relative z-10 w-full max-w-3xl h-full flex flex-col border-l shadow-2xl overflow-hidden ${
          isDark
            ? 'bg-slate-950 border-slate-800 text-slate-100'
            : 'bg-white border-slate-200 text-slate-900'
        }`}
      >
        {/* Top Action Bar */}
        <div
          className={`sfeed-reader-toolbar px-4 sm:px-6 py-3 border-b flex items-center justify-between gap-2 shrink-0 ${
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
            {/* AI Summary Trigger */}
            <button
              type="button"
              onClick={() => handleSummarizeAI(false)}
              disabled={summarizing}
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
              <span>{article.ai_summary ? 'AI 요약 완료' : 'AI 핵심 요약'}</span>
            </button>

            {/* Full-Text Reader View Scraper Trigger */}
            <button
              type="button"
              onClick={handleToggleReaderView}
              disabled={scrapingReader}
              className={`px-3 py-1.5 rounded-xl text-xs font-medium flex items-center gap-1.5 border transition cursor-pointer ${
                readerMode
                  ? 'bg-blue-500/20 border-blue-500/40 text-blue-400 font-semibold'
                  : isDark
                  ? 'bg-slate-900 border-slate-800 text-slate-300 hover:bg-slate-800'
                  : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-100'
              }`}
            >
              {scrapingReader ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <BookOpen className="w-3.5 h-3.5" />
              )}
              <span>{readerMode ? '원문 리더 뷰 켜짐' : '원문 전체 불러오기'}</span>
            </button>

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
            <button
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
            </button>

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

        {/* Scrollable Article Content Area */}
        <div className="flex-1 overflow-y-auto px-6 sm:px-10 py-8 space-y-6">
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

          {/* Reader View Mode Banner */}
          {readerMode && (
            <div className="px-3.5 py-2 rounded-xl bg-blue-500/10 border border-blue-500/30 text-xs text-blue-300 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <BookOpen className="w-4 h-4 text-blue-400" />
                <span>
                  원문 웹페이지에서 스크래핑한 <strong>Reader View</strong> 전체 본문입니다.
                </span>
              </div>
              <button
                type="button"
                onClick={() => setReaderMode(false)}
                className="underline hover:text-white cursor-pointer"
              >
                기본 RSS 본문 보기
              </button>
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
            <div className="flex items-center gap-2">
              {!readerMode && (
                <button
                  type="button"
                  onClick={handleToggleReaderView}
                  disabled={scrapingReader}
                  className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium inline-flex items-center gap-1.5 transition cursor-pointer"
                >
                  <BookOpen className="w-3.5 h-3.5 text-blue-400" />
                  <span>원문 전체 스크래핑(Reader View)</span>
                </button>
              )}
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
      </div>
    </div>
  );
};
