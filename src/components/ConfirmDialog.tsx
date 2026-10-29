import React, { useEffect, useId, useRef } from 'react';

interface ConfirmDialogProps {
  title: string;
  children: React.ReactNode;
  confirmLabel: string;
  busyLabel?: string;
  /** danger: removes something (rose button); primary: everyday action (emerald). */
  tone?: 'danger' | 'primary';
  isDark: boolean;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
  /** Asked from a keyboard shortcut: focus starts on the confirm button, so Enter confirms. */
  focusConfirm?: boolean;
}

/** A modal yes/no question. Focus starts on 취소, and Esc cancels unless busy. */
export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  title, children, confirmLabel, busyLabel = '처리 중…', tone = 'primary', isDark, busy, error, onCancel, onConfirm, focusConfirm = false,
}) => {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  useEffect(() => {
    const dialog = dialogRef.current;
    const previousFocus = document.activeElement;
    dialog?.showModal();
    (focusConfirm ? confirmRef : cancelRef).current?.focus();
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
      <h2 id={titleId} className="text-lg font-semibold">{title}</h2>
      <div id={descriptionId} className={`mt-3 text-sm leading-relaxed ${isDark ? 'text-slate-300' : 'text-slate-600'}`}>
        {children}
      </div>
      {error && <p role="alert" className="mt-3 text-sm text-rose-400">{error}</p>}
      <div className="mt-6 flex justify-end gap-2">
        <button ref={cancelRef} type="button" onClick={onCancel} disabled={busy}
          className={`rounded-xl px-4 py-2 text-sm font-medium cursor-pointer disabled:opacity-50 ${isDark ? 'bg-slate-800 hover:bg-slate-700' : 'bg-slate-100 hover:bg-slate-200'}`}>
          취소
        </button>
        <button ref={confirmRef} type="button" onClick={onConfirm} disabled={busy}
          className={`rounded-xl px-4 py-2 text-sm font-semibold cursor-pointer disabled:opacity-50 ${tone === 'danger' ? 'bg-rose-500 hover:bg-rose-400 text-white' : 'bg-emerald-500 hover:bg-emerald-400 text-slate-950'}`}>
          {busy ? busyLabel : confirmLabel}
        </button>
      </div>
    </dialog>
  );
};
