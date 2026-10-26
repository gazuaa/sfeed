interface Point { x: number; y: number; time: number }
export function isBackSwipe(start: Point, end: Point) {
  const dx = end.x - start.x, dy = Math.abs(end.y - start.y);
  return dx >= 64 && dx > dy * 1.8 && end.time - start.time <= 900;
}

// Ordinary rightward swipes use the same history as native Back. Leave the
// screen edges to iOS so one gesture cannot trigger both navigation paths.
export function bindSwipeBack(document: Document, navigation: { canGoBack(): boolean; back(): void }) {
  const view = document.defaultView;
  if (!view) return () => {};
  let start: Point | null = null;
  let claimed = false;
  const cancel = () => { start = null; claimed = false; };
  const point = (touch: Touch, time: number): Point => ({ x: touch.clientX, y: touch.clientY, time });
  const begin = (event: TouchEvent) => {
    cancel();
    if (event.touches.length !== 1 || !navigation.canGoBack() || (view.visualViewport?.scale ?? 1) > 1.05 || document.querySelector('dialog[open], [aria-modal="true"]') || document.getSelection()?.isCollapsed === false) return;
    const target = event.target as HTMLElement | null;
    const container = target?.closest('.sfeed-feed-list, .sfeed-mobile-library-scroll, .sfeed-reader-content');
    if (!container || target?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="slider"], video, audio, iframe, summary, button:not(.sfeed-mobile-library-row)')) return;
    // Preserve horizontal code blocks, tables and carousels.
    for (let node = target; node && node !== container; node = node.parentElement) {
      if (node.scrollWidth > node.clientWidth + 4 && /auto|scroll/.test(view.getComputedStyle(node).overflowX)) return;
    }
    const touch = event.touches[0];
    if (touch.clientX <= 24 || touch.clientX >= view.innerWidth - 24) return;
    start = point(touch, event.timeStamp);
  };
  const move = (event: TouchEvent) => {
    if (!start) return;
    if (event.touches.length !== 1) { cancel(); return; }
    const current = point(event.touches[0], event.timeStamp);
    const dx = current.x - start.x, dy = Math.abs(current.y - start.y);
    if (!claimed && (dy > 12 && dy > Math.abs(dx) || dx < -12)) { cancel(); return; }
    if (dx > 12 && dx > dy * 1.8) claimed = true;
    if (claimed) {
      if (event.cancelable) event.preventDefault();
      else cancel(); // the browser already took ownership of this gesture
    }
  };
  const end = (event: TouchEvent) => {
    const initial = start, touch = event.changedTouches[0];
    cancel();
    if (!initial || !touch || !event.cancelable || !isBackSwipe(initial, point(touch, event.timeStamp)) || !navigation.canGoBack()) return;
    event.preventDefault();
    navigation.back();
  };
  document.addEventListener('touchstart', begin, { passive: true, capture: true });
  document.addEventListener('touchmove', move, { passive: false, capture: true });
  document.addEventListener('touchend', end, { passive: false, capture: true });
  document.addEventListener('touchcancel', cancel, { passive: true, capture: true });
  view.addEventListener('popstate', cancel);
  return () => {
    document.removeEventListener('touchstart', begin, { capture: true });
    document.removeEventListener('touchmove', move, { capture: true });
    document.removeEventListener('touchend', end, { capture: true });
    document.removeEventListener('touchcancel', cancel, { capture: true });
    view.removeEventListener('popstate', cancel);
  };
}
