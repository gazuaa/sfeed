import React from 'react';
import {
  Search,
  RefreshCw,
  CheckCheck,
  LayoutList,
  LayoutGrid,
  AlignJustify,
  Menu,
  X,
} from 'lucide-react';
import type { LayoutMode, ThemeMode } from '../client/api';
import { InstallAppButton } from './PwaInstall';
import { ThemeSwitch } from './ThemeSwitch';

interface HeaderBarProps {
  searchQuery: string;
  onSearchChange: (q: string) => void;
  layout: LayoutMode;
  onChangeLayout: (layout: LayoutMode) => void;
  theme: ThemeMode;
  onChangeTheme: (theme: ThemeMode) => void;
  onRefresh: () => void;
  refreshing: boolean;
  onMarkAllRead: () => void;
  onOpenMobileSidebar: () => void;
}

export const HeaderBar: React.FC<HeaderBarProps> = ({
  searchQuery,
  onSearchChange,
  layout,
  onChangeLayout,
  theme,
  onChangeTheme,
  onRefresh,
  refreshing,
  onMarkAllRead,
  onOpenMobileSidebar,
}) => {
  const isDark = theme === 'dark';

  return (
    <header
      className={`sfeed-header shrink-0 z-30 border-b backdrop-blur-md py-3.5 transition-colors ${
        isDark
          ? 'bg-slate-950/85 border-slate-800/80 text-slate-100'
          : 'bg-white/90 border-slate-200 text-slate-900'
      }`}
    >
      <div className="sfeed-header-sections">
        <div className="sfeed-list-controls flex min-w-0 items-center gap-2 px-4">
        {/* Mobile Menu */}
        <button
          type="button"
          aria-label="피드 채널 열기"
          onClick={onOpenMobileSidebar}
          className={`lg:hidden shrink-0 p-2 rounded-lg border cursor-pointer ${
            isDark
              ? 'border-slate-800 text-slate-300 hover:bg-slate-900'
              : 'border-slate-200 text-slate-700 hover:bg-slate-100'
          }`}
        >
          <Menu className="w-5 h-5" />
        </button>

        {/* Search, View Switcher, Mark Read, and right-aligned utilities */}
        <div className="flex flex-1 min-w-0 items-center gap-2">
          {/* Keyword Search Input */}
          <div className="relative flex-1 min-w-0">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="키워드 검색 (제목, 요약, 피드)..."
              className={`w-full pl-9 pr-7 py-1.5 rounded-xl text-xs border transition focus:outline-none focus:border-emerald-500 ${
                isDark
                  ? 'bg-slate-900 border-slate-800 text-slate-100 placeholder-slate-500'
                  : 'bg-slate-100 border-slate-200 text-slate-900 placeholder-slate-400'
              }`}
            />
            {searchQuery && (
              <button
                type="button"
                aria-label="검색어 지우기"
                onClick={() => onSearchChange('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Feedly 3-Mode Layout Switcher */}
          <div
            className={`inline-flex shrink-0 items-center p-0.5 rounded-xl border ${
              isDark
                ? 'bg-slate-900 border-slate-800'
                : 'bg-slate-100 border-slate-200'
            }`}
          >
            <button
              type="button"
              onClick={() => onChangeLayout('magazine')}
              aria-label="매거진 뷰"
              aria-pressed={layout === 'magazine'}
              title="매거진 뷰 (Magazine View)"
              className={`p-1.5 rounded-lg flex items-center transition cursor-pointer ${
                layout === 'magazine'
                  ? 'bg-emerald-500 text-slate-950 font-semibold shadow-sm'
                  : isDark ? 'text-slate-400 hover:text-slate-200' : 'text-slate-600 hover:text-slate-950'
              }`}
            >
              <LayoutList className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={() => onChangeLayout('cards')}
              aria-label="카드 뷰"
              aria-pressed={layout === 'cards'}
              title="카드 뷰 (Cards View)"
              className={`p-1.5 rounded-lg flex items-center transition cursor-pointer ${
                layout === 'cards'
                  ? 'bg-emerald-500 text-slate-950 font-semibold shadow-sm'
                  : isDark ? 'text-slate-400 hover:text-slate-200' : 'text-slate-600 hover:text-slate-950'
              }`}
            >
              <LayoutGrid className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={() => onChangeLayout('list')}
              aria-label="리스트 뷰"
              aria-pressed={layout === 'list'}
              title="리스트 뷰 (Title-Only Compact View)"
              className={`p-1.5 rounded-lg flex items-center transition cursor-pointer ${
                layout === 'list'
                  ? 'bg-emerald-500 text-slate-950 font-semibold shadow-sm'
                  : isDark ? 'text-slate-400 hover:text-slate-200' : 'text-slate-600 hover:text-slate-950'
              }`}
            >
              <AlignJustify className="w-4 h-4" />
            </button>
          </div>

          {/* Mark All Read */}
          <button
            type="button"
            onClick={onMarkAllRead}
            title="현재 목록 모두 읽음 처리"
            aria-label="모두 읽음"
            className={`shrink-0 p-2 rounded-xl border flex items-center transition cursor-pointer ${
              isDark
                ? 'bg-slate-900 border-slate-800 text-slate-300 hover:bg-slate-800'
                : 'bg-slate-100 border-slate-200 text-slate-700 hover:bg-slate-200'
            }`}
          >
            <CheckCheck className="w-4 h-4 text-emerald-400" />
          </button>

        </div>
        </div>
          <div aria-hidden="true" className="sfeed-header-divider" />
          <div className="sfeed-global-controls flex shrink-0 items-center justify-end gap-2 px-4">
            <InstallAppButton />
            {/* Refresh Feeds */}
            <button
              type="button"
              onClick={onRefresh}
              disabled={refreshing}
              title="피드 새로고침 (단축키: R)"
              className={`p-2 rounded-xl border transition cursor-pointer ${
                isDark
                  ? 'bg-slate-900 border-slate-800 text-slate-300 hover:bg-slate-800'
                  : 'bg-slate-100 border-slate-200 text-slate-700 hover:bg-slate-200'
              }`}
            >
              <RefreshCw
                className={`w-4 h-4 ${refreshing ? 'animate-spin text-emerald-400' : ''}`}
              />
            </button>

            <ThemeSwitch theme={theme} onChange={onChangeTheme} />
          </div>
      </div>
    </header>
  );
};
