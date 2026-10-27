import { useEffect, useRef } from 'react';
import { Archive, ArrowLeft, Bookmark, CheckCheck, LayoutGrid, LayoutList, AlignJustify, Plus, RefreshCw, Rss, Search, Settings2, Sun, Moon, X, FileCode2 } from 'lucide-react';
import type { LayoutMode, ThemeMode } from '../client/api';
import { InstallAppButton } from './PwaInstall';
import { ScrollReadSetting, TextSizeControl, LayoutSetting, AutoRefreshSetting, type ScrollReadSettingsProps, type RefreshSettingsProps } from './ReadingSettings';
import { LocalNotificationSetting } from './LocalNotificationSetting';
import { CacheSettings } from './CacheSettings';

export type LibraryTab = 'all' | 'unread' | 'saved';
export interface MobileSettingsProps extends ScrollReadSettingsProps, RefreshSettingsProps {
  accountId?: string;
  theme: ThemeMode;
  onChangeTheme: (theme: ThemeMode) => void;
  layout: LayoutMode;
  onChangeLayout: (layout: LayoutMode) => void;
  onOpenOpml: () => void;
}

export function MobileSettings({ theme, onChangeTheme, layout, onChangeLayout, onOpenOpml, library, markReadOnScroll, onChangeMarkReadOnScroll, autoRefreshMinutes, onChangeAutoRefreshMinutes, accountId }: MobileSettingsProps & { library?: boolean }) {
  const ref = useRef<HTMLDetailsElement>(null);
  const close = () => { if (ref.current) ref.current.open = false; };
  useEffect(() => {
    const outside = (event: PointerEvent) => { if (!ref.current?.contains(event.target as Node)) close(); };
    document.addEventListener('pointerdown', outside);
    window.addEventListener('resize', close);
    return () => { document.removeEventListener('pointerdown', outside); window.removeEventListener('resize', close); };
  }, []);
  return <details ref={ref} className="sfeed-mobile-settings" onKeyDown={(event) => { if (event.key === 'Escape') { close(); ref.current?.querySelector('summary')?.focus(); } }}>
    <summary aria-label="보기 설정" className="sfeed-mobile-icon"><Settings2 size={21} /></summary>
    <div className="sfeed-mobile-settings-panel">
      <section className="sfeed-setting-section">
      <p className="sfeed-mobile-eyebrow">화면</p>
      <div className="sfeed-mobile-setting-options">{(['light', 'dark'] as const).map((value) => { const Icon = value === 'light' ? Sun : Moon; return <button key={value} aria-label={value === 'light' ? '낮 모드' : '밤 모드'} aria-pressed={theme === value} onClick={() => onChangeTheme(value)}><Icon size={20} /></button>; })}</div>
      <p className="sfeed-mobile-eyebrow">글자 크기</p><TextSizeControl />
      </section>
      {!library && <section className="sfeed-setting-section"><LayoutSetting layout={layout} onChangeLayout={(value) => { onChangeLayout(value); close(); }} /></section>}
      {!library && <section className="sfeed-setting-section"><ScrollReadSetting markReadOnScroll={markReadOnScroll} onChangeMarkReadOnScroll={onChangeMarkReadOnScroll} /></section>}
      <section className="sfeed-setting-section"><AutoRefreshSetting autoRefreshMinutes={autoRefreshMinutes} onChangeAutoRefreshMinutes={onChangeAutoRefreshMinutes} /></section>
      {accountId && <section className="sfeed-setting-section"><LocalNotificationSetting accountId={accountId} /></section>}
      {accountId && <section className="sfeed-setting-section"><CacheSettings accountId={accountId} /></section>}
      <section className="sfeed-setting-section">
      <button className="sfeed-mobile-settings-row" onClick={() => { close(); onOpenOpml(); }}><FileCode2 size={18} />OPML 가져오기 / 내보내기</button>
      <InstallAppButton />
      </section>
    </div>
  </details>;
}

export function MobileHeader({ title, library, hidden, search, onSearch, onBack, onAdd, ...settings }: MobileSettingsProps & { title: string; library?: boolean; hidden?: boolean; search: string; onSearch: (value: string) => void; onBack?: () => void; onAdd: () => void }) {
  return <header className="sfeed-mobile-header" data-scroll-hidden={hidden || undefined} inert={hidden || undefined} aria-hidden={hidden || undefined}>
    <div className="sfeed-mobile-heading">
      {library ? <span className="sfeed-mobile-brand-icon"><Rss size={21} strokeWidth={2.4} /></span> : <button className="sfeed-mobile-icon" onClick={onBack} aria-label="내 피드로 돌아가기"><ArrowLeft size={22} /></button>}
      <h1>{title}</h1>
      <div className="sfeed-mobile-header-actions"><MobileSettings library={library} {...settings} /><button className="sfeed-mobile-icon" onClick={onAdd} aria-label="피드 추가"><Plus size={23} /></button></div>
    </div>
    <label className="sfeed-mobile-search"><Search size={20} aria-hidden="true" /><input type="search" aria-label={library ? '폴더 및 피드 검색' : '글 검색'} placeholder={library ? '폴더 또는 피드 검색' : '글 검색'} value={search} onChange={(event) => onSearch(event.target.value)} autoComplete="off" />{search && <button aria-label="검색어 지우기" onClick={() => onSearch('')}><X size={18} /></button>}</label>
  </header>;
}

export function MobileDock({ active, onSelect, onRefresh, refreshing, onMarkAllRead, library, onAdd, hidden }: { /** null on the library, which is not one of the lists. */ active: LibraryTab | null; onSelect: (tab: LibraryTab) => void; onRefresh: () => void; refreshing: boolean; onMarkAllRead: () => void; library?: boolean; onAdd: () => void; hidden?: boolean }) {
  return <nav aria-label="모바일 글 탐색" className="sfeed-mobile-dock lg:hidden" data-scroll-hidden={hidden || undefined} inert={hidden || undefined} aria-hidden={hidden || undefined}>
    <button aria-label="피드 새로고침" disabled={refreshing} onClick={onRefresh}><RefreshCw size={21} className={refreshing ? 'animate-spin' : ''} /></button>
    <div className="sfeed-mobile-dock-tabs">{([{ id: 'all', label: '전체', Icon: Archive }, { id: 'unread', label: '안 읽음', Icon: null }, { id: 'saved', label: '저장', Icon: Bookmark }] as const).map(({ id, label, Icon }) => <button key={id} aria-label={label} aria-pressed={active === id} onClick={() => onSelect(id)}>{Icon ? <Icon size={21} /> : <span className="sfeed-unread-dot" />}<span>{label}</span></button>)}</div>
    <button aria-label={library ? '피드 추가' : '모두 읽음'} onClick={library ? onAdd : onMarkAllRead}>{library ? <Plus size={23} /> : <CheckCheck size={22} />}</button>
  </nav>;
}
