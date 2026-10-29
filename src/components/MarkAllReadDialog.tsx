import React from 'react';
import { ConfirmDialog } from './ConfirmDialog';

interface MarkAllReadDialogProps {
  scopeName: string;
  search: string;
  savedOnly: boolean;
  isDark: boolean;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}

export const MarkAllReadDialog: React.FC<MarkAllReadDialogProps> = ({
  scopeName, search, savedOnly, isDark, busy, error, onCancel, onConfirm,
}) => {
  const where = <><strong>{scopeName}</strong>{savedOnly && '의 저장한 글'}</>;
  return (
    <ConfirmDialog
      title="모두 읽음 처리할까요?"
      confirmLabel="모두 읽음 처리"
      isDark={isDark}
      busy={busy}
      error={error}
      onCancel={onCancel}
      onConfirm={onConfirm}
    >
      {search
        ? <p>{where}에서 <strong>‘{search}’</strong> 검색 결과에 나온 안읽은 글만 읽음으로 표시합니다.</p>
        : <p>{where}{savedOnly ? ' 중' : '의'} 안읽은 글을 모두 읽음으로 표시합니다.</p>}
    </ConfirmDialog>
  );
};
