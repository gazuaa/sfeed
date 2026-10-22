// Web view support: whether an original page may be shown inside SFeed's
// reader pane. Sites opt out with X-Frame-Options or CSP frame-ancestors;
// browsers then render an error page that the app cannot detect, so check
// the headers up front and offer "open in a new window" instead.

export function framingBlocked(headers: Headers, appOrigin: string): boolean {
  const xfo = (headers.get('x-frame-options') || '').toLowerCase();
  if (xfo.includes('deny') || xfo.includes('sameorigin')) return true;

  const csp = (headers.get('content-security-policy') || '').toLowerCase();
  const match = /(?:^|;)\s*frame-ancestors\s+([^;]*)/.exec(csp);
  if (!match) return false;

  const app = new URL(appOrigin);
  return !match[1]
    .trim()
    .split(/\s+/)
    .some((source) => {
      if (source === '*' || source === `${app.protocol}`) return true;
      const host = source.replace(/^[a-z]+:\/\//, '').replace(/\/.*$/, '');
      if (host === app.host) return true;
      return host.startsWith('*.') && app.host.endsWith(host.slice(1));
    });
}

export interface EmbedCheck {
  embeddable: boolean;
  url: string;
}

export async function checkEmbeddable(url: string, appOrigin: string): Promise<EmbedCheck> {
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SfeedReader/1.0)' },
      signal: AbortSignal.timeout(6000),
    });
    await res.body?.cancel();
    const finalUrl = res.url || url;
    // An https app cannot frame plain http pages (mixed content).
    const secureEnough = finalUrl.startsWith('https:') || appOrigin.startsWith('http:');
    return { embeddable: secureEnough && !framingBlocked(res.headers, appOrigin), url: finalUrl };
  } catch {
    // Unreachable from the server (some sites block Cloudflare): let the browser try.
    return { embeddable: true, url: appOrigin.startsWith('https:') ? url.replace(/^http:/, 'https:') : url };
  }
}
