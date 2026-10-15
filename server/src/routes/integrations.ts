import { Router, type Request } from 'express';
import crypto from 'node:crypto';
import { all, get, insert, update, run, parseJsonAll, parseJson, currentCompanySlug } from '../db.js';
import { requireHr } from '../auth.js';
import { wrap, badRequest, notFound, audit, toInt, nowIso, today } from '../util.js';

/**
 * Integrations: API keys for job boards / ATS tools pushing candidates in (see public.ts), and
 * outgoing webhooks fired on recruitment events. HR only. Keys are shown once on creation and
 * stored as a SHA-256 hash; webhook payloads are signed with HMAC-SHA256 when a secret is set.
 */
const r = Router();

export const SCOPES = [
  { key: 'candidates:write', label: 'Create candidates', description: 'POST /api/public/v1/candidates with a CV or JSON details.' },
  { key: 'jobs:read', label: 'Read open jobs', description: 'GET /api/public/v1/jobs (the same list the careers page shows).' },
];
export const EVENTS = [
  { key: 'candidate.created', label: 'Candidate created', description: 'A CV was uploaded, an application arrived from the careers page, or an API key pushed a candidate.' },
  { key: 'candidate.stage_changed', label: 'Candidate moved', description: 'A candidate moved between pipeline stages.' },
  { key: 'employee.hired', label: 'Candidate hired', description: 'A candidate was hired and their employee record created.' },
];
const SCOPE_KEYS = SCOPES.map((s) => s.key);
const EVENT_KEYS = EVENTS.map((e) => e.key);

const hashKey = (key: string) => crypto.createHash('sha256').update(key).digest('hex');

/* ------------------------------------------------------------------ */
/* Helpers used by other routers                                       */
/* ------------------------------------------------------------------ */
/** Looks up an active API key from the `X-API-Key` header (or `Authorization: ApiKey …`). */
export function apiKeyFrom(req: Request): any | null {
  const header = String(req.headers['x-api-key'] || '').trim() || String(req.headers.authorization || '').replace(/^ApiKey\s+/i, '').trim();
  if (!header || !header.startsWith('hrms_')) return null;
  const row = get<any>('SELECT * FROM api_keys WHERE key_hash = ? AND active = 1', [hashKey(header)]);
  if (!row) return null;
  run('UPDATE api_keys SET last_used_at = ? WHERE id = ?', [nowIso(), row.id]);
  return parseJson(row, ['scopes']);
}

async function deliver(hook: any, event: string, data: any) {
  const body = JSON.stringify({ event, sent_at: nowIso(), data });
  const headers: Record<string, string> = { 'Content-Type': 'application/json', 'User-Agent': 'HRMS-Webhooks/1', 'X-HRMS-Event': event };
  if (hook.secret) headers['X-HRMS-Signature'] = 'sha256=' + crypto.createHmac('sha256', hook.secret).update(body).digest('hex');
  let status_code: number | null = null;
  let error: string | null = null;
  try {
    const res = await fetch(hook.url, { method: 'POST', headers, body, signal: AbortSignal.timeout(5000), redirect: 'manual' });
    status_code = res.status;
    if (!res.ok) error = `HTTP ${res.status}`;
  } catch (e: any) {
    error = e?.name === 'TimeoutError' ? 'Timed out after 5 s' : String(e?.cause?.code || e?.message || 'Delivery failed').slice(0, 300);
  }
  const ok = status_code !== null && status_code >= 200 && status_code < 300 ? 1 : 0;
  try {
    const id = insert('webhook_deliveries', { webhook_id: hook.id, event, payload: body, status_code, ok, error: ok ? null : error, attempted_at: nowIso() });
    // Keep the log small: the newest 50 deliveries per webhook.
    run('DELETE FROM webhook_deliveries WHERE webhook_id = ? AND id NOT IN (SELECT id FROM webhook_deliveries WHERE webhook_id = ? ORDER BY id DESC LIMIT 50)', [hook.id, hook.id]);
    return get<any>('SELECT * FROM webhook_deliveries WHERE id = ?', [id]);
  } catch {
    return null; // the webhook may have been deleted while the request was in flight
  }
}

