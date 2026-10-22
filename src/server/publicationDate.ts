// A feed generator's pubDate can be the time it discovered an old article.
// Only explicit publication metadata (never dateModified or arbitrary prose)
// may override that date.
const HAS_ZONE = /(?:Z|[+-]\d{2}:?\d{2}|\b[A-Z]{2,5})\s*$/;

export function parsePublicationDate(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const text = raw.trim();
  if (!/\b\d{4}\b/.test(text)) return null;
  const local = text.match(/^(\d{4})[-.](\d{2})[-.](\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(\.\d+)?)?)?$/);
  let value = text;
  if (local) {
    const [, year, month, day, hour = '00', minute = '00', second = '00', fraction = ''] = local;
    const calendar = new Date(Date.UTC(+year, +month - 1, +day));
    if (calendar.getUTCFullYear() !== +year || calendar.getUTCMonth() !== +month - 1 || calendar.getUTCDate() !== +day || +hour > 23 || +minute > 59 || +second > 59) return null;
    // Existing zone-less Korean CMS feeds and Hankyung cards use KST.
    value = `${year}-${month}-${day}T${hour}:${minute}:${second}${fraction}+09:00`;
  } else if (!HAS_ZONE.test(text)) {
    if (!Number.isFinite(Date.parse(text))) return null;
    value = `${text} +0900`;
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function attributes(tag: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const match of tag.matchAll(/([\w:-]+)\s*=\s*(["'])([\s\S]*?)\2/g)) result[match[1].toLowerCase()] = match[3];
  return result;
}

function sameArticle(left: string, right: string): boolean {
  try {
    const a = new URL(left, right), b = new URL(right);
    return a.hostname.replace(/^www\./, '') === b.hostname.replace(/^www\./, '') && a.pathname.replace(/\/$/, '') === b.pathname.replace(/\/$/, '');
  } catch { return false; }
}

export function extractOriginalPublishedAt(html: string | null | undefined, url: string): string | null {
  if (!html) return null;
  const parseHtmlDate = (value: unknown) => {
    if (typeof value !== 'string') return null;
    // Feed parsing has a KST convention for Korean CMS dates. Do not apply
    // that convention to an overseas publisher's timezone-less metadata.
    // Keep its feed date until an explicit offset can be verified instead.
    if (!HAS_ZONE.test(value.trim())) {
      try { if (!/(?:\.kr|(?:^|\.)(?:hankyung|aitimes)\.com)$/i.test(new URL(url).hostname)) return null; }
      catch { return null; }
    }
    return parsePublicationDate(value);
  };
  // Ignore comments and non-JSON scripts so examples quoted in a post are not
  // mistaken for the page's own metadata.
  const source = html.replace(/<!--[\s\S]*?-->/g, '');
  const markup = source.replace(/<script\b[\s\S]*?<\/script>/gi, '');
  for (const match of markup.matchAll(/<meta\b[^>]*>/gi)) {
    const attrs = attributes(match[0]);
    if (['article:published_time', 'datepublished', 'pubdate', 'publishdate', 'publish-date', 'dc.date.issued', 'parsely-pub-date', 'sailthru.date', 'citation_publication_date'].includes((attrs.property || attrs.itemprop || attrs.name || '').toLowerCase())) {
      const date = parseHtmlDate(attrs.content);
      if (date) return date;
    }
  }
  for (const match of source.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (attributes(match[1]).type?.toLowerCase() !== 'application/ld+json') continue;
    try {
      const visit = (node: unknown): string | null => {
        if (Array.isArray(node)) {
          for (const child of node) { const date = visit(child); if (date) return date; }
          return null;
        }
        if (!node || typeof node !== 'object') return null;
        const obj = node as Record<string, unknown>;
        const types = Array.isArray(obj['@type']) ? obj['@type'] : [obj['@type']];
        const main = obj.mainEntityOfPage;
        const identity = obj.url || (typeof main === 'object' && main ? (main as Record<string, unknown>)['@id'] : main) || obj['@id'];
        if (types.some((type) => typeof type === 'string' && /^(?:NewsArticle|Article|BlogPosting|ReportageNewsArticle|TechArticle)$/.test(type)) && (!identity || (typeof identity === 'string' && sameArticle(identity, url)))) {
          const date = parseHtmlDate(obj.datePublished);
          if (date) return date;
        }
        // Do not descend into related articles, comments or quoted objects.
        return visit(obj['@graph']) || visit(obj.mainEntity);
      };
      const date = visit(JSON.parse(match[2]));
      if (date) return date;
    } catch { /* Invalid structured metadata must not block the feed. */ }
  }
  for (const match of markup.matchAll(/<time\b([^>]*)>([\s\S]*?)<\/time>/gi)) {
    const attrs = attributes(match[1]);
    const preceding = markup.slice(Math.max(0, (match.index || 0) - 3000), match.index);
    const headline = [...preceding.matchAll(/<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/gi)].at(-1)?.[1];
    const link = headline?.match(/<a\b[^>]*>/i);
    const linkedPostDate = link && sameArticle(attributes(link[0]).href, url) && attrs.class?.split(/\s+/).some((name) => ['post-date', 'entry-date'].includes(name));
    if (!/modified|updated/i.test(attrs.class || '') && (attrs.itemprop?.toLowerCase() === 'datepublished' || /\bpubdate\b/i.test(match[1]) || linkedPostDate || attrs.class?.split(/\s+/).some((name) => ['published', 'date-published', 'published-date', 'entry-published'].includes(name)))) {
      const date = parseHtmlDate(attrs.datetime || match[2].replace(/<[^>]*>/g, '').trim());
      if (date) return date;
    }
  }
  for (const match of markup.matchAll(/<(?:span|p)\b([^>]*)>([^<]*)<\/(?:span|p)>/gi)) {
    const attrs = attributes(match[1]);
    if (attrs.itemprop?.toLowerCase() === 'datepublished') {
      const date = parseHtmlDate(attrs.content || match[2]);
      if (date) return date;
    }
  }
  // PolitePol carries Hankyung's reporter-card HTML. Bind the date to the
  // preceding headline link, rather than scanning arbitrary body dates.
  if (/^https?:\/\/(?:www\.)?hankyung\.com\/article\//i.test(url)) {
    for (const match of markup.matchAll(/<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>\s*<p\b([^>]*)>([\s\S]*?)<\/p>/gi)) {
      if (!attributes(match[2]).class?.split(/\s+/).includes('txt-date')) continue;
      const link = match[1].match(/<a\b[^>]*>/i);
      if (!link || !sameArticle(attributes(link[0]).href, url)) continue;
      const date = parsePublicationDate(match[3].replace(/<[^>]*>/g, '').trim());
      if (date) return date;
    }
  }
  return null;
}

// Older Feedly downloads retained only the flattened reporter card. This
// publisher-specific format puts the date immediately after the exact title.
export function extractSummaryPublishedAt(summary: string | null, title: string, url: string): string | null {
  if (!summary || !/^https?:\/\/(?:www\.)?hankyung\.com\/article\//i.test(url)) return null;
  const normalize = (text: string) => text.replace(/\s+/g, ' ').trim();
  const text = normalize(summary), headline = normalize(title);
  if (!headline || !text.startsWith(headline)) return null;
  const date = text.slice(headline.length).match(/^\s+(\d{4}\.\d{2}\.\d{2} \d{2}:\d{2})(?:\s|$)/);
  return date ? parsePublicationDate(date[1]) : null;
}
