import React, { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, qs } from '../lib/api';
import { useAuth } from '../lib/auth';
import { usePageTour } from '../lib/tour';
import { fmtDate, fmtDateTime, fmtMoney, label, monthIso } from '../lib/format';
import { useCounts } from '../lib/notifications';
import { Icon } from '../components/Icons';
import { Badge, Button, Card, Checkbox, EmptyState, Field, Input, Modal, PageHeader, Select, Spinner, Stat, StatusBadge, Switch, Table, Tabs, Textarea, useConfirm, useFetch, useForm, useToast } from '../components/ui';
import Payslip, { fmtPeriod, type PayLine, type PayslipData } from '../components/Payslip';

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */
interface TdsSlab { upto: number | null; percent: number }
interface PayrollSettings {
  currency: string; pay_day: number;
  pf_employee_percent: number; pf_employer_percent: number; pf_wage_ceiling: number;
  esi_employee_percent: number; esi_employer_percent: number; esi_wage_ceiling: number;
  professional_tax_monthly: number; professional_tax_threshold: number;
  tds_slabs: TdsSlab[]; standard_deduction_annual: number; overtime_multiplier: number;
  lop_based_on_attendance: boolean; working_days_mode: 'calendar' | 'working';
}
interface RunTotals { employees?: number; gross?: number; deductions?: number; net?: number; skipped?: number }
interface PayRun { id: number; period: string; status: 'draft' | 'processed' | 'approved' | 'paid'; working_days: number; totals: RunTotals; notes?: string | null; created_at: string; processed_at?: string | null; approved_at?: string | null; paid_at?: string | null; payslip_count: number }
interface RunDetailData extends PayRun { payslips: RunPayslip[] }
interface RunPayslip extends PayslipData { employee_name: string; employee_code: string; department_name?: string | null }
interface Skipped { employee_id: number; name: string; reason: string }
interface Summary { activeEmployees: number; withStructure: number; withoutStructure: number; recentRuns: PayRun[] }
interface Component { id: number; name: string; code: string; type: 'earning' | 'deduction'; calc_type: 'fixed' | 'percent_of_basic' | 'percent_of_gross'; default_value: number; taxable: number; statutory: number; prorate: number; sort_order: number; active: number }
interface Adjustment { id: number; employee_id: number; employee_name: string; employee_code: string; period: string; type: string; amount: number; note?: string | null; created_at: string }
interface DirEmployee { id: number; employee_code: string; first_name: string; last_name: string; department_name?: string }
interface PayslipRequest { id: number; employee_id: number; employee_name: string; employee_code: string; period: string; reason?: string | null; status: 'pending' | 'fulfilled' | 'rejected'; payslip_id?: number | null; handled_by?: number | null; handled_by_name?: string | null; handled_at?: string | null; note?: string | null; run_status?: string | null; run_id?: number | null; created_at: string }

const ADJ_TYPES = ['bonus', 'reimbursement', 'overtime', 'deduction', 'advance', 'loan_recovery', 'arrears'] as const;
const ADJ_EARNING = new Set(['bonus', 'reimbursement', 'overtime', 'arrears']);
const SPECIAL_CODES: Record<string, string> = { PF: 'Provident fund — employee % of basic (capped at the PF wage ceiling)', ESI: 'ESI — % of gross when gross is within the ESI ceiling', PT: 'Professional tax — flat monthly amount above the threshold', TDS: 'Income tax — monthly share of annual tax from the TDS slabs' };

const HR_TOUR = [
  { element: '[data-tour="payroll-tabs"]', title: 'Payroll areas', description: 'Overview, pay runs, salary components, one-off adjustments and statutory settings each have a tab.' },
  { element: '[data-tour="payroll-stats"]', title: 'Coverage at a glance', description: 'How many active employees have a salary structure. Employees without one are skipped when a run is processed.' },
  { element: '[data-tour="payroll-recent"]', title: 'Recent runs', description: 'Click a run to open it: process, approve, mark paid and view or edit individual payslips.' },
  { element: '[data-tour="payroll-new-run"]', title: 'Start a pay run', description: 'Create one run per month. Processing generates a payslip for every employee with a salary structure.' },
  { element: '[data-tour="payroll-runs"]', title: 'Run workflow', description: 'Draft → Processed → Approved → Paid. Payslips are released to employees once a run is approved.' },
  { element: '[data-tour="payroll-components"]', title: 'Salary components', description: 'Earnings and deductions applied to every structure. PF, ESI, PT and TDS are computed from the Settings tab.' },
  { element: '[data-tour="payroll-adjustments"]', title: 'Adjustments', description: 'Bonuses, reimbursements, overtime, advances and recoveries for a specific month are picked up when that month is processed.' },
  { element: '[data-tour="payroll-requests"]', title: 'Payslip requests', description: 'Employees can apply for a payslip. Fulfil a request to attach the released payslip, or reject it with a note.' },
  { element: '[data-tour="payroll-settings"]', title: 'Statutory settings', description: 'Currency, pay day, PF/ESI/PT rates and the TDS slab table used by every run.' },
];
const MY_TOUR = [
  { element: '[data-tour="payroll-my"]', title: 'Your payslips', description: 'Released payslips for each month, with gross, deductions and net pay.' },
  { element: '[data-tour="payroll-my-tabs"]', title: 'Payslips and requests', description: 'Switch between your released payslips and your payslip requests.' },
  { element: '[data-tour="payroll-my-table"]', title: 'View and download', description: 'Open a payslip to see the full earnings and deductions breakdown, then download it as a PDF.' },
  { element: '[data-tour="payroll-request-new"]', title: 'Request a payslip', description: 'Need a payslip for a past month? Pick the month, add a reason and HR will attach it once the run is approved.' },
  { element: '[data-tour="payroll-my-help"]', title: 'Need a correction?', description: 'Payslips are locked once approved. Contact HR for any correction before the next run.' },
];

const periodLabel = (p: string) => fmtPeriod(p);

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */
export default function Payroll() {
  const { isHr } = useAuth();
  usePageTour('Payroll', isHr ? HR_TOUR : MY_TOUR);
  return isHr ? <HrPayroll /> : <MyPayslips />;
}