/** Fire-and-forget: sends `event` to every active webhook subscribed to it. Never throws. */
export function emitEvent(event: string, data: any) {
  let hooks: any[] = [];
  try {
    hooks = parseJsonAll(all<any>('SELECT * FROM webhooks WHERE active = 1'), ['events']).filter((h) => Array.isArray(h.events) && (h.events.includes(event) || h.events.includes('*')));
  } catch {
    return;
  }
  for (const h of hooks) deliver(h, event, data).catch(() => {});
}

/* ------------------------------------------------------------------ */
/* Overview                                                            */
/* ------------------------------------------------------------------ */
function keyRows() {
  return parseJsonAll(all<any>(`SELECT k.id, k.name, k.key_prefix, k.scopes, k.active, k.last_used_at, k.created_at, u.email AS created_by_email
                                FROM api_keys k LEFT JOIN users u ON u.id = k.created_by ORDER BY k.active DESC, k.created_at DESC`), ['scopes']);
}
function hookRow(id: number) {
  const h = parseJson(get<any>(`SELECT w.*, (SELECT COUNT(*) FROM webhook_deliveries d WHERE d.webhook_id = w.id) AS deliveries,
                                       (SELECT COUNT(*) FROM webhook_deliveries d WHERE d.webhook_id = w.id AND d.ok = 0) AS failures,
                                       (SELECT MAX(attempted_at) FROM webhook_deliveries d WHERE d.webhook_id = w.id) AS last_attempt_at,
                                       (SELECT d.ok FROM webhook_deliveries d WHERE d.webhook_id = w.id ORDER BY d.id DESC LIMIT 1) AS last_ok
                                FROM webhooks w WHERE w.id = ?`, [id]), ['events']);
  if (!h) throw notFound('Webhook not found');
  h.has_secret = !!h.secret;
  delete h.secret;
  return h;
}

r.get('/', requireHr, (_req, res) => {
  const hooks = all<any>('SELECT id FROM webhooks ORDER BY created_at DESC').map((h) => hookRow(h.id));
  const since = new Date(Date.now() - 30 * 86400000).toISOString();
  res.json({
    keys: keyRows(),
    webhooks: hooks,
    scopes: SCOPES,
    events: EVENTS,
    careers: {
      path: '/careers',
      open_jobs: get<any>("SELECT COUNT(*) AS n FROM vacancies WHERE status = 'open'")?.n ?? 0,
      applications_30d: get<any>("SELECT COUNT(*) AS n FROM candidates WHERE source = 'Careers page' AND created_at >= ?", [since])?.n ?? 0,
      api_candidates_30d: get<any>("SELECT COUNT(*) AS n FROM candidates WHERE source LIKE 'API:%' AND created_at >= ?", [since])?.n ?? 0,
    },
    today: today(),
  });
});

/* ------------------------------------------------------------------ */
/* API keys                                                            */
/* ------------------------------------------------------------------ */
function cleanScopes(v: any): string[] {
  const list = Array.isArray(v) ? v.map(String) : [];
  const bad = list.filter((s) => !SCOPE_KEYS.includes(s));
  if (bad.length) throw badRequest(`Unknown scope: ${bad.join(', ')}`);
  if (!list.length) throw badRequest('Pick at least one scope');
  return [...new Set(list)];
}

r.post('/keys', requireHr, wrap(async (req, res) => {
  const name = String(req.body?.name || '').trim().slice(0, 80);
  if (!name) throw badRequest('name is required');
  const scopes = cleanScopes(req.body?.scopes ?? ['candidates:write']);
  // The company slug is part of the key so the public API can route it to the right company.
  const key = `hrms_${currentCompanySlug()}_${crypto.randomBytes(24).toString('base64url')}`;
  const id = insert('api_keys', { name, key_prefix: key.slice(0, key.indexOf('_', 5) + 7), key_hash: hashKey(key), scopes: JSON.stringify(scopes), active: 1, created_by: req.user!.id, created_at: nowIso() });
  audit(req, 'create', 'api_key', id, { name, scopes });
  res.status(201).json({ ...keyRows().find((k) => k.id === id), key });
}));

