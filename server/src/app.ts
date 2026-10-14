import express, { type Request, type Response, type NextFunction } from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getDb } from './db.js';
import { attachUser } from './auth.js';
import { HttpError } from './util.js';
import authRoutes from './routes/auth.js';
import settingsRoutes from './routes/settings.js';
import orgRoutes from './routes/org.js';
import employeeRoutes from './routes/employees.js';
import documentRoutes from './routes/documents.js';
import jobRoutes from './routes/jobs.js';
import payrollRoutes from './routes/payroll.js';
import attendanceRoutes from './routes/attendance.js';
import leaveRoutes from './routes/leave.js';
import assetRoutes from './routes/assets.js';
import journeyRoutes from './routes/journey.js';
import dashboardRoutes from './routes/dashboard.js';

const here = path.dirname(fileURLToPath(import.meta.url));

export function createApp() {
  getDb();
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: false }));

  // Security headers (no external deps).
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'geolocation=(self), camera=(), microphone=()');
    next();
  });

  // CSRF mitigation for cookie sessions: state-changing API requests must be same-origin
  // (browser sends Sec-Fetch-Site) or carry an explicit JSON content-type / bearer token.
  app.use('/api', (req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    const site = req.headers['sec-fetch-site'];
    if (site && site !== 'same-origin' && site !== 'none') {
      return res.status(403).json({ error: 'Cross-site request blocked' });
    }
    next();
  });

  app.use(attachUser);

  app.get('/api/health', (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));
  app.use('/api/auth', authRoutes);
  app.use('/api/settings', settingsRoutes);
  app.use('/api/org', orgRoutes);
  app.use('/api/employees', employeeRoutes);
  app.use('/api/documents', documentRoutes);
  app.use('/api/jobs', jobRoutes);
  app.use('/api/payroll', payrollRoutes);
  app.use('/api/attendance', attendanceRoutes);
  app.use('/api/leave', leaveRoutes);
  app.use('/api/assets', assetRoutes);
  app.use('/api/journey', journeyRoutes);
  app.use('/api/dashboard', dashboardRoutes);

  app.use('/api', (_req, res) => res.status(404).json({ error: 'Unknown API route' }));

  // Serve the built client when present (production / e2e).
  const clientDist = path.resolve(here, '..', '..', 'client', 'dist');
  if (fs.existsSync(clientDist)) {
    app.use(express.static(clientDist, { index: false, maxAge: '1h' }));
    app.get(/.*/, (_req, res) => res.sendFile(path.join(clientDist, 'index.html')));
  }

  // Error handler.
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) {
      return res.status(err.status).json({ error: err.message, details: err.details });
    }
    if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON body' });
    if (err?.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'File too large' });
    if (typeof err?.message === 'string' && /UNIQUE constraint failed/.test(err.message)) {
      const col = err.message.split('failed:')[1]?.trim();
      return res.status(409).json({ error: `Duplicate value for ${col}` });
    }
    if (typeof err?.message === 'string' && /FOREIGN KEY constraint failed/.test(err.message)) {
      return res.status(409).json({ error: 'Record is referenced by other data' });
    }
    if (typeof err?.message === 'string' && /CHECK constraint failed/.test(err.message)) {
      return res.status(400).json({ error: 'Invalid value: ' + err.message.split('failed:')[1]?.trim() });
    }
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}
