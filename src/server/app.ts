import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type {
  Env,
  UserRecord,
  UserPreferences,
  FolderRecord,
  SubscriptionItem,
  ArticleItem,
} from './types';
import { CURATED_FEEDS } from './curatedFeeds';
import type { OpmlFeed } from '../shared/opml';
import { normalizeFeedUrl } from '../shared/feedDiscovery';
import { importOpmlFeed, OpmlSourceError } from './opmlImporter';
import { clearOpmlFailure, listOpmlFailures, recordOpmlFailure } from './opmlFailures';
import { fetchAndParseFeed, parseOpml, generateOpml, type ParsedFeed } from './rssParser';
import { scrapeFullArticle } from './readerScraper';
import { checkEmbeddable } from './framing';
import { fetchPreviewImage } from './previewImage';
import { extractOriginalPublishedAt } from './publicationDate';
import { resolveArticlePublication, type PublicationArticle } from './articlePublication';
import { summarizeArticleWithAI } from './aiSummarizer';
import {
  generateId,
  upsertFeedAndArticles,
} from './seedService';
import {
  DEFAULT_GOOGLE_CLIENT_ID,
  verifyGoogleToken,
} from './googleVerify';

type Variables = {
  user: UserRecord;
};

export const app = new Hono<{ Bindings: Env; Variables: Variables }>();

app.use('/api/*', cors());

const DEFAULT_PREFS: UserPreferences = {
  layout: 'magazine',
  theme: 'dark',
  unreadOnly: false,
};

