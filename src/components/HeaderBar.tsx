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
  title: string;
  subtitle?: string;
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
  title,
  subtitle,
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
      className={`sfeed-header shrink-0 z-30 border-b backdrop-blur-md px-4 lg:px-8 py-3.5 transition-colors ${
        isDark
          ? 'bg-slate-950/85 border-slate-800/80 text-slate-100'
          : 'bg-white/90 border-slate-200 text-slate-900'
      }`}
    >
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        {/* Left: Mobile Menu & View Title */}
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            aria-label="피드 채널 열기"
            onClick={onOpenMobileSidebar}
            className={`lg:hidden p-2 rounded-lg border cursor-pointer ${
              isDark
                ? 'border-slate-800 text-slate-300 hover:bg-slate-900'
                : 'border-slate-200 text-slate-700 hover:bg-slate-100'
            }`}
          >
            <Menu className="w-5 h-5" />
          </button>

          <div className="min-w-0">
            <h1 className="text-lg sm:text-xl font-bold tracking-tight truncate">
              {title}
            </h1>
            {subtitle && (
              <p className="text-xs text-slate-400 truncate mt-0.5">{subtitle}</p>
            )}
          </div>
        </div>

        {/* Right: Search, View Switcher, Refresh, Mark Read, Theme */}
        <div className="flex flex-wrap items-center gap-2">
          <InstallAppButton />
          {/* Keyword Search Input */}
          <div className="relative flex-1 sm:flex-initial sm:w-60">
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
                onClick={() => onSearchChange('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Feedly 3-Mode Layout Switcher */}
          <div
            className={`inline-flex items-center p-0.5 rounded-xl border ${
              isDark
                ? 'bg-slate-900 border-slate-800'
                : 'bg-slate-100 border-slate-200'
            }`}
          >
            <button
              type="button"
              onClick={() => onChangeLayout('magazine')}
              title="매거진 뷰 (Magazine View)"
              className={`px-2 py-1 rounded-lg text-xs font-medium flex items-center gap-1 transition cursor-pointer ${
                layout === 'magazine'
                  ? 'bg-emerald-500 text-slate-950 font-semibold shadow-sm'
                  : isDark ? 'text-slate-400 hover:text-slate-200' : 'text-slate-600 hover:text-slate-950'
              }`}
            >
              <LayoutList className="w-3.5 h-3.5" />
              <span className="hidden xl:inline">매거진</span>
            </button>

            <button
              type="button"
              onClick={() => onChangeLayout('cards')}
              title="카드 뷰 (Cards View)"
              className={`px-2 py-1 rounded-lg text-xs font-medium flex items-center gap-1 transition cursor-pointer ${
                layout === 'cards'
                  ? 'bg-emerald-500 text-slate-950 font-semibold shadow-sm'
                  : isDark ? 'text-slate-400 hover:text-slate-200' : 'text-slate-600 hover:text-slate-950'
              }`}
            >
              <LayoutGrid className="w-3.5 h-3.5" />
              <span className="hidden xl:inline">카드</span>
            </button>

            <button
              type="button"
              onClick={() => onChangeLayout('list')}
              title="리스트 뷰 (Title-Only Compact View)"
              className={`px-2 py-1 rounded-lg text-xs font-medium flex items-center gap-1 transition cursor-pointer ${
                layout === 'list'
                  ? 'bg-emerald-500 text-slate-950 font-semibold shadow-sm'
                  : isDark ? 'text-slate-400 hover:text-slate-200' : 'text-slate-600 hover:text-slate-950'
              }`}
            >
              <AlignJustify className="w-3.5 h-3.5" />
              <span className="hidden xl:inline">리스트</span>
            </button>
          </div>

          {/* Mark All Read */}
          <button
            type="button"
            onClick={onMarkAllRead}
            title="현재 목록 모두 읽음 처리"
            className={`px-2.5 py-1.5 rounded-xl text-xs font-medium border flex items-center gap-1.5 transition cursor-pointer ${
              isDark
                ? 'bg-slate-900 border-slate-800 text-slate-300 hover:bg-slate-800'
                : 'bg-slate-100 border-slate-200 text-slate-700 hover:bg-slate-200'
            }`}
          >
            <CheckCheck className="w-3.5 h-3.5 text-emerald-400" />
            <span className="hidden sm:inline">모두 읽음</span>
          </button>

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
