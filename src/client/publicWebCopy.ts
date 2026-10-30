import { fetchPublicWebPage } from '../shared/publicWebPage';
import { revealLazyImages } from '../shared/lazyImages';
import { dropSidebars } from '../shared/sidebars';
import { dropEmptySlots } from '../shared/emptySlots';
import { plainCopyStyles } from '../shared/copyStyles';
import { dropConsentBanners } from '../shared/consentBanners';

export function sanitizePublicWebCopy(html: string, url: string): string {
  const document = new DOMParser().parseFromString(html, 'text/html');
  if (/security checkpoint|just a moment|verify you are human|access denied|sign in|log in/i.test(document.title) || /"isAccessibleForFree"\s*:\s*false/.test(html)) throw new Error('공개 기사 본문이 아닙니다.');
  const article = document.querySelector('article,main,[itemprop="articleBody"]');
  if (((article ? article.textContent : document.body?.textContent) || '').trim().length < 120) throw new Error('웹 사본의 본문이 비어 있습니다.');
  document.querySelectorAll('script,noscript,iframe,frame,frameset,object,embed,applet,template,base,meta[http-equiv],link[rel~="preload"],link[rel~="modulepreload"],link[rel~="prefetch"]').forEach((node) => node.remove());
  for (const element of document.querySelectorAll('*')) for (const { name, value } of Array.from(element.attributes)) {
    if (/^on/i.test(name) || /^srcdoc$/i.test(name) || (/^(?:href|src|action|formaction|xlink:href)$/i.test(name) && /^\s*(?:javascript|vbscript|data:text\/html)/i.test(value))) element.removeAttribute(name);
  }
  revealLazyImages(document, url);
  // Removed ad scripts/frames leave tall, empty billboard reservations.
  for (const slot of document.querySelectorAll('.ad-container, [id^="google_ads_"]')) {
    if (slot.textContent?.trim() || slot.querySelector('img[src],picture,video,audio,svg')) continue;
    let parent = slot.parentElement; slot.remove();
    while (parent && parent !== document.body && /^(DIV|SECTION|ASIDE)$/.test(parent.tagName) && !parent.children.length && !parent.textContent?.trim()) {
      const next = parent.parentElement; parent.remove(); parent = next;
    }
  }
  dropEmptySlots(document);
  dropConsentBanners(document);
  dropSidebars(document);
  plainCopyStyles(document);
  const base = document.createElement('base'); base.setAttribute('href', url); base.setAttribute('target', '_blank');
  const charset = document.createElement('meta'); charset.setAttribute('charset', 'utf-8');
  document.head.prepend(charset, base);
  return '<!doctype html>' + document.documentElement.outerHTML;
}
export async function loadPublicWebCopy(url: string) {
  const page = await fetchPublicWebPage(url);
  return page ? { html: sanitizePublicWebCopy(page.html, page.url), url: page.url } : null;
}
