import React, { useState } from 'react';
import {
  Rss,
  Layers,
  Mail,
  Bookmark,
  Plus,
  Folder,
  FolderOpen,
  ChevronRight,
  ChevronDown,
  Trash2,
  FolderPlus,
  FileCode2,
  LogOut,
  Compass,
  X,
} from 'lucide-react';
import type {
  FolderItem,
  SubscriptionItem,
  ScopeType,
  UserProfile,
  BootstrapResponse,
} from '../client/api';

interface SidebarProps {
  user: UserProfile;
  folders: FolderItem[];
  subscriptions: SubscriptionItem[];
  counts: BootstrapResponse['counts'];
  unreadOnly: boolean;
  activeScope: ScopeType;
  activeFolderId: string | null;
  activeFeedId: string | null;
  onSelectScope: (
    scope: ScopeType,
    folderId?: string | null,
    feedId?: string | null
  ) => void;
  onSelectLibraryTab: (tab: 'all' | 'unread' | 'saved') => void;
  onOpenDiscover: (initialTab?: 'curated' | 'custom' | 'opml') => void;
  onCreateFolder: (name: string) => Promise<void>;
  onDeleteFolder: (folderId: string) => Promise<void>;
  onUnsubscribe: (subscriptionId: string, title: string) => Promise<void>;
  onLogout: () => void;
  isDark: boolean;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  user,
  folders,
  subscriptions,
  counts,
  unreadOnly,
  activeScope,
  activeFolderId,
  activeFeedId,
  onSelectScope,
  onSelectLibraryTab,
  onOpenDiscover,
  onCreateFolder,
  onDeleteFolder,
  onUnsubscribe,
  onLogout,
  isDark,
  mobileOpen,
  onCloseMobile,
}) => {
  const [collapsedFolders, setCollapsedFolders] = useState<Record<string, boolean>>({});
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');

  const toggleFolderCollapse = (folderId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setCollapsedFolders((prev) => ({
      ...prev,
      [folderId]: !prev[folderId],
    }));
  };

  const handleCreateFolderSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFolderName.trim()) return;
    await onCreateFolder(newFolderName.trim());
    setNewFolderName('');
    setCreatingFolder(false);
  };

  const uncategorizedSubs = subscriptions.filter(
    (s) => !s.folder_id || !folders.some((f) => f.id === s.folder_id)
  );
  const getFeedCount = (sub: SubscriptionItem) => unreadOnly ? sub.unread_count : sub.total_count;

  return (
    <>
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-black/60 z-40 lg:hidden"
          onClick={onCloseMobile}
        />
      )}

      <aside
        aria-label="피드 채널"
        className={`sfeed-sidebar fixed lg:static inset-y-0 left-0 z-50 w-72 min-h-0 shrink-0 flex flex-col overflow-hidden border-r transition-transform duration-200 ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        } ${
          isDark
            ? 'bg-slate-900/95 border-slate-800/80 text-slate-200'
            : 'bg-slate-50 border-slate-200 text-slate-800'
        }`}
      >
        {/* Top Logo & Add Feed CTA */}
        <div className="p-4 shrink-0 flex items-center justify-between">
          <div
            onClick={() => {
              onSelectScope('all', null, null);
              onCloseMobile();
            }}
            className="flex items-center gap-2.5 cursor-pointer"
          >
            <div className="w-8 h-8 rounded-lg bg-emerald-500 flex items-center justify-center shadow-sm shadow-emerald-500/30">
              <Rss className="w-4 h-4 text-slate-950 stroke-[2.5]" />
            </div>
            <span
              className={`text-lg font-bold tracking-tight ${
                isDark ? 'text-white' : 'text-slate-900'
              }`}
            >
              Sfeed
            </span>
          </div>

          <button
            type="button"
            aria-label="피드 채널 닫기"
            onClick={onCloseMobile}
            className="lg:hidden p-1.5 rounded-lg text-slate-400 hover:text-white"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-3 mb-3 shrink-0">
          <button
            type="button"
            onClick={() => {
              onOpenDiscover('curated');
              onCloseMobile();
            }}
            className="w-full py-2.5 px-3.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold text-sm flex items-center justify-center gap-2 shadow-sm shadow-emerald-500/20 transition cursor-pointer"
          >
            <Plus className="w-4 h-4 stroke-[2.5]" />
            <span>피드 추가 · 추천 탐색</span>
          </button>
        </div>

        <nav aria-label="글 보기" className={`mx-3 mb-4 grid grid-cols-3 shrink-0 gap-1 rounded-xl border p-1 ${isDark ? 'bg-slate-950/50 border-slate-800' : 'bg-slate-100 border-slate-200'}`}>
          {([
            { id: 'all', label: '전체', icon: Layers, count: counts.totalArticles },
            { id: 'unread', label: '안 읽음', icon: Mail, count: counts.totalUnread },
            { id: 'saved', label: '저장', icon: Bookmark, count: counts.savedCount },
          ] as const).map((tab) => {
            const selected = tab.id === 'saved' ? activeScope === 'saved' : activeScope === 'all' && unreadOnly === (tab.id === 'unread');
            const Icon = tab.icon;
            return <button key={tab.id} type="button" aria-pressed={selected} onClick={() => { onSelectLibraryTab(tab.id); onCloseMobile(); }} className={`min-w-0 flex flex-col items-center gap-1 rounded-lg py-2 text-xs font-semibold transition cursor-pointer ${selected ? isDark ? 'bg-emerald-500/15 text-emerald-400' : 'bg-white text-emerald-700 shadow-sm' : isDark ? 'text-slate-400 hover:bg-slate-800 hover:text-white' : 'text-slate-600 hover:bg-white hover:text-slate-950'}`}><span className="inline-flex items-center gap-1"><Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /><span>{tab.label}</span></span><span className="text-[10px] tabular-nums opacity-80">{tab.count.toLocaleString('ko-KR')}</span></button>;
          })}
        </nav>

        {/* Scrollable Navigation Tree */}
        <div aria-label="구독 피드 채널" role="navigation" tabIndex={0} className="sfeed-channel-list flex-1 min-h-0 overflow-y-auto overscroll-contain px-3 space-y-5 pb-4">
          {/* Folders & Feeds Section */}
          <div>
            <div className="flex items-center justify-between px-2 mb-2">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                피드 및 폴더 ({subscriptions.length})
              </span>
              <button
                type="button"
                onClick={() => setCreatingFolder((v) => !v)}
                title="새 폴더 만들기"
                className="text-xs text-emerald-400 hover:text-emerald-300 flex items-center gap-1 cursor-pointer"
              >
                <FolderPlus className="w-3.5 h-3.5" />
                <span>폴더 추가</span>
              </button>
            </div>

            {creatingFolder && (
              <form onSubmit={handleCreateFolderSubmit} className="mb-2.5 px-1">
                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    placeholder="새 폴더 이름..."
                    value={newFolderName}
                    onChange={(e) => setNewFolderName(e.target.value)}
                    autoFocus
                    className={`flex-1 px-2.5 py-1.5 rounded-lg text-xs border focus:outline-none focus:border-emerald-500 ${
                      isDark
                        ? 'bg-slate-950 border-slate-700 text-white'
                        : 'bg-white border-slate-300 text-slate-900'
                    }`}
                  />
                  <button
                    type="submit"
                    className="px-2.5 py-1.5 rounded-lg bg-emerald-500 text-slate-950 text-xs font-semibold cursor-pointer"
                  >
                    생성
                  </button>
                </div>
              </form>
            )}

            <div className="space-y-1.5">
              {folders.map((folder) => {
                const folderSubs = subscriptions.filter(
                  (s) => s.folder_id === folder.id
                );
                const folderCount = folderSubs.reduce(
                  (sum, s) => sum + getFeedCount(s),
                  0
                );
                const isCollapsed = Boolean(collapsedFolders[folder.id]);
                const isFolderActive =
                  activeScope === 'folder' && activeFolderId === folder.id;

                return (
                  <div key={folder.id} className="space-y-0.5">
                    <div
                      onClick={() => {
                        onSelectScope('folder', folder.id, null);
                        onCloseMobile();
                      }}
                      className={`group flex items-center justify-between px-2.5 py-1.5 rounded-xl text-sm transition cursor-pointer ${
                        isFolderActive
                          ? 'bg-emerald-500/15 text-emerald-400 font-semibold'
                          : isDark
                          ? 'text-slate-300 hover:bg-slate-800/70'
                          : 'text-slate-700 hover:bg-slate-200/70'
                      }`}
                    >
                      <div className="flex items-center gap-1.5 min-w-0">
                        <button
                          type="button"
                          onClick={(e) => toggleFolderCollapse(folder.id, e)}
                          className="p-0.5 rounded hover:bg-slate-700/40 text-slate-400 cursor-pointer"
                        >
                          {isCollapsed ? (
                            <ChevronRight className="w-3.5 h-3.5" />
                          ) : (
                            <ChevronDown className="w-3.5 h-3.5" />
                          )}
                        </button>
                        {isCollapsed ? (
                          <Folder className="w-4 h-4 text-emerald-400 shrink-0" />
                        ) : (
                          <FolderOpen className="w-4 h-4 text-emerald-400 shrink-0" />
                        )}
                        <span className="truncate">{folder.name}</span>
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        {folderCount > 0 && (
                          <span className="text-[11px] text-slate-400 font-medium">
                            {folderCount}
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onDeleteFolder(folder.id);
                          }}
                          title="폴더 삭제"
                          className="opacity-0 group-hover:opacity-100 p-1 rounded text-slate-500 hover:text-rose-400 transition cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    {!isCollapsed && (
                      <div className="pl-5 space-y-0.5">
                        {folderSubs.length === 0 ? (
                          <div className="px-3 py-1 text-[11px] text-slate-500">
                            비어 있는 폴더
                          </div>
                        ) : (
                          folderSubs.map((sub) => {
                            const isFeedActive =
                              activeScope === 'feed' && activeFeedId === sub.feed_id;
                            return (
                              <div
                                key={sub.id}
                                onClick={() => {
                                  onSelectScope('feed', null, sub.feed_id);
                                  onCloseMobile();
                                }}
                                className={`group flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs transition cursor-pointer ${
                                  isFeedActive
                                    ? 'bg-emerald-500/15 text-emerald-400 font-semibold'
                                    : isDark
                                    ? 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'
                                    : 'text-slate-600 hover:bg-slate-200/60 hover:text-slate-900'
                                }`}
                              >
                                <div className="flex items-center gap-2 min-w-0">
                                  {sub.favicon_url ? (
                                    <img
                                      src={sub.favicon_url}
                                      alt=""
                                      className="w-3.5 h-3.5 rounded-sm shrink-0"
                                      onError={(e) => {
                                        (e.currentTarget as HTMLImageElement).style.display =
                                          'none';
                                      }}
                                    />
                                  ) : (
                                    <Rss className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                                  )}
                                  <span className="truncate">{sub.title}</span>
                                </div>
                                <div className="flex items-center gap-1 shrink-0">
                                  {getFeedCount(sub) > 0 && (
                                    <span className="text-[11px] text-slate-500">
                                      {getFeedCount(sub)}
                                    </span>
                                  )}
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      onUnsubscribe(sub.id, sub.title);
                                    }}
                                    title="구독 취소"
                                    className="opacity-0 group-hover:opacity-100 p-0.5 text-slate-500 hover:text-rose-400 transition cursor-pointer"
                                  >
                                    <Trash2 className="w-3 h-3" />
                                  </button>
                                </div>
                              </div>
                            );
                          })
                        )}
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Uncategorized Subscriptions */}
              {uncategorizedSubs.length > 0 && (
                <div className="pt-1 space-y-0.5">
                  <div className="px-2.5 py-1 text-[11px] font-semibold text-slate-500">
                    미분류 피드
                  </div>
                  {uncategorizedSubs.map((sub) => {
                    const isFeedActive =
                      activeScope === 'feed' && activeFeedId === sub.feed_id;
                    return (
                      <div
                        key={sub.id}
                        onClick={() => {
                          onSelectScope('feed', null, sub.feed_id);
                          onCloseMobile();
                        }}
                        className={`group flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs transition cursor-pointer ${
                          isFeedActive
                            ? 'bg-emerald-500/15 text-emerald-400 font-semibold'
                            : isDark
                            ? 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'
                            : 'text-slate-600 hover:bg-slate-200/60 hover:text-slate-900'
                        }`}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          {sub.favicon_url ? (
                            <img
                              src={sub.favicon_url}
                              alt=""
                              className="w-3.5 h-3.5 rounded-sm shrink-0"
                            />
                          ) : (
                            <Rss className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                          )}
                          <span className="truncate">{sub.title}</span>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          {getFeedCount(sub) > 0 && (
                            <span className="text-[11px] text-slate-500">
                              {getFeedCount(sub)}
                            </span>
                          )}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onUnsubscribe(sub.id, sub.title);
                            }}
                            title="구독 취소"
                            className="opacity-0 group-hover:opacity-100 p-0.5 text-slate-500 hover:text-rose-400 transition cursor-pointer"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Quick Tools Section */}
          <div className="pt-2 border-t border-slate-800/40 space-y-1">
            <button
              type="button"
              onClick={() => {
                onOpenDiscover('curated');
                onCloseMobile();
              }}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium transition cursor-pointer ${
                isDark
                  ? 'text-slate-400 hover:bg-slate-800/70 hover:text-white'
                  : 'text-slate-600 hover:bg-slate-200/70 hover:text-slate-900'
              }`}
            >
              <Compass className="w-4 h-4 text-emerald-400" />
              <span>추천 피드 카탈로그</span>
            </button>

            <button
              type="button"
              onClick={() => {
                onOpenDiscover('opml');
                onCloseMobile();
              }}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium transition cursor-pointer ${
                isDark
                  ? 'text-slate-400 hover:bg-slate-800/70 hover:text-white'
                  : 'text-slate-600 hover:bg-slate-200/70 hover:text-slate-900'
              }`}
            >
              <FileCode2 className="w-4 h-4 text-blue-400" />
              <span>OPML 가져오기 / 내보내기</span>
            </button>
          </div>
        </div>

        {/* User Footer */}
        <div
          className={`sfeed-sidebar-footer p-3 shrink-0 border-t flex items-center justify-between gap-2 ${
            isDark ? 'border-slate-800/80 bg-slate-950/50' : 'border-slate-200 bg-slate-100/70'
          }`}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <img
              src={
                user.picture ||
                `https://api.dicebear.com/9.x/glass/svg?seed=${encodeURIComponent(
                  user.email
                )}`
              }
              alt={user.name}
              className="w-8 h-8 rounded-full bg-slate-800 shrink-0"
            />
            <div className="min-w-0">
              <div
                className={`text-xs font-semibold truncate ${
                  isDark ? 'text-slate-100' : 'text-slate-900'
                }`}
              >
                {user.name}
              </div>
              <div className="text-[11px] text-slate-400 truncate">
                {user.email}
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={onLogout}
            title="로그아웃 / 계정 전환"
            className="p-2 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-slate-800/40 transition cursor-pointer shrink-0"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </aside>
    </>
  );
};