/* ------------------------------------------------------------------ */
/* Employee / manager view                                             */
/* ------------------------------------------------------------------ */
type MyTab = 'payslips' | 'requests';
function MyPayslips() {
  const { company } = useAuth();
  const { counts } = useCounts();
  const [sp, setSp] = useSearchParams();
  const tabParam = sp.get('tab');
  const tab: MyTab = tabParam === 'requests' ? 'requests' : 'payslips';
  const slips = useFetch<PayslipData[]>(() => api.get('/api/payroll/payslips'), []);
  const [view, setView] = useState<number | null>(null);
  const cur = company.currency || 'INR';
  return (
    <>
      <PageHeader title="My payslips" subtitle="Released payslips for you. Open one to view the breakdown or download it, or request a payslip for a past month." tour="payroll-my" />
      <Tabs tour="payroll-my-tabs" value={tab} onChange={(k) => setSp(k === 'payslips' ? {} : { tab: k }, { replace: true })} tabs={[
        { key: 'payslips', label: 'My payslips', icon: 'banknote', count: slips.data?.length },
        { key: 'requests', label: 'Payslip requests', icon: 'file', count: counts.my_payslip_requests || undefined },
      ]} />
      {tab === 'payslips' ? (
        <>
          <Card padded={false} tour="payroll-my-table">
            <Table<PayslipData>
              loading={slips.loading}
              rows={slips.data || []}
              empty={<EmptyState title="No payslips yet" description="Payslips appear here once HR approves a pay run. You can also request one from the Payslip requests tab." />}
              onRowClick={(p) => setView(p.id)}
              columns={[
                { key: 'period', header: 'Period', render: (p) => <span><strong>{periodLabel(p.period || '')}</strong> <span className="muted mono">{p.period}</span></span> },
                { key: 'paid_days', header: 'Paid / LOP days', render: (p) => <span className="num">{p.paid_days} / {p.lop_days}</span> },
                { key: 'gross', header: 'Gross', align: 'right', render: (p) => <span className="num">{fmtMoney(p.gross, p.currency || cur)}</span> },
                { key: 'total_deductions', header: 'Deductions', align: 'right', render: (p) => <span className="num">{fmtMoney(p.total_deductions, p.currency || cur)}</span> },
                { key: 'net', header: 'Net pay', align: 'right', render: (p) => <strong className="num">{fmtMoney(p.net, p.currency || cur)}</strong> },
                { key: 'status', header: 'Status', render: (p) => <StatusBadge status={p.status} label={label(p.status)} /> },
                { key: 'actions', header: '', align: 'right', render: (p) => <Button size="sm" onClick={(e) => { e.stopPropagation(); setView(p.id); }} data-testid="payslip-view">View</Button> },
              ]}
            />
          </Card>
          <p className="help" data-tour="payroll-my-help">Payslips are locked once a run is approved. Contact HR if something looks wrong.</p>
        </>
      ) : null}
      {tab === 'requests' ? <MyPayslipRequests currency={cur} onOpenPayslip={(id) => setView(id)} /> : null}
      {view ? <PayslipModal id={view} currency={cur} onClose={() => setView(null)} /> : null}
    </>
  );
}

/* ---------- Payslip requests (employee) ---------- */
function MyPayslipRequests({ currency, onOpenPayslip }: { currency: string; onOpenPayslip: (id: number) => void }) {
  const toast = useToast();
  const { refreshCounts } = useCounts();
  const list = useFetch<PayslipRequest[]>(() => api.get('/api/payroll/payslip-requests'), []);
  const [open, setOpen] = useState(false);
  const rows = list.data || [];
  const pending = rows.filter((r) => r.status === 'pending').length;
  return (
    <>
      <Card
        padded={false}
        tour="payroll-requests"
        title={<span className="row">Payslip requests {pending ? <Badge tone="warning">{pending} pending</Badge> : null}</span>}
        actions={<Button variant="primary" size="sm" onClick={() => setOpen(true)} data-testid="payslip-request-new" data-tour="payroll-request-new"><Icon name="plus" size={14} /> Request a payslip</Button>}
      >
        <Table<PayslipRequest>
          loading={list.loading}
          rows={rows}
          empty={<EmptyState title="No requests yet" description="Request a payslip for any past month. HR attaches it as soon as that month's payroll is approved." action={<Button variant="primary" onClick={() => setOpen(true)}>Request a payslip</Button>} />}
          columns={[
            { key: 'period', header: 'Period', render: (r) => <span><strong>{periodLabel(r.period)}</strong> <span className="muted mono">{r.period}</span></span> },
            { key: 'reason', header: 'Reason', render: (r) => r.reason || <span className="muted">—</span> },
            { key: 'created_at', header: 'Requested', render: (r) => fmtDateTime(r.created_at) },
            { key: 'status', header: 'Status', render: (r) => <RequestStatus r={r} /> },
            { key: 'actions', header: '', align: 'right', render: (r) => (r.status === 'fulfilled' && r.payslip_id ? <Button size="sm" variant="primary" onClick={() => onOpenPayslip(r.payslip_id!)} data-testid="payslip-request-open">Open payslip</Button> : null) },
          ]}
        />
      </Card>
      <p className="help">One pending request per month. Payslips are released only after HR approves the pay run for that month. Currency: {currency}.</p>
      {open ? <PayslipRequestModal onClose={() => setOpen(false)} onCreated={() => { setOpen(false); list.reload(); refreshCounts(); toast.success('Payslip requested'); }} /> : null}
    </>
  );
}
function RequestStatus({ r }: { r: PayslipRequest }) {
  return (
    <span className="stack" style={{ gap: 2 }}>
      <StatusBadge status={r.status} label={label(r.status)} />
      {r.status === 'pending' ? <span className="pending-with">Pending with HR{r.run_status ? ` · run ${r.run_status}` : ' · no run yet'}</span> : null}
      {r.status !== 'pending' && r.handled_by_name ? <span className="audit-trail">{r.status === 'fulfilled' ? 'Fulfilled' : 'Rejected'} by {r.handled_by_name}{r.handled_at ? ` · ${fmtDateTime(r.handled_at)}` : ''}{r.note ? ` · “${r.note}”` : ''}</span> : null}
    </span>
  );
}
function PayslipRequestModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const toast = useToast();
  const prev = new Date();
  prev.setMonth(prev.getMonth() - 1);
  const f = useForm({ period: monthIso(prev), reason: '' });
  const [busy, setBusy] = useState(false);
  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!f.values.period) return toast.error('Pick a month');
    setBusy(true);
    try {
      await api.post('/api/payroll/payslip-requests', { period: f.values.period, reason: f.values.reason || undefined });
      onCreated();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open title="Request a payslip" onClose={onClose} testId="payslip-request-modal"
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={() => submit()} data-testid="payslip-request-submit">Send request</Button></>}>
      <form onSubmit={submit} className="stack">
        <Field label="Month" required hint="Current or any past month."><Input type="month" {...f.bind('period')} max={monthIso()} required autoFocus data-testid="payslip-request-period" /></Field>
        <Field label="Reason" hint="Optional — e.g. loan application, visa, tax filing."><Textarea {...f.bind('reason')} rows={3} data-testid="payslip-request-reason" /></Field>
      </form>
    </Modal>
  );
}

