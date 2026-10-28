interface Point { x: number; y: number; time: number }
export function isBackSwipe(start: Point, end: Point) {
  const dx = end.x - start.x, dy = Math.abs(end.y - start.y);
  return dx >= 64 && dx > dy * 1.8 && end.time - start.time <= 900;
}

/** A slow, deliberate drag also goes back once it covers this share of the screen. */
const COMMIT_SHARE = 0.4;
const PARALLAX = 0.3;
const DURATION = 220;
const EASING = 'cubic-bezier(.2, .8, .2, 1)';

export interface SwipeNavigation {
  canGoBack(): boolean;
  back(): void;
  /** Where Back leads from a list: the library, or an earlier state of the list. */
  backTarget?(): 'library' | 'other';
}

// The screen that leaves follows the finger; the one it returns to slides in
// from a little to the left, the way iOS navigation does.
interface SwipeScene { top: HTMLElement[]; under: HTMLElement[]; revealLibrary: boolean }

function findScene(document: Document, navigation: SwipeNavigation): SwipeScene | null {
  const view = document.defaultView;
  if (!view || view.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) return null;
  const reader = document.querySelector<HTMLElement>('.sfeed-article-reader');
  if (reader && view.getComputedStyle(reader).position === 'fixed' && reader.querySelector('.sfeed-reader')) {
    const under = [document.querySelector<HTMLElement>('.sfeed-workspace-header'), document.querySelector<HTMLElement>('.sfeed-feed-list')];
    return { top: [reader], under: under.filter((node): node is HTMLElement => Boolean(node)), revealLibrary: false };
  }
  const workspace = document.querySelector<HTMLElement>('.sfeed-workspace');
  if (!workspace || navigation.backTarget?.() !== 'library') return null;
  const docks = Array.from(document.querySelectorAll<HTMLElement>('.sfeed-mobile-dock')).filter((dock) => !dock.closest('.sfeed-mobile-library') && !dock.classList.contains('sfeed-mobile-reader-dock'));
  const library = document.querySelector<HTMLElement>('.sfeed-mobile-library');
  return { top: [workspace, ...docks], under: library ? [library] : [], revealLibrary: true };
}

function present(document: Document, scene: SwipeScene) {
  const width = document.defaultView?.innerWidth || 1;
  const root = document.documentElement;
  if (scene.revealLibrary) {
    root.dataset.sfeedSwipe = 'library';
    // The library normally covers the list; while revealed underneath, the list stays on top.
    scene.top[0].style.zIndex = '41';
  }
  for (const node of [...scene.top, ...scene.under]) { node.style.willChange = 'transform'; node.style.transition = 'none'; }
  const place = (dx: number, animate: boolean) => {
    const progress = Math.min(1, Math.max(0, dx / width));
    for (const node of [...scene.top, ...scene.under]) node.style.transition = animate ? `transform ${DURATION}ms ${EASING}, box-shadow ${DURATION}ms ${EASING}` : 'none';
    for (const node of scene.top) {
      node.style.transform = `translate3d(${Math.max(0, dx)}px, 0, 0)`;
      node.style.boxShadow = `-10px 0 30px rgba(15, 23, 42, ${0.18 * (1 - progress)})`;
    }
    for (const node of scene.under) node.style.transform = `translate3d(${-(1 - progress) * PARALLAX * width}px, 0, 0)`;
  };
  const clear = () => {
    for (const node of [...scene.top, ...scene.under]) {
      for (const property of ['transform', 'transition', 'will-change', 'box-shadow', 'z-index']) node.style.removeProperty(property);
    }
    delete root.dataset.sfeedSwipe;
  };
  return { width, place, clear };
}

/** A home-screen app has no system edge swipe, so nothing else claims the screen edges. */
export const homeScreenApp = (view: Window) => Boolean(view.matchMedia?.('(display-mode: standalone)')?.matches || (view.navigator as (Navigator & { standalone?: boolean }) | undefined)?.standalone === true);

