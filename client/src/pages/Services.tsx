import React, { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, apiUrl } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useCounts } from '../lib/notifications';
import { usePageTour, type TourStep } from '../lib/tour';
import { fmtDate, fmtDateTime, fmtMoney } from '../lib/format';
import { Badge, Button, Card, EmptyState, Field, Input, Modal, PageHeader, Pill, Select, Spinner, Stat, Table, Tabs, Textarea, useConfirm, useFetch, useForm, useToast } from '../components/ui';
import { Icon } from '../components/Icons';
import { PRIORITIES, PriorityBadge, SR_CATEGORIES, SlaChip, SrStatusBadge, cap, daysPhrase, isActive, type ServiceRequest } from '../agency/ops/shared';
import { RequestDrawer } from '../agency/ops/RequestDrawer';
import '../agency/calendar.css';

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */
interface Milestone {
  key: 'inputs' | 'attendance_lock' | 'generation' | 'client_approval' | 'payment';
  label: string;
  description: string;
  due: string;
  owner: 'client' | 'agency';
  done: boolean;
  done_at: string | null;
  status: 'done' | 'overdue' | 'due_today' | 'due_soon' | 'upcoming';
  days_left: number;
}
interface PayrollCalendar {
  period: string;
  pay_date: string;
  run: { id: number; status: string; processed_at: string | null; approved_at: string | null; paid_at: string | null; net: number | null; payslips: number } | null;
  milestones: Milestone[];
  next: Milestone | null;
  stage: string;
  status: 'on_track' | 'due_soon' | 'overdue' | 'complete';
  locked: boolean;
}
interface CalendarResponse { current: PayrollCalendar; next: PayrollCalendar; history: PayrollCalendar[]; today: string }
interface Filing {
  id: number; code: string; name: string; authority: string | null; frequency: string; period: string; due_date: string;
  status: 'pending' | 'filed' | 'not_applicable'; state: 'overdue' | 'due_soon' | 'upcoming' | 'filed' | 'not_applicable';
  amount: number | null; reference: string | null; filed_at: string | null; filed_by_name: string | null; notes: string | null; description: string | null;
}
interface Invoice {
  id: number; number: string; period: string; issue_date: string; due_date: string; currency: string; exponent: number;
  subtotal_minor: number; tax_minor: number; total_minor: number; paid_minor: number; status: string; entity_name: string; overdue: 0 | 1;
}

type Tab = 'calendar' | 'compliance' | 'requests' | 'invoices';
const TABS: Tab[] = ['calendar', 'compliance', 'requests', 'invoices'];

const periodTitle = (p: string) => new Date(p + '-01T00:00:00Z').toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' });
const MS_TONE: Record<Milestone['status'], 'neutral' | 'success' | 'warning' | 'danger' | 'info'> = { done: 'success', overdue: 'danger', due_today: 'warning', due_soon: 'warning', upcoming: 'neutral' };
const MS_LABEL: Record<Milestone['status'], string> = { done: 'Done', overdue: 'Overdue', due_today: 'Due today', due_soon: 'Due soon', upcoming: 'Upcoming' };
const FILING_STATES: Filing['state'][] = ['overdue', 'due_soon', 'upcoming', 'filed', 'not_applicable'];
const FILING_LABEL: Record<Filing['state'], string> = { overdue: 'Overdue', due_soon: 'Due soon', upcoming: 'Upcoming', filed: 'Filed', not_applicable: 'Not applicable' };
const FILING_TONE: Record<Filing['state'], 'neutral' | 'success' | 'warning' | 'danger' | 'info'> = { overdue: 'danger', due_soon: 'warning', upcoming: 'neutral', filed: 'success', not_applicable: 'neutral' };

