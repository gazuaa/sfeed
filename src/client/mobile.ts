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
/** `frame` is a web copy that posts its scroll position (see framedCopy); it is used when `ref` is empty. */
export function useScrollChrome(ref: RefObject<HTMLElement | null>, enabled: boolean, resetKey = '', frame?: RefObject<HTMLIFrameElement | null>) {
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    setHidden(false);
    const element = ref.current, copy = frame?.current;
    if (!enabled || (!element && !copy)) return;
    let position = { top: element?.scrollTop ?? 0, travel: 0, hidden: false }, viewport = element?.clientHeight ?? 0;
    const move = (top: number, max: number, height: number) => {
      // Bars folding away at the bottom grow the viewport, which pulls the position up; that is not a scroll back up.
      const resized = height !== viewport;
      viewport = height;
      if (resized && top >= max - 1) { position = { ...position, top: Math.max(0, top), travel: 0 }; return; }
      const shell = (element ?? copy)!.closest('.sfeed-mobile-library, .sfeed-workspace');
      const locked = Boolean(document.querySelector('dialog[open]') || shell?.querySelector('.sfeed-mobile-settings[open]')) || /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName ?? '');
      position = scrollChrome(position, top, max, locked);
      setHidden(position.hidden);
    };
    if (element) {
      const scroll = () => move(element.scrollTop, element.scrollHeight - element.clientHeight, element.clientHeight);
      element.addEventListener('scroll', scroll, { passive: true });
      return () => element.removeEventListener('scroll', scroll);
    }
    const message = (event: MessageEvent) => {
      const sample = event.data?.sfeedScroll;
      if (event.source !== copy!.contentWindow || !Array.isArray(sample)) return;
      move(Number(sample[0]) || 0, Number(sample[1]) || 0, Number(sample[2]) || 0);
    };
    window.addEventListener('message', message);
    return () => window.removeEventListener('message', message);
  }, [ref, frame, enabled, resetKey]);
  return enabled && hidden;
}

// A sandboxed copy cannot be read from the app, so it reports its own scroll.
// The policy lets only this script run; the copy itself stays script-free.
// Without its scripts a page can lay out a little wider than the frame; it never pans
// sideways, so a sideways drag reaches the web view's swipe-back pager instead.
const COPY_PREAMBLE = `<style>html,body{overflow-x:hidden!important}</style><meta http-equiv="Content-Security-Policy" content="script-src 'nonce-sfeed-scroll'"><script nonce="sfeed-scroll">addEventListener('scroll',()=>{const d=document.scrollingElement||document.documentElement;parent.postMessage({sfeedScroll:[d.scrollTop,d.scrollHeight-innerHeight,innerHeight]},'*')},{passive:true})</script>`;
export const framedCopy = (html: string) => html.replace(/^(\s*<!doctype[^>]*>)?(\s*<html[^>]*>)?/i, (start) => start + COPY_PREAMBLE);
