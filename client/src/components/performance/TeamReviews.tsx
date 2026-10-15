import React, { useMemo, useState } from 'react';
import { api, qs } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { fmtDate } from '../../lib/format';
import { Button, Card, Pill, SearchInput, Select, Table, useFetch } from '../ui';
import { Icon } from '../Icons';
import { ReviewModal, editorModeFor } from './ReviewModal';
import { REVIEW_STATUS_LABEL, RatingBar, ReviewStatusBadge, type Cycle, type Review, type ReviewStatus } from './shared';

const STATUS_ORDER: Record<ReviewStatus, number> = { pending_manager: 0, pending_self: 1, completed: 2, acknowledged: 3 };

/**
 * Reviews of other people the viewer can see: managers get their reporting chain (plus anything
 * assigned to them), HR gets everyone. Defaults to all open cycles; pending manager reviews first.
 */
export function TeamReviews({ cycles, onChanged }: { cycles: Cycle[]; onChanged: () => void }) {
  const { isHr, user } = useAuth();
  const [cycle, setCycle] = useState<string>('open');
  const [status, setStatus] = useState<'' | ReviewStatus>('');
  const [mineOnly, setMineOnly] = useState(false);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<number | null>(null);
  const cycleId = cycle !== 'open' && cycle !== 'all' ? cycle : '';
  const list = useFetch<Review[]>(
    () => api.get(`/api/performance/reviews${qs({ cycle_id: cycleId, to_review: isHr ? '' : '1' })}`),
    [cycleId, isHr],
  );

  const base = useMemo(() => (list.data || [])
    .filter((r) => r.employee_id !== user?.employee_id)
    .filter((r) => (cycle === 'open' ? r.cycle_status === 'open' : true))
    .filter((r) => (mineOnly ? r.reviewer_employee_id === user?.employee_id : true))
    .filter((r) => {
      const s = q.trim().toLowerCase();
      return !s || r.employee_name.toLowerCase().includes(s) || (r.employee_code || '').toLowerCase().includes(s) || (r.department_name || '').toLowerCase().includes(s);
    }), [list.data, cycle, mineOnly, q, user?.employee_id]);
  const byStatus = useMemo(() => {
    const m: Record<string, number> = {};
    for (const r of base) m[r.status] = (m[r.status] || 0) + 1;
    return m;
  }, [base]);
  const rows = useMemo(() => base
    .filter((r) => !status || r.status === status)
    .sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || a.employee_name.localeCompare(b.employee_name)), [base, status]);

  return (
    <>
      <div className="toolbar" data-tour="perf-team-filters">
        <Select value={cycle} onChange={(e) => setCycle(e.target.value)} aria-label="Cycle" data-testid="team-cycle">
          <option value="open">All open cycles</option>
          <option value="all">All cycles</option>
          {cycles.filter((c) => c.status !== 'draft').map((c) => <option key={c.id} value={c.id}>{c.name}{c.status === 'closed' ? ' (closed)' : ''}</option>)}
        </Select>
        <Select value={status} onChange={(e) => setStatus(e.target.value as ReviewStatus | '')} aria-label="Status" data-testid="team-status">
          <option value="">All statuses</option>
          {(Object.keys(REVIEW_STATUS_LABEL) as ReviewStatus[]).map((s) => <option key={s} value={s}>{REVIEW_STATUS_LABEL[s]}</option>)}
        </Select>
        <SearchInput value={q} onChange={setQ} placeholder="Search name, code, department…" />
        {user?.employee_id ? <Pill active={mineOnly} onClick={() => setMineOnly((v) => !v)}>Assigned to me</Pill> : null}
        <span className="count-chips" style={{ marginLeft: 'auto' }} data-tour="perf-team-chips">
          {(Object.keys(REVIEW_STATUS_LABEL) as ReviewStatus[]).map((s) => (
            <span key={s} className={`badge badge-neutral count-chip ${status === s ? 'active' : ''}`} role="button" onClick={() => setStatus(status === s ? '' : s)}>
              {REVIEW_STATUS_LABEL[s]} {byStatus[s] || 0}
            </span>
          ))}
        </span>
      </div>

      <Card padded={false} tour="perf-team-list">
        {list.error ? <div className="alert alert-error" style={{ margin: 12 }}>{list.error}</div> : null}
        <Table<Review>
          loading={list.loading && !list.data}
          rows={rows}
          empty={isHr ? 'No reviews match these filters.' : 'No reviews from your team match these filters.'}
          onRowClick={(r) => setOpen(r.id)}
          columns={[
            { key: 'employee_name', header: 'Employee', render: (r) => <span><strong>{r.employee_name}</strong> <span className="muted mono">{r.employee_code}</span><div className="muted">{r.position_title || '—'}{r.department_name ? ` · ${r.department_name}` : ''}</div></span> },
            { key: 'cycle_name', header: 'Cycle', render: (r) => <span>{r.cycle_name}<div className="muted">{r.due_date ? `Due ${fmtDate(r.due_date)}` : `${fmtDate(r.period_start)} – ${fmtDate(r.period_end)}`}</div></span> },
            { key: 'reviewer_name', header: 'Reviewer', render: (r) => r.reviewer_name ? (r.reviewer_employee_id === user?.employee_id ? <strong>You</strong> : r.reviewer_name) : <span className="muted">Not assigned</span> },
            { key: 'status', header: 'Status', render: (r) => <ReviewStatusBadge status={r.status} /> },
            { key: 'final_rating', header: 'Final rating', render: (r) => <RatingBar value={r.final_rating} scale={r.rating_scale || 5} /> },
            {
              key: 'actions', header: '', align: 'right', render: (r) => {
                const mode = editorModeFor({ ...r, is_own: false }, isHr);
                return (
                  <Button size="sm" variant={mode === 'manager' ? 'primary' : 'secondary'} onClick={(e) => { e.stopPropagation(); setOpen(r.id); }} data-testid="review-open" data-tour="perf-team-open">
                    <Icon name={mode === 'manager' ? 'edit' : 'eye'} size={14} /> {mode === 'manager' ? 'Review' : 'View'}
                  </Button>
                );
              },
            },
          ]}
        />
      </Card>

      {open ? <ReviewModal reviewId={open} onClose={() => setOpen(null)} onChanged={() => { list.reload(); onChanged(); }} /> : null}
    </>
  );
}
