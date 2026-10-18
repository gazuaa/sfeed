import React, { useEffect, useState } from 'react';
import { ArrowLeft, ExternalLink, Loader2, Rss } from 'lucide-react';
import {
  apiRequest,
  formatRelativeTime,
  type CuratedFeedItem,
  type FeedPreviewResponse,
} from '../client/api';

interface FeedPreviewProps {
  feed: CuratedFeedItem;
  onBack: () => void;
  subscribeButton: React.ReactNode;
  isDark: boolean;
}

export const FeedPreview: React.FC<FeedPreviewProps> = ({
  feed,
  onBack,
  subscribeButton,
  isDark,
}) => {
  const [articles, setArticles] = useState<FeedPreviewResponse['articles']>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setArticles([]);
    apiRequest<FeedPreviewResponse>(
      `/api/discover/feeds/${encodeURIComponent(feed.id)}/preview`,
      { signal: controller.signal }
    )
      .then((result) => {
        if (!controller.signal.aborted) setArticles(result.articles);
      })
      .catch((err) => {
        if (!controller.signal.aborted) {
          setError(err instanceof Error ? err.message : '최근 글을 불러오지 못했습니다.');
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [feed.id, retry]);

  return (
    <section className="space-y-5" aria-label={`${feed.title} 미리보기`}>
      <button
        type="button"
        autoFocus
        onClick={onBack}
        className="inline-flex items-center gap-1.5 text-xs text-emerald-500 hover:text-emerald-400 cursor-pointer"
      >
        <ArrowLeft className="w-4 h-4" />
        추천 목록으로
      </button>

      <div className={`p-4 rounded-2xl border ${isDark ? 'bg-slate-950/60 border-slate-800' : 'bg-slate-50 border-slate-200'}`}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-base font-bold break-words">{feed.title}</h3>
            <p className="mt-2 text-xs text-slate-400 leading-relaxed">{feed.description}</p>
          </div>
          {subscribeButton}
        </div>
        <a
          href={feed.htmlUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 inline-flex items-center gap-1 text-xs text-emerald-500 hover:underline"
        >
          웹사이트 방문 <ExternalLink className="w-3 h-3" />
        </a>
      </div>

      <div>
        <h4 className="text-sm font-semibold">최근 글 미리보기</h4>
        <p className="mt-1 text-xs text-slate-400">미리보기만으로는 구독되지 않습니다. 원하는 피드만 구독해 보세요.</p>
      </div>

      <div aria-live="polite" aria-busy={loading}>
        {loading ? (
          <div role="status" className="flex items-center justify-center gap-2 py-12 text-sm text-slate-400">
            <Loader2 className="w-5 h-5 animate-spin" /> 최근 글을 불러오는 중입니다…
          </div>
        ) : error ? (
          <div className="py-8 text-center">
            <p className="text-sm text-rose-400">{error}</p>
            <button
              type="button"
              onClick={() => setRetry((value) => value + 1)}
              className="mt-3 px-3 py-2 rounded-lg text-xs text-emerald-500 border border-emerald-500/40 hover:bg-emerald-500/10 cursor-pointer"
            >
              다시 시도
            </button>
          </div>
        ) : articles.length === 0 ? (
          <div className="py-10 text-center text-slate-400">
            <Rss className="w-6 h-6 mx-auto mb-2" />
            <p className="text-sm">아직 공개된 글이 없습니다.</p>
          </div>
        ) : (
          <ul className="space-y-3">
            {articles.map((article, index) => (
              <li key={`${article.url}-${index}`}>
                <a
                  href={article.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`block p-4 rounded-xl border transition focus-visible:outline-2 focus-visible:outline-emerald-500 ${
                    isDark
                      ? 'border-slate-800 hover:bg-slate-800/60 hover:border-slate-700'
                      : 'border-slate-200 hover:bg-slate-50 hover:border-slate-300'
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <h5 className="flex-1 text-sm font-semibold leading-relaxed break-words">{article.title}</h5>
                    <ExternalLink className="w-3.5 h-3.5 mt-1 shrink-0 text-slate-400" />
                  </div>
                  {article.summary && <p className="mt-2 text-xs text-slate-400 leading-relaxed line-clamp-3 break-words">{article.summary}</p>}
                  <time dateTime={article.publishedAt} className="block mt-2 text-[11px] text-slate-500">
                    {formatRelativeTime(article.publishedAt)}
                  </time>
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
};
