import React, { useEffect, useId, useRef } from 'react';

interface MarkAllReadDialogProps {
  scopeName: string;
  searching: boolean;
  isDark: boolean;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}

export const MarkAllReadDialog: React.FC<MarkAllReadDialogProps> = ({
  scopeName, searching, isDark, busy, error, onCancel, onConfirm,
}) => {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  useEffect(() => {
    const dialog = dialogRef.current;
    const previousFocus = document.activeElement;
    dialog?.showModal();
    cancelRef.current?.focus();
    return () => {
      dialog?.close();
      if (previousFocus instanceof HTMLElement) previousFocus.focus();
    };
  }, []);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onCancel={(event) => { event.preventDefault(); if (!busy) onCancel(); }}
      className={`fixed inset-0 m-auto w-[calc(100%-2rem)] max-w-md rounded-2xl border p-6 shadow-2xl backdrop:bg-black/60 ${isDark ? 'bg-slate-900 border-slate-700 text-slate-100' : 'bg-white border-slate-200 text-slate-900'}`}
    >
      <h2 id={titleId} className="text-lg font-semibold">모두 읽음 처리할까요?</h2>
      <div id={descriptionId} className={`mt-3 text-sm leading-relaxed ${isDark ? 'text-slate-300' : 'text-slate-600'}`}>
        <p><strong>{scopeName}</strong>의 안읽은 글을 모두 읽음으로 표시합니다.</p>
        {searching && <p className="mt-2">검색 결과뿐 아니라 선택한 범위 전체에 적용됩니다.</p>}
      </div>
      {error && <p role="alert" className="mt-3 text-sm text-rose-400">{error}</p>}
      <div className="mt-6 flex justify-end gap-2">
        <button ref={cancelRef} type="button" onClick={onCancel} disabled={busy}
          className={`rounded-xl px-4 py-2 text-sm font-medium cursor-pointer disabled:opacity-50 ${isDark ? 'bg-slate-800 hover:bg-slate-700' : 'bg-slate-100 hover:bg-slate-200'}`}>
          취소
        </button>
        <button type="button" onClick={onConfirm} disabled={busy}
          className="rounded-xl bg-emerald-500 hover:bg-emerald-400 px-4 py-2 text-sm font-semibold text-slate-950 cursor-pointer disabled:opacity-50">
          {busy ? '처리 중…' : '모두 읽음 처리'}
        </button>
      </div>
    </dialog>
  );
};
