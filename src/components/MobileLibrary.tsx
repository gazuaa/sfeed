import { useRef, useState } from 'react';
import { Archive, ChevronDown, ChevronRight, Folder, FolderPlus, LogOut, Rss, Trash2 } from 'lucide-react';
import type { BootstrapResponse, FolderItem, SubscriptionItem, UserProfile } from '../client/api';
import { MobileHeader, MobileDock, type LibraryTab, type MobileSettingsProps } from './MobileChrome';
import { InstallCard } from './PwaInstall';
import { useScrollChrome } from '../client/mobile';

export function MobileLibrary({ user, folders, subscriptions, counts, countTab, visible = true, onChangeCountTab, onSelectTab, onSelectFolder, onSelectFeed, onAdd, onRefresh, refreshing, syncing, onCreateFolder, onDeleteFolder, onUnsubscribe, onLogout, ...settings }: MobileSettingsProps & {
  user: UserProfile; folders: FolderItem[]; subscriptions: SubscriptionItem[]; counts: BootstrapResponse['counts'];
  /** Which count each folder and feed shows; the dock tabs switch it in place. */
  countTab: LibraryTab; onChangeCountTab: (tab: LibraryTab) => void;
  visible?: boolean;
  onSelectTab: (tab: LibraryTab) => void; onSelectFolder: (id: string) => void; onSelectFeed: (id: string) => void; onAdd: () => void; onRefresh: () => void; refreshing: boolean; syncing?: boolean; onCreateFolder: (name: string) => Promise<void>;
  /** Both ask for confirmation before anything is removed. */
  onDeleteFolder: (id: string) => void; onUnsubscribe: (subscriptionId: string, title: string) => void; onLogout: () => void;
}) {
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [newFolder, setNewFolder] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  // Touch screens have no hover, so removing feeds and folders lives in an edit mode.
  const [editing, setEditing] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const chromeHidden = useScrollChrome(scrollRef, visible && !editing && newFolder === null, `${query}:${countTab}`);
  const total = countTab === 'saved' ? counts.savedCount : countTab === 'unread' ? counts.totalUnread : counts.totalArticles;
  const matches = (value: string) => value.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
  const count = (feed: SubscriptionItem) => countTab === 'saved' ? feed.saved_count : countTab === 'unread' ? feed.unread_count : feed.total_count;
  const visibleSubscriptions = countTab === 'unread' ? subscriptions.filter((feed) => feed.unread_count > 0) : subscriptions;
  const visibleFolders = countTab === 'unread' ? folders.filter((folder) => visibleSubscriptions.some((feed) => feed.folder_id === folder.id)) : folders;
  const deleteButton = (label: string, onDelete: () => void) => <button type="button" className="sfeed-mobile-delete" aria-label={label} onClick={onDelete}><Trash2 size={17} /></button>;
  const feedRow = (feed: SubscriptionItem) => <div className="sfeed-mobile-row-wrap" key={feed.id} data-feed-id={feed.feed_id}><button className="sfeed-mobile-library-row sfeed-mobile-feed-row" onClick={() => onSelectFeed(feed.feed_id)}>{feed.favicon_url ? <img src={feed.favicon_url} alt="" /> : <Rss size={20} />}<span>{feed.title}</span><span className="sfeed-mobile-count">{count(feed).toLocaleString()}</span>{!editing && <ChevronRight size={17} />}</button>{editing && deleteButton(`${feed.title} 구독 취소`, () => onUnsubscribe(feed.id, feed.title))}</div>;
  const ungrouped = visibleSubscriptions.filter((feed) => !feed.folder_id || !folders.some((folder) => folder.id === feed.folder_id));
  return <section className="sfeed-mobile-library lg:hidden" aria-label="내 피드">
    <MobileHeader library hidden={chromeHidden} title="SFeed" search={query} onSearch={setQuery} onAdd={onAdd} {...settings} />
    <div ref={scrollRef} className="sfeed-mobile-library-scroll">
      {!query.trim() && <InstallCard />}
      {!query.trim() && <><h2 className="sfeed-mobile-section-title">라이브러리</h2><div className="sfeed-mobile-library-group"><button className="sfeed-mobile-library-row" onClick={() => onSelectTab(countTab)}><Archive size={21} /><span>전체 글</span><span className="sfeed-mobile-count">{total.toLocaleString()}</span><ChevronRight size={17} /></button></div></>}
      <div className="sfeed-mobile-section-title"><h2>{query.trim() ? '검색 결과' : '폴더'}</h2><span className="sfeed-mobile-section-actions">{(folders.length > 0 || subscriptions.length > 0) && <button className="sfeed-mobile-edit" aria-pressed={editing} onClick={() => setEditing((value) => !value)}>{editing ? '완료' : '편집'}</button>}<button aria-label="폴더 추가" onClick={() => setNewFolder('')}><FolderPlus size={18} /></button></span></div>
      {newFolder !== null && <form className="sfeed-mobile-new-folder" onSubmit={async (event) => { event.preventDefault(); if (!newFolder.trim() || creating) return; setCreating(true); setError(''); try { await onCreateFolder(newFolder.trim()); setNewFolder(null); } catch { setError('폴더를 만들지 못했습니다. 다시 시도해 주세요.'); } finally { setCreating(false); } }}><input aria-label="새 폴더 이름" placeholder="새 폴더 이름" value={newFolder} onChange={(event) => setNewFolder(event.target.value)} autoFocus /><button disabled={creating || !newFolder.trim()}>추가</button><button type="button" disabled={creating} onClick={() => setNewFolder(null)}>취소</button>{error && <p role="alert">{error}</p>}</form>}
      <div className="sfeed-mobile-library-group">{visibleFolders.filter((folder) => matches(folder.name) || visibleSubscriptions.some((feed) => feed.folder_id === folder.id && matches(feed.title))).map((folder) => { const feeds = visibleSubscriptions.filter((feed) => feed.folder_id === folder.id); return <div key={folder.id} data-folder-id={folder.id}><div className="sfeed-mobile-folder-row"><button className="sfeed-mobile-library-row" onClick={() => onSelectFolder(folder.id)}><Folder size={21} /><span>{folder.name}</span><span className="sfeed-mobile-count">{feeds.reduce((sum, feed) => sum + count(feed), 0).toLocaleString()}</span></button>{editing ? deleteButton(`${folder.name} 폴더 삭제`, () => onDeleteFolder(folder.id)) : <button className="sfeed-mobile-expand" aria-label={`${folder.name} 피드 ${expanded[folder.id] ? '접기' : '펼치기'}`} aria-expanded={Boolean(expanded[folder.id])} onClick={() => setExpanded((value) => ({ ...value, [folder.id]: !value[folder.id] }))}><ChevronDown size={18} className={expanded[folder.id] ? 'rotate-180' : ''} /></button>}</div>{(expanded[folder.id] || query.trim() || editing) && <div className="sfeed-mobile-folder-feeds">{feeds.filter((feed) => matches(feed.title) || matches(folder.name)).map(feedRow)}{feeds.length === 0 && <p className="sfeed-mobile-empty">이 폴더에 구독한 피드가 없습니다.</p>}</div>}</div>; })}</div>
      {ungrouped.length > 0 && <><h2 className="sfeed-mobile-section-title">미분류 피드</h2><div className="sfeed-mobile-library-group">{ungrouped.filter((feed) => matches(feed.title)).map(feedRow)}</div></>}
      {query.trim() && !subscriptions.some((feed) => matches(feed.title)) && !folders.some((folder) => matches(folder.name)) && <p className="sfeed-mobile-empty">일치하는 폴더나 피드가 없습니다.</p>}
      {!subscriptions.length && <div className="sfeed-mobile-empty"><Rss size={28} /><p>관심 있는 피드를 추가해 보세요.</p><button onClick={onAdd}>피드 찾아보기</button></div>}
      <div className="sfeed-mobile-account"><span><strong>{user.name}</strong><small>{user.email}</small></span><button className="sfeed-mobile-icon" aria-label="로그아웃 / 계정 전환" onClick={onLogout}><LogOut size={20} /></button></div>
    </div>
    <MobileDock library hidden={chromeHidden} active={countTab} onSelect={onChangeCountTab} onRefresh={onRefresh} refreshing={refreshing} syncing={syncing} onAdd={onAdd} onMarkAllRead={() => {}} />
  </section>;
}
