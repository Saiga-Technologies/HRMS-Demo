import React, { useMemo, useState } from 'react';
import { api, qs } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useCounts } from '../../lib/notifications';
import { fmtDate, fmtDateTime, fmtMinutes, label } from '../../lib/format';
import { Badge, Button, Card, EmptyState, Input, Pill, Spinner, StatusBadge, Table, useConfirm, useFetch, useToast } from '../ui';
import { Icon } from '../Icons';
import { BalanceCards } from './MyLeave';
import { ApprovalTrail, CompOffCredit, CompOffSettings, DEFAULT_COMP_OFF, LeaveBalance, fmtDays } from './shared';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
interface Summary { counts: Record<string, number>; approved_days: number; criteria: CompOffSettings; weekly_offs: number[]; window_days: number }

/** Why the day earned a credit: Weekend / holiday name / Extra hours. */
export function ReasonChip({ c }: { c: CompOffCredit }) {
  if (c.reason === 'holiday') return <Badge tone="info"><Icon name="star" size={12} /> {c.holiday_name || 'Holiday'}</Badge>;
  if (c.reason === 'extra_hours') return <Badge tone="warning"><Icon name="clock" size={12} /> Extra hours</Badge>;
  return <Badge tone="neutral"><Icon name="calendar" size={12} /> Weekend</Badge>;
}
function ExpiryText({ c }: { c: CompOffCredit }) {
  if (!c.expires_on) return <span className="muted">—</span>;
  const days = Math.round((Date.parse(c.expires_on + 'T00:00:00') - Date.parse(new Date().toISOString().slice(0, 10) + 'T00:00:00')) / 86400000);
  if (c.expired || days < 0) return <span className="late">Expired {fmtDate(c.expires_on)}</span>;
  return <span className={days <= 14 ? 'late' : ''}>{fmtDate(c.expires_on)}<span className="muted"> · {days === 0 ? 'today' : `${days}d left`}</span></span>;
}

/**
 * Comp off: detected extra working days the employee can claim, their credits and the resulting
 * Comp Off balance, approvals for managers/HR, and (HR) a manual detection run + criteria summary.
 */