/* ---------- Payslip requests (HR) ---------- */
function HrPayslipRequests({ currency, onOpenPayslip }: { currency: string; onOpenPayslip: (id: number) => void }) {
  const toast = useToast();
  const { refreshCounts } = useCounts();
  const [status, setStatus] = useState<'' | 'pending' | 'fulfilled' | 'rejected'>('pending');
  const list = useFetch<PayslipRequest[]>(() => api.get(`/api/payroll/payslip-requests${qs({ status })}`), [status]);
  const [rejecting, setRejecting] = useState<PayslipRequest | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const fulfil = async (r: PayslipRequest) => {
    setBusyId(r.id);
    try {
      await api.post(`/api/payroll/payslip-requests/${r.id}/fulfil`, {});
      toast.success(`Payslip for ${periodLabel(r.period)} sent to ${r.employee_name}`);
      list.reload();
      refreshCounts();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusyId(null);
    }
  };
  return (
    <>
      <Card
        padded={false}
        tour="payroll-requests"
        title="Payslip requests"
        actions={<div className="row">{(['pending', 'fulfilled', 'rejected', ''] as const).map((k) => <button key={k || 'all'} type="button" className={`pill ${status === k ? 'active' : ''}`} onClick={() => setStatus(k)}>{k ? k[0].toUpperCase() + k.slice(1) : 'All'}</button>)}</div>}
      >
        <Table<PayslipRequest>
          loading={list.loading}
          rows={list.data || []}
          empty={<EmptyState title={status === 'pending' ? 'No pending requests' : 'No requests'} description="Employees can request payslips from Payroll → Payslip requests." />}
          columns={[
            { key: 'employee_name', header: 'Employee', render: (r) => <span><Link to={`/employees/${r.employee_id}`}><strong>{r.employee_name}</strong></Link> <span className="muted mono">{r.employee_code}</span></span> },
            { key: 'period', header: 'Period', render: (r) => <span><strong>{periodLabel(r.period)}</strong> <span className="muted mono">{r.period}</span></span> },
            { key: 'reason', header: 'Reason', render: (r) => r.reason || <span className="muted">—</span> },
            { key: 'run_status', header: 'Pay run', render: (r) => (r.run_status ? <span className="row"><StatusBadge status={r.run_status} label={label(r.run_status)} />{r.run_id ? <Link to={`/payroll?tab=runs&run=${r.run_id}`}>open</Link> : null}</span> : <span className="muted">No run for this month</span>) },
            { key: 'created_at', header: 'Requested', render: (r) => fmtDateTime(r.created_at) },
            { key: 'status', header: 'Status', render: (r) => <RequestStatus r={r} /> },
            { key: 'actions', header: '', align: 'right', render: (r) => (
              <span className="row" style={{ justifyContent: 'flex-end' }}>
                {r.status === 'pending' ? <Button size="sm" variant="primary" loading={busyId === r.id} onClick={() => fulfil(r)} data-testid="payslip-request-fulfil" title={['approved', 'paid'].includes(r.run_status || '') ? 'Attach the released payslip' : 'The pay run must be approved first'}>Fulfil</Button> : null}
                {r.status === 'pending' ? <Button size="sm" variant="danger" onClick={() => setRejecting(r)} data-testid="payslip-request-reject">Reject</Button> : null}
                {r.status === 'fulfilled' && r.payslip_id ? <Button size="sm" onClick={() => onOpenPayslip(r.payslip_id!)}>View payslip</Button> : null}
              </span>
            ) },
          ]}
        />
      </Card>
      <p className="help">Fulfilling attaches the employee's payslip from the approved or paid run for that month. If the run is still a draft or processed, approve it first. Amounts in {currency}.</p>
      {rejecting ? <RejectRequestModal r={rejecting} onClose={() => setRejecting(null)} onDone={() => { setRejecting(null); list.reload(); refreshCounts(); }} /> : null}
    </>
  );
}
function RejectRequestModal({ r, onClose, onDone }: { r: PayslipRequest; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      await api.post(`/api/payroll/payslip-requests/${r.id}/reject`, { note });
      toast.success('Request rejected');
      onDone();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open title={`Reject request · ${r.employee_name} · ${periodLabel(r.period)}`} onClose={onClose} testId="payslip-reject-modal"
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="danger" loading={busy} onClick={submit} data-testid="payslip-request-reject-submit">Reject</Button></>}>
      <Field label="Note to the employee" hint="Explain why, e.g. no payroll was processed for that month."><Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} autoFocus /></Field>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* HR view                                                             */
/* ------------------------------------------------------------------ */
type HrTab = 'overview' | 'runs' | 'requests' | 'components' | 'adjustments' | 'settings';
const HR_TABS: { key: HrTab; label: string; icon?: string }[] = [
  { key: 'overview', label: 'Overview' }, { key: 'runs', label: 'Pay runs' }, { key: 'requests', label: 'Payslip requests' }, { key: 'components', label: 'Salary components' }, { key: 'adjustments', label: 'Adjustments' }, { key: 'settings', label: 'Settings' },
];

function HrPayroll() {
  const { counts } = useCounts();
  const [sp, setSp] = useSearchParams();
  const [viewSlip, setViewSlip] = useState<number | null>(null);
  const tabParam = sp.get('tab') as HrTab | null;
  const tab: HrTab = tabParam && HR_TABS.some((t) => t.key === tabParam) ? tabParam : 'overview';
  const runId = Number(sp.get('run')) || null;
  const settings = useFetch<PayrollSettings>(() => api.get('/api/settings/payroll'), []);
  const currency = settings.data?.currency || 'INR';
  const [newRun, setNewRun] = useState(false);

  const go = (t: HrTab, run?: number | null) => {
    const next: Record<string, string> = { tab: t };
    if (run) next.run = String(run);
    setSp(next);
  };
  const openRun = (id: number) => go('runs', id);

  return (
    <>
      <PageHeader
        title="Payroll"
        subtitle="Monthly pay runs, salary components, adjustments and statutory settings."
        actions={<Button variant="primary" onClick={() => setNewRun(true)} data-testid="payroll-new-run" data-tour="payroll-new-run">+ New run</Button>}
      />
      <Tabs tour="payroll-tabs" value={tab} onChange={(k) => go(k as HrTab)} tabs={HR_TABS.map((t) => (t.key === 'requests' ? { ...t, badge: counts.payslip_requests } : t.key === 'runs' ? { ...t, badge: counts.payroll_draft_runs } : t))} />
      {tab === 'overview' ? <OverviewTab currency={currency} onOpenRun={openRun} /> : null}
      {tab === 'runs' ? (runId ? <RunDetail id={runId} currency={currency} onBack={() => go('runs')} /> : <RunsTab currency={currency} onOpenRun={openRun} onNew={() => setNewRun(true)} />) : null}
      {tab === 'requests' ? <HrPayslipRequests currency={currency} onOpenPayslip={(id) => setViewSlip(id)} /> : null}
      {tab === 'components' ? <ComponentsTab settings={settings.data} /> : null}
      {tab === 'adjustments' ? <AdjustmentsTab currency={currency} /> : null}
      {tab === 'settings' ? <SettingsTab settings={settings.data} loading={settings.loading} onSaved={(s) => settings.setData(s)} /> : null}
      {newRun ? <NewRunModal onClose={() => setNewRun(false)} onCreated={(r) => { setNewRun(false); openRun(r.id); }} /> : null}
      {viewSlip ? <PayslipModal id={viewSlip} currency={currency} onClose={() => setViewSlip(null)} /> : null}
    </>
  );
}

/* ---------- Overview ---------- */
function OverviewTab({ currency, onOpenRun }: { currency: string; onOpenRun: (id: number) => void }) {
  const summary = useFetch<Summary>(() => api.get('/api/payroll/summary'), []);
  const s = summary.data;
  return (
    <>
      <div className="grid grid-3 mb" data-tour="payroll-stats">
        <Stat label="Active employees" value={s ? s.activeEmployees : '…'} hint="Not exited" />
        <Stat label="With salary structure" value={s ? s.withStructure : '…'} color="#16a34a" hint="Included in pay runs" />
        <Stat label="Without structure" value={s ? s.withoutStructure : '…'} color={s && s.withoutStructure > 0 ? '#ca8a04' : undefined} hint={<Link to="/employees">Set up salary structures in Employees →</Link>} />
      </div>
      <Card title="Recent runs" padded={false} tour="payroll-recent">
        <RunsTable rows={s?.recentRuns || []} loading={summary.loading} currency={currency} onOpen={onOpenRun} />
      </Card>
    </>
  );
}

