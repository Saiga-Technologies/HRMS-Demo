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

export default async function handler(req, res) {
  const app = await getApp();
  return app(req, res);
}
