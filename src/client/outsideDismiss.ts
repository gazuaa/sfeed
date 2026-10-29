import { useEffect, type RefObject } from 'react';

/**
 * Closes an open <details> popover on a press outside it or a resize. The press only
 * closes it: the click it would have made is swallowed, so whatever lay behind the
 * popover is not tapped too. A press that turns into a scroll swallows nothing.
 */
export function useOutsideDismiss(ref: RefObject<HTMLDetailsElement | null>) {
  useEffect(() => {
    let swallowing: ReturnType<typeof setTimeout> | undefined;
    const stop = () => { clearTimeout(swallowing); swallowing = undefined; };
    const close = () => { if (ref.current) ref.current.open = false; };
    const press = (event: PointerEvent) => {
      const details = ref.current;
      if (!details?.open || details.contains(event.target as Node)) return;
      close();
      stop(); swallowing = setTimeout(stop, 1000);
    };
    const swallow = (event: Event) => {
      if (!swallowing) return;
      event.preventDefault(); event.stopPropagation();
      if (event.type === 'click') stop();
    };
    document.addEventListener('pointerdown', press, true);
    document.addEventListener('pointercancel', stop, true);
    window.addEventListener('mousedown', swallow, true);
    window.addEventListener('click', swallow, true);
    window.addEventListener('resize', close);
    return () => {
      stop();
      document.removeEventListener('pointerdown', press, true);
      document.removeEventListener('pointercancel', stop, true);
      window.removeEventListener('mousedown', swallow, true);
      window.removeEventListener('click', swallow, true);
      window.removeEventListener('resize', close);
    };
  }, [ref]);
}