function RunsTable({ rows, loading, currency, onOpen, tour }: { rows: PayRun[]; loading: boolean; currency: string; onOpen: (id: number) => void; tour?: string }) {
  return (
    <Table<PayRun>
      tour={tour}
      loading={loading}
      rows={rows}
      onRowClick={(r) => onOpen(r.id)}
      empty={<EmptyState title="No pay runs yet" description="Create a run for a month to get started." />}
      columns={[
        { key: 'period', header: 'Period', render: (r) => <span><strong>{periodLabel(r.period)}</strong> <span className="muted mono">{r.period}</span></span> },
        { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} label={label(r.status)} /> },
        { key: 'employees', header: 'Employees', align: 'right', render: (r) => <span className="num">{r.totals?.employees ?? r.payslip_count ?? 0}</span> },
        { key: 'gross', header: 'Gross', align: 'right', render: (r) => <span className="num">{r.totals?.gross != null ? fmtMoney(r.totals.gross, currency) : '—'}</span> },
        { key: 'net', header: 'Net', align: 'right', render: (r) => <span className="num">{r.totals?.net != null ? fmtMoney(r.totals.net, currency) : '—'}</span> },
        { key: 'created_at', header: 'Created', render: (r) => fmtDate(r.created_at) },
      ]}
    />
  );
}

/* ---------- Runs ---------- */
function RunsTab({ currency, onOpenRun, onNew }: { currency: string; onOpenRun: (id: number) => void; onNew: () => void }) {
  const runs = useFetch<PayRun[]>(() => api.get('/api/payroll/runs'), []);
  return (
    <Card title="Pay runs" padded={false} tour="payroll-runs" actions={<Button size="sm" onClick={onNew}>+ New run</Button>}>
      <RunsTable rows={runs.data || []} loading={runs.loading} currency={currency} onOpen={onOpenRun} />
    </Card>
  );
}

function NewRunModal({ onClose, onCreated }: { onClose: () => void; onCreated: (r: PayRun) => void }) {
  const toast = useToast();
  const f = useForm({ period: monthIso(), notes: '' });
  const [busy, setBusy] = useState(false);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^\d{4}-\d{2}$/.test(f.values.period)) return toast.error('Pick a month');
    setBusy(true);
    try {
      const r = await api.post<PayRun>('/api/payroll/runs', { period: f.values.period, notes: f.values.notes || null });
      toast.success(`Run for ${periodLabel(r.period)} created`);
      onCreated(r);
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open title="New pay run" onClose={onClose} testId="payroll-run-modal"
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={save as any} data-testid="payroll-create-run">Create run</Button></>}>
      <form onSubmit={save} className="form-grid">
        <Field label="Period" required hint="One run per month."><Input type="month" {...f.bind('period')} required autoFocus data-testid="payroll-run-period" /></Field>
        <Field label="Notes" className="span-2"><Textarea {...f.bind('notes')} placeholder="Optional" /></Field>
      </form>
    </Modal>
  );
}

