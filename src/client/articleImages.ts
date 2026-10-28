import { revealLazyImages } from '../shared/lazyImages';

// A picture's name without its size variant: photo_T1.jpg and photo_P1.jpg,
// or photo-300x200.jpg and photo.jpg, are the same picture.
function imageStem(url: string) {
  try {
    const name = decodeURIComponent(new URL(url, 'https://sfeed.invalid').pathname.split('/').pop() || '').toLowerCase();
    return name.replace(/\.[a-z0-9]{2,5}$/, '').replace(/@\dx$/, '').replace(/(?:[-_](?:\d+x\d+|[a-z]\d{1,2}|thumb(?:nail)?|small|medium|large|scaled|cropped|resized))+$/, '');
  } catch { return ''; }
}

/** Whether the body already shows the lead image, in this size or another. */
export function bodyShowsImage(html: string, url: string) {
  if (html.includes(url)) return true;
  const stem = imageStem(url);
  if (stem.length < 8) return false;
  for (const [tag] of html.matchAll(/<img\b[^>]*>/gi)) {
    for (const [, value] of tag.matchAll(/\s(?:src|data-src|data-lazy-src|data-original)\s*=\s*["']([^"']+)["']/gi)) if (imageStem(value) === stem) return true;
  }
  return false;
}

/**
 * Bodies saved before lazy images were revealed on the server still hold
 * blank stand-ins, so the rendered body gets the same repair. Images that
 * fail or turn out to be a pixel are hidden rather than left as a gap.
 */
export function bindArticleImages(container: HTMLElement, base: string) {
  revealLazyImages(container, base);
  const hide = (event: Event) => {
    const img = event.target;
    if (img instanceof HTMLImageElement && (event.type === 'error' || (img.naturalWidth <= 2 && img.naturalHeight <= 2))) img.style.display = 'none';
  };
  container.addEventListener('error', hide, true);
  container.addEventListener('load', hide, true);
  return () => { container.removeEventListener('error', hide, true); container.removeEventListener('load', hide, true); };
}

/** The same repair for a saved web copy, which renders in a sandbox the app cannot reach into. */
export function revealCopyImages(html: string) {
  if (typeof DOMParser === 'undefined' || !/<img|<source/i.test(html)) return html;
  const document = new DOMParser().parseFromString(html, 'text/html');
  revealLazyImages(document);
  return '<!doctype html>' + document.documentElement.outerHTML;
}
