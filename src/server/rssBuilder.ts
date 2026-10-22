import { parseHTML } from 'linkedom';
import type { BuilderAnalysis, BuilderArticle, BuilderGroup } from '../shared/rssBuilder';
import { normalizeFeedUrl } from '../shared/feedDiscovery';
import { parsePublicationDate } from './publicationDate';
import { decodeHtmlEntities } from './rssParser';
import type { ParsedFeed } from './rssParser';
import type { Env } from './types';

export function publicPageUrl(value: string): string {
  const normalized = normalizeFeedUrl(value);
  if (!normalized) throw new Error('올바른 공개 웹사이트 주소를 입력해 주세요.');
  const host = new URL(normalized).hostname.toLowerCase();
  if (!host.includes('.') || (/(?:^|\.)(?:localhost|local|internal|test)$/i.test(host) && !host.endsWith('.example.test')) || /^(?:\d+\.){3}\d+$/.test(host) || host.includes(':')) throw new Error('공개 웹사이트 주소만 사용할 수 있습니다.');
  return normalized;
}
const text = (value: string | null | undefined) => decodeHtmlEntities(value || '').replace(/\s+/g, ' ').trim();
const quoted = (value: string) => '"' + value.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
const skippedPath = /\/(?:tags?|category|categories|authors?|researchers|search|login|sign-?up|policy|privacy|terms)(?:\/|$)/i;

function articleUrl(href: string | null, source: URL): string | null {
  if (!href || href.startsWith('#')) return null;
  try {
    const url = new URL(href, source);
    if (!/^https?:$/.test(url.protocol) || url.origin !== source.origin || skippedPath.test(url.pathname) || /\.(?:png|jpe?g|gif|svg|pdf|zip|webp)$/i.test(url.pathname)) return null;
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) if (/^(?:utm_|fbclid|gclid)/i.test(key)) url.searchParams.delete(key);
    if (url.href.replace(/\/$/, '') === source.href.replace(/\/$/, '') || url.pathname === '/') return null;
    return url.href;
  } catch { return null; }
}

export function analyseBuilderHtml(html: string, sourceUrl: string, selector?: string): BuilderAnalysis {
  const source = new URL(sourceUrl);
  const { document } = parseHTML(html);
  const title = text(document.querySelector('meta[property="og:title"]')?.getAttribute('content') || document.querySelector('title')?.textContent) || source.hostname;
  if (/security checkpoint|just a moment|verify you are human|access denied/i.test(title)) throw new Error('사이트가 자동 수집을 차단하고 있습니다. 보안 확인이 없는 공개 글 목록 주소를 사용해 주세요.');
  document.querySelectorAll('script,style,noscript,template,nav,header,footer,aside,[role="navigation"]').forEach((node) => node.remove());
  if (selector && selector.length > 1000) throw new Error('글 목록 선택이 너무 깁니다.');
  let anchors;
  try { anchors = [...document.querySelectorAll(selector || 'a[href]')].slice(0, 600); }
  catch { throw new Error('글 목록 선택이 올바르지 않습니다. 다시 선택해 주세요.'); }
  const entries = new Map<string, { article: BuilderArticle; prefix: string; score: number }>();
  for (const node of anchors) {
    const anchor = node.tagName === 'A' ? node : node.querySelector('a[href]');
    if (!anchor) continue;
    const url = articleUrl(anchor.getAttribute('href'), source);
    if (!url) continue;
    const heading = anchor.querySelector('h1,h2,h3,h4');
    const articleTitle = text(heading?.textContent) || text(anchor.textContent) || text(anchor.getAttribute('title')) || text(anchor.querySelector('img')?.getAttribute('alt'));
    if (articleTitle.length < 7 || articleTitle.length > 350 || /^(?:더 보기|목록|read more|next page|previous|load more)$/i.test(articleTitle)) continue;
    const target = new URL(url);
    const prefix = target.search ? target.pathname + '?' : target.pathname.slice(0, target.pathname.lastIndexOf('/') + 1);
    const score = heading ? 3 : anchor.textContent?.trim() ? 2 : 1;
    if ((entries.get(url)?.score || 0) >= score) continue;
    let card = anchor.closest('article,li');
    if (!card) {
      let parent = anchor.parentElement;
      for (let depth = 0; parent && depth < 5; depth++, parent = parent.parentElement) {
        const sameGroup = [...parent.querySelectorAll('a[href]')].map((link) => articleUrl(link.getAttribute('href'), source)).filter((link) => link && new URL(link).pathname.startsWith(prefix));
        if (new Set(sameGroup).size > 1) break;
        card = parent;
        if (parent.querySelector('img,time') || /20\d{2}[.\-/]\d{1,2}[.\-/]\d{1,2}/.test(parent.textContent || '')) break;
      }
    }
    const dateText = card?.querySelector('time')?.getAttribute('datetime') || card?.querySelector('[itemprop="datePublished"]')?.getAttribute('content') || card?.textContent?.match(/\b20\d{2}[.\-/]\d{1,2}[.\-/]\d{1,2}\b/)?.[0];
    const published = dateText ? parsePublicationDate(dateText.replace(/\./g, '-')) : null;
    const img = card?.querySelector('img');
    let thumbnailUrl: string | null = null;
    try { const src = img?.getAttribute('src') || img?.getAttribute('data-src'); if (src) { const u = new URL(src, source); if (/^https?:$/.test(u.protocol)) thumbnailUrl = u.href; } } catch {}
    entries.set(url, { prefix, score, article: { title: articleTitle, url, summary: text(card?.querySelector('p')?.textContent) || null, thumbnailUrl, publishedAt: published || new Date().toISOString(), dateSource: published ? 'feed' : 'collected' } });
  }
  const buckets = new Map<string, BuilderArticle[]>();
  for (const { article, prefix } of entries.values()) buckets.set(prefix, [...(buckets.get(prefix) || []), article]);
  const groups: BuilderGroup[] = [...buckets].filter(([, articles]) => selector ? articles.length > 0 : articles.length >= 2).map(([prefix, articles]) => ({
    selector: selector || `a[href^=${quoted(prefix)}], a[href^=${quoted(source.origin + prefix)}]`,
    label: prefix,
    articles: articles.slice(0, 40),
  })).sort((a, b) => {
    const score = (group: BuilderGroup) => group.articles.length + (group.label.startsWith(source.pathname.replace(/\/$/, '') + '/') ? 100 : 0);
    return score(b) - score(a);
  }).slice(0, 8);
  return { sourceUrl, title, groups, rendered: false };
}