export default function CompOffTab() {
  const { user, isHr, isManager } = useAuth();
  const { refreshCounts } = useCounts();
  const toast = useToast();
  const { confirm, dialog } = useConfirm();
  const eid = user?.employee_id ?? null;
  const year = new Date().getFullYear();

  const credits = useFetch<CompOffCredit[]>(() => api.get('/api/compoff'), []);
  const pending = useFetch<CompOffCredit[]>(() => (isManager ? api.get('/api/compoff/pending') : Promise.resolve([])), [isManager]);
  const summary = useFetch<Summary>(() => api.get('/api/compoff/summary'), []);
  const balances = useFetch<LeaveBalance[]>(() => (eid ? api.get(`/api/leave/balances/${eid}${qs({ year })}`) : Promise.resolve([])), [eid]);
  const [busy, setBusy] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [teamStatus, setTeamStatus] = useState('');

  const reloadAll = () => { credits.reload(); pending.reload(); summary.reload(); balances.reload(); refreshCounts(); };
  const rows = credits.data || [];
  const mine = useMemo(() => rows.filter((c) => c.employee_id === eid), [rows, eid]);
  const detected = mine.filter((c) => c.status === 'detected' && !c.expired);
  const team = useMemo(() => rows.filter((c) => c.employee_id !== eid && (!teamStatus || c.status === teamStatus)), [rows, eid, teamStatus]);
  const criteria: CompOffSettings = { ...DEFAULT_COMP_OFF, ...(summary.data?.criteria || {}) };
  const coCode = criteria.leave_type_code || 'CO';
  const coBalance = (balances.data || []).filter((b) => b.code === coCode);

  const act = async (c: CompOffCredit, action: 'request' | 'dismiss', okMsg: string) => {
    if (action === 'dismiss' && !(await confirm(`Dismiss the credit for ${fmtDate(c.worked_date)}?`, 'It will be hidden and cannot be claimed later.'))) return;
    setBusy(`${c.id}-${action}`);
    try {
      await api.post(`/api/compoff/${c.id}/${action}`, {});
      toast.success(okMsg);
      reloadAll();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(null);
    }
  };
  const decide = async (c: CompOffCredit, decision: 'approve' | 'reject') => {
    setBusy(`${c.id}-${decision}`);
    try {
      await api.post(`/api/compoff/${c.id}/review`, { decision, note: notes[c.id] || null });
      toast.success(decision === 'approve' ? `Approved ${fmtDays(c.days)} comp off for ${c.employee_name}` : `Rejected ${c.employee_name}'s comp off`);
      reloadAll();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(null);
    }
  };
  const detectNow = async () => {
    setBusy('detect');
    try {
      const r = await api.post<{ created: number; scanned: number; enabled: boolean }>('/api/compoff/detect', {});
      toast.success(r.enabled ? `Scanned ${r.scanned} attendance records · ${r.created} new credit${r.created === 1 ? '' : 's'} detected` : 'Comp off is disabled in Leave settings');
      reloadAll();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(null);
    }
  };

  const creditColumns = (showEmployee: boolean) => [
    ...(showEmployee ? [{ key: 'employee_name', header: 'Employee', render: (c: CompOffCredit) => <span><strong>{c.employee_name}</strong> <span className="muted mono">{c.employee_code}</span></span> }] : []),
    { key: 'worked_date', header: 'Worked on', render: (c: CompOffCredit) => fmtDate(c.worked_date, { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' }) },
    { key: 'reason', header: 'Reason', render: (c: CompOffCredit) => <ReasonChip c={c} /> },
    { key: 'work_minutes', header: 'Worked', align: 'right' as const, render: (c: CompOffCredit) => fmtMinutes(c.work_minutes) },
    { key: 'days', header: 'Credit', align: 'right' as const, render: (c: CompOffCredit) => <strong>{fmtDays(c.days)}</strong> },
    { key: 'status', header: 'Status', render: (c: CompOffCredit) => <StatusBadge status={c.status} label={label(c.status)} /> },
    { key: 'expires_on', header: 'Expires', render: (c: CompOffCredit) => <ExpiryText c={c} /> },
    { key: 'approval', header: 'Approval', render: (c: CompOffCredit) => (c.status === 'detected' ? <span className="muted">Not requested yet</span> : <ApprovalTrail status={c.status} approverName={c.approver_name} reviewerName={c.reviewer_name} reviewerEmail={c.reviewer_email} reviewedAt={c.reviewed_at} note={c.review_note} />) },
  ];

  if (credits.loading && !credits.data) return <Spinner />;
  return (
    <>
      {dialog}
      {credits.error ? <div className="alert alert-error mb">{credits.error}</div> : null}

      {eid ? (
        <>
          <div className="row between mb" data-tour="compoff-detected">
            <div>
              <h2 className="card-title" style={{ margin: 0 }}>Detected extra working days</h2>
              <span className="muted">Days you worked on a weekly off, a holiday{criteria.extra_hours_threshold_minutes > 0 ? ' or well beyond a standard day' : ''} in the last {summary.data?.window_days || 60} days. Confirm the ones you want credited; they go to {detected[0]?.approver_name ? detected[0].approver_name : 'your manager'} for approval.</span>
            </div>
            {!criteria.enabled ? <Badge tone="warning">Comp off is disabled</Badge> : null}
          </div>
          {detected.length ? (
            <div className="grid grid-auto compoff-grid mb">
              {detected.map((c) => (
                <div key={c.id} className="compoff-card" data-testid="compoff-detected-card">
                  <div className="row between">
                    <strong>{fmtDate(c.worked_date, { weekday: 'short', day: '2-digit', month: 'short' })}</strong>
                    <ReasonChip c={c} />
                  </div>
                  <div className="compoff-credit"><span className="stat-value">{c.days % 1 === 0 ? c.days : c.days.toFixed(1)}</span> <span className="muted">day{c.days === 1 ? '' : 's'} credit</span></div>
                  <div className="compoff-meta muted">
                    <span><Icon name="clock" size={13} /> {fmtMinutes(c.work_minutes)} worked</span>
                    <span><Icon name="alert" size={13} /> Claim by <ExpiryText c={c} /></span>
                  </div>
                  <div className="row end" style={{ gap: 6 }}>
                    <Button size="sm" onClick={() => act(c, 'dismiss', 'Credit dismissed')} loading={busy === `${c.id}-dismiss`} disabled={!!busy} data-testid="compoff-dismiss">Dismiss</Button>
                    <Button size="sm" variant="primary" onClick={() => act(c, 'request', criteria.requires_manager_approval ? `Sent to ${c.approver_name || 'HR'} for approval` : `${fmtDays(c.days)} added to your ${coCode} balance`)} loading={busy === `${c.id}-request`} disabled={!!busy || !criteria.enabled} data-testid="compoff-request">Request credit</Button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <Card className="mb"><EmptyState icon="✓" title="No extra working days waiting for you" description="When you work on a weekly off or a holiday it will show up here automatically after you punch out." /></Card>
          )}

          <div className="detail-grid mb" data-tour="compoff-mine">
            <Card title={`My ${coCode} balance · ${year}`} tour="compoff-balance">
              {balances.loading && !balances.data ? <Spinner /> : coBalance.length ? (
                <div data-testid="compoff-balance"><BalanceCards balances={coBalance} /></div>
              ) : <span className="muted">No {coCode} leave type is active. HR can add one under Leave types.</span>}
              <p className="help mt" style={{ marginTop: 10 }}>Approved credits are added to this balance for the year of the worked date; apply for leave with the {coCode} type to use them.</p>
            </Card>
            <Card title="Summary">
              <div className="compoff-summary">
                {['detected', 'pending', 'approved', 'rejected', 'expired'].map((s) => (
                  <div key={s} className="compoff-summary-item"><StatusBadge status={s} label={label(s)} /><strong className="num">{mine.filter((c) => c.status === s).length}</strong></div>
                ))}
              </div>
            </Card>
          </div>
          <Card padded={false} title="My comp-off credits" className="mb">
            <Table<CompOffCredit> rows={mine} columns={creditColumns(false)} empty="No comp-off credits yet." />
          </Card>
        </>
      ) : (
        <Card className="mb"><EmptyState title="No employee record linked to your login" description="Comp-off credits need an employee profile. Ask HR to link your user account under Settings → Users." /></Card>
      )}

      {isManager ? (
        <Card padded={false} title="Approvals" className="mb" tour="compoff-approvals" actions={<span className="muted">{pending.data?.length || 0} waiting</span>}>
          {pending.loading && !pending.data ? <Spinner /> : !pending.data?.length ? (
            <EmptyState icon="✓" title="Nothing waiting for you" description="Comp-off credits requested by your reports will appear here." />
          ) : (
            <div className="grid grid-2" style={{ padding: 16 }}>
              {pending.data.map((c) => (
                <div key={c.id} className="card approval-card" data-testid="compoff-approval-card">
                  <div className="card-body">
                    <div className="row between">
                      <span><strong>{c.employee_name}</strong> <span className="muted mono">{c.employee_code}</span>{c.department_name ? <span className="muted"> · {c.department_name}</span> : null}</span>
                      <StatusBadge status={c.status} />
                    </div>
                    <div className="row" style={{ marginTop: 8 }}>
                      <ReasonChip c={c} />
                      <span>{fmtDate(c.worked_date, { weekday: 'short', day: '2-digit', month: 'short' })} · {fmtMinutes(c.work_minutes)} worked · <strong>{fmtDays(c.days)}</strong></span>
                    </div>
                    <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>Claim by <ExpiryText c={c} /> · <ApprovalTrail status={c.status} approverName={c.approver_name} /></div>
                    <div className="row" style={{ marginTop: 10 }}>
                      <Input placeholder="Note to employee (optional)" value={notes[c.id] || ''} onChange={(e) => setNotes({ ...notes, [c.id]: e.target.value })} style={{ flex: 1 }} data-testid="compoff-review-note" />
                      <Button variant="danger" size="sm" loading={busy === `${c.id}-reject`} disabled={!!busy} onClick={() => decide(c, 'reject')} data-testid="compoff-reject">Reject</Button>
                      <Button variant="primary" size="sm" loading={busy === `${c.id}-approve`} disabled={!!busy} onClick={() => decide(c, 'approve')} data-testid="compoff-approve">Approve</Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      ) : null}

      {isManager ? (
        <Card padded={false} title={isHr ? 'All credits' : 'Team credits'} className="mb"
          actions={
            <span className="row">
              {['', 'detected', 'pending', 'approved', 'rejected', 'expired'].map((s) => <Pill key={s || 'all'} active={teamStatus === s} onClick={() => setTeamStatus(s)}>{s ? label(s) : 'All'}</Pill>)}
            </span>
          }>
          <Table<CompOffCredit> rows={team} columns={creditColumns(true)} empty="No comp-off credits in your team." />
        </Card>
      ) : null}

      {isHr ? (
        <Card title="Detection criteria" tour="compoff-criteria" actions={<Button variant="primary" onClick={detectNow} loading={busy === 'detect'} disabled={!!busy} data-testid="compoff-detect"><Icon name="sparkles" size={15} /> Run detection now</Button>}>
          <div className="compoff-criteria">
            <div><span className="section-title">Status</span><Badge tone={criteria.enabled ? 'success' : 'danger'}>{criteria.enabled ? 'Enabled' : 'Disabled'}</Badge></div>
            <div><span className="section-title">Weekly offs</span>{criteria.on_weekly_off ? (summary.data?.weekly_offs || [0, 6]).map((d) => WEEKDAYS[d]).join(', ') : 'Not credited'}</div>
            <div><span className="section-title">Holidays</span>{criteria.on_holiday ? 'Credited' : 'Not credited'}</div>
            <div><span className="section-title">Extra hours</span>{criteria.extra_hours_threshold_minutes > 0 ? `Beyond standard day + ${fmtMinutes(criteria.extra_hours_threshold_minutes)}` : 'Not credited'}</div>
            <div><span className="section-title">Credit</span>1 day from {fmtMinutes(criteria.full_day_minutes)} · ½ day from {fmtMinutes(criteria.half_day_minutes)}</div>
            <div><span className="section-title">Expiry</span>{criteria.expiry_days} days after the worked date</div>
            <div><span className="section-title">Approval</span>{criteria.requires_manager_approval ? 'Reporting manager (or HR)' : 'Automatic once the employee confirms'}</div>
            <div><span className="section-title">Company-wide</span>{summary.data ? `${summary.data.counts.detected || 0} detected · ${summary.data.counts.pending || 0} pending · ${summary.data.counts.approved || 0} approved (${summary.data.approved_days} days)` : '—'}</div>
          </div>
          <p className="help" style={{ marginTop: 10 }}>Detection also runs automatically whenever anyone opens this tab. Change the criteria under the Settings tab. Last refreshed {fmtDateTime(new Date().toISOString())}.</p>
        </Card>
      ) : null}
    </>
  );
}
