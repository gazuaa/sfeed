import { useEffect, useRef } from 'react';
import { Minus, Plus, Settings2, LayoutList, LayoutGrid, AlignJustify } from 'lucide-react';
import type { LayoutMode } from '../client/api';
import { LocalNotificationSetting } from './LocalNotificationSetting';
import { FONT_SCALES, useTextSize } from '../client/textSize';
import { AUTO_REFRESH_OPTIONS } from '../shared/preferences';

export interface ScrollReadSettingsProps {
  markReadOnScroll: boolean;
  onChangeMarkReadOnScroll: (enabled: boolean) => void;
}

export function TextSizeControl({ className = '' }: { className?: string }) {
  const [size, setSize] = useTextSize();
  const index = FONT_SCALES.indexOf(size);
  return <div role="group" aria-label="글자 크기" className={`sfeed-text-size-control ${className}`}>
    <button type="button" aria-label="글자 작게" disabled={index === 0} onClick={() => setSize(FONT_SCALES[index - 1])}><Minus size={18} /></button>
    <button type="button" aria-label="기본 글자 크기로" onClick={() => setSize(1)}><span aria-hidden="true">가</span></button>
    <button type="button" aria-label="글자 크게" disabled={index === FONT_SCALES.length - 1} onClick={() => setSize(FONT_SCALES[index + 1])}><Plus size={18} /></button>
  </div>;
}

export function ScrollReadSetting({ markReadOnScroll, onChangeMarkReadOnScroll }: ScrollReadSettingsProps) {
  return <label className="sfeed-scroll-read-setting"><span>스크롤 시 읽음 처리<small>위로 지나간 글을 읽음으로 표시</small></span><input type="checkbox" role="switch" aria-label="스크롤 시 읽음 처리" checked={markReadOnScroll} onChange={(event) => onChangeMarkReadOnScroll(event.target.checked)} /></label>;
}

export interface RefreshSettingsProps {
  autoRefreshMinutes: number;
  onChangeAutoRefreshMinutes: (minutes: number) => void;
}
export interface LayoutSettingsProps { layout: LayoutMode; onChangeLayout: (layout: LayoutMode) => void }
export function LayoutSetting({ layout, onChangeLayout }: LayoutSettingsProps) {
  return <><p className="sfeed-setting-label">목록 보기</p><div className="sfeed-layout-options">{([{ id: 'magazine', label: '매거진 뷰', Icon: LayoutList }, { id: 'cards', label: '카드 뷰', Icon: LayoutGrid }, { id: 'list', label: '리스트 뷰', Icon: AlignJustify }] as const).map(({ id, label, Icon }) => <button key={id} type="button" aria-label={label} aria-pressed={layout === id} onClick={() => onChangeLayout(id)}><Icon size={19} /></button>)}</div></>;
}
export function AutoRefreshSetting({ autoRefreshMinutes, onChangeAutoRefreshMinutes }: RefreshSettingsProps) {
  return <><label className="sfeed-auto-refresh-setting"><span>자동 새로고침</span><select aria-label="자동 새로고침 주기" value={autoRefreshMinutes} onChange={(event) => onChangeAutoRefreshMinutes(Number(event.target.value))}>{AUTO_REFRESH_OPTIONS.map((minutes) => <option key={minutes} value={minutes}>{minutes ? `${minutes}분마다` : '수동'}</option>)}</select></label><small className="sfeed-auto-refresh-help">변경된 내용만 확인합니다. 피드 수집은 15분 주기입니다.</small></>;
}
export interface DesktopSettingsProps extends ScrollReadSettingsProps, RefreshSettingsProps, LayoutSettingsProps { accountId?: string }
export function DesktopReadingSettings({ autoRefreshMinutes, onChangeAutoRefreshMinutes, layout, onChangeLayout, accountId, ...props }: DesktopSettingsProps) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const outside = (event: PointerEvent) => { if (ref.current && !ref.current.contains(event.target as Node)) ref.current.open = false; };
    document.addEventListener('pointerdown', outside);
    const resize = () => { if (ref.current) ref.current.open = false; };
    window.addEventListener('resize', resize);
    return () => { document.removeEventListener('pointerdown', outside); window.removeEventListener('resize', resize); };
  }, []);
  return <details ref={ref} className="sfeed-desktop-settings" onKeyDown={(event) => { if (event.key === 'Escape' && ref.current) { ref.current.open = false; ref.current.querySelector('summary')?.focus(); } }}>
    <summary aria-label="환경설정"><Settings2 size={17} /></summary>
    <div className="sfeed-desktop-settings-panel">
      <section className="sfeed-setting-section"><p className="sfeed-setting-label">글자 크기</p><TextSizeControl /></section>
      <section className="sfeed-setting-section"><LayoutSetting layout={layout} onChangeLayout={onChangeLayout} /></section>
      <section className="sfeed-setting-section"><ScrollReadSetting {...props} /></section>
      <section className="sfeed-setting-section"><AutoRefreshSetting autoRefreshMinutes={autoRefreshMinutes} onChangeAutoRefreshMinutes={onChangeAutoRefreshMinutes} /></section>
      {accountId && <section className="sfeed-setting-section"><LocalNotificationSetting accountId={accountId} /></section>}
    </div>
  </details>;
}
