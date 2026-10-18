import React, { useRef, useState } from 'react';
import { Loader2, Upload } from 'lucide-react';
import { apiRequest } from '../client/api';
import type { OpmlFeed, OpmlImportResult } from '../shared/opml';

interface ImportReport {
  total: number;
  processed: number;
  imported: number;
  existing: number;
  foldersCreated: number;
  failures: { item: OpmlFeed; error: string }[];
}

interface OpmlImporterProps {
  isDark: boolean;
  onBusyChange: (busy: boolean) => void;
  onSubscribed: () => Promise<void>;
}

export const OpmlImporter: React.FC<OpmlImporterProps> = ({ isDark, onBusyChange, onSubscribed }) => {
  const [text, setText] = useState('');
  const [running, setRunning] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [pending, setPending] = useState<OpmlFeed[]>([]);
  const stopRequested = useRef(false);
  const busy = useRef(false);

  const changeText = (value: string) => {
    setText(value);
    setReport(null);
    setPending([]);
    setError(null);
  };

  const handleFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      changeText(await file.text());
    } catch {
      setError('파일을 읽지 못했습니다. 다시 선택해 주세요.');
    }
    event.target.value = '';
  };

  const startImport = async (retryFailed = false) => {
    if (busy.current) return;
    busy.current = true;
    stopRequested.current = false;
    setRunning(true);
    setStopping(false);
    setError(null);
    onBusyChange(true);
    try {
      let queue: OpmlFeed[];
      let current: ImportReport;
      if (retryFailed && report) {
        queue = report.failures.map((failure) => failure.item);
        current = { ...report, processed: report.processed - queue.length, failures: [] };
      } else if (pending.length > 0 && report) {
        queue = pending;
        current = { ...report };
      } else {
        const parsed = await apiRequest<{ items: OpmlFeed[]; totalFound: number }>('/api/opml/parse', {
          method: 'POST', body: JSON.stringify({ opmlXml: text }),
        });
        queue = parsed.items;
        current = { total: parsed.totalFound, processed: 0, imported: 0, existing: 0, foldersCreated: 0, failures: [] };
      }
      setReport(current);
      let index = 0;
      for (; index < queue.length; index++) {
        if (stopRequested.current) break;
        const item = queue[index];
        let result: OpmlImportResult;
        try {
          result = await apiRequest<OpmlImportResult>('/api/opml/import', {
            method: 'POST', body: JSON.stringify({ item }),
          });
        } catch (err) {
          result = { status: 'failed', foldersCreated: 0, error: err instanceof Error ? err.message : '가져오기에 실패했습니다.' };
        }
        current = {
          ...current,
          processed: current.processed + 1,
          imported: current.imported + (result.status === 'imported' ? 1 : 0),
          existing: current.existing + (result.status === 'existing' ? 1 : 0),
          foldersCreated: current.foldersCreated + result.foldersCreated,
          failures: result.status === 'failed'
            ? [...current.failures, { item, error: result.error || '가져오기에 실패했습니다.' }]
            : current.failures,
        };
        setReport(current);
      }
      setPending(queue.slice(index));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'OPML 가져오기에 실패했습니다.');
    } finally {
      // Refresh the workspace once, rather than after every imported feed.
      try { await onSubscribed(); } catch { /* The next refresh will reload the workspace. */ }
      busy.current = false;
      setRunning(false);
      setStopping(false);
      onBusyChange(false);
    }
  };

  return (
    <div className={`p-4 rounded-2xl border space-y-3 ${isDark ? 'bg-slate-950/60 border-slate-800' : 'bg-slate-50 border-slate-200'}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-bold">OPML 파일 가져오기 (Feedly / Inoreader 마이그레이션)</h3>
          <p className="mt-1 text-xs text-slate-400">피드 개수 제한 없이 전체 목록을 순서대로 가져옵니다. 기존 구독은 유지됩니다.</p>
        </div>
        <label className={`px-3.5 py-2 rounded-xl bg-slate-800 text-slate-200 text-xs font-medium inline-flex items-center gap-1.5 ${running ? 'opacity-40' : 'hover:bg-slate-700 cursor-pointer'}`}>
          <Upload className="w-3.5 h-3.5 text-emerald-400" /> 파일 선택
          <input type="file" accept=".opml,.xml,text/xml" disabled={running} onChange={handleFile} className="hidden" />
        </label>
      </div>

      <textarea
        aria-label="OPML 파일 내용"
        rows={6}
        placeholder=".opml 또는 .xml 파일을 선택하거나 OPML 내용을 붙여넣으세요."
        value={text}
        disabled={running}
        onChange={(event) => changeText(event.target.value)}
        className={`w-full p-3 rounded-xl font-mono text-xs border focus:outline-none focus:border-emerald-500 disabled:opacity-60 ${isDark ? 'bg-slate-950 border-slate-800 text-slate-200' : 'bg-white border-slate-300 text-slate-900'}`}
      />

      {error && <p role="alert" className="text-xs text-rose-400">{error}</p>}

      {report && (
        <div role="status" className="space-y-2 text-xs">
          <div className="flex justify-between gap-2 font-semibold">
            <span>{running ? '피드 가져오는 중' : pending.length > 0 ? '가져오기 일시 중단' : '가져오기 완료'}</span>
            <span>{report.processed} / {report.total}개</span>
          </div>
          <progress aria-label="피드 가져오기 진행률" className="block w-full h-2 accent-emerald-500" max={report.total} value={report.processed} />
          <p className="text-slate-400 leading-relaxed">
            신규 구독 {report.imported}개 · 기존 구독 {report.existing}개 · 실패 {report.failures.length}개 · 신규 폴더 {report.foldersCreated}개
          </p>
          {running && <p className="text-slate-400">가져오는 동안 이 화면을 유지해 주세요. 중단하면 남은 항목부터 이어서 가져올 수 있습니다.</p>}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={running || !text.trim()}
          onClick={() => startImport()}
          className="px-5 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold text-xs inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-40"
        >
          {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
          {pending.length > 0 ? '이어서 가져오기' : 'OPML 구독 일괄 등록하기'}
        </button>
        {running && (
          <button
            type="button"
            disabled={stopping}
            onClick={() => { stopRequested.current = true; setStopping(true); }}
            className="px-3 py-2 rounded-xl border border-slate-500 text-xs cursor-pointer disabled:opacity-50"
          >
            {stopping ? '현재 항목 처리 후 중단…' : '일시 중단'}
          </button>
        )}
        {!running && pending.length === 0 && report && report.failures.length > 0 && (
          <button
            type="button"
            onClick={() => startImport(true)}
            className="px-3 py-2 rounded-xl border border-emerald-500/40 text-emerald-500 text-xs cursor-pointer"
          >
            실패한 피드 {report.failures.length}개 다시 시도
          </button>
        )}
      </div>

      {report && report.failures.length > 0 && (
        <details className="text-xs">
          <summary className="text-rose-400 cursor-pointer">가져오지 못한 피드 {report.failures.length}개 확인</summary>
          <ul className="mt-3 space-y-3">
            {report.failures.map(({ item, error: reason }, index) => (
              <li key={`${item.xmlUrl}-${index}`}>
                <p className="font-semibold break-words">{item.title}</p>
                <p className="text-slate-400 break-all">{item.xmlUrl}</p>
                <p className="mt-1 text-rose-400">{reason}</p>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
};