r.post('/keys/:id/revoke', requireHr, (req, res) => {
  const id = toInt(req.params.id)!;
  if (!get('SELECT 1 FROM api_keys WHERE id = ?', [id])) throw notFound('API key not found');
  update('api_keys', id, { active: 0 });
  audit(req, 'revoke', 'api_key', id);
  res.json(keyRows().find((k) => k.id === id));
});

r.delete('/keys/:id', requireHr, (req, res) => {
  const id = toInt(req.params.id)!;
  if (!get('SELECT 1 FROM api_keys WHERE id = ?', [id])) throw notFound('API key not found');
  run('DELETE FROM api_keys WHERE id = ?', [id]);
  audit(req, 'delete', 'api_key', id);
  res.json({ ok: true });
});

/* ------------------------------------------------------------------ */
/* Webhooks                                                            */
/* ------------------------------------------------------------------ */
function hookData(body: any, partial = false) {
  const out: any = {};
  if (!partial || body.url !== undefined) {
    const url = String(body.url || '').trim();
    let u: URL;
    try { u = new URL(url); } catch { throw badRequest('url must be a valid http(s) URL'); }
    if (!['http:', 'https:'].includes(u.protocol)) throw badRequest('url must be a valid http(s) URL');
    out.url = url.slice(0, 500);
  }
  if (!partial || body.events !== undefined) {
    const events = Array.isArray(body.events) ? body.events.map(String) : [];
    const bad = events.filter((e: string) => !EVENT_KEYS.includes(e) && e !== '*');
    if (bad.length) throw badRequest(`Unknown event: ${bad.join(', ')}`);
    if (!events.length) throw badRequest('Pick at least one event');
    out.events = JSON.stringify([...new Set(events)]);
  }
  if (body.secret !== undefined) out.secret = body.secret ? String(body.secret).slice(0, 200) : null;
  if (body.active !== undefined) out.active = body.active ? 1 : 0;
  return out;
}

r.post('/webhooks', requireHr, wrap(async (req, res) => {
  const data = hookData(req.body || {});
  const id = insert('webhooks', { secret: null, active: 1, ...data, created_at: nowIso() });
  audit(req, 'create', 'webhook', id, { url: data.url });
  res.status(201).json(hookRow(id));
}));

r.put('/webhooks/:id', requireHr, wrap(async (req, res) => {
  const id = toInt(req.params.id)!;
  hookRow(id);
  const data = hookData(req.body || {}, true);
  if (Object.keys(data).length) update('webhooks', id, data);
  audit(req, 'update', 'webhook', id, Object.keys(data));
  res.json(hookRow(id));
}));

r.delete('/webhooks/:id', requireHr, (req, res) => {
  const id = toInt(req.params.id)!;
  hookRow(id);
  run('DELETE FROM webhooks WHERE id = ?', [id]);
  audit(req, 'delete', 'webhook', id);
  res.json({ ok: true });
});

r.get('/webhooks/:id/deliveries', requireHr, (req, res) => {
  const id = toInt(req.params.id)!;
  hookRow(id);
  res.json(all<any>('SELECT * FROM webhook_deliveries WHERE webhook_id = ? ORDER BY id DESC LIMIT 20', [id]));
});

/** Sends a `ping` event right away and returns the delivery result. */
r.post('/webhooks/:id/test', requireHr, wrap(async (req, res) => {
  const id = toInt(req.params.id)!;
  hookRow(id);
  const hook = get<any>('SELECT * FROM webhooks WHERE id = ?', [id]);
  const delivery = await deliver(hook, 'ping', { message: 'Test delivery from HRMS', webhook_id: id });
  res.json({ delivery, webhook: hookRow(id) });
}));

export default r;
