// Vercel serverless entry point. Every /api/* request is rewritten here (see vercel.json) and
// handled by the same Express app that `npm start` runs locally. The app is created once per
// warm function instance; the SQLite demo database lives in /tmp and is reseeded on cold start.
let appPromise;

async function getApp() {
  if (!appPromise) {
    appPromise = (async () => {
      process.env.VERCEL ||= '1';
      const { seedIfEmpty } = await import('../server/dist/seed.js');
      const { createApp } = await import('../server/dist/app.js');
      seedIfEmpty();
      return createApp();
    })();
  }
  return appPromise;
}

/** The vercel.json rewrite maps /api/:path* to /api/index?path=...; restore the original URL for Express. */
function normalizeUrl(req) {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/api/index' && url.searchParams.has('path')) {
      const p = url.searchParams.get('path') || '';
      url.searchParams.delete('path');
      url.pathname = '/api/' + p.replace(/^\/+/, '');
      req.url = url.pathname + (url.search || '');
    }
  } catch {
    /* leave as-is */
  }
}

export default async function handler(req, res) {
  normalizeUrl(req);
  const app = await getApp();
  return app(req, res);
}
