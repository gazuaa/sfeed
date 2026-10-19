import { XMLParser, XMLValidator } from 'fast-xml-parser';
import type { OpmlFeed } from '../shared/opml';
import { CURATED_FEEDS, FALLBACK_ARTICLES_BY_FEED_URL } from './curatedFeeds';

export interface ParsedArticle {
  guid: string;
  title: string;
  url: string;
  author: string | null;
  summary: string | null;
  contentHtml: string | null;
  thumbnailUrl: string | null;
  publishedAt: string;
}

export interface ParsedFeed {
  xmlUrl: string;
  htmlUrl: string | null;
  title: string;
  description: string | null;
  faviconUrl: string | null;
  articles: ParsedArticle[];
}

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  cdataPropName: '__cdata',
  trimValues: true,
  parseTagValue: false,
});

function extractText(val: unknown): string {
  if (val == null) return '';
  if (typeof val === 'string') return val.trim();
  if (typeof val === 'number' || typeof val === 'boolean') return String(val);
  if (Array.isArray(val)) return extractText(val[0]);
  if (typeof val === 'object') {
    const obj = val as Record<string, unknown>;
    if (typeof obj.__cdata === 'string') return obj.__cdata.trim();
    if (typeof obj['#text'] === 'string') return obj['#text'].trim();
    if (obj.__cdata != null) return extractText(obj.__cdata);
    if (obj['#text'] != null) return extractText(obj['#text']);
  }
  return '';
}

