import { app } from './server/app';
import type { Env } from './server/types';
import { fetchAndParseFeed } from './server/rssParser';
import { upsertFeedAndArticles } from './server/seedService';

export default {
  async fetch(request: Request, env: Env, ctx: unknown): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.startsWith('/api/')) {
      return app.fetch(request, env, ctx as never);
    }

    if (env.ASSETS) {
      const assetResponse = await env.ASSETS.fetch(request);
      if (url.pathname === '/' || url.pathname.endsWith('.html')) {
        const headers = new Headers(assetResponse.headers);
        headers.set('Cache-Control', 'no-store');
        headers.set('X-Content-Type-Options', 'nosniff');
        return new Response(assetResponse.body, {
          status: assetResponse.status,
          statusText: assetResponse.statusText,
          headers,
        });
      }
      return assetResponse;
    }

    return new Response('Sfeed Worker API is running.', { status: 200 });
  },

  async scheduled(_event: unknown, env: Env, _ctx: unknown): Promise<void> {
    if (!env.DB) return;
    const res = await env.DB.prepare(
      'SELECT id, xml_url FROM feeds ORDER BY last_fetched_at ASC LIMIT 100'
    ).all<{ id: string; xml_url: string }>();

    const feeds = res.results || [];
    await Promise.all(
      feeds.map(async (f) => {
        try {
          const parsed = await fetchAndParseFeed(f.xml_url);
          await upsertFeedAndArticles(env.DB, parsed);
        } catch (err) {
          await env.DB.prepare('UPDATE feeds SET last_error = ? WHERE id = ?')
            .bind(
              err instanceof Error ? err.message : 'Scheduled refresh error',
              f.id
            )
            .run();
        }
      })
    );
  },
};
