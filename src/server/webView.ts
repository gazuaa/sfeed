import { parseHTML } from 'linkedom';
import { fetchPage, renderPage, webCopy } from './rssBuilder';
import type { Env } from './types';

function usable(html: string) {
  const { document } = parseHTML(html);
  const title = document.querySelector('title')?.textContent || '';
  if (/security checkpoint|just a moment|verify you are human|access denied|sign in|log in/i.test(title)) return false;
  const article = document.querySelector('article, main, [itemprop="articleBody"]');
  return ((article ? article.textContent : document.body?.textContent) || '').trim().length > 120;
}
/**
 * `phone` skips the served page: some sites serve their desktop layout and switch to the
 * phone one with scripts, which a script-free copy never runs. A phone-sized render has run them.
 */
export async function fetchWebView(url: string, env: Pick<Env, 'BROWSER'>, phone = false) {
  if (!phone) try {
    const original = await fetchPage(url);
    if (usable(original.html)) return { html: webCopy(original.html, original.url), url: original.url };
  } catch { /* A public browser render can supply JavaScript-rendered pages. */ }
  if (env.BROWSER) {
    const rendered = await renderPage(url, env, 'article', phone);
    if (usable(rendered.html)) return { html: webCopy(rendered.html, rendered.url), url: rendered.url };
  }
  throw new Error('원문 사이트를 표시하지 못했습니다.');
}