/** One tour for the whole page, in the order the work happens; wording follows who is looking (client HR or agency staff). */
function servicesTour(agency: boolean): TourStep[] {
  const you = agency ? 'the client' : 'you';
  return [
    { title: 'Agency services', description: agency
      ? 'Service delivery for this client. Each month runs the same loop: client inputs (T-7), attendance cut-off (T-5), payroll generation (T-3), client approval (T-2) and payment on pay day, alongside statutory filings, the client\'s requests and invoices.'
      : 'Everything your HR agency runs for your company. Each month: you send payroll inputs (T-7), the agency cuts off attendance (T-5) and generates payroll (T-3), you approve the register (T-2) and the agency pays salaries on pay day. Filings, requests and invoices are on the other tabs.', tab: 'calendar' },
    { element: '[data-tour="svc-tabs"]', title: 'Four tabs, one loop', description: `Payroll calendar, compliance, requests and invoices, in that order. Red badges count what is waiting: a register to approve, filings needing attention, requests waiting on ${you}.` },
    { element: '[data-testid="svc-approval-banner"]', title: agency ? 'Waiting for the client' : 'Ready for your approval', description: agency
      ? 'The register is processed. Only the client\'s HR team can approve it; salaries are paid after that.'
      : 'The agency has processed this month\'s payroll. Review and approve the register in Payroll so salaries go out on pay day.' },
    { element: '[data-tour="svc-countdown"]', title: 'Countdown to the next step', description: `Days left (or days overdue) for the next payroll milestone, its due date and who owns it: Client means ${agency ? 'the client\'s HR team' : 'your team'}, Agency means the HR agency.` },
    { element: '[data-tour="svc-period-facts"]', title: 'This period', description: 'The payroll month and whether its attendance is locked, the pay date and current stage, and the net pay once the run is processed.' },
    { element: '[data-tour="svc-timeline"]', title: 'The five milestones', description: 'Every step of this month\'s payroll with its due date, owner and status. Dates count back from pay day in working days of this company\'s calendar (weekends and holidays skipped). The ringed step is next.' },
    { element: '[data-testid="ms-inputs"]', title: 'T-7: payroll inputs', description: agency
      ? 'The client sends joiners, exits, salary changes and one-off payments. When they press Inputs sent this ticks; you can also tick it with Mark inputs received.'
      : 'Send the agency this month\'s joiners, exits, salary changes and one-off payments (raise a request on the Requests tab if needed), then press Inputs sent.' },
    { element: '[data-testid="ms-attendance_lock"]', title: 'T-5: attendance cut-off', description: agency
      ? 'Lock attendance to freeze the period. After that, attendance, leave and appeal changes up to the cut-off date are refused and go into next month as adjustments; live punches still work.'
      : 'The agency locks attendance for the month. After that, attendance and leave changes up to the cut-off date are refused and go into next month as adjustments, so get approvals done before this date.' },
    { element: '[data-testid="ms-generation"]', title: 'T-3: payroll generation', description: agency
      ? 'Generate and process the run in Payroll. The countdown turns amber in these last three days and red if it slips, here, on the portfolio and in the agency alerts.'
      : 'The agency generates and processes the payroll run from your inputs and the locked attendance.' },
    { element: '[data-testid="ms-client_approval"]', title: 'T-2: client approval', description: agency
      ? 'The client\'s HR approves the processed register in Payroll. Agency staff cannot approve it for them; nudge the client through a request if it is late.'
      : 'You review the processed register and approve it in Payroll, Runs. Nothing is paid until you approve.' },
    { element: '[data-testid="ms-payment"]', title: 'Pay day: payment and payslips', description: 'The agency pays salaries and releases payslips to employees. The period is then complete.' },
    { element: '[data-tour="svc-next"]', title: 'Next period', description: 'Next month\'s dates for every milestone, so both sides can plan ahead.' },
    { element: '[data-tour="svc-history"]', title: 'Recent periods', description: 'The last payroll periods with their pay date, final stage and net pay.' },
    { element: '[data-tour="svc-filing-stats"]', title: 'Next: statutory compliance', description: 'The returns this company must file (for example PF, ESI, TDS in India; WPS and social insurance in the GCC; federal and state filings in the US). Tiles count overdue, due within 7 days, upcoming and filed; click one to filter.', tab: 'compliance' },
    { element: '[data-testid="svc-compliance-readonly"]', title: 'Filed by your agency', description: 'Your HR agency files these returns and records the acknowledgement references. You can follow every filing here, read-only.' },
    { element: '[data-tour="svc-filing-filters"]', title: 'Filter by state', description: 'Open shows overdue, due soon and upcoming together; or pick one state, or All.' },
    { element: '[data-tour="svc-filings"]', title: 'Statutory filings', description: 'Each filing with its authority, period, due date (and days left), state and, once filed, the acknowledgement reference, amount and who filed it. Due dates are demo master data; confirm with the authority.' },
    { element: '[data-testid="filing-file"]', title: 'Mark as filed', description: 'Record the acknowledgement or challan reference (required), the amount paid and notes. Use N/A when a filing does not apply this period; filed items can be edited or reopened.' },
    { element: '[data-tour="svc-new-request"]', title: 'Next: requests', description: agency
      ? 'Raise a request on the client\'s behalf. Requests from every company also arrive on the agency service desk.'
      : 'Ask the agency for anything: payroll changes, onboarding, exits, letters, compliance questions. Pick a category and priority; priority sets the response SLA.', tab: 'requests' },
    { element: '[data-tour="svc-request-filters"]', title: 'Active or all', description: 'Focus on open work or browse the full history.' },
    { element: '[data-tour="svc-requests"]', title: agency ? 'This client\'s requests' : 'Your requests', description: agency
      ? 'Click a row to open the conversation: assign it to yourself, change status or priority and reply. Set Waiting for client to pause the SLA while you wait for them.'
      : 'Each request with its priority, status, SLA and who at the agency is handling it. Click one to read the conversation, reply, or close it; resolved requests can be reopened.' },
    { element: '[data-tour="svc-requests"] [data-testid="sla-chip"]', title: 'Response SLA', description: 'The agency\'s response deadline, set by priority (by default urgent 4 hours, high 24, normal 48, low 96). It pauses while a request is waiting for the client.' },
    { element: '[data-tour="svc-invoice-stats"]', title: 'Next: invoices', description: agency
      ? 'What this client owes the agency and how much of it is past due. Invoices are generated and issued on the agency Billing page.'
      : 'What you owe the agency and how much of it is past due.', tab: 'invoices' },
    { element: '[data-tour="svc-invoices"]', title: 'Invoices', description: 'Every issued invoice with its number, issuing entity, service month, dates, total, payments and status. Download the PDF for your records.' },
    { title: 'What to do next', description: agency
      ? 'Keep the countdown green: lock attendance at T-5, generate at T-3 and chase the client\'s approval at T-2. Mark filings as filed with their references and answer the client\'s requests within SLA. The agency portfolio and calendar show the same dates across every client.'
      : 'Send inputs before T-7, approve the payroll register in Payroll as soon as it is ready, and raise a request for anything you need from the agency. Your filings and invoices are always up to date here.' },
  ];
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */
export default function Services() {
  const { isAgency, companyRef, company } = useAuth();
  const { counts } = useCounts();
  const [params, setParams] = useSearchParams();
  const tab: Tab = TABS.includes(params.get('tab') as Tab) ? (params.get('tab') as Tab) : 'calendar';
  usePageTour('Agency services', servicesTour(isAgency));
  const setTab = (k: string) => setParams(k === 'calendar' ? {} : { tab: k }, { replace: true });
  const companyName = companyRef?.name || company?.name || 'this company';

  return (
    <div className="ops-page">
      <PageHeader
        title="Agency services"
        subtitle={isAgency ? `Service delivery for ${companyName}: payroll calendar, statutory filings, requests and invoices.` : 'Payroll, statutory compliance and HR requests handled by your HR agency.'}
        actions={isAgency ? <Badge tone="info">Agency view</Badge> : undefined}
      />
      <Tabs
        tour="svc-tabs"
        value={tab}
        onChange={setTab}
        tabs={[
          { key: 'calendar', label: 'Payroll calendar', icon: 'calendar', badge: counts.payroll_client_approval },
          { key: 'compliance', label: 'Compliance', icon: 'shield', badge: counts.compliance_attention },
          { key: 'requests', label: 'Requests', icon: 'headset', badge: counts.service_requests_waiting },
          { key: 'invoices', label: 'Invoices', icon: 'file' },
        ]}
      />
      {tab === 'calendar' ? <PayrollCalendarTab /> : tab === 'compliance' ? <ComplianceTab /> : tab === 'requests' ? <RequestsTab /> : <InvoicesTab />}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Payroll calendar                                                    */
/* ------------------------------------------------------------------ */
function PayrollCalendarTab() {
  const { isAgency, company, companyRef } = useAuth();
  const { refreshCounts } = useCounts();
  const toast = useToast();
  const { confirm, dialog } = useConfirm();
  const cal = useFetch<CalendarResponse>(() => api.get('/api/services/calendar'), []);
  const [busy, setBusy] = useState<string | null>(null);
  const currency = companyRef?.currency || company?.currency || 'INR';

  const checkpoint = async (period: string, key: 'inputs_received' | 'attendance_locked') => {
    if (key === 'attendance_locked' && !(await confirm(`Lock attendance for ${periodTitle(period)}?`, 'Attendance, leave and appeals up to the cut-off become final for this payroll. Later corrections roll into next month as adjustments.', false))) return;
    setBusy(key);
    try {
      await api.post(`/api/services/calendar/${period}/checkpoints`, { key, done: true });
      toast.success(key === 'inputs_received' ? 'Inputs marked as sent to the agency' : 'Attendance locked for this period');
      cal.reload();
      refreshCounts();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(null);
    }
  };

  if (cal.loading && !cal.data) return <Spinner />;
  if (cal.error || !cal.data) return <div className="alert alert-error">{cal.error || 'Could not load the payroll calendar'}</div>;
  const { current: c, next, history } = cal.data;
  const awaitingApproval = c.run?.status === 'processed' && c.milestones.some((m) => m.key === 'client_approval' && !m.done);
  const nm = c.next;

  return (
    <>
      {dialog}
      {awaitingApproval ? (
        isAgency ? (
          <div className="svc-banner tone-info" data-testid="svc-approval-banner">
            <Icon name="clock" size={20} />
            <div><strong>Waiting for client approval</strong><span>The {periodTitle(c.period)} register is processed. The client's HR team approves it before salaries are paid.</span></div>
          </div>
        ) : (
          <div className="svc-banner tone-warn" data-testid="svc-approval-banner">
            <Icon name="alert" size={20} />
            <div><strong>Payroll for {periodTitle(c.period)} is ready for your approval</strong><span>Review the register and approve it so the agency can pay salaries on {fmtDate(c.pay_date)}.</span></div>
            <Link to="/payroll?tab=runs" className="btn btn-primary btn-md" data-testid="svc-approve-link">Review and approve</Link>
          </div>
        )
      ) : null}

      <div className="svc-cal-top">
        <div className={`svc-countdown st-${nm?.status || 'done'}`} data-tour="svc-countdown" data-testid="svc-countdown">
          {nm ? (
            <>
              <div className="svc-countdown-num">
                <strong>{Math.abs(nm.days_left)}</strong>
                <span>{nm.days_left < 0 ? `day${nm.days_left === -1 ? '' : 's'} overdue` : nm.days_left === 0 ? 'due today' : `day${nm.days_left === 1 ? '' : 's'} to go`}</span>
              </div>
              <div className="svc-countdown-body">
                <small className="section-title">Next step</small>
                <strong className="svc-countdown-label">{nm.label}</strong>
                <span>{daysPhrase(nm.days_left)} · due {fmtDate(nm.due)}</span>
                <span className="row" style={{ gap: 6 }}><OwnerBadge owner={nm.owner} /><Badge tone={MS_TONE[nm.status]}>{MS_LABEL[nm.status]}</Badge></span>
              </div>
            </>
          ) : (
            <div className="svc-countdown-body">
              <small className="section-title">{periodTitle(c.period)}</small>
              <strong className="svc-countdown-label"><Icon name="check" size={18} /> Payroll complete</strong>
              <span>Salaries paid and payslips released.</span>
            </div>
          )}
        </div>
        <div className="svc-period-facts" data-tour="svc-period-facts">
          <Stat label="Period" value={periodTitle(c.period)} icon="calendar" color="var(--brand)" hint={c.locked ? 'Attendance locked' : 'Attendance open'} />
          <Stat label="Pay date" value={fmtDate(c.pay_date)} icon="banknote" color="var(--accent)" hint={c.stage} />
          <Stat label="Net pay" value={c.run?.net != null ? fmtMoney(c.run.net, currency) : '—'} icon="wallet" color="var(--info)" hint={c.run ? `${c.run.payslips} payslips · run ${c.run.status}` : 'Run not started'} />
        </div>
      </div>

      <Card title={`${periodTitle(c.period)} payroll`} actions={<Badge tone={c.status === 'overdue' ? 'danger' : c.status === 'due_soon' ? 'warning' : c.status === 'complete' ? 'success' : 'info'}>{cap(c.status)}</Badge>} tour="svc-timeline">
        <ol className="svc-timeline" data-testid="svc-timeline">
          {c.milestones.map((m, i) => (
            <li key={m.key} className={`svc-step st-${m.status} ${nm?.key === m.key ? 'is-next' : ''}`} data-testid={`ms-${m.key}`} data-status={m.status}>
              <span className="svc-step-dot">{m.done ? <Icon name="check" size={14} /> : i + 1}</span>
              <div className="svc-step-body">
                <div className="svc-step-head">
                  <strong>{m.label}</strong>
                  <OwnerBadge owner={m.owner} />
                </div>
                <div className="svc-step-due">{fmtDate(m.due)}</div>
                <div><Badge tone={MS_TONE[m.status]}>{m.done ? 'Done' : m.status === 'upcoming' ? daysPhrase(m.days_left) : `${MS_LABEL[m.status]} · ${daysPhrase(m.days_left).toLowerCase()}`}</Badge></div>
                <small className="muted">{m.done && m.done_at ? `Completed ${fmtDateTime(m.done_at)}` : m.description}</small>
                {m.key === 'inputs' && !m.done && !isAgency ? (
                  <Button size="sm" variant="primary" onClick={() => checkpoint(c.period, 'inputs_received')} loading={busy === 'inputs_received'} data-testid="cp-inputs"><Icon name="send" size={14} /> Inputs sent</Button>
                ) : null}
                {m.key === 'inputs' && !m.done && isAgency ? (
                  <Button size="sm" onClick={() => checkpoint(c.period, 'inputs_received')} loading={busy === 'inputs_received'} data-testid="cp-inputs">Mark inputs received</Button>
                ) : null}
                {m.key === 'attendance_lock' && !m.done && isAgency ? (
                  <Button size="sm" variant="primary" onClick={() => checkpoint(c.period, 'attendance_locked')} loading={busy === 'attendance_locked'} data-testid="cp-attendance"><Icon name="lock" size={14} /> Lock attendance</Button>
                ) : null}
                {m.key === 'client_approval' && !m.done && c.run?.status === 'processed' && !isAgency ? (
                  <Link to="/payroll?tab=runs" className="btn btn-secondary btn-sm">Approve in Payroll</Link>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      </Card>

      <div className="detail-grid">
        <Card title={`Next: ${periodTitle(next.period)}`} tour="svc-next" actions={<small className="muted">Pay date {fmtDate(next.pay_date)}</small>}>
          <ul className="svc-mini-list">
            {next.milestones.map((m) => (
              <li key={m.key}><span>{m.label}</span><span className="row" style={{ gap: 6 }}><OwnerBadge owner={m.owner} /><strong>{fmtDate(m.due)}</strong></span></li>
            ))}
          </ul>
        </Card>
        <Card title="Recent periods" tour="svc-history" padded={false}>
          <Table<PayrollCalendar>
            dense
            keyField="period"
            rows={history}
            empty="No earlier periods."
            columns={[
              { key: 'period', header: 'Period', render: (p) => <strong>{periodTitle(p.period)}</strong> },
              { key: 'pay', header: 'Pay date', render: (p) => fmtDate(p.pay_date) },
              { key: 'stage', header: 'Stage', render: (p) => <Badge tone={p.status === 'complete' ? 'success' : p.status === 'overdue' ? 'danger' : 'neutral'}>{p.stage}</Badge> },
              { key: 'net', header: 'Net pay', align: 'right', render: (p) => (p.run?.net != null ? fmtMoney(p.run.net, currency) : '—') },
            ]}
          />
        </Card>
      </div>
    </>
  );
}
function OwnerBadge({ owner }: { owner: 'client' | 'agency' }) {
  return <span className={`svc-owner owner-${owner}`}>{owner === 'client' ? 'Client' : 'Agency'}</span>;
}

/* ------------------------------------------------------------------ */
/* Compliance                                                          */
/* ------------------------------------------------------------------ */
function ComplianceTab() {
  const { isAgency, company, companyRef } = useAuth();
  const { refreshCounts } = useCounts();
  const toast = useToast();
  const { confirm, dialog } = useConfirm();
  const list = useFetch<Filing[]>(() => api.get('/api/services/compliance'), []);
  const [state, setState] = useState<'' | 'open' | Filing['state']>('open');
  const [editing, setEditing] = useState<Filing | null>(null);
  const form = useForm({ reference: '', amount: '', notes: '' });
  const [saving, setSaving] = useState(false);
  const currency = companyRef?.currency || company?.currency || 'INR';
  const rows = list.data || [];
  const n = (s: Filing['state']) => rows.filter((f) => f.state === s).length;
  const shown = rows.filter((f) => (state === 'open' ? ['overdue', 'due_soon', 'upcoming'].includes(f.state) : !state || f.state === state));
  const today = new Date().toISOString().slice(0, 10);
  const left = (d: string) => Math.round((Date.parse(d + 'T00:00:00Z') - Date.parse(today + 'T00:00:00Z')) / 86400000);

  const openFile = (f: Filing) => { setEditing(f); form.reset({ reference: f.reference || '', amount: f.amount != null ? String(f.amount) : '', notes: f.notes || '' }); };
  const update = async (f: Filing, body: any, ok: string) => {
    try {
      await api.put(`/api/services/compliance/${f.id}`, body);
      toast.success(ok);
      list.reload();
      refreshCounts();
      return true;
    } catch (e) {
      toast.error(e);
      return false;
    }
  };
  const saveFiled = async () => {
    if (!editing) return;
    if (!form.values.reference.trim()) return toast.error('Add the acknowledgement / challan reference');
    setSaving(true);
    const ok = await update(editing, { status: 'filed', reference: form.values.reference.trim(), amount: form.values.amount, notes: form.values.notes }, `${editing.name} (${editing.period}) marked as filed`);
    setSaving(false);
    if (ok) setEditing(null);
  };
  const notApplicable = async (f: Filing) => {
    if (await confirm(`Mark ${f.name} (${f.period}) as not applicable?`, 'Use this when the filing does not apply to this company for the period (for example no covered employees).', false)) update(f, { status: 'not_applicable' }, 'Marked as not applicable');
  };
  const reopen = async (f: Filing) => {
    if (await confirm(`Reopen ${f.name} (${f.period})?`, 'The filing goes back to pending; its reference is kept.', false)) update(f, { status: 'pending' }, 'Filing reopened');
  };

  return (
    <>
      {dialog}
      <div className="stat-strip" data-tour="svc-filing-stats">
        <Stat label="Overdue" value={list.data ? n('overdue') : '…'} icon="alert" color="var(--danger)" onClick={() => setState('overdue')} />
        <Stat label="Due within 7 days" value={list.data ? n('due_soon') : '…'} icon="clock" color="var(--warning)" onClick={() => setState('due_soon')} />
        <Stat label="Upcoming" value={list.data ? n('upcoming') : '…'} icon="calendar" color="var(--info)" onClick={() => setState('upcoming')} />
        <Stat label="Filed" value={list.data ? n('filed') : '…'} icon="check" color="var(--success)" onClick={() => setState('filed')} />
      </div>
      {!isAgency ? <div className="alert alert-info" style={{ marginBottom: 12 }} data-testid="svc-compliance-readonly">Your HR agency files these returns and records the acknowledgement references here. This list is read-only for your team.</div> : null}
      <div className="toolbar" data-tour="svc-filing-filters">
        <Pill active={state === 'open'} onClick={() => setState('open')}>Open</Pill>
        {FILING_STATES.map((s) => <Pill key={s} active={state === s} onClick={() => setState(s)}>{FILING_LABEL[s]} {list.data ? <span className="muted">{n(s)}</span> : null}</Pill>)}
        <Pill active={!state} onClick={() => setState('')}>All</Pill>
      </div>
      <Card padded={false}>
        <Table<Filing>
          tour="svc-filings"
          loading={list.loading && !list.data}
          rows={shown}
          empty="No filings in this view."
          columns={[
            { key: 'name', header: 'Filing', render: (f) => (
              <div className="ops-cell-title" data-testid="filing-row" data-code={f.code} data-period={f.period}>
                <strong>{f.name}</strong>
                <small className="muted">{f.description || f.code} · {cap(f.frequency)}</small>
              </div>
            ) },
            { key: 'authority', header: 'Authority', render: (f) => f.authority || '—' },
            { key: 'period', header: 'Period', render: (f) => <span className="mono">{f.period}</span> },
            { key: 'due', header: 'Due', render: (f) => (
              <div className="ops-cell-title">
                <span>{fmtDate(f.due_date)}</span>
                {f.status === 'pending' ? <small className={left(f.due_date) < 0 ? 'text-danger' : 'muted'}>{daysPhrase(left(f.due_date)).toLowerCase()}</small> : null}
              </div>
            ) },
            { key: 'state', header: 'State', render: (f) => <Badge tone={FILING_TONE[f.state]}>{FILING_LABEL[f.state]}</Badge> },
            { key: 'reference', header: 'Reference', render: (f) => (f.reference ? (
              <div className="ops-cell-title">
                <span className="mono" data-testid="filing-ref">{f.reference}</span>
                <small className="muted">{[f.amount != null ? fmtMoney(f.amount, currency) : null, f.filed_by_name, f.filed_at ? fmtDate(f.filed_at) : null].filter(Boolean).join(' · ')}</small>
              </div>
            ) : <span className="muted">—</span>) },
            ...(isAgency ? [{ key: 'actions', header: '', align: 'right' as const, render: (f: Filing) => (
              <div className="row end" style={{ gap: 6, flexWrap: 'nowrap' }}>
                {f.status === 'pending' ? (
                  <>
                    <Button size="sm" variant="primary" onClick={() => openFile(f)} data-testid="filing-file">Mark filed</Button>
                    <Button size="sm" variant="ghost" onClick={() => notApplicable(f)} data-testid="filing-na">N/A</Button>
                  </>
                ) : (
                  <>
                    {f.status === 'filed' ? <Button size="sm" variant="ghost" onClick={() => openFile(f)} data-testid="filing-edit">Edit</Button> : null}
                    <Button size="sm" variant="ghost" onClick={() => reopen(f)} data-testid="filing-reopen">Reopen</Button>
                  </>
                )}
              </div>
            ) }] : []),
          ]}
        />
      </Card>

      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing ? `Mark as filed: ${editing.name}` : ''}
        testId="filing-modal"
        footer={<><Button onClick={() => setEditing(null)}>Cancel</Button><Button variant="primary" onClick={saveFiled} loading={saving} data-testid="filing-save">Save as filed</Button></>}
      >
        {editing ? (
          <div className="svc-form">
            <p className="muted" style={{ margin: 0 }}>{editing.authority} · period {editing.period} · due {fmtDate(editing.due_date)}</p>
            <Field label="Acknowledgement / challan reference" required>
              <Input {...form.bind('reference')} placeholder="e.g. TRRN 1234567890" data-testid="filing-reference" autoFocus />
            </Field>
            <Field label={`Amount paid (${currency})`} hint="Optional">
              <Input type="number" min="0" step="0.01" {...form.bind('amount')} data-testid="filing-amount" />
            </Field>
            <Field label="Notes" hint="Optional">
              <Textarea rows={3} {...form.bind('notes')} data-testid="filing-notes" />
            </Field>
          </div>
        ) : null}
      </Modal>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Requests                                                            */
/* ------------------------------------------------------------------ */
function RequestsTab() {
  const { isAgency, agency } = useAuth();
  const { refreshCounts } = useCounts();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [scope, setScope] = useState<'active' | 'all'>('active');
  const list = useFetch<ServiceRequest[]>(() => api.get('/api/services/requests'), []);
  const [creating, setCreating] = useState(false);
  const form = useForm({ category: 'payroll', priority: 'normal', subject: '', description: '' });
  const [saving, setSaving] = useState(false);
  const rows = list.data || [];
  const shown = scope === 'active' ? rows.filter(isActive) : rows;
  const openId = params.get('id') ? Number(params.get('id')) : null;
  const setOpen = (id: number | null) => setParams((p) => { const n = new URLSearchParams(p); n.set('tab', 'requests'); if (id) n.set('id', String(id)); else n.delete('id'); return n; }, { replace: true });

  const submit = async () => {
    if (!form.values.subject.trim()) return toast.error('Add a subject');
    setSaving(true);
    try {
      const r = await api.post<ServiceRequest>('/api/services/requests', form.values);
      toast.success(`Request ${r.number} raised`);
      setCreating(false);
      form.reset();
      list.reload();
      refreshCounts();
    } catch (e) {
      toast.error(e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="toolbar row between">
        <div className="row" data-tour="svc-request-filters">
          <Pill active={scope === 'active'} onClick={() => setScope('active')}>Active {list.data ? <span className="muted">{rows.filter(isActive).length}</span> : null}</Pill>
          <Pill active={scope === 'all'} onClick={() => setScope('all')}>All {list.data ? <span className="muted">{rows.length}</span> : null}</Pill>
        </div>
        <Button variant="primary" onClick={() => setCreating(true)} data-tour="svc-new-request" data-testid="sr-new"><Icon name="plus" size={15} /> New request</Button>
      </div>
      <Card padded={false}>
        <Table<ServiceRequest>
          tour="svc-requests"
          loading={list.loading && !list.data}
          rows={shown}
          onRowClick={(r) => setOpen(r.id)}
          empty={<EmptyState title={scope === 'active' ? 'No open requests' : 'No requests yet'} description="Raise a request whenever you need something from the agency." />}
          columns={[
            { key: 'subject', header: 'Request', render: (r) => (
              <div className="ops-cell-title" data-testid="sr-row">
                <span className="ops-sr-number">{r.number}</span>
                <strong>{r.subject}</strong>
                <small className="muted">{cap(r.category)} · {r.raised_by_name || 'HR'} · {fmtDate(r.created_at)} · {r.comments} repl{r.comments === 1 ? 'y' : 'ies'}</small>
              </div>
            ) },
            { key: 'priority', header: 'Priority', render: (r) => <PriorityBadge priority={r.priority} /> },
            { key: 'status', header: 'Status', render: (r) => <SrStatusBadge status={r.status} /> },
            { key: 'sla', header: 'SLA', render: (r) => <SlaChip r={r} /> },
            { key: 'assignee', header: 'Handled by', render: (r) => r.assignee_name || <span className="muted">Unassigned</span> },
          ]}
        />
      </Card>

      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        title="New request to the agency"
        testId="sr-new-modal"
        footer={<><Button onClick={() => setCreating(false)}>Cancel</Button><Button variant="primary" onClick={submit} loading={saving} data-testid="sr-submit">Raise request</Button></>}
      >
        <div className="svc-form">
          <div className="grid grid-2">
            <Field label="Category">
              <Select {...form.bind('category')} data-testid="sr-category">
                {SR_CATEGORIES.map((c) => <option key={c} value={c}>{cap(c)}</option>)}
              </Select>
            </Field>
            <Field label="Priority" hint="Sets the response SLA">
              <Select {...form.bind('priority')} data-testid="sr-new-priority">
                {PRIORITIES.map((p) => <option key={p} value={p}>{cap(p)}</option>)}
              </Select>
            </Field>
          </div>
          <Field label="Subject" required>
            <Input {...form.bind('subject')} maxLength={160} placeholder="e.g. Add a new joiner to this month's payroll" data-testid="sr-subject" />
          </Field>
          <Field label="Details">
            <Textarea rows={5} {...form.bind('description')} placeholder="Names, dates, amounts and anything the agency needs to act on it." data-testid="sr-description" />
          </Field>
        </div>
      </Modal>

      <RequestDrawer
        base="/api/services"
        id={openId}
        agencySide={isAgency}
        myAgencyId={agency?.id}
        onClose={() => setOpen(null)}
        onChanged={() => { list.reload(); refreshCounts(); }}
      />
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Invoices                                                            */
/* ------------------------------------------------------------------ */
function InvoicesTab() {
  const list = useFetch<Invoice[]>(() => api.get('/api/services/invoices'), []);
  const rows = list.data || [];
  const money = (minor: number, i: { exponent: number; currency: string }) => fmtMoney(minor / 10 ** i.exponent, i.currency);
  const cur = rows[0];
  const outstanding = rows.filter((i) => i.status === 'issued').reduce((a, i) => a + (i.total_minor - i.paid_minor), 0);
  const overdue = rows.filter((i) => i.overdue).reduce((a, i) => a + (i.total_minor - i.paid_minor), 0);

  return (
    <>
      <div className="stat-strip" data-tour="svc-invoice-stats">
        <Stat label="Outstanding" value={list.data ? (cur ? money(outstanding, cur) : '—') : '…'} icon="wallet" color="var(--info)" hint={`${rows.filter((i) => i.status === 'issued').length} unpaid invoice(s)`} />
        <Stat label="Past due" value={list.data ? (cur ? money(overdue, cur) : '—') : '…'} icon="alert" color="var(--danger)" hint={`${rows.filter((i) => i.overdue).length} overdue`} />
        <Stat label="Invoices" value={list.data ? rows.length : '…'} icon="file" color="var(--brand)" hint="Issued by your agency" />
      </div>
      <Card padded={false}>
        <Table<Invoice>
          tour="svc-invoices"
          loading={list.loading && !list.data}
          rows={rows}
          empty={<EmptyState title="No invoices yet" description="Invoices from your HR agency appear here once issued." />}
          columns={[
            { key: 'number', header: 'Invoice', render: (i) => <div className="ops-cell-title" data-testid="invoice-row"><strong className="mono">{i.number}</strong><small className="muted">{i.entity_name}</small></div> },
            { key: 'period', header: 'Period', render: (i) => (/^\d{4}-\d{2}$/.test(i.period) ? periodTitle(i.period) : i.period) },
            { key: 'issue', header: 'Issued', render: (i) => fmtDate(i.issue_date) },
            { key: 'due', header: 'Due', render: (i) => <span className={i.overdue ? 'text-danger' : ''}>{fmtDate(i.due_date)}</span> },
            { key: 'total', header: 'Total', align: 'right', render: (i) => <strong>{money(i.total_minor, i)}</strong> },
            { key: 'paid', header: 'Paid', align: 'right', render: (i) => money(i.paid_minor, i) },
            { key: 'status', header: 'Status', render: (i) => (i.overdue ? <Badge tone="danger">Overdue</Badge> : <Badge tone={i.status === 'paid' ? 'success' : i.status === 'void' ? 'neutral' : 'info'}>{cap(i.status)}</Badge>) },
            { key: 'pdf', header: '', align: 'right', render: (i) => (
              <Button size="sm" variant="ghost" onClick={() => window.open(apiUrl(`/api/services/invoices/${i.id}/pdf`), '_blank', 'noopener')} data-testid="invoice-pdf"><Icon name="download" size={14} /> PDF</Button>
            ) },
          ]}
        />
      </Card>
    </>
  );
}
