import React, { useEffect, useState } from 'react';
import { ArrowLeft, Check, Copy, Loader2, Rss, ExternalLink } from 'lucide-react';
import { apiRequest, type FolderItem } from '../client/api';
import type { BuilderAnalysis } from '../shared/rssBuilder';

export function RssBuilder({ url, folders, isDark, onBack, onSubscribed, onBusyChange }: { url: string; folders: FolderItem[]; isDark: boolean; onBack: () => void; onSubscribed: () => Promise<void>; onBusyChange: (busy: boolean) => void }) {
  const [analysis, setAnalysis] = useState<BuilderAnalysis | null>(null);
  const [selected, setSelected] = useState(0);
  const [title, setTitle] = useState('');
  const [folderId, setFolderId] = useState('');
  const [folderName, setFolderName] = useState('');
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [created, setCreated] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(null); setAnalysis(null);
    apiRequest<BuilderAnalysis>('/api/rss-builder/analyse', { method: 'POST', signal: controller.signal, body: JSON.stringify({ url }) })
      .then((result) => { if (!controller.signal.aborted) { setAnalysis(result); setTitle(result.title); setSelected(0); } })
      .catch((err) => { if (!controller.signal.aborted) setError(err instanceof Error ? err.message : '페이지를 분석하지 못했습니다.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [url, retry]);
  const field = `w-full rounded-xl border px-3 py-2.5 text-sm focus:outline-none focus:border-emerald-500 ${isDark ? 'bg-slate-950 border-slate-700 text-slate-100' : 'bg-white border-slate-300 text-slate-900'}`;
  const group = analysis?.groups[selected];
  const create = async () => {
    if (!group) return;
    setCreating(true); onBusyChange(true); setError(null);
    try {
      const result = await apiRequest<{ rssUrl: string }>('/api/rss-builder', { method: 'POST', body: JSON.stringify({ url: analysis!.sourceUrl, selector: group.selector, title, folderId: folderId || undefined, folderName: folderName || undefined }) });
      setCreated(result.rssUrl);
      await onSubscribed();
    } catch (err) { setError(err instanceof Error ? err.message : 'RSS 피드를 만들지 못했습니다.'); }
    finally { setCreating(false); onBusyChange(false); }
  };
  return <section aria-label="RSS 빌더" className="space-y-5">
    <button type="button" disabled={creating} onClick={onBack} className="inline-flex items-center gap-1.5 text-xs text-emerald-500 cursor-pointer"><ArrowLeft size={14} />검색으로 돌아가기</button>
    <div><h3 className="flex items-center gap-2 text-base font-bold"><Rss size={18} className="text-emerald-500" />RSS 빌더</h3><p className="mt-2 text-xs leading-relaxed text-slate-400">RSS가 없어도 글 목록으로 피드를 만들 수 있습니다. 수집할 목록을 확인한 뒤 구독하세요.</p><a href={url} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-1 text-xs text-emerald-500 break-all">{url}<ExternalLink size={12} className="shrink-0" /></a></div>
    {loading && <div role="status" className="flex items-center justify-center gap-2 py-10 text-sm text-slate-400"><Loader2 size={18} className="animate-spin" />페이지에서 글 목록을 찾는 중입니다…</div>}
    {error && <div role="alert" className="rounded-xl border border-rose-500/30 bg-rose-500/5 p-4 text-sm text-rose-500">{error}{!analysis && <button type="button" onClick={() => setRetry((n) => n + 1)} className="block mt-3 text-xs font-semibold underline cursor-pointer">다시 분석</button>}</div>}
    {created ? <div role="status" className="space-y-3 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4"><h4 className="flex items-center gap-2 font-semibold text-emerald-500"><Check size={16} />RSS 피드를 만들고 구독했습니다</h4><p className="text-xs text-slate-400">새 글은 피드 새로고침과 정기 갱신에 반영됩니다.</p><label className="block text-xs font-semibold">RSS 주소<input readOnly value={created} onFocus={(event) => event.target.select()} className={`${field} mt-2`} /></label><button type="button" onClick={async () => { try { await navigator.clipboard.writeText(created); setCopied(true); } catch { setCopied(false); } }} className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-500 cursor-pointer"><Copy size={14} />{copied ? '복사됨' : 'RSS 주소 복사'}</button></div> : analysis && group && <>
      {analysis.groups.length > 1 && <fieldset className="space-y-2"><legend className="mb-2 text-sm font-semibold">수집할 글 목록</legend>{analysis.groups.map((candidate, index) => <label key={candidate.selector} className={`flex cursor-pointer items-start gap-2 rounded-xl border p-3 text-xs ${selected === index ? 'border-emerald-500 bg-emerald-500/5' : isDark ? 'border-slate-700' : 'border-slate-200'}`}><input type="radio" name="builder-group" checked={selected === index} disabled={creating} onChange={() => setSelected(index)} className="mt-0.5 accent-emerald-500" /><span className="min-w-0"><strong>{candidate.articles[0]?.title}</strong><span className="mt-1 block text-slate-400">{candidate.articles.length}개 글</span></span></label>)}</fieldset>}
      <details className={`rounded-xl border p-3 ${isDark ? 'border-slate-700' : 'border-slate-200'}`}><summary className="cursor-pointer text-xs font-semibold">구독 설정 · {title}{folderId || folderName ? ' · 폴더 지정됨' : ' · 미분류'}</summary><div className="mt-3 space-y-3"><label className="block text-xs font-semibold">피드 이름<input value={title} disabled={creating} onChange={(event) => setTitle(event.target.value)} className={`${field} mt-2`} /></label><label className="block text-xs font-semibold">구독 폴더<select value={folderId} disabled={creating} onChange={(event) => setFolderId(event.target.value)} className={`${field} mt-2`}><option value="">미분류</option>{folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}</select></label>{!folderId && <label className="block text-xs font-semibold">새 폴더 이름 (선택사항)<input value={folderName} disabled={creating} onChange={(event) => setFolderName(event.target.value)} placeholder="새 폴더에 구독하려면 입력하세요" className={`${field} mt-2`} /></label>}</div></details>
      <div className="flex flex-wrap items-center justify-between gap-3"><h4 className="text-sm font-semibold">글 미리보기 · {group.articles.length}개</h4><button type="button" disabled={creating || !title.trim()} onClick={create} className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 px-4 py-2.5 text-xs font-semibold text-slate-950 cursor-pointer disabled:opacity-50">{creating ? <Loader2 size={14} className="animate-spin" /> : <Rss size={14} />}{creating ? '피드를 만드는 중…' : '피드 만들고 구독'}</button></div>
      <p className="text-[11px] text-slate-400">미리보기만으로는 구독되지 않습니다. 발행일은 사이트에서 확인되는 경우에만 표시합니다.</p>
      <ul className="space-y-2">{group.articles.slice(0, 20).map((article) => <li key={article.url} className={`rounded-xl border p-3 ${isDark ? 'border-slate-800' : 'border-slate-200'}`}><a href={article.url} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold hover:text-emerald-500">{article.title}</a><p className="mt-1 text-[11px] text-slate-400">{article.dateSource === 'collected' ? '발행일 미제공' : new Date(article.publishedAt).toLocaleDateString('ko-KR')}</p></li>)}</ul>
    </>}
  </section>;
}
