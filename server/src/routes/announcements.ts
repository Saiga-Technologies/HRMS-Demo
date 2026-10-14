import { Router, type Request } from 'express';
import { all, get, insert, update, run, transaction } from '../db.js';
import { requireAuth, requireHr } from '../auth.js';
import { wrap, badRequest, notFound, pick, requireFields, audit, toInt, nowIso, addDays, today } from '../util.js';

/**
 * Notice board. Audience is `all`, `managers`, `hr` or `department:<id>`; a post is live between
 * publish_at and expires_at (both optional). Reads are tracked per user in announcement_reads.
 * Mounted at /api/announcements.
 */
const r = Router();

const COLS = ['title', 'body', 'audience', 'pinned', 'publish_at', 'expires_at'];
const baseQuery = `
  SELECT a.*, d.name AS department_name,
         COALESCE(NULLIF(TRIM(ae.first_name || ' ' || ae.last_name), ''), au.email) AS author_name
  FROM announcements a
  LEFT JOIN departments d ON a.audience = 'department:' || d.id
  LEFT JOIN users au ON au.id = a.created_by
  LEFT JOIN employees ae ON ae.id = au.employee_id`;

export function audienceLabel(a: { audience: string; department_name?: string | null }): string {
  if (a.audience === 'all') return 'Everyone';
  if (a.audience === 'managers') return 'Managers';
  if (a.audience === 'hr') return 'HR';
  if (a.audience.startsWith('department:')) return a.department_name ? `${a.department_name} department` : 'Department';
  return a.audience;
}
function decorate(row: any) {
  if (!row) return row;
  row.pinned = row.pinned ? 1 : 0;
  row.audience_label = audienceLabel(row);
  const now = nowIso();
  row.state = row.publish_at && row.publish_at > now ? 'scheduled' : row.expires_at && row.expires_at < now ? 'expired' : 'live';
  return row;
}

/** SQL fragment + params restricting rows to those the signed-in user may see (HR sees every audience). */
function visibilityClause(req: Request): { sql: string; params: any[] } {
  const user = req.user!;
  const dept = user.employee_id ? get<any>('SELECT department_id FROM employees WHERE id = ?', [user.employee_id])?.department_id ?? null : null;
  const audiences = ['all'];
  if (user.role === 'manager' || user.role === 'hr') audiences.push('managers');
  if (user.role === 'hr') audiences.push('hr');
  if (dept) audiences.push(`department:${dept}`);
  const parts = [`a.audience IN (${audiences.map(() => '?').join(',')})`];
  const params: any[] = [...audiences];
  if (user.role === 'hr') parts.push("a.audience LIKE 'department:%'");
  return { sql: `(${parts.join(' OR ')})`, params };
}
const windowClause = '(a.publish_at IS NULL OR a.publish_at <= ?) AND (a.expires_at IS NULL OR a.expires_at >= ?)';

/** Demo notices, inserted the first time the board is read while empty. */
export function ensureAnnouncementDefaults() {
  if (get('SELECT 1 FROM announcements LIMIT 1')) return;
  const author = get<any>("SELECT id FROM users WHERE role = 'hr' ORDER BY id LIMIT 1")?.id ?? null;
  const dept = get<any>("SELECT id FROM departments WHERE name = 'Platform'") || get<any>('SELECT id FROM departments ORDER BY id LIMIT 1');
  const holiday = get<any>('SELECT name, date FROM holidays WHERE date >= ? ORDER BY date LIMIT 1', [today()]);
  const daysAgo = (n: number) => new Date(Date.now() - n * 86400000).toISOString();
  transaction(() => {
    const post = (title: string, body: string, audience: string, pinned: number, publish_at: string, expires_at: string | null) =>
      insert('announcements', { title, body, audience, pinned, publish_at, expires_at, created_by: author, created_at: publish_at, updated_at: publish_at });
    post('Welcome to the new HRMS', 'Welcome aboard! This portal is now the single place for attendance, leave, payslips, documents and your shift roster.\n\nStart by checking your profile under Account and make sure your emergency contact is up to date. If anything looks wrong, raise it with HR and we will fix it within a working day.', 'all', 1, daysAgo(10), null);
    post(holiday ? `Holiday notice: ${holiday.name}` : 'Holiday notice', holiday
      ? `The office will be closed on ${holiday.date} for ${holiday.name}. Attendance is not required and no leave is deducted.\n\nIf you are scheduled on a client site that day, please confirm with your reporting manager whether the client observes the holiday.`
      : 'The updated holiday calendar for the year is available under Settings. Optional holidays can be availed by applying for leave as usual.', 'all', 0, daysAgo(4), null);
    post('Policy update: approvals within two working days', 'A reminder that leave, attendance appeals and comp-off requests should be actioned within two working days. Requests still pending after that are escalated to the next manager in the reporting chain.\n\nThe Approvals tab on each module shows what is waiting on you.', 'managers', 0, daysAgo(2), null);
    if (dept) post('Platform: on-call rotation starts Monday', 'The new on-call rotation for the Platform team starts next Monday. Check the shift roster for your assigned week and swap with a teammate if you have approved leave in that window.\n\nQuestions go to your engineering manager.', `department:${dept.id}`, 0, daysAgo(1), addDays(today(), 21) + 'T23:59:59.000Z');
  });
}

