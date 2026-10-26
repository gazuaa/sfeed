import { useLayoutEffect, useRef } from 'react';
import type { ScopeType } from './api';

export interface MobileLocation {
  scope: ScopeType;
  folderId: string | null;
  feedId: string | null;
  search: string;
  unread: boolean;
  articleId: string | null;
  library: boolean;
}

interface Entry {
  version: 1;
  account: string;
  index: number;
  location: MobileLocation;
  list: number | null;
  library: number | null;
  scroll: number;
}
const key = 'sfeedNavigation';
const equal = (a: MobileLocation, b: MobileLocation) => JSON.stringify(a) === JSON.stringify(b);
const sameList = (a: MobileLocation, b: MobileLocation) => a.scope === b.scope && a.folderId === b.folderId && a.feedId === b.feedId && a.unread === b.unread && a.search === b.search;
const root = (location: MobileLocation): MobileLocation => ({ ...location, articleId: null, library: true });

// Keep only navigation identifiers in history, never article bodies or tokens.
// Using the native stack lets iOS edge swipes and browser Back/Forward agree.
export class MobileNavigation {
  private current: Entry;
  private restoring: MobileLocation | null = null;
  private observed: MobileLocation;
  constructor(private history: Pick<History, 'state' | 'pushState' | 'replaceState' | 'go'>, private account: string, initial: MobileLocation, private restore: (location: MobileLocation, scroll: number) => void) {
    this.observed = initial;
    this.current = this.read(history.state) ?? { version: 1, account, index: 0, location: root(initial), list: null, library: null, scroll: 0 };
    this.write(this.current, false);
    if (!equal(this.current.location, initial)) this.apply(this.current);
  }
  private read(state: unknown): Entry | null {
    const entry = (state as Record<string, Entry> | null)?.[key];
    if (entry?.version !== 1 || entry.account !== this.account || !Number.isInteger(entry.index) || entry.index < 0) return null;
    const loc = entry.location;
    if (!loc || !['all', 'today', 'saved', 'folder', 'feed'].includes(loc.scope) || typeof loc.search !== 'string' || typeof loc.unread !== 'boolean' || typeof loc.library !== 'boolean' || ![loc.folderId, loc.feedId, loc.articleId].every((id) => id === null || typeof id === 'string')) return null;
    return entry;
  }
  private write(entry: Entry, push: boolean) {
    this.history[push ? 'pushState' : 'replaceState']({ ...this.history.state, [key]: entry }, '');
    this.current = entry;
  }
  private apply(entry: Entry) {
    this.current = entry;
    // A close button can update React before the asynchronous popstate arrives.
    // In that case React may skip rendering identical state, so no render is
    // needed to acknowledge restoration.
    this.restoring = equal(entry.location, this.observed) ? null : entry.location;
    this.restore(entry.location, entry.scroll);
  }
  pop(state: unknown) {
    const entry = this.read(state);
    if (entry) this.apply(entry);
    else {
      // Entries from a previous login must never reopen that account's article.
      const safe = { ...this.current, index: 0, location: root(this.current.location), list: null, library: null, scroll: 0 };
      this.write(safe, false);
      this.apply(safe);
    }
  }
  record(location: MobileLocation, scroll = 0) {
    this.observed = location;
    if (this.restoring) {
      if (equal(location, this.restoring)) this.restoring = null;
      return;
    }
    const previous = this.current;
    if (equal(previous.location, location)) return;
    // Capture the list's position before opening a reader. The list stays
    // mounted, and this also restores it after a reload or a scope change.
    if (!previous.location.articleId && !previous.location.library) this.write({ ...previous, scroll }, false);
    if (previous.location.articleId && !location.articleId && !location.library && sameList(previous.location, location) && previous.list !== null) {
      this.restoring = location;
      this.history.go(previous.list - previous.index);
      return;
    }
    if (!previous.location.library && location.library && previous.library !== null) {
      this.restoring = location;
      this.history.go(previous.library - previous.index);
      return;
    }
    // Editing a search field should not create one Back step per character.
    const typing = previous.location.search !== location.search && equal({ ...previous.location, search: location.search }, location);
    const index = previous.index + (typing ? 0 : 1);
    this.write({ version: 1, account: this.account, index, location,
      list: location.articleId ? previous.location.articleId ? previous.list : previous.index : location.library ? null : index,
      library: location.library ? null : previous.location.library ? previous.index : previous.library,
      scroll: location.articleId ? this.current.scroll : typing ? scroll : 0,
    }, !typing);
  }
}

export function useMobileNavigation(account: string | null, location: MobileLocation, restore: (location: MobileLocation, scroll: number) => void, getScroll: () => number) {
  const latest = useRef({ location, restore, getScroll });
  latest.current = { location, restore, getScroll };
  const controller = useRef<MobileNavigation | null>(null);
  useLayoutEffect(() => {
    if (!account) return;
    const navigation = new MobileNavigation(window.history, account, latest.current.location, (loc, scroll) => latest.current.restore(loc, scroll));
    controller.current = navigation;
    const pop = (event: PopStateEvent) => navigation.pop(event.state);
    window.addEventListener('popstate', pop);
    return () => { window.removeEventListener('popstate', pop); controller.current = null; };
  }, [account]);
  useLayoutEffect(() => { controller.current?.record(location, latest.current.getScroll()); });
}
