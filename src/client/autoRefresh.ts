import { useEffect, useRef } from 'react';
import { validAutoRefresh } from '../shared/preferences';

type Clock = { set: typeof setTimeout; clear: typeof clearTimeout };
export function bindAutoRefresh(doc: Document, minutes: number, refresh: () => Promise<unknown>, clock: Clock = { set: setTimeout.bind(globalThis), clear: clearTimeout.bind(globalThis) }, allowHidden = false) {
  if (!validAutoRefresh(minutes) || minutes === 0) return () => {};
  let disposed = false, running = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = () => {
    clock.clear(timer);
    if (disposed || running || (!allowHidden && doc.visibilityState === 'hidden')) return;
    timer = clock.set(() => {
      if (disposed || (!allowHidden && doc.visibilityState === 'hidden')) return;
      running = true;
      void Promise.resolve().then(() => { if (!disposed && (allowHidden || doc.visibilityState !== 'hidden')) return refresh(); }).catch(() => {}).finally(() => { running = false; schedule(); });
    }, minutes * 60_000);
  };
  doc.addEventListener('visibilitychange', schedule);
  schedule();
  return () => { disposed = true; clock.clear(timer); doc.removeEventListener('visibilitychange', schedule); };
}

export function useAutoRefresh(enabled: boolean, minutes: number, refresh: () => Promise<unknown>, allowHidden = false) {
  const latest = useRef(refresh);
  latest.current = refresh;
  useEffect(() => {
    if (!enabled) return;
    return bindAutoRefresh(document, minutes, () => latest.current(), undefined, allowHidden);
  }, [enabled, minutes, allowHidden]);
}