function validate(body: any, existing?: any) {
  const data = pick<any>(body, COLS);
  if (data.title !== undefined && !String(data.title).trim()) throw badRequest('title is required');
  if (data.body !== undefined && !String(data.body).trim()) throw badRequest('body is required');
  if (data.audience !== undefined) {
    const a = String(data.audience);
    if (a.startsWith('department:')) {
      const id = toInt(a.slice('department:'.length));
      if (!id || !get('SELECT 1 FROM departments WHERE id = ?', [id])) throw badRequest('Unknown department for audience');
      data.audience = `department:${id}`;
    } else if (!['all', 'managers', 'hr'].includes(a)) throw badRequest('audience must be all, managers, hr or department:<id>');
  }
  if (data.pinned !== undefined) data.pinned = data.pinned ? 1 : 0;
  for (const k of ['publish_at', 'expires_at']) {
    if (data[k] === undefined) continue;
    if (data[k] === null || data[k] === '') { data[k] = null; continue; }
    const t = Date.parse(String(data[k]));
    if (Number.isNaN(t)) throw badRequest(`${k} must be an ISO date-time`);
    data[k] = new Date(t).toISOString();
  }
  const merged = { ...(existing || {}), ...data };
  if (merged.publish_at && merged.expires_at && merged.expires_at <= merged.publish_at) throw badRequest('expires_at must be after publish_at');
  return data;
}
const loadOne = (id: number | undefined) => decorate(get<any>(`${baseQuery} WHERE a.id = ?`, [id]));

// ---------- Feed (visible to the signed-in user) ----------
r.get('/', requireAuth, (req, res) => {
  ensureAnnouncementDefaults();
  const vis = visibilityClause(req);
  const now = nowIso();
  const rows = all<any>(`${baseQuery.replace('SELECT a.*,', 'SELECT a.*, (ar.read_at IS NOT NULL) AS is_read, ar.read_at,')}
     LEFT JOIN announcement_reads ar ON ar.announcement_id = a.id AND ar.user_id = ?
     WHERE ${vis.sql} AND ${windowClause}
     ORDER BY a.pinned DESC, COALESCE(a.publish_at, a.created_at) DESC, a.id DESC`, [req.user!.id, ...vis.params, now, now]).map(decorate);
  res.json(rows);
});