function RunDetail({ id, currency, onBack }: { id: number; currency: string; onBack: () => void }) {
  const toast = useToast();
  const { confirm, dialog } = useConfirm();
  const run = useFetch<RunDetailData>(() => api.get(`/api/payroll/runs/${id}`), [id]);
  // Agency-managed payroll: the client's HR approves the register, agency staff prepare and pay it.
  const { isAgency } = useAuth();
  const [busy, setBusy] = useState<string | null>(null);
  const [skipped, setSkipped] = useState<Skipped[]>([]);
  const [view, setView] = useState<number | null>(null);
  const [edit, setEdit] = useState<RunPayslip | null>(null);
  const [q, setQ] = useState('');
  const r = run.data;
  const editable = r ? r.status === 'draft' || r.status === 'processed' : false;

  const act = async (key: string, fn: () => Promise<any>, ok: string) => {
    setBusy(key);
    try {
      await fn();
      toast.success(ok);
      await run.reload();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(null);
    }
  };
  const process = () => act('process', async () => {
    const res = await api.post<PayRun & { skipped: Skipped[] }>(`/api/payroll/runs/${id}/process`);
    setSkipped(res.skipped || []);
  }, 'Run processed');
  const setStatus = (status: string, okMsg: string) => act(status, () => api.post(`/api/payroll/runs/${id}/status`, { status }), okMsg);
  const remove = async () => {
    if (!(await confirm('Delete this run?', 'All generated payslips in it will be removed.'))) return;
    try {
      await api.delete(`/api/payroll/runs/${id}`);
      toast.success('Run deleted');
      onBack();
    } catch (err) {
      toast.error(err);
    }
  };

  const slips = useMemo(() => (r?.payslips || []).filter((p) => !q || p.employee_name.toLowerCase().includes(q.toLowerCase()) || p.employee_code.toLowerCase().includes(q.toLowerCase()) || (p.department_name || '').toLowerCase().includes(q.toLowerCase())), [r?.payslips, q]);

  if (run.loading && !r) return <Spinner />;
  if (!r) return <EmptyState title="Run not found" action={<Button onClick={onBack}>Back to runs</Button>} />;
  const t = r.totals || {};
  return (
    <div data-tour="payroll-runs">
      {dialog}
      <div className="row between mb">
        <div className="row">
          <Button size="sm" onClick={onBack}>← All runs</Button>
          <h2 style={{ fontSize: 18 }}>{periodLabel(r.period)}</h2>
          <StatusBadge status={r.status} label={label(r.status)} />
          <span className="muted">{r.working_days} working days · created {fmtDateTime(r.created_at)}</span>
        </div>
        <div className="row" data-testid="payroll-run-actions">
          {r.status === 'draft' ? <Button variant="primary" loading={busy === 'process'} onClick={process} data-testid="payroll-process">Process</Button> : null}
          {r.status === 'processed' ? (
            <>
              <Button onClick={() => setStatus('draft', 'Run moved back to draft')} loading={busy === 'draft'} data-testid="payroll-to-draft">Back to draft</Button>
              {isAgency
                ? <span className="chip chip-info" data-testid="payroll-awaiting-client">Waiting for the client to approve</span>
                : <Button variant="primary" onClick={() => setStatus('approved', 'Run approved — payslips released')} loading={busy === 'approved'} data-testid="payroll-approve">Approve</Button>}
            </>
          ) : null}
          {r.status === 'approved' ? (
            <>
              <Button onClick={() => setStatus('processed', 'Approval withdrawn')} loading={busy === 'processed'} data-testid="payroll-unapprove">Back to processed</Button>
              <Button variant="primary" onClick={async () => { if (await confirm('Mark this run as paid?', 'Payslips will be marked paid and the run becomes read-only.', false)) setStatus('paid', 'Run marked as paid'); }} loading={busy === 'paid'} data-testid="payroll-mark-paid">Mark paid</Button>
            </>
          ) : null}
          {r.status !== 'paid' ? <Button variant="danger" onClick={remove} data-testid="payroll-delete-run">Delete</Button> : null}
        </div>
      </div>
      {r.notes ? <p className="muted" style={{ marginTop: -8 }}>{r.notes}</p> : null}
      {r.status === 'draft' ? <div className="alert alert-info mb">This run is a draft. Add any adjustments for {periodLabel(r.period)} first, then <strong>Process</strong> to generate payslips.</div> : null}

      <div className="grid grid-4 mb" data-tour="payroll-run-totals">
        <Stat label="Employees" value={t.employees ?? r.payslip_count ?? 0} hint={t.skipped ? `${t.skipped} skipped` : undefined} />
        <Stat label="Gross" value={fmtMoney(t.gross ?? 0, currency)} color="#16a34a" />
        <Stat label="Deductions" value={fmtMoney(t.deductions ?? 0, currency)} color="#dc2626" />
        <Stat label="Net payable" value={fmtMoney(t.net ?? 0, currency)} hint={r.paid_at ? `Paid ${fmtDate(r.paid_at)}` : r.approved_at ? `Approved ${fmtDate(r.approved_at)}` : r.processed_at ? `Processed ${fmtDate(r.processed_at)}` : undefined} />
      </div>

      {skipped.length ? (
        <Card title={`Skipped (${skipped.length})`} className="mb">
          <ul className="list">
            {skipped.map((s) => (
              <li key={s.employee_id}><span><Link to={`/employees/${s.employee_id}`}>{s.name}</Link></span><span className="meta">{s.reason}</span></li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card title={`Payslips (${r.payslips.length})`} padded={false} actions={<input className="input search" type="search" placeholder="Filter employees…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter payslips" />}>
        <Table<RunPayslip>
          rows={slips}
          loading={run.loading}
          empty={<EmptyState title="No payslips" description={r.status === 'draft' ? 'Process the run to generate payslips.' : 'No employees were eligible.'} />}
          onRowClick={(p) => setView(p.id)}
          columns={[
            { key: 'employee_name', header: 'Employee', render: (p) => <span><strong>{p.employee_name}</strong> <span className="muted mono">{p.employee_code}</span></span> },
            { key: 'department_name', header: 'Department', render: (p) => p.department_name || '—' },
            { key: 'paid_days', header: 'Paid / LOP', align: 'right', render: (p) => <span className="num">{p.paid_days} / {p.lop_days}</span> },
            { key: 'gross', header: 'Gross', align: 'right', render: (p) => <span className="num">{fmtMoney(p.gross, p.currency || currency)}</span> },
            { key: 'total_deductions', header: 'Deductions', align: 'right', render: (p) => <span className="num">{fmtMoney(p.total_deductions, p.currency || currency)}</span> },
            { key: 'net', header: 'Net', align: 'right', render: (p) => <strong className="num">{fmtMoney(p.net, p.currency || currency)}</strong> },
            { key: 'status', header: 'Status', render: (p) => <StatusBadge status={p.status} label={label(p.status)} /> },
            { key: 'actions', header: '', align: 'right', render: (p) => (
              <span className="row" style={{ justifyContent: 'flex-end', gap: 6 }}>
                <Button size="sm" onClick={(e) => { e.stopPropagation(); setView(p.id); }} data-testid="payslip-view">View</Button>
                {editable ? <Button size="sm" onClick={(e) => { e.stopPropagation(); setEdit(p); }} data-testid="payslip-edit">Edit</Button> : null}
              </span>
            ) },
          ]}
        />
      </Card>
      {view ? <PayslipModal id={view} currency={currency} onClose={() => setView(null)} /> : null}
      {edit ? <PayslipEditor payslip={edit} currency={currency} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); run.reload(); }} /> : null}
    </div>
  );
}

/* ---------- Payslip modal (view/print) ---------- */
function PayslipModal({ id, currency, onClose }: { id: number; currency: string; onClose: () => void }) {
  const { company } = useAuth();
  const slip = useFetch<PayslipData>(() => api.get(`/api/payroll/payslips/${id}`), [id]);
  return (
    <Modal open wide title={slip.data ? `Payslip · ${slip.data.employee_name} · ${periodLabel(slip.data.period || '')}` : 'Payslip'} onClose={onClose} testId="payslip-modal"
      footer={<><Button onClick={onClose}>Close</Button><Button variant="primary" onClick={() => window.print()} data-testid="payslip-download" title="Opens the print dialog — choose “Save as PDF”"><Icon name="download" size={15} /> Download PDF</Button></>}>
      {slip.loading ? <Spinner /> : slip.error ? <div className="alert alert-error">{slip.error}</div> : slip.data ? <Payslip payslip={slip.data} company={company} currency={slip.data.currency || currency} /> : null}
    </Modal>
  );
}

/* ---------- Payslip editor (HR, draft/processed runs) ---------- */
function PayslipEditor({ payslip, currency, onClose, onSaved }: { payslip: RunPayslip; currency: string; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [earnings, setEarnings] = useState<PayLine[]>(() => (payslip.earnings || []).map((l) => ({ ...l })));
  const [deductions, setDeductions] = useState<PayLine[]>(() => (payslip.deductions || []).map((l) => ({ ...l })));
  const [paidDays, setPaidDays] = useState(String(payslip.paid_days));
  const [lopDays, setLopDays] = useState(String(payslip.lop_days));
  const [notes, setNotes] = useState(payslip.notes || '');
  const [busy, setBusy] = useState(false);
  const cur = payslip.currency || currency;
  const gross = earnings.reduce((s, l) => s + (Number(l.amount) || 0), 0);
  const total = deductions.reduce((s, l) => s + (Number(l.amount) || 0), 0);
  const setAmt = (list: PayLine[], set: (v: PayLine[]) => void, i: number, v: string) => set(list.map((l, j) => (j === i ? { ...l, amount: v === '' ? 0 : Number(v) } : l)));
  const addLine = (list: PayLine[], set: (v: PayLine[]) => void) => set([...list, { code: 'OTHER', name: '', amount: 0 }]);
  const setName = (list: PayLine[], set: (v: PayLine[]) => void, i: number, v: string) => set(list.map((l, j) => (j === i ? { ...l, name: v } : l)));
  const removeLine = (list: PayLine[], set: (v: PayLine[]) => void, i: number) => set(list.filter((_, j) => j !== i));
  const save = async () => {
    if (earnings.some((l) => !l.name.trim()) || deductions.some((l) => !l.name.trim())) return toast.error('Every line needs a name');
    setBusy(true);
    try {
      await api.put(`/api/payroll/payslips/${payslip.id}`, {
        earnings: earnings.map((l) => ({ ...l, amount: Number(l.amount) || 0 })),
        deductions: deductions.map((l) => ({ ...l, amount: Number(l.amount) || 0 })),
        paid_days: Number(paidDays), lop_days: Number(lopDays), notes: notes || null,
      });
      toast.success('Payslip updated');
      onSaved();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };
  const lines = (title: string, list: PayLine[], set: (v: PayLine[]) => void, sum: number) => (
    <div>
      <table className="table dense">
        <thead><tr><th>{title}</th><th style={{ width: 150 }} className="right">Amount</th><th style={{ width: 36 }} /></tr></thead>
        <tbody>
          {list.map((l, i) => (
            <tr key={i}>
              <td><Input value={l.name} onChange={(e) => setName(list, set, i, e.target.value)} placeholder="Line name" /><span className="muted mono" style={{ fontSize: 11 }}>{l.code}</span></td>
              <td><Input type="number" step="0.01" value={l.amount} onChange={(e) => setAmt(list, set, i, e.target.value)} className="right" /></td>
              <td><button type="button" className="btn btn-ghost btn-sm" aria-label="Remove line" onClick={() => removeLine(list, set, i)}>✕</button></td>
            </tr>
          ))}
          <tr><td><Button size="sm" variant="ghost" onClick={() => addLine(list, set)}>+ Add line</Button></td><td className="right num"><strong>{fmtMoney(sum, cur)}</strong></td><td /></tr>
        </tbody>
      </table>
    </div>
  );
  return (
    <Modal open wide title={`Edit payslip · ${payslip.employee_name}`} onClose={onClose} testId="payslip-editor"
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={save} data-testid="payslip-save">Save</Button></>}>
      <div className="form-grid mb">
        <Field label="Paid days"><Input type="number" step="0.5" min={0} value={paidDays} onChange={(e) => setPaidDays(e.target.value)} /></Field>
        <Field label="LOP days"><Input type="number" step="0.5" min={0} value={lopDays} onChange={(e) => setLopDays(e.target.value)} /></Field>
        <Field label="Notes" className="span-2"><Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Shown on the payslip" /></Field>
      </div>
      <div className="payslip-cols">
        {lines('Earnings', earnings, setEarnings, gross)}
        {lines('Deductions', deductions, setDeductions, total)}
      </div>
      <div className="payslip-total"><span>Net pay</span><span className="num">{fmtMoney(gross - total, cur)}</span></div>
      <p className="help mt">Changing amounts here overrides the computed values for this payslip only. Re-processing the run recalculates everything from salary structures.</p>
    </Modal>
  );
}

/* ---------- Salary components ---------- */
function ComponentsTab({ settings }: { settings: PayrollSettings | null }) {
  const comps = useFetch<Component[]>(() => api.get('/api/payroll/components'), []);
  const [edit, setEdit] = useState<Partial<Component> | null>(null);
  const cur = settings?.currency || 'INR';
  const fmtDefault = (c: Component) => (c.calc_type === 'fixed' ? fmtMoney(c.default_value, cur) : `${c.default_value}% of ${c.calc_type === 'percent_of_basic' ? 'basic' : 'gross'}`);
  const yn = (v: number) => <Badge tone={v ? 'success' : 'neutral'}>{v ? 'Yes' : 'No'}</Badge>;
  return (
    <>
      <div className="alert alert-info mb">
        Components with the special codes <code>PF</code>, <code>ESI</code>, <code>PT</code> and <code>TDS</code> ignore their default value and are computed from the rates and slabs in the <strong>Settings</strong> tab.
      </div>
      <Card title="Salary components" padded={false} tour="payroll-components" actions={<Button variant="primary" size="sm" onClick={() => setEdit({ type: 'earning', calc_type: 'fixed', default_value: 0, taxable: 1, statutory: 0, prorate: 1, active: 1, sort_order: (comps.data?.length || 0) + 1 })} data-testid="component-add">+ Add component</Button>}>
        <Table<Component>
          loading={comps.loading}
          rows={comps.data || []}
          onRowClick={(c) => setEdit(c)}
          columns={[
            { key: 'name', header: 'Component', render: (c) => <span><strong>{c.name}</strong> {SPECIAL_CODES[c.code] ? <span className="muted" title={SPECIAL_CODES[c.code]}> ⓘ</span> : null}</span> },
            { key: 'code', header: 'Code', render: (c) => <span className="mono">{c.code}</span> },
            { key: 'type', header: 'Type', render: (c) => <Badge tone={c.type === 'earning' ? 'success' : 'danger'}>{c.type}</Badge> },
            { key: 'calc_type', header: 'Calculation', render: (c) => label(c.calc_type) },
            { key: 'default_value', header: 'Default', align: 'right', render: (c) => <span className="num">{SPECIAL_CODES[c.code] ? <span className="muted">from settings</span> : fmtDefault(c)}</span> },
            { key: 'taxable', header: 'Taxable', render: (c) => yn(c.taxable) },
            { key: 'statutory', header: 'Statutory', render: (c) => yn(c.statutory) },
            { key: 'prorate', header: 'Prorate', render: (c) => yn(c.prorate) },
            { key: 'active', header: 'Status', render: (c) => <Badge tone={c.active ? 'success' : 'neutral'}>{c.active ? 'Active' : 'Inactive'}</Badge> },
          ]}
        />
      </Card>
      {edit ? <ComponentModal comp={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); comps.reload(); }} /> : null}
    </>
  );
}

function ComponentModal({ comp, onClose, onSaved }: { comp: Partial<Component>; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const { confirm, dialog } = useConfirm();
  const f = useForm({ name: comp.name || '', code: comp.code || '', type: comp.type || 'earning', calc_type: comp.calc_type || 'fixed', default_value: comp.default_value ?? 0, taxable: comp.taxable ?? 1, statutory: comp.statutory ?? 0, prorate: comp.prorate ?? 1, sort_order: comp.sort_order ?? 0, active: comp.active ?? 1 });
  const [busy, setBusy] = useState(false);
  const special = SPECIAL_CODES[String(f.values.code).toUpperCase()];
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const body = { ...f.values, default_value: Number(f.values.default_value) || 0, sort_order: Number(f.values.sort_order) || 0, taxable: Number(f.values.taxable), statutory: Number(f.values.statutory), prorate: Number(f.values.prorate), active: Number(f.values.active) };
      if (comp.id) await api.put(`/api/payroll/components/${comp.id}`, body);
      else await api.post('/api/payroll/components', body);
      toast.success(comp.id ? 'Component updated' : 'Component created');
      onSaved();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!(await confirm('Delete component?', 'Existing payslips keep their lines; future runs will not include it.'))) return;
    try {
      await api.delete(`/api/payroll/components/${comp.id}`);
      toast.success('Component deleted');
      onSaved();
    } catch (err) {
      toast.error(err);
    }
  };
  const flag = (k: 'taxable' | 'statutory' | 'prorate' | 'active', text: string) => <Checkbox label={text} checked={!!f.values[k]} onChange={(e) => f.set(k, e.target.checked ? 1 : 0)} />;
  return (
    <Modal open title={comp.id ? 'Edit component' : 'New component'} onClose={onClose} testId="component-modal"
      footer={<>
        {comp.id ? <Button variant="danger" onClick={remove} style={{ marginRight: 'auto' }}>Delete</Button> : null}
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" loading={busy} onClick={save as any} data-testid="component-save">Save</Button>
      </>}>
      {dialog}
      <form onSubmit={save} className="form-grid">
        <Field label="Name" required><Input {...f.bind('name')} required autoFocus /></Field>
        <Field label="Code" required hint={comp.id ? 'Codes cannot be changed' : 'Letters, digits and _ only. PF/ESI/PT/TDS are special.'}><Input {...f.bind('code')} required disabled={!!comp.id} placeholder="e.g. HRA" style={{ textTransform: 'uppercase' }} /></Field>
        <Field label="Type"><Select {...f.bind('type')}><option value="earning">Earning</option><option value="deduction">Deduction</option></Select></Field>
        <Field label="Calculation"><Select {...f.bind('calc_type')}><option value="fixed">Fixed amount</option><option value="percent_of_basic">% of basic</option><option value="percent_of_gross">% of gross</option></Select></Field>
        <Field label={f.values.calc_type === 'fixed' ? 'Default amount (monthly)' : 'Default percent'} hint={special ? `Ignored: ${special}` : 'Can be overridden per employee in their salary structure.'}><Input type="number" step="0.01" min={0} {...f.bind('default_value')} /></Field>
        <Field label="Sort order"><Input type="number" {...f.bind('sort_order')} /></Field>
        <div className="span-2 row" style={{ gap: 18 }}>
          {flag('taxable', 'Taxable')}
          {flag('statutory', 'Statutory')}
          {flag('prorate', 'Prorate for LOP days')}
          {flag('active', 'Active')}
        </div>
      </form>
    </Modal>
  );
}

