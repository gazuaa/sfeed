const MEDIA = 'img,picture,video,audio';
const DATE = /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4}\b|\b\d{4}[-./]\d{1,2}[-./]\d{1,2}\b|\d{4}년\s*\d{1,2}월\s*\d{1,2}일/i;
const BYLINE = /^\s*(?:by|written by|posted by)\s+\p{Lu}/u;

const words = (value: string | null | undefined) => (value || '').toLowerCase().replace(/[\s ]+/g, ' ').replace(/[“”"'‘’]/g, '').trim();
const text = (node: Element) => (node.textContent || '').replace(/\s+/g, ' ').trim();
const linkShare = (node: Element) => {
  const length = text(node).length;
  return length ? Array.from(node.querySelectorAll('a')).reduce((sum, link) => sum + text(link).length, 0) / length : 1;
};

/** A title as the page-title comparison sees it. */
export const titleKey = words;

/** The page's own name for the article: og:title, else <title> with its " | Site" suffix as well. */
export function pageTitles(document: Document): string[] {
  const titles = [document.querySelector('meta[property="og:title"]')?.getAttribute('content'), document.querySelector('meta[name="twitter:title"]')?.getAttribute('content'), document.querySelector('title')?.textContent];
  return [...new Set(titles.flatMap((title) => [title, title?.split(/\s+[|–—-]\s+/)[0]]).map(words).filter((title) => title.length >= 12))];
}

/**
 * A reader body is the article alone; the reader shows its title, source and date itself.
 * From the page's article markup this drops the page's own title, the byline and date
 * lines before the text, "preferred source" and share buttons, and cards for other stories.
 */
export function dropArticleChrome(body: Element, titles: string[]) {
  for (const heading of Array.from(body.querySelectorAll('h1,h2')).slice(0, 3)) {
    if (titles.includes(words(heading.textContent))) heading.remove();
  }
  for (const node of Array.from(body.querySelectorAll('a[href*="google.com/preferences/source"], button'))) {
    if (!node.querySelector(MEDIA) || node.tagName === 'A') node.remove();
  }
  // Short byline and date lines, only ahead of the first full paragraph.
  const first = Array.from(body.querySelectorAll('p')).find((p) => text(p).length >= 200);
  const before = (node: Element) => !first || Boolean(node.compareDocumentPosition(first) & 4);
  for (const node of Array.from(body.querySelectorAll('div,p,span,time,address'))) {
    if (!node.isConnected || !before(node) || node.closest('figure,figcaption,blockquote,li,table') || node.querySelector('p,h1,h2,h3,ul,ol,figure,' + MEDIA)) continue;
    const line = text(node);
    if (!line || line.length > 100) continue;
    const byline = node.querySelector('a[href*="/author"],[rel~="author"],[itemprop="author"]') || BYLINE.test(line);
    const dated = node.tagName === 'TIME' || node.querySelector('time') || (DATE.test(line) && line.length <= 60);
    if (byline || dated) node.remove();
  }
  for (const card of Array.from(body.querySelectorAll('article'))) {
    if (card.isConnected && linkShare(card) >= 0.5) card.remove();
  }
  // A heading those cards leave with nothing after it ("Related articles").
  const last = (node: Element) => {
    for (let at: Element | null = node; at && at !== body; at = at.parentElement) {
      for (let next = at.nextElementSibling; next; next = next.nextElementSibling) if (text(next) || next.matches(MEDIA) || next.querySelector(MEDIA)) return false;
    }
    return true;
  };
  for (const heading of Array.from(body.querySelectorAll('h2,h3,h4,h5,h6')).reverse()) if (last(heading)) heading.remove();
}
