import { useEffect, useState, useSyncExternalStore, type RefObject } from 'react';
const query = '(max-width: 1023px)';
const subscribe = (callback: () => void) => { const media = window.matchMedia(query); media.addEventListener('change', callback); return () => media.removeEventListener('change', callback); };
export const useMobileViewport = () => useSyncExternalStore(subscribe, () => window.matchMedia(query).matches, () => false);

// Accumulate movement before changing direction; clamp iOS rubber-band scroll
// so bouncing at an edge cannot make the bars flicker.
export function scrollChrome(previous: { top: number; travel: number; hidden: boolean }, top: number, max: number, locked = false) {
  const next = Math.max(0, Math.min(max, top));
  const delta = next - previous.top;
  const travel = Math.sign(delta) === Math.sign(previous.travel) ? previous.travel + delta : delta;
  return { top: next, travel, hidden: locked || next < 24 ? false : travel > 18 ? true : travel < -12 ? false : previous.hidden };
}
export function useScrollChrome(ref: RefObject<HTMLElement | null>, enabled: boolean, resetKey = '') {
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    setHidden(false);
    const element = ref.current;
    if (!enabled || !element) return;
    let position = { top: element.scrollTop, travel: 0, hidden: false };
    const scroll = () => {
      const shell = element.closest('.sfeed-mobile-library, .sfeed-workspace');
      const locked = Boolean(document.querySelector('dialog[open]') || shell?.querySelector('.sfeed-mobile-settings[open]')) || /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName ?? '');
      position = scrollChrome(position, element.scrollTop, element.scrollHeight - element.clientHeight, locked);
      setHidden(position.hidden);
    };
    element.addEventListener('scroll', scroll, { passive: true });
    return () => element.removeEventListener('scroll', scroll);
  }, [ref, enabled, resetKey]);
  return enabled && hidden;
}