/* ---------- Adjustments ---------- */
function AdjustmentsTab({ currency }: { currency: string }) {
  const toast = useToast();
  const { confirm, dialog } = useConfirm();
  const [period, setPeriod] = useState(monthIso());
  const [employeeId, setEmployeeId] = useState('');
  const employees = useFetch<DirEmployee[]>(() => api.get('/api/employees/directory/all'), []);
  const list = useFetch<Adjustment[]>(() => api.get(`/api/payroll/adjustments${qs({ period, employee_id: employeeId })}`), [period, employeeId]);
  const [add, setAdd] = useState(false);
  const remove = async (a: Adjustment) => {
    if (!(await confirm('Delete adjustment?', `${label(a.type)} of ${fmtMoney(a.amount, currency)} for ${a.employee_name}.`))) return;
    try {
      await api.delete(`/api/payroll/adjustments/${a.id}`);
      toast.success('Adjustment deleted');
      list.reload();
    } catch (err) {
      toast.error(err);
    }
  };
  const total = (list.data || []).reduce((s, a) => s + (ADJ_EARNING.has(a.type) ? a.amount : -a.amount), 0);
  return (
    <>
      {dialog}
      <div className="toolbar">
        <Input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} aria-label="Period" data-testid="adjustment-period-filter" />
        <Select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} aria-label="Employee">
          <option value="">All employees</option>
          {(employees.data || []).map((e) => <option key={e.id} value={e.id}>{e.first_name} {e.last_name} ({e.employee_code})</option>)}
        </Select>
        {period ? <Button size="sm" variant="ghost" onClick={() => setPeriod('')}>All periods</Button> : null}
        <span className="muted" style={{ marginLeft: 'auto' }}>Net effect: <strong className="num">{total >= 0 ? '+' : '−'}{fmtMoney(Math.abs(total), currency)}</strong></span>
        <Button variant="primary" onClick={() => setAdd(true)} data-testid="adjustment-add">+ Add adjustment</Button>
      </div>
      <Card padded={false} tour="payroll-adjustments">
        <Table<Adjustment>
          loading={list.loading}
          rows={list.data || []}
          empty={<EmptyState title="No adjustments" description="Bonuses, reimbursements, overtime, advances and recoveries added here are included when the month is processed." />}
          columns={[
            { key: 'employee_name', header: 'Employee', render: (a) => <span><strong>{a.employee_name}</strong> <span className="muted mono">{a.employee_code}</span></span> },
            { key: 'period', header: 'Period', render: (a) => periodLabel(a.period) },
            { key: 'type', header: 'Type', render: (a) => <Badge tone={ADJ_EARNING.has(a.type) ? 'success' : 'danger'}>{label(a.type)}</Badge> },
            { key: 'amount', header: 'Amount', align: 'right', render: (a) => <span className="num">{ADJ_EARNING.has(a.type) ? '+' : '−'}{fmtMoney(a.amount, currency)}</span> },
            { key: 'note', header: 'Note', render: (a) => a.note || '—' },
            { key: 'created_at', header: 'Added', render: (a) => fmtDate(a.created_at) },
            { key: 'actions', header: '', align: 'right', render: (a) => <Button size="sm" variant="danger" onClick={() => remove(a)} data-testid="adjustment-delete">Delete</Button> },
          ]}
        />
      </Card>
      {add ? <AdjustmentModal employees={employees.data || []} defaultPeriod={period || monthIso()} defaultEmployee={employeeId} currency={currency} onClose={() => setAdd(false)} onSaved={() => { setAdd(false); list.reload(); }} /> : null}
    </>
  );
}