async function fetchPage(url: string): Promise<{ html: string; url: string }> {
  let current = publicPageUrl(url);
  for (let i = 0; i < 5; i++) {
    const response = await fetch(current, { redirect: 'manual', signal: AbortSignal.timeout(10000), headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SFeed/1.0)', Accept: 'text/html,application/xhtml+xml' } });
    if (response.status >= 300 && response.status < 400 && response.headers.get('location')) { current = publicPageUrl(new URL(response.headers.get('location')!, current).href); continue; }
    if (!response.ok) throw new Error(`사이트 응답 오류 (HTTP ${response.status})`);
    return { html: (await response.text()).slice(0, 2_000_000), url: current };
  }
  throw new Error('사이트 이동이 너무 많습니다.');
}

async function renderPage(url: string, env: Env): Promise<{ html: string; url: string }> {
  if (!env.BROWSER) throw new Error('이 사이트는 브라우저 렌더링이 필요합니다.');
  const { default: puppeteer } = await import('@cloudflare/puppeteer');
  const browser = await puppeteer.launch(env.BROWSER);
  try {
    const page = await browser.newPage();
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      try {
        publicPageUrl(request.url());
        if (['image', 'font', 'media'].includes(request.resourceType())) void request.abort(); else void request.continue();
      } catch { void request.abort(); }
    });
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 20000 });
    await page.waitForFunction('document.querySelectorAll("a[href]").length >= 5', { timeout: 5000 }).catch(() => {});
    return { html: (await page.content()).slice(0, 2_000_000), url: publicPageUrl(page.url()) };
  } finally { await browser.close(); }
}

export async function analyseBuilderPage(url: string, env: Env, selector?: string): Promise<BuilderAnalysis> {
  const source = publicPageUrl(url);
  let initialError: unknown;
  try {
    const page = await fetchPage(source);
    const result = analyseBuilderHtml(page.html, page.url, selector);
    if (result.groups.length) return result;
  } catch (error) { initialError = error; }
  if (env.BROWSER) {
    try { const page = await renderPage(source, env); return { ...analyseBuilderHtml(page.html, page.url, selector), rendered: true }; }
    catch (error) { throw new Error(error instanceof Error && /차단/.test(error.message) ? error.message : '사이트의 글 목록을 불러오지 못했습니다. 자동 수집을 허용하는 공개 페이지인지 확인해 주세요.'); }
  }
  if (initialError) throw initialError;
  return { sourceUrl: source, title: new URL(source).hostname, groups: [], rendered: false };
}

export function builderParsedFeed(analysis: BuilderAnalysis, selector: string, xmlUrl: string, title?: string): ParsedFeed {
  const group = analysis.groups.find((item) => item.selector === selector);
  if (!group?.articles.length) throw new Error('수집할 글 목록을 찾지 못했습니다. 다른 목록을 선택해 주세요.');
  return { xmlUrl, htmlUrl: analysis.sourceUrl, title: title?.trim() || analysis.title, description: 'RSS 빌더로 만든 웹사이트 글 목록', faviconUrl: `https://www.google.com/s2/favicons?domain=${encodeURIComponent(new URL(analysis.sourceUrl).hostname)}&sz=64`, articles: group.articles.map((article) => ({ ...article, guid: article.url, contentHtml: article.summary ? `<p>${article.summary.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</p>` : null, author: null })) };
}
