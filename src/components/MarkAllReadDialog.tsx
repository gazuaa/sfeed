import React from 'react';
import { ConfirmDialog } from './ConfirmDialog';

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
}) => (
  <ConfirmDialog
    title="모두 읽음 처리할까요?"
    confirmLabel="모두 읽음 처리"
    isDark={isDark}
    busy={busy}
    error={error}
    onCancel={onCancel}
    onConfirm={onConfirm}
  >
    <p><strong>{scopeName}</strong>의 안읽은 글을 모두 읽음으로 표시합니다.</p>
    {searching && <p className="mt-2">검색 결과뿐 아니라 선택한 범위 전체에 적용됩니다.</p>}
  </ConfirmDialog>
);