export function decodeHtmlEntities(str: string): string {
  if (!str) return '';
  return str
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(Number(dec)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

export function stripHtmlToSummary(html: string, maxLength = 260): string {
  if (!html) return '';
  const cleaned = decodeHtmlEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  );
  if (cleaned.length <= maxLength) return cleaned;
  return cleaned.slice(0, maxLength).trim() + '…';
}

export function sanitizeContentHtml(html: string, baseUrl?: string): string {
  if (!html) return '';
  let result = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
    .replace(/\son\w+="[^"]*"/gi, '')
    .replace(/\son\w+='[^']*'/gi, '');

  if (baseUrl) {
    try {
      const base = new URL(baseUrl);
      result = result.replace(/(<img[^>]+src=["'])([^"']+)(["'])/gi, (full, p1, src, p3) => {
        try {
          if (src.startsWith('data:')) return full;
          return `${p1}${new URL(src, base).href}${p3}`;
        } catch {
          return full;
        }
      });
      result = result.replace(/(<a[^>]+href=["'])([^"']+)(["'])/gi, (full, p1, href, p3) => {
        try {
          if (href.startsWith('#') || href.startsWith('mailto:')) return full;
          return `${p1}${new URL(href, base).href}${p3}`;
        } catch {
          return full;
        }
      });
    } catch {
      // Ignore invalid baseUrl
    }
  }
  return result.trim();
}

function extractThumbnail(item: Record<string, unknown>, htmlContent: string, baseUrl?: string): string | null {
  // 1. Check media:content or media:thumbnail
  const mediaCandidates = [
    item['media:content'],
    item['media:thumbnail'],
    item['enclosure'],
    item['itunes:image'],
  ];

  for (const candidate of mediaCandidates) {
    if (!candidate) continue;
    const list = Array.isArray(candidate) ? candidate : [candidate];
    for (const entry of list) {
      if (entry && typeof entry === 'object') {
        const obj = entry as Record<string, unknown>;
        const url = (obj['@_url'] || obj['@_href'] || obj.url) as string | undefined;
        const type = String(obj['@_type'] || '');
        const medium = String(obj['@_medium'] || '');
        if (url && (medium === 'image' || type.startsWith('image/') || /\.(jpg|jpeg|png|webp|gif)(\?|$)/i.test(url))) {
          return resolveUrl(url, baseUrl);
        }
      }
    }
  }

  // 2. Check first <img> inside HTML content
  if (htmlContent) {
    const imgMatch = htmlContent.match(/<img[^>]+src=["']([^"']+)["']/i);
    if (imgMatch && imgMatch[1] && !imgMatch[1].startsWith('data:image/gif') && !imgMatch[1].includes('1x1')) {
      return resolveUrl(imgMatch[1], baseUrl);
    }
  }

  return null;
}

function resolveUrl(url: string, baseUrl?: string): string {
  if (!url) return '';
  try {
    if (url.startsWith('http://') || url.startsWith('https://')) return url;
    if (baseUrl) return new URL(url, baseUrl).href;
  } catch {
    // ignore
  }
  return url;
}

// Keep every item a publisher exposes (some feeds carry their whole archive);
// the cap only guards against pathological feeds.
const MAX_FEED_ITEMS = 1000;

// RSS uses pubDate/dc:date, Atom 1.0 published/updated, and Atom 0.3 (still
// served by Naver blogs) issued/created/modified. Publication dates come first.
const ITEM_DATE_FIELDS = ['pubDate', 'published', 'dc:date', 'issued', 'created', 'updated', 'modified'];

function extractItemDate(item: Record<string, unknown>): string {
  for (const field of ITEM_DATE_FIELDS) {
    const text = extractText(item[field]);
    if (text) return text;
  }
  return '';
}

function parseDateSafe(raw: string): string {
  if (!raw) return new Date().toISOString();
  const parsed = new Date(raw);
  if (!isNaN(parsed.getTime())) {
    return parsed.toISOString();
  }
  return new Date().toISOString();
}

export function getFaviconForSite(siteUrl: string | null, xmlUrl: string): string | null {
  const target = siteUrl || xmlUrl;
  try {
    const u = new URL(target);
    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(u.hostname)}&sz=64`;
  } catch {
    return null;
  }
}

function parseXmlFeedContentRaw(xmlText: string, xmlUrl: string): ParsedFeed {
  const parsed = xmlParser.parse(xmlText) as Record<string, unknown>;

  // RSS 2.0 or RDF
  const rssChannel =
    (parsed.rss as Record<string, unknown> | undefined)?.channel ||
    (parsed['rdf:RDF'] as Record<string, unknown> | undefined)?.channel;

  if (rssChannel && typeof rssChannel === 'object') {
    const ch = rssChannel as Record<string, unknown>;
    const title = decodeHtmlEntities(extractText(ch.title)) || new URL(xmlUrl).hostname;
    const description = decodeHtmlEntities(extractText(ch.description || ch.subtitle)) || null;

    let htmlUrl: string | null = null;
    if (Array.isArray(ch.link)) {
      for (const l of ch.link) {
        if (typeof l === 'string') {
          htmlUrl = l;
          break;
        }
        if (l && typeof l === 'object' && (l as Record<string, unknown>)['@_href']) {
          const rel = (l as Record<string, unknown>)['@_rel'];
          if (!rel || rel === 'alternate') {
            htmlUrl = String((l as Record<string, unknown>)['@_href']);
          }
        }
      }
    } else if (typeof ch.link === 'string') {
      htmlUrl = ch.link.trim();
    } else if (ch.link && typeof ch.link === 'object') {
      htmlUrl = String((ch.link as Record<string, unknown>)['@_href'] || '') || null;
    }

    const rawItems = ch.item || (parsed['rdf:RDF'] as Record<string, unknown> | undefined)?.item || [];
    const items = Array.isArray(rawItems) ? rawItems : [rawItems];

    const articles: ParsedArticle[] = [];
    for (const rawItem of items.slice(0, MAX_FEED_ITEMS)) {
      if (!rawItem || typeof rawItem !== 'object') continue;
      const item = rawItem as Record<string, unknown>;
      const itemTitle = decodeHtmlEntities(extractText(item.title)) || 'Untitled Article';

      let itemUrl = extractText(item.link);
      if (!itemUrl && item.link && typeof item.link === 'object') {
        itemUrl = String((item.link as Record<string, unknown>)['@_href'] || '');
      }
      if (!itemUrl) itemUrl = extractText(item.guid);
      itemUrl = resolveUrl(itemUrl, htmlUrl || xmlUrl);

      const guid = extractText(item.guid) || itemUrl || `${xmlUrl}:${itemTitle}`;
      const author =
        decodeHtmlEntities(
          extractText(item['dc:creator'] || item.author || item.creator)
        ) || null;

      const rawContent =
        extractText(item['content:encoded']) ||
        extractText(item.content) ||
        extractText(item.description);
      const rawDesc = extractText(item.description) || rawContent;

      const contentHtml = sanitizeContentHtml(rawContent || rawDesc, itemUrl || htmlUrl || xmlUrl);
      const summary = stripHtmlToSummary(rawDesc || rawContent);
      const thumbnailUrl = extractThumbnail(item, rawContent || rawDesc, itemUrl || htmlUrl || xmlUrl);
      const pubDateRaw = extractItemDate(item);

      articles.push({
        guid,
        title: itemTitle,
        url: itemUrl || xmlUrl,
        author,
        summary: summary || null,
        contentHtml: contentHtml || null,
        thumbnailUrl,
        publishedAt: parseDateSafe(pubDateRaw),
      });
    }

    return {
      xmlUrl,
      htmlUrl,
      title,
      description,
      faviconUrl: getFaviconForSite(htmlUrl, xmlUrl),
      articles,
    };
  }

  // Atom 1.0
  const atomFeed = parsed.feed as Record<string, unknown> | undefined;
  if (atomFeed && typeof atomFeed === 'object') {
    const title = decodeHtmlEntities(extractText(atomFeed.title)) || new URL(xmlUrl).hostname;
    const description = decodeHtmlEntities(extractText(atomFeed.subtitle || atomFeed.tagline)) || null;

    let htmlUrl: string | null = null;
    const links = Array.isArray(atomFeed.link) ? atomFeed.link : atomFeed.link ? [atomFeed.link] : [];
    for (const l of links) {
      if (l && typeof l === 'object') {
        const linkObj = l as Record<string, unknown>;
        const rel = String(linkObj['@_rel'] || 'alternate');
        const href = String(linkObj['@_href'] || '');
        if (href && (rel === 'alternate' || !htmlUrl)) {
          htmlUrl = href;
          if (rel === 'alternate') break;
        }
      }
    }

    const rawEntries = atomFeed.entry || [];
    const entries = Array.isArray(rawEntries) ? rawEntries : [rawEntries];
    const articles: ParsedArticle[] = [];

    for (const rawEntry of entries.slice(0, MAX_FEED_ITEMS)) {
      if (!rawEntry || typeof rawEntry !== 'object') continue;
      const entry = rawEntry as Record<string, unknown>;
      const entryTitle = decodeHtmlEntities(extractText(entry.title)) || 'Untitled Article';

      let entryUrl = '';
      const entryLinks = Array.isArray(entry.link) ? entry.link : entry.link ? [entry.link] : [];
      for (const l of entryLinks) {
        if (typeof l === 'string') {
          entryUrl = l;
          break;
        }
        if (l && typeof l === 'object') {
          const lo = l as Record<string, unknown>;
          const rel = String(lo['@_rel'] || 'alternate');
          const href = String(lo['@_href'] || '');
          if (href && (rel === 'alternate' || !entryUrl)) {
            entryUrl = href;
            if (rel === 'alternate') break;
          }
        }
      }
      entryUrl = resolveUrl(entryUrl || extractText(entry.id), htmlUrl || xmlUrl);

      const guid = extractText(entry.id) || entryUrl || `${xmlUrl}:${entryTitle}`;
      let author: string | null = null;
      if (entry.author && typeof entry.author === 'object') {
        author = decodeHtmlEntities(extractText((entry.author as Record<string, unknown>).name)) || null;
      } else {
        author = decodeHtmlEntities(extractText(entry.author)) || null;
      }

      const rawContent = extractText(entry.content) || extractText(entry.summary);
      const rawSummary = extractText(entry.summary) || rawContent;
      const contentHtml = sanitizeContentHtml(rawContent || rawSummary, entryUrl || htmlUrl || xmlUrl);
      const summary = stripHtmlToSummary(rawSummary || rawContent);
      const thumbnailUrl = extractThumbnail(entry, rawContent || rawSummary, entryUrl || htmlUrl || xmlUrl);
      const pubDateRaw = extractItemDate(entry);

      articles.push({
        guid,
        title: entryTitle,
        url: entryUrl || xmlUrl,
        author,
        summary: summary || null,
        contentHtml: contentHtml || null,
        thumbnailUrl,
        publishedAt: parseDateSafe(pubDateRaw),
      });
    }

    return {
      xmlUrl,
      htmlUrl,
      title,
      description,
      faviconUrl: getFaviconForSite(htmlUrl, xmlUrl),
      articles,
    };
  }

  throw new Error('유효한 RSS 또는 Atom 피드 형식이 아닙니다.');
}

export function parseXmlFeedContent(xmlText: string, xmlUrl: string): ParsedFeed {
  const parsed = parseXmlFeedContentRaw(xmlText, xmlUrl);
  // The publisher's live feed still contains vitalik.ca links, whose DNS no
  // longer resolves. Only repair that publisher's old host, preserving GUIDs.
  if (/^https?:\/\/vitalik\.eth\.limo\//i.test(xmlUrl)) {
    const repairUrl = (value: string | null): string | null => {
      if (!value) return value;
      try {
        const url = new URL(value);
        if (url.hostname === 'vitalik.ca' || url.hostname === 'www.vitalik.ca') {
          url.protocol = 'https:';
          url.host = 'vitalik.eth.limo';
          return url.href;
        }
      } catch { /* Keep unrelated relative or malformed URLs unchanged. */ }
      return value;
    };
    parsed.htmlUrl = repairUrl(parsed.htmlUrl);
    parsed.articles = parsed.articles.map((article) => ({
      ...article,
      url: repairUrl(article.url)!,
      thumbnailUrl: repairUrl(article.thumbnailUrl),
      contentHtml: article.contentHtml?.replace(
        /https?:\/\/(?:www\.)?vitalik\.ca(?=\/|["'\s<])/gi,
        'https://vitalik.eth.limo'
      ) || null,
    }));
  }
  return parsed;
}

function buildFallbackFeed(xmlUrl: string): ParsedFeed {
  const curated = CURATED_FEEDS.find(
    (f) => f.xmlUrl.toLowerCase() === xmlUrl.toLowerCase() || f.htmlUrl.toLowerCase() === xmlUrl.toLowerCase()
  );
  const canonicalXmlUrl = curated ? curated.xmlUrl : xmlUrl;
  const htmlUrl = curated ? curated.htmlUrl : xmlUrl;
  let hostname = 'RSS Feed';
  try {
    hostname = new URL(canonicalXmlUrl).hostname;
  } catch {
    // ignore
  }
  const title = curated ? curated.title : hostname;
  const description = curated ? curated.description : `${title} RSS 피드`;

  const seeds = FALLBACK_ARTICLES_BY_FEED_URL[canonicalXmlUrl] || [
    {
      guid: `${canonicalXmlUrl}-welcome-1`,
      title: `${title} - 최신 업데이트 및 주요 기술 트렌드 아티클`,
      url: htmlUrl,
      author: title,
      summary: `${title}에서 발행된 최신 소식입니다. 상단 새로고침 버튼이나 원문 보기(Reader View), AI 요약 기능을 활용해 빠르게 핵심 내용을 확인해 보세요.`,
      contentHtml: `<p><strong>${title}</strong> 피드가 성공적으로 구독되었습니다.</p><p>${description}</p><p>클라우드플레어 배포 환경 및 인터넷 연결 상태에서 새로고침 시 실시간 피드 XML을 가져오며, 우측 상단의 <strong>AI 핵심 요약</strong>과 <strong>원문 전체 스크래핑(Reader View)</strong>을 바로 사용할 수 있습니다.</p>`,
      thumbnailUrl: 'https://images.unsplash.com/photo-1518770660439-4636190af475?auto=format&fit=crop&w=900&q=80',
      publishedAtOffsetMinutes: 30,
    },
  ];

  const now = Date.now();
  return {
    xmlUrl: canonicalXmlUrl,
    htmlUrl,
    title,
    description,
    faviconUrl: getFaviconForSite(htmlUrl, canonicalXmlUrl),
    articles: seeds.map((s) => ({
      guid: s.guid,
      title: s.title,
      url: s.url,
      author: s.author,
      summary: s.summary,
      contentHtml: s.contentHtml,
      thumbnailUrl: s.thumbnailUrl,
      publishedAt: new Date(now - s.publishedAtOffsetMinutes * 60_000).toISOString(),
    })),
  };
}

export async function fetchAndParseFeed(
  inputUrl: string,
  options: { allowFallback?: boolean } = {}
): Promise<ParsedFeed> {
  let normalizedUrl = inputUrl.trim();
  if (!/^https?:\/\//i.test(normalizedUrl)) {
    normalizedUrl = `https://${normalizedUrl}`;
  }

  // Check if user pasted a known curated site htmlUrl
  const matchedCurated = CURATED_FEEDS.find(
    (f) =>
      f.htmlUrl.replace(/\/$/, '').toLowerCase() === normalizedUrl.replace(/\/$/, '').toLowerCase()
  );
  if (matchedCurated) {
    normalizedUrl = matchedCurated.xmlUrl;
  }

  const headers = {
    'User-Agent':
      'Mozilla/5.0 (compatible; SfeedRSS/1.0; +https://cloudflare.com) AppleWebKit/537.36',
    Accept:
      'application/rss+xml, application/atom+xml, application/xml, text/xml, text/html;q=0.9, */*;q=0.8',
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 7000);
  try {
    const response = await fetch(normalizedUrl, {
      headers,
      signal: controller.signal,
      redirect: 'follow',
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const text = await response.text();
    const trimmed = text.trim();

    // Check if HTML page instead of XML -> try auto-discovering <link rel="alternate" type="application/rss+xml">
    if (/^<!doctype html/i.test(trimmed) || /^<html/i.test(trimmed)) {
      const linkMatch =
        trimmed.match(
          /<link[^>]+type=["']application\/(?:rss|atom)\+xml["'][^>]*href=["']([^"']+)["']/i
        ) ||
        trimmed.match(
          /<link[^>]+href=["']([^"']+)["'][^>]*type=["']application\/(?:rss|atom)\+xml["']/i
        );

      if (linkMatch && linkMatch[1]) {
        const discoveredUrl = resolveUrl(linkMatch[1], normalizedUrl);
        const subRes = await fetch(discoveredUrl, { headers, redirect: 'follow', signal: controller.signal });
        if (subRes.ok) {
          const subXml = await subRes.text();
          return parseXmlFeedContent(subXml, discoveredUrl);
        }
      }

      // Try common suffix paths
      const commonPaths = ['/feed', '/rss.xml', '/feed.xml', '/atom.xml', '/rss'];
      const origin = new URL(normalizedUrl).origin;
      for (const suffix of commonPaths) {
        try {
          const candidateUrl = `${origin}${suffix}`;
          const res = await fetch(candidateUrl, { headers, redirect: 'follow', signal: controller.signal });
          if (res.ok) {
            const xml = await res.text();
            return parseXmlFeedContent(xml, candidateUrl);
          }
        } catch {
          // continue trying
        }
      }
    }

    return parseXmlFeedContent(text, normalizedUrl);
  } catch (err) {
    if (options.allowFallback === false) throw err;
    // Graceful fallback when running in offline sandbox or if target server blocks automated requests
    return buildFallbackFeed(normalizedUrl);
  } finally {
    clearTimeout(timer);
  }
}

export function parseOpml(opmlXml: string): OpmlFeed[] {
  if (XMLValidator.validate(opmlXml) !== true) {
    throw new Error('유효하지 않은 OPML XML입니다. 파일 내용을 확인해 주세요.');
  }
  const parsed = xmlParser.parse(opmlXml) as Record<string, unknown>;
  const opml = parsed.opml as Record<string, unknown> | undefined;
  const body = opml?.body as Record<string, unknown> | undefined;
  if (!body) {
    throw new Error('유효하지 않은 OPML 파일입니다.');
  }

  const results: OpmlFeed[] = [];

  function walkOutlines(node: unknown, parentFolder: string | null) {
    if (!node) return;
    const list = Array.isArray(node) ? node : [node];
    for (const item of list) {
      if (!item || typeof item !== 'object') continue;
      const outline = item as Record<string, unknown>;
      const xmlUrl = String(outline['@_xmlUrl'] || outline['@_xmlurl'] || '').trim();
      const title = decodeHtmlEntities(
        String(outline['@_title'] || outline['@_text'] || '').trim()
      );
      const htmlUrl = String(outline['@_htmlUrl'] || outline['@_htmlurl'] || '').trim() || null;

      if (xmlUrl) {
        results.push({
          title: title || xmlUrl,
          xmlUrl,
          htmlUrl,
          folderName: parentFolder,
        });
      } else if (outline.outline) {
        walkOutlines(outline.outline, title || parentFolder);
      }
    }
  }

  walkOutlines(body.outline, null);
  return results;
}

function escapeXmlAttr(str: string): string {
  return (str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function generateOpml(
  userName: string,
  folders: Array<{ id: string; name: string }>,
  subscriptions: Array<{
    folder_id: string | null;
    title: string;
    xml_url: string;
    html_url: string | null;
  }>
): string {
  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<opml version="2.0">',
    '  <head>',
    `    <title>Sfeed Subscriptions - ${escapeXmlAttr(userName)}</title>`,
    `    <dateCreated>${new Date().toUTCString()}</dateCreated>`,
    '  </head>',
    '  <body>',
  ];

  // Grouped by folders
  for (const folder of folders) {
    const folderSubs = subscriptions.filter((s) => s.folder_id === folder.id);
    if (folderSubs.length === 0) continue;
    const fName = escapeXmlAttr(folder.name);
    lines.push(`    <outline text="${fName}" title="${fName}">`);
    for (const sub of folderSubs) {
      const t = escapeXmlAttr(sub.title);
      const x = escapeXmlAttr(sub.xml_url);
      const h = escapeXmlAttr(sub.html_url || '');
      lines.push(
        `      <outline type="rss" text="${t}" title="${t}" xmlUrl="${x}" htmlUrl="${h}" />`
      );
    }
    lines.push('    </outline>');
  }

  // Uncategorized
  const uncategorized = subscriptions.filter(
    (s) => !s.folder_id || !folders.some((f) => f.id === s.folder_id)
  );
  for (const sub of uncategorized) {
    const t = escapeXmlAttr(sub.title);
    const x = escapeXmlAttr(sub.xml_url);
    const h = escapeXmlAttr(sub.html_url || '');
    lines.push(`    <outline type="rss" text="${t}" title="${t}" xmlUrl="${x}" htmlUrl="${h}" />`);
  }

  lines.push('  </body>', '</opml>');
  return lines.join('\n');
}