// Like Feedly, articles older than this count as read unless marked otherwise.
// Bounding unread queries to recent articles also keeps them fast when feeds
// carry years of imported history.
const UNREAD_WINDOW_DAYS = 30;
const unreadCutoff = () =>
  new Date(Date.now() - UNREAD_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();

// Fail closed: quick login is on only when explicitly enabled (vite dev server or .dev.vars)
function isQuickLoginEnabled(env: Env): boolean {
  return env.ALLOW_QUICK_LOGIN === 'true';
}

function parsePreferences(jsonStr: string | null | undefined): UserPreferences {
  if (!jsonStr) return { ...DEFAULT_PREFS };
  try {
    const parsed = JSON.parse(jsonStr);
    return {
      layout: ['magazine', 'cards', 'list'].includes(parsed.layout)
        ? parsed.layout
        : 'magazine',
      theme: parsed.theme === 'light' ? 'light' : 'dark',
      unreadOnly: Boolean(parsed.unreadOnly),
    };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

async function createSessionForUser(db: Env['DB'], userId: string): Promise<string> {
  const token = `sfeed_${crypto.randomUUID().replace(/-/g, '')}${crypto.randomUUID().replace(/-/g, '')}`;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();
  await db
    .prepare(
      `INSERT INTO sessions (token, user_id, expires_at, created_at)
       VALUES (?, ?, ?, ?)`
    )
    .bind(token, userId, expiresAt, now.toISOString())
    .run();
  return token;
}

async function findOrCreateGoogleUser(
  db: Env['DB'],
  profile: { email: string; name: string; picture?: string | null; googleId?: string | null }
): Promise<UserRecord> {
  const now = new Date().toISOString();
  const email = profile.email.trim().toLowerCase();

  let user = await db
    .prepare('SELECT * FROM users WHERE email = ?')
    .bind(email)
    .first<UserRecord>();

  if (!user && profile.googleId) {
    user = await db
      .prepare('SELECT * FROM users WHERE google_id = ?')
      .bind(profile.googleId)
      .first<UserRecord>();
  }

  if (user) {
    await db
      .prepare(
        `UPDATE users
         SET name = COALESCE(?, name),
             picture = COALESCE(?, picture),
             google_id = COALESCE(?, google_id)
         WHERE id = ?`
      )
      .bind(profile.name || null, profile.picture || null, profile.googleId || null, user.id)
      .run();

    const updated = await db
      .prepare('SELECT * FROM users WHERE id = ?')
      .bind(user.id)
      .first<UserRecord>();
    return updated || user;
  }

  const userId = generateId('usr');
  const picture =
    profile.picture ||
    `https://api.dicebear.com/9.x/glass/svg?seed=${encodeURIComponent(email)}`;

  await db
    .prepare(
      `INSERT INTO users (id, email, name, picture, google_id, preferences_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      userId,
      email,
      profile.name || email.split('@')[0],
      picture,
      profile.googleId || null,
      JSON.stringify(DEFAULT_PREFS),
      now
    )
    .run();

  const created = await db
    .prepare('SELECT * FROM users WHERE id = ?')
    .bind(userId)
    .first<UserRecord>();

  return created!;
}

// Public Auth Config Endpoint
app.get('/api/auth/config', (c) => {
  const clientId =
    c.env.GOOGLE_CLIENT_ID && !c.env.GOOGLE_CLIENT_ID.includes('your-google-oauth-client-id')
      ? c.env.GOOGLE_CLIENT_ID
      : DEFAULT_GOOGLE_CLIENT_ID;
  return c.json({
    googleClientId: clientId,
    workersAiAvailable: Boolean(c.env.AI),
    aiModel: c.env.AI_MODEL || '@cf/meta/llama-3.1-8b-instruct',
    quickLoginEnabled: isQuickLoginEnabled(c.env),
  });
});

// Google Identity Services ID Token (credential) RS256 verification endpoint (MUUSED style)
app.post('/api/auth/google/credential', async (c) => {
  const body = await c.req.json<{ credential?: string }>();
  if (!body.credential) {
    return c.json({ error: 'Google credential 토큰이 필요합니다.' }, 400);
  }

  const payload = await verifyGoogleToken(body.credential, c.env.GOOGLE_CLIENT_ID);
  if (!payload) {
    return c.json({ error: '구글 로그인이 만료되었거나 올바르지 않습니다.' }, 401);
  }

  const user = await findOrCreateGoogleUser(c.env.DB, {
    email: payload.email,
    name: payload.name || payload.email.split('@')[0],
    picture: payload.picture,
    googleId: payload.sub,
  });

  const token = await createSessionForUser(c.env.DB, user.id);
  return c.json({
    token,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      picture: user.picture,
      preferences: parsePreferences(user.preferences_json),
    },
  });
});

// Quick Google Account Sign-In (local development only — no identity verification)
app.post('/api/auth/google/quick', async (c) => {
  if (!isQuickLoginEnabled(c.env)) {
    return c.json({ error: '빠른 로그인은 로컬 개발 환경에서만 사용할 수 있습니다.' }, 403);
  }

  const body = await c.req.json<{
    email?: string;
    name?: string;
    picture?: string;
  }>();

  const email = (body.email || 'demo@gmail.com').trim().toLowerCase();
  if (!email.includes('@')) {
    return c.json({ error: '올바른 이메일 주소를 입력해 주세요.' }, 400);
  }

  const name = (body.name || email.split('@')[0]).trim();
  const user = await findOrCreateGoogleUser(c.env.DB, {
    email,
    name,
    picture: body.picture || null,
    googleId: `google_${email}`,
  });

  const token = await createSessionForUser(c.env.DB, user.id);
  return c.json({
    token,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      picture: user.picture,
      preferences: parsePreferences(user.preferences_json),
    },
  });
});

// Auth Middleware for protected /api/* routes
app.use('/api/*', async (c, next) => {
  const path = c.req.path;
  if (path.startsWith('/api/auth/')) {
    return next();
  }

  const authHeader = c.req.header('Authorization') || '';
  const token = authHeader.startsWith('Bearer ')
    ? authHeader.slice(7).trim()
    : c.req.query('token') || '';

  if (!token) {
    return c.json({ error: '인증이 필요합니다.' }, 401);
  }

  const sessionRow = await c.env.DB.prepare(
    `SELECT u.*
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token = ? AND s.expires_at > ?`
  )
    .bind(token, new Date().toISOString())
    .first<UserRecord>();

  if (!sessionRow) {
    return c.json({ error: '세션이 만료되었거나 유효하지 않습니다.' }, 401);
  }

  c.set('user', sessionRow);
  return next();
});

app.get('/api/user/me', (c) => {
  const user = c.get('user');
  return c.json({
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      picture: user.picture,
      preferences: parsePreferences(user.preferences_json),
    },
  });
});

app.put('/api/user/preferences', async (c) => {
  const user = c.get('user');
  const body = await c.req.json<Partial<UserPreferences>>();
  const current = parsePreferences(user.preferences_json);
  const nextPrefs: UserPreferences = {
    layout:
      body.layout && ['magazine', 'cards', 'list'].includes(body.layout)
        ? body.layout
        : current.layout,
    theme: body.theme === 'light' || body.theme === 'dark' ? body.theme : current.theme,
    unreadOnly:
      typeof body.unreadOnly === 'boolean' ? body.unreadOnly : current.unreadOnly,
  };

  await c.env.DB.prepare('UPDATE users SET preferences_json = ? WHERE id = ?')
    .bind(JSON.stringify(nextPrefs), user.id)
    .run();

  return c.json({ preferences: nextPrefs });
});

app.post('/api/user/logout', async (c) => {
  const authHeader = c.req.header('Authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (token) {
    await c.env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
  }
  return c.json({ success: true });
});

// Bootstrap includes both totals and unread counts so filters can switch instantly.
app.get('/api/bootstrap', async (c) => {
  const user = c.get('user');

  const foldersRes = await c.env.DB.prepare(
    `SELECT * FROM folders WHERE user_id = ? ORDER BY sort_order ASC, name ASC`
  )
    .bind(user.id)
    .all<FolderRecord>();

  const subsRes = await c.env.DB.prepare(
    `SELECT
       s.id,
       s.feed_id,
       s.folder_id,
       s.custom_title,
       f.xml_url,
       f.html_url,
       COALESCE(s.custom_title, f.title) as title,
       f.description,
       f.favicon_url,
       f.last_fetched_at,
       f.last_error,
       (
         SELECT COUNT(*)
         FROM articles a
         LEFT JOIN article_states st ON st.article_id = a.id AND st.user_id = s.user_id
         WHERE a.feed_id = f.id AND a.published_at >= ? AND COALESCE(st.is_read, 0) = 0
       ) as unread_count,
       (SELECT COUNT(*) FROM articles a WHERE a.feed_id = f.id) as total_count,
       (SELECT v.view_mode FROM feed_view_modes v WHERE v.user_id = s.user_id AND v.feed_id = s.feed_id) as view_mode
     FROM subscriptions s
     JOIN feeds f ON f.id = s.feed_id
     WHERE s.user_id = ?
     ORDER BY title ASC`
  )
    .bind(unreadCutoff(), user.id)
    .all<SubscriptionItem>();

  const subscriptions = (subsRes.results || []).map((s) => ({
    ...s,
    unread_count: Number(s.unread_count || 0),
    total_count: Number(s.total_count || 0),
  }));

  const totalUnread = subscriptions.reduce((sum, s) => sum + s.unread_count, 0);
  const totalArticles = subscriptions.reduce((sum, s) => sum + s.total_count, 0);

  const savedRow = await c.env.DB.prepare(
    `SELECT COUNT(*) as cnt
     FROM article_states st
     JOIN articles a ON a.id = st.article_id
     JOIN subscriptions s ON s.feed_id = a.feed_id AND s.user_id = st.user_id
     WHERE st.user_id = ? AND st.is_saved = 1`
  )
    .bind(user.id)
    .first<{ cnt: number }>();

  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const todayRow = await c.env.DB.prepare(
    `SELECT COUNT(*) as cnt,
            COALESCE(SUM(CASE WHEN COALESCE(st.is_read, 0) = 0 THEN 1 ELSE 0 END), 0) as unread
     FROM articles a
     JOIN subscriptions s ON s.feed_id = a.feed_id
     LEFT JOIN article_states st ON st.article_id = a.id AND st.user_id = s.user_id
     WHERE s.user_id = ? AND a.published_at >= ?`
  )
    .bind(user.id, twentyFourHoursAgo)
    .first<{ cnt: number; unread: number }>();

  return c.json({
    folders: foldersRes.results || [],
    subscriptions,
    counts: {
      totalUnread,
      totalArticles,
      savedCount: Number(savedRow?.cnt || 0),
      todayCount: Number(todayRow?.unread || 0),
      todayTotal: Number(todayRow?.cnt || 0),
    },
    curatedFeeds: CURATED_FEEDS,
  });
});

function feedPreviewResponse(parsed: ParsedFeed) {
  return {
    feed: { title: parsed.title, xmlUrl: parsed.xmlUrl, htmlUrl: parsed.htmlUrl && /^https?:\/\//i.test(parsed.htmlUrl) ? parsed.htmlUrl : null, description: parsed.description },
    articles: parsed.articles
      .filter((article) => /^https?:\/\//i.test(article.url))
      .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))
      .slice(0, 10)
      .map((article) => ({ title: article.title, url: article.url, summary: article.summary, publishedAt: article.publishedAt, dateSource: article.dateSource })),
  };
}

// Both previews are read-only: never create folders, feeds, articles or subscriptions.
app.post('/api/discover/preview', async (c) => {
  const body = await c.req.json<{ url?: unknown }>().catch(() => null);
  const url = typeof body?.url === 'string' ? normalizeFeedUrl(body.url) : null;
  if (!url) return c.json({ error: '올바른 RSS 또는 웹사이트 주소를 입력해 주세요.' }, 400);
  try {
    return c.json(feedPreviewResponse(await fetchAndParseFeed(url)));
  } catch {
    return c.json({ error: '피드를 찾지 못했습니다. RSS 주소와 연결 상태를 확인한 뒤 다시 시도해 주세요.' }, 502);
  }
});

app.get('/api/discover/feeds/:id/preview', async (c) => {
  const feed = CURATED_FEEDS.find((item) => item.id === c.req.param('id'));
  if (!feed) return c.json({ error: '추천 피드를 찾을 수 없습니다.' }, 404);

  try {
    const parsed = await fetchAndParseFeed(feed.xmlUrl);
    return c.json(feedPreviewResponse(parsed));
  } catch {
    return c.json({ error: '최근 글을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.' }, 502);
  }
});

// Folder CRUD
app.post('/api/folders', async (c) => {
  const user = c.get('user');
  const body = await c.req.json<{ name?: string; color?: string }>();
  const name = (body.name || '').trim();
  if (!name) {
    return c.json({ error: '폴더 이름을 입력해 주세요.' }, 400);
  }

  const existing = await c.env.DB.prepare(
    'SELECT * FROM folders WHERE user_id = ? AND name = ?'
  )
    .bind(user.id, name)
    .first<FolderRecord>();

  if (existing) {
    return c.json({ folder: existing });
  }

  const folderId = generateId('fld');
  const color = body.color || '#10b981';
  const now = new Date().toISOString();

  await c.env.DB.prepare(
    `INSERT INTO folders (id, user_id, name, color, sort_order, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  )
    .bind(folderId, user.id, name, color, 10, now)
    .run();

  const created = await c.env.DB.prepare('SELECT * FROM folders WHERE id = ?')
    .bind(folderId)
    .first<FolderRecord>();

  return c.json({ folder: created });
});

app.put('/api/folders/:id', async (c) => {
  const user = c.get('user');
  const folderId = c.req.param('id');
  const body = await c.req.json<{ name?: string; color?: string }>();

  const name = (body.name || '').trim();
  if (!name) {
    return c.json({ error: '폴더 이름을 입력해 주세요.' }, 400);
  }

  await c.env.DB.prepare(
    `UPDATE folders SET name = ?, color = COALESCE(?, color) WHERE id = ? AND user_id = ?`
  )
    .bind(name, body.color || null, folderId, user.id)
    .run();

  return c.json({ success: true });
});

app.delete('/api/folders/:id', async (c) => {
  const user = c.get('user');
  const folderId = c.req.param('id');

  await c.env.DB.prepare(
    `UPDATE subscriptions SET folder_id = NULL WHERE folder_id = ? AND user_id = ?`
  )
    .bind(folderId, user.id)
    .run();

  await c.env.DB.prepare(`DELETE FROM folders WHERE id = ? AND user_id = ?`)
    .bind(folderId, user.id)
    .run();

  return c.json({ success: true });
});

// Subscribe to a Feed URL
app.post('/api/subscriptions', async (c) => {
  const user = c.get('user');
  const body = await c.req.json<{
    url?: string;
    folderId?: string | null;
    folderName?: string | null;
    customTitle?: string | null;
  }>();

  const rawUrl = (body.url || '').trim();
  if (!rawUrl) {
    return c.json({ error: '구독할 RSS URL 또는 웹사이트 주소를 입력해 주세요.' }, 400);
  }

  let parsed;
  try {
    parsed = await fetchAndParseFeed(rawUrl);
  } catch (error) {
    return c.json({ error: new OpmlSourceError(error).message }, 502);
  }
  const { feedId, insertedCount } = await upsertFeedAndArticles(c.env.DB, parsed);

  let folderId = body.folderId || null;
  if (!folderId && body.folderName) {
    const folderName = body.folderName.trim();
    const existingFolder = await c.env.DB.prepare(
      'SELECT id FROM folders WHERE user_id = ? AND name = ?'
    )
      .bind(user.id, folderName)
      .first<{ id: string }>();

    if (existingFolder) {
      folderId = existingFolder.id;
    } else {
      folderId = generateId('fld');
      await c.env.DB.prepare(
        `INSERT INTO folders (id, user_id, name, color, sort_order, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
        .bind(folderId, user.id, folderName, '#10b981', 10, new Date().toISOString())
        .run();
    }
  }

  const existingSub = await c.env.DB.prepare(
    'SELECT id FROM subscriptions WHERE user_id = ? AND feed_id = ?'
  )
    .bind(user.id, feedId)
    .first<{ id: string }>();

  if (existingSub) {
    if (folderId) {
      await c.env.DB.prepare(
        'UPDATE subscriptions SET folder_id = ? WHERE id = ? AND user_id = ?'
      )
        .bind(folderId, existingSub.id, user.id)
        .run();
    }
    return c.json({
      subscriptionId: existingSub.id,
      feedId,
      title: parsed.title,
      insertedCount,
      alreadySubscribed: true,
    });
  }

  const subId = generateId('sub');
  await c.env.DB.prepare(
    `INSERT INTO subscriptions (id, user_id, feed_id, folder_id, custom_title, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  )
    .bind(
      subId,
      user.id,
      feedId,
      folderId,
      body.customTitle?.trim() || null,
      new Date().toISOString()
    )
    .run();

  return c.json({
    subscriptionId: subId,
    feedId,
    title: parsed.title,
    insertedCount,
    alreadySubscribed: false,
  });
});

// Update subscription (move folder or rename)
app.put('/api/subscriptions/:id', async (c) => {
  const user = c.get('user');
  const subId = c.req.param('id');
  const body = await c.req.json<{
    folderId?: string | null;
    customTitle?: string | null;
  }>();

  await c.env.DB.prepare(
    `UPDATE subscriptions
     SET folder_id = ?,
         custom_title = COALESCE(?, custom_title)
     WHERE id = ? AND user_id = ?`
  )
    .bind(body.folderId ?? null, body.customTitle ?? null, subId, user.id)
    .run();

  return c.json({ success: true });
});

// Unsubscribe
app.delete('/api/subscriptions/:id', async (c) => {
  const user = c.get('user');
  const subId = c.req.param('id');

  await c.env.DB.prepare('DELETE FROM subscriptions WHERE id = ? AND user_id = ?')
    .bind(subId, user.id)
    .run();

  return c.json({ success: true });
});

// Refresh feeds
app.post('/api/feeds/refresh', async (c) => {
  const user = c.get('user');
  const body = await c.req.json<{ feedId?: string }>().catch(() => ({ feedId: undefined }));

  let feedsToRefresh: Array<{ id: string; xml_url: string }> = [];
  if (body.feedId) {
    const row = await c.env.DB.prepare(
      `SELECT f.id, f.xml_url
       FROM feeds f
       JOIN subscriptions s ON s.feed_id = f.id
       WHERE f.id = ? AND s.user_id = ?`
    )
      .bind(body.feedId, user.id)
      .first<{ id: string; xml_url: string }>();
    if (row) feedsToRefresh = [row];
  } else {
    const res = await c.env.DB.prepare(
      `SELECT f.id, f.xml_url
       FROM feeds f
       JOIN subscriptions s ON s.feed_id = f.id
       WHERE s.user_id = ?`
    )
      .bind(user.id)
      .all<{ id: string; xml_url: string }>();
    feedsToRefresh = res.results || [];
  }

  let totalNewArticles = 0;
  await Promise.all(
    feedsToRefresh.map(async (f) => {
      try {
        const parsed = await fetchAndParseFeed(f.xml_url);
        const { insertedCount } = await upsertFeedAndArticles(c.env.DB, parsed);
        totalNewArticles += insertedCount;
      } catch (err) {
        await c.env.DB.prepare('UPDATE feeds SET last_error = ? WHERE id = ?')
          .bind(err instanceof Error ? err.message : 'Refresh failed', f.id)
          .run();
      }
    })
  );

  return c.json({
    refreshedFeeds: feedsToRefresh.length,
    newArticles: totalNewArticles,
  });
});

// Fetch articles with filtering, search, layout support
app.get('/api/articles', async (c) => {
  const user = c.get('user');
  const scope = c.req.query('scope') || 'all'; // 'all' | 'today' | 'saved' | 'folder' | 'feed'
  const folderId = c.req.query('folderId') || '';
  const feedId = c.req.query('feedId') || '';
  const unreadOnly = c.req.query('unreadOnly') === 'true';
  const search = (c.req.query('search') || '').trim();
  const limit = Math.min(Number(c.req.query('limit') || 80), 200);
  // Keyset cursor: the last article of the previous page (published_at, id).
  const before = c.req.query('before') || '';
  const beforeId = c.req.query('beforeId') || '';
  const cutoff = unreadCutoff();

  const conditions: string[] = ['s.user_id = ?'];
  // The first placeholder sits in the SELECT list: the default read state by age.
  const params: unknown[] = [cutoff, user.id];

  if (scope === 'folder' && folderId) {
    conditions.push('s.folder_id = ?');
    params.push(folderId);
  } else if (scope === 'feed' && feedId) {
    conditions.push('s.feed_id = ?');
    params.push(feedId);
  } else if (scope === 'saved') {
    conditions.push('COALESCE(st.is_saved, 0) = 1');
  } else if (scope === 'today') {
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    conditions.push('a.published_at >= ?');
    params.push(twentyFourHoursAgo);
  }

  if (unreadOnly && scope !== 'saved') {
    conditions.push('a.published_at >= ? AND COALESCE(st.is_read, 0) = 0');
    params.push(cutoff);
  }

  if (search) {
    conditions.push(
      '(a.title LIKE ? OR a.summary LIKE ? OR a.author LIKE ? OR f.title LIKE ?)'
    );
    const likePattern = `%${search}%`;
    params.push(likePattern, likePattern, likePattern, likePattern);
  }

  if (before) {
    conditions.push('(a.published_at < ? OR (a.published_at = ? AND a.id < ?))');
    params.push(before, before, beforeId);
  }

  // One extra row tells the client whether an older page exists.
  params.push(limit + 1);

  const sql = `
    SELECT
      a.id,
      a.feed_id,
      COALESCE(s.custom_title, f.title) as feed_title,
      f.favicon_url as feed_favicon,
      f.html_url as feed_html_url,
      s.folder_id,
      fl.name as folder_name,
      a.guid,
      a.title,
      a.url,
      a.author,
      a.summary,
      a.content_html,
      a.full_content_html,
      a.ai_summary,
      a.thumbnail_url,
      a.published_at,
      COALESCE(dc.source, 'feed') AS date_source,
      COALESCE(st.is_read, CASE WHEN a.published_at < ? THEN 1 ELSE 0 END) as is_read,
      COALESCE(st.is_saved, 0) as is_saved
    FROM articles a
    JOIN subscriptions s ON s.feed_id = a.feed_id
    JOIN feeds f ON f.id = a.feed_id
    LEFT JOIN folders fl ON fl.id = s.folder_id
    LEFT JOIN article_states st ON st.article_id = a.id AND st.user_id = s.user_id
    LEFT JOIN article_date_checks dc ON dc.article_id = a.id
    WHERE ${conditions.join(' AND ')}
    ORDER BY a.published_at DESC, a.id DESC
    LIMIT ?
  `;

  const res = await c.env.DB.prepare(sql)
    .bind(...params)
    .all<Record<string, unknown>>();

  const rows = res.results || [];
  const hasMore = rows.length > limit;
  const articles: ArticleItem[] = rows.slice(0, limit).map((row) => ({
    id: String(row.id),
    feed_id: String(row.feed_id),
    feed_title: String(row.feed_title || ''),
    feed_favicon: (row.feed_favicon as string) || null,
    feed_html_url: (row.feed_html_url as string) || null,
    folder_id: (row.folder_id as string) || null,
    folder_name: (row.folder_name as string) || null,
    guid: String(row.guid),
    title: String(row.title),
    url: String(row.url),
    author: (row.author as string) || null,
    summary: (row.summary as string) || null,
    content_html: (row.content_html as string) || null,
    full_content_html: (row.full_content_html as string) || null,
    ai_summary: (row.ai_summary as string) || null,
    // Keep '' (looked up, no image) apart from null (not looked up yet).
    thumbnail_url: row.thumbnail_url == null ? null : String(row.thumbnail_url),
    published_at: String(row.published_at),
    date_source: String(row.date_source),
    is_read: Boolean(Number(row.is_read)),
    is_saved: Boolean(Number(row.is_saved)),
  }));

  return c.json({ articles, hasMore });
});

// Toggle read / saved state on an article
app.post('/api/articles/:id/state', async (c) => {
  const user = c.get('user');
  const articleId = c.req.param('id');
  const body = await c.req.json<{ isRead?: boolean; isSaved?: boolean }>();
  const now = new Date().toISOString();

  const existing = await c.env.DB.prepare(
    'SELECT is_read, is_saved FROM article_states WHERE user_id = ? AND article_id = ?'
  )
    .bind(user.id, articleId)
    .first<{ is_read: number; is_saved: number }>();

  const nextRead =
    typeof body.isRead === 'boolean'
      ? body.isRead
        ? 1
        : 0
      : existing
      ? Number(existing.is_read)
      : 0;
  const nextSaved =
    typeof body.isSaved === 'boolean'
      ? body.isSaved
        ? 1
        : 0
      : existing
      ? Number(existing.is_saved)
      : 0;

  await c.env.DB.prepare(
    `INSERT INTO article_states (user_id, article_id, is_read, is_saved, read_at, saved_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, article_id) DO UPDATE SET
       is_read = excluded.is_read,
       is_saved = excluded.is_saved,
       read_at = CASE WHEN excluded.is_read = 1 THEN excluded.read_at ELSE article_states.read_at END,
       saved_at = CASE WHEN excluded.is_saved = 1 THEN excluded.saved_at ELSE article_states.saved_at END`
  )
    .bind(
      user.id,
      articleId,
      nextRead,
      nextSaved,
      nextRead ? now : null,
      nextSaved ? now : null
    )
    .run();

  return c.json({
    articleId,
    isRead: Boolean(nextRead),
    isSaved: Boolean(nextSaved),
  });
});

// Mark all matching articles as read
app.post('/api/articles/mark-all-read', async (c) => {
  const user = c.get('user');
  const body = await c.req.json<{
    scope?: string;
    folderId?: string;
    feedId?: string;
  }>();

  const scope = body.scope || 'all';
  const conditions: string[] = ['s.user_id = ?'];
  const params: unknown[] = [user.id];

  if (scope === 'folder' && body.folderId) {
    conditions.push('s.folder_id = ?');
    params.push(body.folderId);
  } else if (scope === 'feed' && body.feedId) {
    conditions.push('s.feed_id = ?');
    params.push(body.feedId);
  } else if (scope === 'saved') {
    conditions.push('COALESCE(st.is_saved, 0) = 1');
  } else if (scope === 'today') {
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    conditions.push('a.published_at >= ?');
    params.push(twentyFourHoursAgo);
  }

  // Older articles already count as read, so only the unread window needs
  // marking — in one statement, as a per-article loop exceeds D1's query budget.
  conditions.push('a.published_at >= ?');
  params.push(unreadCutoff());
  const res = await c.env.DB.prepare(
    `INSERT INTO article_states (user_id, article_id, is_read, read_at)
     SELECT s.user_id, a.id, 1, ?
     FROM articles a
     JOIN subscriptions s ON s.feed_id = a.feed_id
     LEFT JOIN article_states st ON st.article_id = a.id AND st.user_id = s.user_id
     WHERE ${conditions.join(' AND ')} AND COALESCE(st.is_read, 0) = 0
     ON CONFLICT(user_id, article_id) DO UPDATE SET is_read = 1, read_at = excluded.read_at`
  )
    .bind(new Date().toISOString(), ...params)
    .run();

  return c.json({ markedCount: Number(res.meta?.changes ?? 0) });
});

// Runs for any subscribed publisher when its article is opened, independently
// of Reader View. Repeated opens use the saved result rather than refetching.
app.post('/api/articles/:id/publication-date', async (c) => {
  const article = await c.env.DB.prepare(`SELECT a.id,a.url,a.title,a.summary,a.content_html,a.full_content_html,a.published_at,d.source AS date_source,d.checked_at FROM articles a LEFT JOIN article_date_checks d ON d.article_id=a.id WHERE a.id=? AND EXISTS(SELECT 1 FROM subscriptions s WHERE s.feed_id=a.feed_id AND s.user_id=?)`).bind(c.req.param('id'), c.get('user').id).first<PublicationArticle>();
  if (!article) return c.json({ error: '아티클을 찾을 수 없습니다.' }, 404);
  return c.json(await resolveArticlePublication(c.env.DB, article));
});

// Reader View: Scrape full article body from original URL
// Remember the body view (feed content / reader / web page) per feed.
app.put('/api/feeds/:feedId/view-mode', async (c) => {
  const user = c.get('user');
  const feedId = c.req.param('feedId');
  const { viewMode } = await c.req
    .json<{ viewMode?: string }>()
    .catch(() => ({ viewMode: undefined }));
  if (viewMode !== 'feed' && viewMode !== 'reader' && viewMode !== 'web') {
    return c.json({ error: '보기 방식은 feed, reader, web 중 하나여야 합니다.' }, 400);
  }
  const subscribed = await c.env.DB.prepare('SELECT 1 FROM subscriptions WHERE user_id = ? AND feed_id = ?')
    .bind(user.id, feedId)
    .first();
  if (!subscribed) return c.json({ error: '구독 중인 피드가 아닙니다.' }, 404);
  await c.env.DB.prepare(
    `INSERT INTO feed_view_modes (user_id, feed_id, view_mode, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id, feed_id) DO UPDATE SET view_mode = excluded.view_mode, updated_at = excluded.updated_at`
  )
    .bind(user.id, feedId, viewMode, new Date().toISOString())
    .run();
  return c.json({ viewMode });
});

// Thumbnail for an article whose feed shipped none: look up the page's
// og:image once. '' records "looked up, none" so the page is not fetched
// again; unreachable pages are left unchecked for a later try.
app.post('/api/articles/:id/thumbnail', async (c) => {
  const article = await c.env.DB.prepare('SELECT id, url, thumbnail_url FROM articles WHERE id = ?')
    .bind(c.req.param('id'))
    .first<{ id: string; url: string; thumbnail_url: string | null }>();
  if (!article) return c.json({ error: '아티클을 찾을 수 없습니다.' }, 404);
  if (article.thumbnail_url !== null) return c.json({ thumbnailUrl: article.thumbnail_url || null });

  const found = await fetchPreviewImage(article.url);
  if (found !== undefined) {
    await c.env.DB.prepare('UPDATE articles SET thumbnail_url = ? WHERE id = ? AND thumbnail_url IS NULL')
      .bind(found ?? '', article.id)
      .run();
  }
  return c.json({ thumbnailUrl: found ?? null });
});

// Web view: may the original page be framed inside the reader pane?
app.get('/api/articles/:id/embeddable', async (c) => {
  const article = await c.env.DB.prepare('SELECT url FROM articles WHERE id = ?')
    .bind(c.req.param('id'))
    .first<{ url: string }>();
  if (!article) return c.json({ error: '아티클을 찾을 수 없습니다.' }, 404);
  return c.json(await checkEmbeddable(article.url, new URL(c.req.url).origin));
});

app.post('/api/articles/:id/reader-view', async (c) => {
  const articleId = c.req.param('id');
  const body = await c.req
    .json<{ force?: boolean }>()
    .catch(() => ({ force: false }));

  const article = await c.env.DB.prepare(
    `SELECT id, title, url, content_html, full_content_html, thumbnail_url, published_at
     FROM articles WHERE id = ?`
  )
    .bind(articleId)
    .first<{
      id: string;
      title: string;
      url: string;
      content_html: string | null;
      full_content_html: string | null;
      thumbnail_url: string | null;
      published_at: string;
    }>();

  if (!article) {
    return c.json({ error: '아티클을 찾을 수 없습니다.' }, 404);
  }

  if (article.full_content_html && !body.force) {
    const publishedAt = extractOriginalPublishedAt(article.content_html, article.url) || extractOriginalPublishedAt(article.full_content_html, article.url) || article.published_at;
    if (publishedAt !== article.published_at) {
      await c.env.DB.prepare('UPDATE articles SET published_at = ? WHERE id = ?').bind(publishedAt, article.id).run();
    }
    return c.json({
      fullContentHtml: article.full_content_html,
      publishedAt,
      cached: true,
    });
  }

  const scraped = await scrapeFullArticle(
    article.url,
    article.content_html,
    article.title
  );

  await c.env.DB.prepare(
    `UPDATE articles
     SET full_content_html = ?,
         thumbnail_url = COALESCE(NULLIF(thumbnail_url, ''), ?),
         published_at = COALESCE(?, published_at)
     WHERE id = ?`
  )
    .bind(scraped.fullContentHtml, scraped.leadImageUrl, scraped.originalPublishedAt, article.id)
    .run();

  return c.json({
    fullContentHtml: scraped.fullContentHtml,
    publishedAt: scraped.originalPublishedAt || article.published_at,
    scrapedFromWeb: scraped.scrapedFromWeb,
    cached: false,
  });
});

// Cloudflare Workers AI Summary endpoint
app.post('/api/articles/:id/summarize', async (c) => {
  const articleId = c.req.param('id');
  const body = await c.req
    .json<{ force?: boolean }>()
    .catch(() => ({ force: false }));

  const article = await c.env.DB.prepare(
    `SELECT a.id, a.title, a.summary, a.content_html, a.full_content_html, a.ai_summary, f.title as feed_title
     FROM articles a
     JOIN feeds f ON f.id = a.feed_id
     WHERE a.id = ?`
  )
    .bind(articleId)
    .first<{
      id: string;
      title: string;
      summary: string | null;
      content_html: string | null;
      full_content_html: string | null;
      ai_summary: string | null;
      feed_title: string;
    }>();

  if (!article) {
    return c.json({ error: '아티클을 찾을 수 없습니다.' }, 404);
  }

  if (article.ai_summary && !body.force) {
    return c.json({
      aiSummary: article.ai_summary,
      provider: c.env.AI ? 'cloudflare-workers-ai' : 'cached',
      model: c.env.AI_MODEL || '@cf/meta/llama-3.1-8b-instruct',
      cached: true,
    });
  }

  const result = await summarizeArticleWithAI(c.env, {
    title: article.title,
    feedTitle: article.feed_title,
    summary: article.summary,
    contentHtml: article.content_html,
    fullContentHtml: article.full_content_html,
  });

  await c.env.DB.prepare('UPDATE articles SET ai_summary = ? WHERE id = ?')
    .bind(result.summary, article.id)
    .run();

  return c.json({
    aiSummary: result.summary,
    provider: result.provider,
    model: result.model,
    cached: false,
  });
});

// Parse the entire OPML before writing anything; the client imports every item individually.
app.post('/api/opml/parse', async (c) => {
  const body = await c.req.json<{ opmlXml?: string }>();
  if (typeof body.opmlXml !== 'string' || !body.opmlXml.trim()) {
    return c.json({ error: 'OPML XML 내용이 비어 있습니다.' }, 400);
  }
  try {
    const items = parseOpml(body.opmlXml);
    if (items.length === 0) {
      return c.json({ error: 'OPML 파일에서 RSS 피드 항목을 찾지 못했습니다.' }, 400);
    }
    return c.json({ items, totalFound: items.length });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'OPML 파일을 읽지 못했습니다.' }, 400);
  }
});

function validOpmlItem(item: OpmlFeed | undefined): item is OpmlFeed {
  return Boolean(item && typeof item.xmlUrl === 'string' && item.xmlUrl.trim() &&
    (item.title == null || typeof item.title === 'string') &&
    (item.htmlUrl == null || typeof item.htmlUrl === 'string') &&
    (item.folderName == null || typeof item.folderName === 'string'));
}

app.get('/api/opml/failures', async (c) => {
  c.header('Cache-Control', 'no-store');
  return c.json({ failures: await listOpmlFailures(c.env.DB, c.get('user').id) });
});

// Diagnose a migrated URL in the same Worker environment without subscribing.
app.post('/api/opml/check', async (c) => {
  const body = await c.req.json<{ url?: string }>();
  let url: URL;
  try {
    if (typeof body.url !== 'string') throw new Error();
    url = new URL(body.url.trim());
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error();
  } catch {
    return c.json({ error: '올바른 HTTP 또는 HTTPS RSS 주소가 아닙니다.' }, 400);
  }
  try {
    const parsed = await fetchAndParseFeed(url.href);
    return c.json({ ok: true, title: parsed.title, articles: parsed.articles.length });
  } catch (error) {
    return c.json({ ok: false, error: new OpmlSourceError(error).message });
  }
});

// The client can also record a network/interrupted-response failure, without
// exposing its private feed URL to any service other than the user's own account.
app.post('/api/opml/failures', async (c) => {
  const body = await c.req.json<{ item?: OpmlFeed; error?: string }>();
  if (!validOpmlItem(body.item) || typeof body.error !== 'string' || !body.error.trim()) {
    return c.json({ error: '저장할 실패 항목을 확인해 주세요.' }, 400);
  }
  await recordOpmlFailure(c.env.DB, c.get('user').id, body.item, body.error);
  return c.json({ saved: true });
});

// One feed per request avoids a large file exhausting Worker time or query budgets.
app.post('/api/opml/import', async (c) => {
  const body = await c.req.json<{ item?: OpmlFeed; previousUrl?: string }>();
  const item = body.item;
  if (!validOpmlItem(item) || (body.previousUrl != null && typeof body.previousUrl !== 'string')) {
    return c.json({ error: '가져오기 화면을 새로고침한 뒤 OPML 파일을 다시 선택해 주세요.' }, 400);
  }
  let xmlUrl: string;
  try {
    const url = new URL(item.xmlUrl.trim());
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error();
    xmlUrl = url.href;
  } catch {
    const error = '올바른 HTTP 또는 HTTPS RSS 주소가 아닙니다.';
    await recordOpmlFailure(c.env.DB, c.get('user').id, item, error);
    if (body.previousUrl && body.previousUrl !== item.xmlUrl) {
      await clearOpmlFailure(c.env.DB, c.get('user').id, body.previousUrl);
    }
    return c.json({ status: 'failed' as const, foldersCreated: 0, error, failureSaved: true });
  }
  try {
    const result = await importOpmlFeed(c.env.DB, c.get('user').id, { ...item, xmlUrl });
    await clearOpmlFailure(c.env.DB, c.get('user').id, xmlUrl, body.previousUrl || item.xmlUrl);
    return c.json(result);
  } catch (error) {
    const sourceError = error instanceof OpmlSourceError;
    const detail = error instanceof Error ? error.message : 'Unknown error';
    console.warn('OPML import failed', {
      stage: sourceError ? 'fetch' : 'database',
      sourceHost: new URL(xmlUrl).hostname,
      // Never log feed URL paths/queries, which may contain private feed tokens.
      reason: detail.replace(/https?:\/\/[^\s]+/gi, '[feed URL]').slice(0, 300),
    });
    const message = sourceError
      ? error.message
      : '구독 정보를 조회하거나 저장하는 중 오류가 발생했습니다. 서버 오류 기록을 확인해야 합니다.';
    let failureSaved = false;
    try {
      await recordOpmlFailure(c.env.DB, c.get('user').id, { ...item, xmlUrl }, message);
      if (body.previousUrl && body.previousUrl !== xmlUrl) {
        await clearOpmlFailure(c.env.DB, c.get('user').id, body.previousUrl);
      }
      failureSaved = true;
    } catch {
      console.error('Could not persist OPML import failure');
    }
    return c.json({
      status: 'failed' as const,
      foldersCreated: 0,
      error: message,
      failureSaved,
    });
  }
});

// OPML Export
app.get('/api/opml/export', async (c) => {
  const user = c.get('user');

  const foldersRes = await c.env.DB.prepare(
    'SELECT id, name FROM folders WHERE user_id = ? ORDER BY sort_order ASC, name ASC'
  )
    .bind(user.id)
    .all<{ id: string; name: string }>();

  const subsRes = await c.env.DB.prepare(
    `SELECT
       s.folder_id,
       COALESCE(s.custom_title, f.title) as title,
       f.xml_url,
       f.html_url
     FROM subscriptions s
     JOIN feeds f ON f.id = s.feed_id
     WHERE s.user_id = ?
     ORDER BY title ASC`
  )
    .bind(user.id)
    .all<{
      folder_id: string | null;
      title: string;
      xml_url: string;
      html_url: string | null;
    }>();

  const xml = generateOpml(
    user.name,
    foldersRes.results || [],
    subsRes.results || []
  );

  return new Response(xml, {
    headers: {
      'Content-Type': 'text/x-opml; charset=utf-8',
      'Content-Disposition': 'attachment; filename="sfeed-subscriptions.opml"',
    },
  });
});
