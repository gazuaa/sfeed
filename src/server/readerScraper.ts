import { sanitizeContentHtml } from './rssParser';
import { extractOriginalPublishedAt } from './publicationDate';

export interface ScrapedArticleResult {
  fullContentHtml: string;
  leadImageUrl: string | null;
  scrapedFromWeb: boolean;
  originalPublishedAt: string | null;
}

export async function scrapeFullArticle(
  url: string,
  fallbackHtml: string | null,
  title: string
): Promise<ScrapedArticleResult> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 7000);
    const res = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      signal: controller.signal,
      redirect: 'follow',
    });
    clearTimeout(timer);

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    const rawHtml = await res.text();

    // Extract og:image if available
    const ogImgMatch =
      rawHtml.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ||
      rawHtml.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
    const leadImageUrl = ogImgMatch?.[1] || null;

    // Strip non-content blocks first
    const cleaned = rawHtml
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
      .replace(/<nav[\s\S]*?<\/nav>/gi, '')
      .replace(/<footer[\s\S]*?<\/footer>/gi, '')
      .replace(/<aside[\s\S]*?<\/aside>/gi, '')
      .replace(/<form[\s\S]*?<\/form>/gi, '');

    // Prefer <article> or <main>
    let bodyCandidate = '';
    const articleMatch = cleaned.match(/<article[^>]*>([\s\S]*?)<\/article>/i);
    const mainMatch = cleaned.match(/<main[^>]*>([\s\S]*?)<\/main>/i);

    if (articleMatch && articleMatch[1] && articleMatch[1].length > 300) {
      bodyCandidate = articleMatch[1];
    } else if (mainMatch && mainMatch[1] && mainMatch[1].length > 300) {
      bodyCandidate = mainMatch[1];
    } else {
      // Collect meaningful paragraphs and headings
      const blocks = cleaned.match(/<(?:p|h2|h3|blockquote|pre|ul|ol)[^>]*>[\s\S]*?<\/(?:p|h2|h3|blockquote|pre|ul|ol)>/gi);
      if (blocks && blocks.length > 0) {
        bodyCandidate = blocks.slice(0, 45).join('\n');
      }
    }

    const sanitized = sanitizeContentHtml(bodyCandidate, url);
    if (sanitized && sanitized.replace(/<[^>]+>/g, '').trim().length > 120) {
      return {
        fullContentHtml: sanitized,
        leadImageUrl,
        scrapedFromWeb: true,
        originalPublishedAt: extractOriginalPublishedAt(rawHtml, url) || extractOriginalPublishedAt(fallbackHtml, url),
      };
    }
  } catch {
    // Fallback below
  }

  // Fallback if site blocks automated requests or running offline
  const baseHtml = fallbackHtml || `<p>${title}</p>`;
  return {
    fullContentHtml: `<div class="reader-fallback-content">
      ${baseHtml}
      <hr />
      <p><em>원문 링크(<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>)의 핵심 본문 데이터입니다.</em></p>
    </div>`,
    leadImageUrl: null,
    scrapedFromWeb: false,
    originalPublishedAt: extractOriginalPublishedAt(fallbackHtml, url),
  };
}
