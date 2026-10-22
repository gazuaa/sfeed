import { useEffect, useRef, useState } from 'react';
import { apiRequest, type ArticleItem } from './api';

// Feeds without images: look up the article page's og:image once the article
// nears the viewport, a few at a time. The server stores the answer ('' when
// the page has none), so every article is looked up only once.
const MAX_PARALLEL = 4;
const lookups = new Map<string, Promise<string>>();
const waiting: Array<() => void> = [];
let running = 0;

function lookupThumbnail(articleId: string): Promise<string> {
  let lookup = lookups.get(articleId);
  if (!lookup) {
    lookup = new Promise<void>((resolve) => {
      const start = () => {
        running++;
        resolve();
      };
      if (running < MAX_PARALLEL) start();
      else waiting.push(start);
    })
      .then(() =>
        apiRequest<{ thumbnailUrl: string | null }>(`/api/articles/${articleId}/thumbnail`, {
          method: 'POST',
        })
      )
      .then(
        (res) => res.thumbnailUrl ?? '',
        () => ''
      )
      .finally(() => {
        running--;
        waiting.shift()?.();
      });
    lookups.set(articleId, lookup);
  }
  return lookup;
}

/**
 * The thumbnail to show for an article: the stored one, or one looked up when
 * the element behind `ref` becomes visible. `pending` is true while unknown.
 */
export function useArticleThumbnail<T extends Element>(article: ArticleItem) {
  const ref = useRef<T>(null);
  const stored = article.thumbnail_url; // null: never looked up, '': no image
  const [found, setFound] = useState<string | null>(null);

  useEffect(() => {
    const element = ref.current;
    if (stored !== null || !element) return;
    let active = true;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        lookupThumbnail(article.id).then((url) => {
          if (active) setFound(url);
        });
      },
      { rootMargin: '300px 0px' }
    );
    observer.observe(element);
    return () => {
      active = false;
      observer.disconnect();
    };
  }, [article.id, stored]);

  return {
    ref,
    url: stored || found || null,
    pending: stored === null && found === null,
  };
}