function AdjustmentModal({ employees, defaultPeriod, defaultEmployee, currency, onClose, onSaved }: { employees: DirEmployee[]; defaultPeriod: string; defaultEmployee: string; currency: string; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const f = useForm({ employee_id: defaultEmployee, period: defaultPeriod, type: 'bonus', amount: '', note: '' });
  const [busy, setBusy] = useState(false);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!f.values.employee_id) return toast.error('Pick an employee');
    if (!(Number(f.values.amount) > 0)) return toast.error('Amount must be greater than zero');
    setBusy(true);
    try {
      await api.post('/api/payroll/adjustments', { employee_id: Number(f.values.employee_id), period: f.values.period, type: f.values.type, amount: Number(f.values.amount), note: f.values.note || null });
      toast.success('Adjustment added');
      onSaved();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open title="Add adjustment" onClose={onClose} testId="adjustment-modal"
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={save as any} data-testid="adjustment-save">Add</Button></>}>
      <form onSubmit={save} className="form-grid">
        <Field label="Employee" required className="span-2">
          <Select {...f.bind('employee_id')} required autoFocus data-testid="adjustment-employee">
            <option value="">— Select —</option>
            {employees.map((e) => <option key={e.id} value={e.id}>{e.first_name} {e.last_name} ({e.employee_code}){e.department_name ? ` · ${e.department_name}` : ''}</option>)}
          </Select>
        </Field>
        <Field label="Period" required hint="Only months whose run is still a draft (or has no run yet)."><Input type="month" {...f.bind('period')} required /></Field>
        <Field label="Type" required>
          <Select {...f.bind('type')} data-testid="adjustment-type">
            {ADJ_TYPES.map((t) => <option key={t} value={t}>{label(t)} ({ADJ_EARNING.has(t) ? 'adds to pay' : 'deducts'})</option>)}
          </Select>
        </Field>
        <Field label={`Amount (${currency})`} required><Input type="number" step="0.01" min={0} {...f.bind('amount')} required data-testid="adjustment-amount" /></Field>
        <Field label="Note" hint="Shown as the line name on the payslip."><Input {...f.bind('note')} placeholder="e.g. Q3 performance bonus" /></Field>
      </form>
    </Modal>
  );
}

