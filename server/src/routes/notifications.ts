import { Router } from 'express';
import { all, get, getSetting } from '../db.js';
import { requireAuth } from '../auth.js';
import { approvableEmployeeIds } from '../approvers.js';
import { today } from '../util.js';
import { documentStatus } from './documents.js';
import { visibilityClause, windowClause } from './announcements.js';

const r = Router();

/**
 * Unread-style counters for the navigation and tab badges, computed for the signed-in user.
 * Managers see counts for their reporting chain; HR sees company-wide queues; employees see their own.
 * Pages call GET /api/notifications/counts (the client polls it every 30 s and after mutations).
 */
r.get('/counts', requireAuth, (req, res) => {
  const user = req.user!;
  const eid = user.employee_id;
  const ids = approvableEmployeeIds(req); // undefined = HR (all)
  const scope = (col: string) => (ids ? (ids.length ? ` AND ${col} IN (${ids.join(',')})` : ' AND 0') : '');
  const n = (sql: string, params: any[] = []) => get<any>(sql, params)?.n ?? 0;
  const isHr = user.role === 'hr';
  const mine = (col: string) => (eid ? ` AND ${col} = ${eid}` : ' AND 0');

  const counts: Record<string, number> = {
    // Approvals waiting on me (manager hierarchy / HR)
    leave_approvals: n(`SELECT COUNT(*) AS n FROM leave_requests l WHERE l.status IN ('pending','correction_pending')${scope('l.employee_id')}`),
    attendance_appeals: n(`SELECT COUNT(*) AS n FROM attendance_corrections c WHERE c.status = 'pending'${scope('c.employee_id')}`),
    comp_off_approvals: n(`SELECT COUNT(*) AS n FROM comp_off_credits c WHERE c.status = 'pending'${scope('c.employee_id')}`),
    // My own open items
    my_leave_pending: n(`SELECT COUNT(*) AS n FROM leave_requests WHERE status IN ('pending','correction_pending')${mine('employee_id')}`),
    my_appeals_pending: n(`SELECT COUNT(*) AS n FROM attendance_corrections WHERE status = 'pending'${mine('employee_id')}`),
    my_comp_off_detected: n(`SELECT COUNT(*) AS n FROM comp_off_credits WHERE status = 'detected'${mine('employee_id')}`),
    my_payslip_requests: n(`SELECT COUNT(*) AS n FROM payslip_requests WHERE status = 'pending'${mine('employee_id')}`),
    my_travel_active: n(`SELECT COUNT(*) AS n FROM travel_logs WHERE status = 'active'${mine('employee_id')}`),
    // HR queues
    payslip_requests: isHr ? n(`SELECT COUNT(*) AS n FROM payslip_requests WHERE status = 'pending'`) : 0,
    documents_pending_review: isHr ? n(`SELECT COUNT(*) AS n FROM documents WHERE status = 'pending_review'`) : 0,
    candidates_new: isHr || user.role === 'manager' ? n(`SELECT COUNT(*) AS n FROM candidates WHERE stage = 'new'`) : 0,
    candidates_interview: isHr || user.role === 'manager' ? n(`SELECT COUNT(*) AS n FROM candidates WHERE stage = 'interview'`) : 0,
    open_vacancies: isHr ? n(`SELECT COUNT(*) AS n FROM vacancies WHERE status = 'open'`) : 0,
    payroll_draft_runs: isHr ? n(`SELECT COUNT(*) AS n FROM payroll_runs WHERE status IN ('draft','processed')`) : 0,
    journeys_in_progress: isHr ? n(`SELECT COUNT(DISTINCT employee_id) AS n FROM journey_stages WHERE status = 'in_progress' AND name != 'Current role'`) : 0,
  };
  // Expiring documents in scope
  const visible = isHr ? undefined : [eid, ...(ids || [])].filter((x): x is number => !!x);
  const docs = all<any>(`SELECT d.expiry_date, t.expiry_warning_days, t.expiry_critical_days FROM documents d LEFT JOIN document_types t ON t.id = d.document_type_id WHERE d.expiry_date IS NOT NULL${visible ? ` AND d.employee_id IN (${visible.join(',') || 'NULL'})` : ''}`);
  counts.documents_expiring = docs.filter((d) => ['warning', 'critical', 'expired'].includes(documentStatus(d).expiry_state)).length;
  counts.letter_requests = isHr ? n(`SELECT COUNT(*) AS n FROM letters WHERE status = 'requested'`) : 0;
  counts.my_letters_ready = n(`SELECT COUNT(*) AS n FROM letters WHERE status = 'generated'${mine('employee_id')}`);
  counts.reviews_pending_self = n(`SELECT COUNT(*) AS n FROM reviews r JOIN review_cycles c ON c.id = r.cycle_id WHERE c.status = 'open' AND r.status = 'pending_self'${mine('r.employee_id')}`);
  counts.reviews_pending_manager = n(`SELECT COUNT(*) AS n FROM reviews r JOIN review_cycles c ON c.id = r.cycle_id WHERE c.status = 'open' AND r.status = 'pending_manager'${isHr ? '' : mine('r.reviewer_employee_id')}`);
  // Same audience + publish window as the feed (GET /api/announcements), so "Mark all read" clears it.
  const vis = visibilityClause(req);
  const nowTs = new Date().toISOString();
  counts.announcements_unread = n(`SELECT COUNT(*) AS n FROM announcements a WHERE ${vis.sql} AND ${windowClause} AND NOT EXISTS (SELECT 1 FROM announcement_reads ar WHERE ar.announcement_id = a.id AND ar.user_id = ?)`, [...vis.params, nowTs, nowTs, user.id]);
  // Roll-ups used by the sidebar
  counts.nav_attendance = counts.attendance_appeals + counts.comp_off_approvals + counts.my_comp_off_detected;
  counts.nav_leave = counts.leave_approvals + counts.my_leave_pending;
  counts.nav_documents = counts.documents_expiring + counts.documents_pending_review;
  counts.nav_payroll = counts.payslip_requests + counts.payroll_draft_runs;
  counts.nav_recruitment = counts.candidates_new + counts.candidates_interview;
  counts.nav_journey = counts.journeys_in_progress;
  counts.nav_letters = counts.letter_requests + counts.my_letters_ready;
  counts.nav_performance = counts.reviews_pending_self + counts.reviews_pending_manager;
  counts.nav_announcements = counts.announcements_unread;
  counts.total_actions = counts.leave_approvals + counts.attendance_appeals + counts.comp_off_approvals + counts.payslip_requests + counts.documents_pending_review + counts.my_comp_off_detected + counts.letter_requests + counts.reviews_pending_self + counts.reviews_pending_manager;
  res.json({ counts, computed_at: new Date().toISOString(), today: today(), settings: { appeal_deadline_days: getSetting('attendance', { appeal_deadline_days: 3 }).appeal_deadline_days } });
});

export default r;
