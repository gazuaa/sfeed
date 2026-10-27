import { useLayoutEffect, useRef, type RefObject } from 'react';
export function useListAnchor(ref: RefObject<HTMLElement | null>, rows: unknown[], scope: string) {
  const anchor = useRef<{ id: string; offset: number; scope: string } | null>(null);
  useLayoutEffect(() => {
    const root = ref.current; if (!root) return;
    const remember = () => {
      if (root.scrollTop < 8) { anchor.current = null; return; }
      const top = root.getBoundingClientRect().top;
      const row = [...root.querySelectorAll<HTMLElement>('[data-article-id]')].find((item) => item.getBoundingClientRect().bottom > top);
      anchor.current = row ? { id: row.dataset.articleId!, offset: row.getBoundingClientRect().top - top, scope } : null;
    };
    const previous = anchor.current;
    if (previous?.scope === scope) {
      const row = [...root.querySelectorAll<HTMLElement>('[data-article-id]')].find((item) => item.dataset.articleId === previous.id);
      if (row) root.scrollTop += row.getBoundingClientRect().top - root.getBoundingClientRect().top - previous.offset;
    }
    remember(); root.addEventListener('scroll', remember, { passive: true });
    return () => root.removeEventListener('scroll', remember);
  }, [ref, rows, scope]);
}