/* ---------- Settings ---------- */
type SettingsDraft = Record<string, any> & { tds_slabs: { upto: string; percent: string }[] };
const NUM_FIELDS: { key: keyof PayrollSettings; label: string; hint?: string; step?: string }[] = [
  { key: 'pay_day', label: 'Pay day (day of month)', step: '1' },
  { key: 'pf_employee_percent', label: 'PF employee %', step: '0.01' },
  { key: 'pf_employer_percent', label: 'PF employer %', step: '0.01' },
  { key: 'pf_wage_ceiling', label: 'PF wage ceiling (monthly basic)', hint: 'PF is computed on basic up to this amount.' },
  { key: 'esi_employee_percent', label: 'ESI employee %', step: '0.01' },
  { key: 'esi_employer_percent', label: 'ESI employer %', step: '0.01' },
  { key: 'esi_wage_ceiling', label: 'ESI wage ceiling (monthly gross)', hint: 'ESI applies only when gross is at or below this.' },
  { key: 'professional_tax_monthly', label: 'Professional tax (monthly)' },
  { key: 'professional_tax_threshold', label: 'Professional tax threshold (monthly gross)' },
  { key: 'standard_deduction_annual', label: 'Standard deduction (annual)', hint: 'Subtracted from annual taxable income before TDS slabs.' },
  { key: 'overtime_multiplier', label: 'Overtime multiplier', step: '0.1' },
];

function toDraft(s: PayrollSettings): SettingsDraft {
  const d: SettingsDraft = { ...s, tds_slabs: (s.tds_slabs || []).map((r) => ({ upto: r.upto == null ? '' : String(r.upto), percent: String(r.percent) })) };
  for (const f of NUM_FIELDS) d[f.key] = s[f.key] == null ? '' : String(s[f.key]);
  return d;
}

function SettingsTab({ settings, loading, onSaved }: { settings: PayrollSettings | null; loading: boolean; onSaved: (s: PayrollSettings) => void }) {
  const toast = useToast();
  const [form, setForm] = useState<SettingsDraft | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (settings && !form) setForm(toDraft(settings)); }, [settings, form]);
  if (loading && !form) return <Spinner />;
  if (!form) return <EmptyState title="Settings unavailable" />;
  const set = (k: string, v: any) => setForm((s) => (s ? { ...s, [k]: v } : s));
  const setSlab = (i: number, k: 'upto' | 'percent', v: string) => set('tds_slabs', form.tds_slabs.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const slabs: TdsSlab[] = form.tds_slabs.map((r) => ({ upto: r.upto === '' ? null : Number(r.upto), percent: Number(r.percent) || 0 }));
    for (let i = 0; i < slabs.length - 1; i++) {
      if (slabs[i].upto == null) return toast.error('Only the last TDS slab may be "and above"');
      if (i > 0 && slabs[i].upto! <= slabs[i - 1].upto!) return toast.error('TDS slab limits must increase from top to bottom');
    }
    const body: Partial<PayrollSettings> = { currency: String(form.currency || 'INR').toUpperCase(), lop_based_on_attendance: !!form.lop_based_on_attendance, working_days_mode: form.working_days_mode === 'working' ? 'working' : 'calendar', tds_slabs: slabs };
    for (const f of NUM_FIELDS) (body as any)[f.key] = Number(form[f.key]) || 0;
    setBusy(true);
    try {
      const saved = await api.put<PayrollSettings>('/api/settings/payroll', body);
      toast.success('Payroll settings saved');
      onSaved(saved);
      setForm(toDraft(saved));
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={save} data-tour="payroll-settings">
      <div className="grid grid-2">
        <Card title="General">
          <div className="form-grid">
            <Field label="Currency (ISO code)" hint="Used for all payroll amounts."><Input value={form.currency || ''} onChange={(e) => set('currency', e.target.value)} maxLength={3} style={{ textTransform: 'uppercase' }} data-testid="payroll-currency" /></Field>
            <Field label="Pay day (day of month)"><Input type="number" min={1} max={31} value={form.pay_day} onChange={(e) => set('pay_day', e.target.value)} /></Field>
            <Field label="Working days basis" hint="Calendar = every day of the month; Working = excludes weekly offs and holidays.">
              <Select value={form.working_days_mode} onChange={(e) => set('working_days_mode', e.target.value)}><option value="calendar">Calendar days</option><option value="working">Working days</option></Select>
            </Field>
            <Field label="Overtime multiplier"><Input type="number" step="0.1" min={1} value={form.overtime_multiplier} onChange={(e) => set('overtime_multiplier', e.target.value)} /></Field>
            <div className="span-2">
              <Switch checked={!!form.lop_based_on_attendance} onChange={(v) => set('lop_based_on_attendance', v)} label="Deduct loss-of-pay from attendance (absent and half days)" />
              <div className="help">When off, only unpaid approved leave and days outside the employment period count as LOP.</div>
            </div>
          </div>
        </Card>
        <Card title="Statutory deductions">
          <div className="form-grid">
            {NUM_FIELDS.filter((f) => !['pay_day', 'overtime_multiplier'].includes(f.key)).map((f) => (
              <Field key={f.key} label={f.label} hint={f.hint}><Input type="number" step={f.step || '1'} min={0} value={form[f.key]} onChange={(e) => set(f.key, e.target.value)} data-testid={`payroll-${f.key}`} /></Field>
            ))}
          </div>
        </Card>
      </div>
      <Card title="TDS slabs (annual taxable income)" actions={<Button size="sm" type="button" onClick={() => set('tds_slabs', [...form.tds_slabs, { upto: '', percent: '' }])}>+ Add slab</Button>}>
        <table className="table dense" data-testid="tds-slabs">
          <thead><tr><th>From</th><th>Up to (annual income)</th><th style={{ width: 140 }}>Tax %</th><th style={{ width: 40 }} /></tr></thead>
          <tbody>
            {form.tds_slabs.map((r, i) => {
              const prev = i === 0 ? 0 : Number(form.tds_slabs[i - 1].upto) || 0;
              const last = i === form.tds_slabs.length - 1;
              return (
                <tr key={i}>
                  <td className="num muted">{fmtMoney(prev, form.currency || 'INR')}</td>
                  <td><Input type="number" min={0} value={r.upto} onChange={(e) => setSlab(i, 'upto', e.target.value)} placeholder={last ? 'and above' : 'e.g. 300000'} /></td>
                  <td><Input type="number" step="0.01" min={0} max={100} value={r.percent} onChange={(e) => setSlab(i, 'percent', e.target.value)} /></td>
                  <td><button type="button" className="btn btn-ghost btn-sm" aria-label="Remove slab" onClick={() => set('tds_slabs', form.tds_slabs.filter((_, j) => j !== i))}>✕</button></td>
                </tr>
              );
            })}
            {form.tds_slabs.length === 0 ? <tr><td colSpan={4} className="table-empty">No slabs — TDS will be zero.</td></tr> : null}
          </tbody>
        </table>
        <p className="help mt">Leave the last slab's limit empty to mean "and above". Monthly TDS is the annual tax divided by 12.</p>
      </Card>
      <div className="sticky-actions">
        <Button type="button" onClick={() => settings && setForm(toDraft(settings))}>Reset</Button>
        <Button variant="primary" type="submit" loading={busy} data-testid="payroll-settings-save">Save settings</Button>
      </div>
    </form>
  );
}
