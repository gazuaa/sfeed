// Representative image of an article page (og:image, twitter:image or
// <link rel="image_src">), for feeds that ship no image of their own.

const PATTERNS = [
  /<meta[^>]+(?:property|name)=["']og:image(?::secure_url|:url)?["'][^>]*content=["']([^"']+)["']/i,
  /<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["']og:image(?::secure_url|:url)?["']/i,
  /<meta[^>]+(?:property|name)=["']twitter:image(?::src)?["'][^>]*content=["']([^"']+)["']/i,
  /<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["']twitter:image(?::src)?["']/i,
  /<link[^>]+rel=["']image_src["'][^>]*href=["']([^"']+)["']/i,
];

export function extractPreviewImage(html: string, pageUrl: string): string | null {
  for (const pattern of PATTERNS) {
    const raw = html.match(pattern)?.[1]?.trim().replace(/&amp;/g, '&');
    if (!raw) continue;
    try {
      const url = new URL(raw, pageUrl);
      if (url.protocol === 'https:' || url.protocol === 'http:') return url.href;
    } catch {
      // malformed URL: try the next tag
    }
  }
  return null;
}

/**
 * Looks the image up on the page itself. Returns null when the page answered
 * but has no image (or is gone), and undefined when it could not be reached,
 * so callers only remember definite answers.
 */
export async function fetchPreviewImage(pageUrl: string): Promise<string | null | undefined> {
  try {
    const res = await fetch(pageUrl, {
      redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SfeedReader/1.0)' },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) {
      await res.body?.cancel();
      return res.status === 404 || res.status === 410 ? null : undefined;
    }
    if (res.headers.get('x-vercel-mitigated') === 'challenge' || res.headers.get('cf-mitigated') === 'challenge') { await res.body?.cancel(); return undefined; }
    // The tags live in <head>; the first part of the page is enough.
    const reader = res.body?.getReader(); if (!reader) return null;
    const decoder = new TextDecoder(); let html = '', bytes = 0;
    try {
      while (bytes < 300_000) {
        const chunk = await reader.read(); if (chunk.done) break;
        const part = chunk.value.subarray(0, 300_000 - bytes); bytes += part.byteLength;
        html += decoder.decode(part, { stream: true });
        if (/<\/head\s*>/i.test(html)) break;
      }
      html += decoder.decode();
    } finally { await reader.cancel().catch(() => {}); }
    if (/<title[^>]*>\s*(?:Vercel Security Checkpoint|Just a moment|Access Denied|Verify you are human)/i.test(html)) return undefined;
    return extractPreviewImage(html, res.url || pageUrl);
  } catch {
    return undefined;
  }
}