// ---------- HR management (literal paths before /:id) ----------
r.get('/all', requireHr, (_req, res) => {
  ensureAnnouncementDefaults();
  const rows = all<any>(`${baseQuery.replace('SELECT a.*,', 'SELECT a.*, (SELECT COUNT(*) FROM announcement_reads ar WHERE ar.announcement_id = a.id) AS read_count,')}
     ORDER BY a.pinned DESC, COALESCE(a.publish_at, a.created_at) DESC, a.id DESC`).map(decorate);
  res.json(rows);
});
r.post('/read-all', requireAuth, (req, res) => {
  const vis = visibilityClause(req);
  const now = nowIso();
  const ids = all<{ id: number }>(`SELECT a.id FROM announcements a WHERE ${vis.sql} AND ${windowClause}`, [...vis.params, now, now]);
  let marked = 0;
  transaction(() => {
    for (const { id } of ids) marked += run('INSERT OR IGNORE INTO announcement_reads (announcement_id, user_id, read_at) VALUES (?, ?, ?)', [id, req.user!.id, now]).changes;
  });
  res.json({ marked, total: ids.length });
});
r.post('/', requireHr, wrap(async (req, res) => {
  requireFields(req.body, ['title', 'body']);
  ensureAnnouncementDefaults();
  const data = validate(req.body);
  const now = nowIso();
  const id = insert('announcements', { audience: 'all', pinned: 0, publish_at: null, expires_at: null, ...data, created_by: req.user!.id, created_at: now, updated_at: now });
  audit(req, 'create', 'announcement', id, { title: data.title, audience: data.audience });
  res.status(201).json(loadOne(id));
}));
r.get('/:id', requireAuth, (req, res) => {
  const id = toInt(req.params.id);
  const vis = visibilityClause(req);
  const row = req.user!.role === 'hr' ? loadOne(id) : decorate(get<any>(`${baseQuery} WHERE a.id = ? AND ${vis.sql}`, [id, ...vis.params]));
  if (!row) throw notFound('Announcement not found');
  row.is_read = get('SELECT 1 FROM announcement_reads WHERE announcement_id = ? AND user_id = ?', [id, req.user!.id]) ? 1 : 0;
  res.json(row);
});
r.put('/:id', requireHr, wrap(async (req, res) => {
  const id = toInt(req.params.id);
  const existing = get<any>('SELECT * FROM announcements WHERE id = ?', [id]);
  if (!existing) throw notFound('Announcement not found');
  const data = validate(req.body, existing);
  update('announcements', id!, { ...data, updated_at: nowIso() });
  audit(req, 'update', 'announcement', id, data);
  res.json(loadOne(id));
}));
r.delete('/:id', requireHr, (req, res) => {
  const id = toInt(req.params.id);
  if (!run('DELETE FROM announcements WHERE id = ?', [id]).changes) throw notFound('Announcement not found');
  audit(req, 'delete', 'announcement', id);
  res.status(204).end();
});
r.post('/:id/read', requireAuth, (req, res) => {
  const id = toInt(req.params.id);
  const vis = visibilityClause(req);
  if (!get(`SELECT 1 FROM announcements a WHERE a.id = ? AND ${vis.sql}`, [id, ...vis.params])) throw notFound('Announcement not found');
  run('INSERT OR IGNORE INTO announcement_reads (announcement_id, user_id, read_at) VALUES (?, ?, ?)', [id, req.user!.id, nowIso()]);
  res.json({ id, is_read: 1, unread: get<any>(`SELECT COUNT(*) AS n FROM announcements a WHERE ${vis.sql} AND ${windowClause} AND NOT EXISTS (SELECT 1 FROM announcement_reads ar WHERE ar.announcement_id = a.id AND ar.user_id = ?)`, [...vis.params, nowIso(), nowIso(), req.user!.id])?.n ?? 0 });
});
r.post('/:id/unread', requireAuth, (req, res) => {
  const id = toInt(req.params.id);
  if (!get('SELECT 1 FROM announcements WHERE id = ?', [id])) throw notFound('Announcement not found');
  run('DELETE FROM announcement_reads WHERE announcement_id = ? AND user_id = ?', [id, req.user!.id]);
  res.json({ id, is_read: 0 });
});
r.get('/:id/readers', requireHr, (req, res) => {
  const id = toInt(req.params.id);
  if (!get('SELECT 1 FROM announcements WHERE id = ?', [id])) throw notFound('Announcement not found');
  res.json(all(`SELECT ar.user_id, ar.read_at, u.email, u.role, e.first_name, e.last_name, e.employee_code,
                       COALESCE(NULLIF(TRIM(e.first_name || ' ' || e.last_name), ''), u.email) AS name
                FROM announcement_reads ar JOIN users u ON u.id = ar.user_id LEFT JOIN employees e ON e.id = u.employee_id
                WHERE ar.announcement_id = ? ORDER BY ar.read_at DESC`, [id]));
});

export default r;