// Ordinary rightward swipes use the same history as native Back. In Safari the
// screen edges stay with iOS so one gesture cannot trigger both navigation paths;
// a home-screen app has no such gesture, so a swipe from its left edge goes back too.
export function bindSwipeBack(document: Document, navigation: SwipeNavigation) {
  const view = document.defaultView;
  if (!view) return () => {};
  let start: Point | null = null;
  let last: Point | null = null;
  let claimed = false;
  let stage: ReturnType<typeof present> | null = null;
  let settling = false;
  const cancel = () => { start = null; last = null; claimed = false; };
  const point = (touch: Touch, time: number): Point => ({ x: touch.clientX, y: touch.clientY, time });
  // Slide the drag back into place and drop the inline styles afterwards.
  const restore = () => {
    const current = stage;
    stage = null;
    if (!current) return;
    current.place(0, true);
    view.setTimeout(current.clear, DURATION + 40);
  };
  // Finish the slide, go Back, and keep the leaving screen off to the side
  // until the history change has rendered so it never flashes back.
  const commit = () => {
    const current = stage;
    stage = null;
    if (!current) { navigation.back(); return; }
    settling = true;
    current.place(current.width, true);
    view.setTimeout(() => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        view.removeEventListener('popstate', settle);
        settling = false;
        current.clear();
      };
      const settle = () => view.requestAnimationFrame(() => view.requestAnimationFrame(finish));
      view.addEventListener('popstate', settle);
      view.setTimeout(finish, 800);
      navigation.back();
    }, DURATION);
  };
  const begin = (event: TouchEvent) => {
    cancel();
    if (settling || event.touches.length !== 1 || !navigation.canGoBack() || (view.visualViewport?.scale ?? 1) > 1.05 || document.querySelector('dialog[open], [aria-modal="true"]') || document.getSelection()?.isCollapsed === false) return;
    const target = event.target as HTMLElement | null;
    // A framed site keeps its own touches; the web view leaves an edge strip for this gesture.
    const strip = Boolean(target?.closest('.sfeed-web-swipe'));
    const container = strip ? target : target?.closest('.sfeed-feed-list, .sfeed-mobile-library-scroll, .sfeed-reader-content');
    if (!container || target?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="slider"], video, audio, iframe, summary, button:not(.sfeed-mobile-library-row)')) return;
    // Preserve horizontal code blocks, tables and carousels.
    for (let node = target; node && node !== container; node = node.parentElement) {
      if (node.scrollWidth > node.clientWidth + 4 && /auto|scroll/.test(view.getComputedStyle(node).overflowX)) return;
    }
    const touch = event.touches[0];
    if ((touch.clientX <= 24 && !homeScreenApp(view)) || touch.clientX >= view.innerWidth - 24) return;
    start = point(touch, event.timeStamp);
    last = start;
  };
  const move = (event: TouchEvent) => {
    if (!start) return;
    if (event.touches.length !== 1) { cancel(); restore(); return; }
    const current = point(event.touches[0], event.timeStamp);
    const dx = current.x - start.x, dy = Math.abs(current.y - start.y);
    if (!claimed && (dy > 12 && dy > Math.abs(dx) || dx < -12)) { cancel(); return; }
    if (!claimed && dx > 12 && dx > dy * 1.8) {
      claimed = true;
      const scene = findScene(document, navigation);
      if (scene) stage = present(document, scene);
    }
    if (claimed) {
      if (event.cancelable) {
        event.preventDefault();
        stage?.place(dx, false);
      } else { cancel(); restore(); } // the browser already took ownership of this gesture
    }
    last = current;
  };
  const end = (event: TouchEvent) => {
    const initial = start, previous = last, touch = event.changedTouches[0];
    cancel();
    if (!initial || !touch || !event.cancelable || !navigation.canGoBack()) { restore(); return; }
    const final = point(touch, event.timeStamp);
    const dx = final.x - initial.x, dy = Math.abs(final.y - initial.y);
    // A flick goes back from a short distance; a slow drag needs to cover the screen.
    const flick = isBackSwipe(initial, final) || Boolean(previous && previous !== initial && final.time > previous.time && (final.x - previous.x) / (final.time - previous.time) > 0.6 && dx >= 64);
    if (!(flick || (stage && dx >= view.innerWidth * COMMIT_SHARE && dx > dy))) { restore(); return; }
    event.preventDefault();
    commit();
  };
  const abort = () => { cancel(); restore(); };
  document.addEventListener('touchstart', begin, { passive: true, capture: true });
  document.addEventListener('touchmove', move, { passive: false, capture: true });
  document.addEventListener('touchend', end, { passive: false, capture: true });
  document.addEventListener('touchcancel', abort, { passive: true, capture: true });
  view.addEventListener('popstate', cancel);
  return () => {
    document.removeEventListener('touchstart', begin, { capture: true });
    document.removeEventListener('touchmove', move, { capture: true });
    document.removeEventListener('touchend', end, { capture: true });
    document.removeEventListener('touchcancel', abort, { capture: true });
    view.removeEventListener('popstate', cancel);
    stage?.clear();
    stage = null;
  };
}
