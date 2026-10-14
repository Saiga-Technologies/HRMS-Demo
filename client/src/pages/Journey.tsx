import React, { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { usePageTour } from '../lib/tour';
import { fmtDate, fmtDateTime, fullName, label } from '../lib/format';
import { Badge, Button, Card, Checkbox, EmptyState, Field, Input, Modal, PageHeader, SearchInput, Select, Spinner, StatusBadge, Table, Tabs, Textarea, useConfirm, useFetch, useForm, useToast } from '../components/ui';

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */
type Tab = 'overview' | 'mine' | 'templates';
type StageStatus = 'pending' | 'in_progress' | 'completed' | 'skipped';
interface Template { id: number; name: string; description?: string | null; sort_order: number; color: string; icon: string; owner_role: string; sla_days?: number | null; active: number }
interface ChecklistItem { label: string; done: boolean }
interface Stage { id: number; employee_id: number; template_id?: number | null; name: string; description?: string | null; sort_order: number; color: string; icon: string; status: StageStatus; started_at?: string | null; completed_at?: string | null; owner?: string | null; notes?: string | null; checklist: ChecklistItem[] }
interface Summary { total: number; completed: number; percent: number; current_stage: string | null }
interface JourneyEmployee { id: number; first_name: string; last_name: string; employee_code: string; join_date?: string | null; status: string; vacancy_id?: number | null; vacancy_title?: string | null; vacancy_opened_at?: string | null }
interface JourneyResp { employee: JourneyEmployee; stages: Stage[]; summary: Summary }
interface OverviewRow { id: number; employee_code: string; first_name: string; last_name: string; status: string; join_date?: string | null; department_name?: string | null; position_title?: string | null; journey: Summary }

const OWNER_ROLES = ['hr', 'manager', 'employee', 'finance', 'it', 'admin', 'leadership'];
const DEFAULT_COLOR = '#2563eb';

const TOUR = [
  { element: '[data-tour="journey-tabs"]', title: 'Employee journey', description: 'Every employee walks the same configurable path: from the vacancy that was raised for them, through hiring and onboarding, to probation and confirmation.' },
  { element: '[data-tour="journey-overview"]', title: 'Everyone at a glance', description: 'See which stage each employee is on and how far along they are. Click a row to open their journey.' },
  { element: '[data-tour="journey-header"]', title: 'Progress', description: 'The header shows the person, the vacancy they were hired against and overall completion.' },
  { element: '[data-tour="journey-stepper"]', title: 'The path', description: 'A compact stepper, coloured by stage. Click any step to jump to it below.' },
  { element: '[data-tour="journey-timeline"]', title: 'Stage details', description: 'Each stage has an owner, dates, notes and a checklist. Employees can tick their own checklist items and add notes.' },
  { element: '[data-tour="journey-actions"]', title: 'Run the journey', description: 'HR starts, completes, skips or resets stages, adds custom stages, reorders them, or re-applies the templates after changing them.' },
  { element: '[data-tour="journey-templates"]', title: 'Stage templates', description: 'Define the 10–15 stages every new employee gets automatically. Reorder them, set an owner role and an SLA in days.' },
];

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */
export default function Journey() {
  usePageTour('Employee journey', TOUR);
  const { isHr, isManager, user } = useAuth();
  const [params, setParams] = useSearchParams();
  const employeeParam = params.get('employee');
  const employeeId = employeeParam ? Number(employeeParam) : null;
  const tabParam = params.get('tab');
  const tab: Tab = isHr ? (tabParam === 'mine' || tabParam === 'templates' ? tabParam : 'overview') : 'mine';
  const setParam = (k: string, v: string | null) => setParams((p) => { const n = new URLSearchParams(p); if (v) n.set(k, v); else n.delete(k); return n; });
  const setTab = (k: string) => setParams((p) => { const n = new URLSearchParams(p); n.set('tab', k); n.delete('employee'); return n; });

  const myId = user?.employee_id ?? null;
  // Non-HR: ?employee= lets a manager open one of their reports (the API enforces access); otherwise their own journey.
  const viewId = isHr ? (tab === 'mine' ? myId : employeeId) : employeeId || myId;

  return (
    <>
      <PageHeader title="Employee journey" subtitle="From vacancy to confirmed employee: a customisable, step-by-step path for every hire." />
      {isHr ? (
        <Tabs tour="journey-tabs" value={tab} onChange={setTab} tabs={[{ key: 'overview', label: 'Overview' }, { key: 'mine', label: 'My journey' }, { key: 'templates', label: 'Stage templates' }]} />
      ) : (
        <Tabs tour="journey-tabs" value="mine" onChange={() => setParam('employee', null)} tabs={[{ key: 'mine', label: employeeId && employeeId !== myId ? 'Team member journey' : 'My journey' }]} />
      )}

      {tab === 'templates' && isHr ? (
        <TemplatesTab />
      ) : tab === 'overview' && isHr && !employeeId ? (
        <OverviewTab onOpen={(id) => setParam('employee', String(id))} />
      ) : viewId ? (
        <EmployeeJourney
          key={viewId}
          employeeId={viewId}
          canManage={isHr}
          canTick={isHr || isManager || viewId === myId}
          onBack={isHr && tab === 'overview' ? () => setParam('employee', null) : !isHr && employeeId && employeeId !== myId ? () => setParam('employee', null) : undefined}
        />
      ) : (
        <Card><EmptyState title="No employee record" description="Your login is not linked to an employee record, so there is no journey to show." icon="🧭" /></Card>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Overview (HR)                                                       */
/* ------------------------------------------------------------------ */
function OverviewTab({ onOpen }: { onOpen: (id: number) => void }) {
  const rows = useFetch<OverviewRow[]>(() => api.get('/api/journey/overview'), []);
  const [q, setQ] = useState('');
  const [onlyActive, setOnlyActive] = useState(false);
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (rows.data || []).filter((r) => (!onlyActive || r.journey.percent < 100) && (!needle || fullName(r).toLowerCase().includes(needle) || r.employee_code.toLowerCase().includes(needle) || (r.department_name || '').toLowerCase().includes(needle) || (r.journey.current_stage || '').toLowerCase().includes(needle)));
  }, [rows.data, q, onlyActive]);
  const inFlight = (rows.data || []).filter((r) => r.journey.total && r.journey.percent < 100).length;
  return (
    <>
      <div className="toolbar">
        <SearchInput value={q} onChange={setQ} placeholder="Search employee, department or stage…" />
        <Checkbox label="Only journeys in progress" checked={onlyActive} onChange={(e) => setOnlyActive(e.target.checked)} />
        <span className="muted">{inFlight} in progress · {(rows.data || []).length} total</span>
      </div>
      <Card padded={false} tour="journey-overview">
        <Table<OverviewRow>
          loading={rows.loading && !rows.data}
          rows={filtered}
          onRowClick={(r) => onOpen(r.id)}
          empty="No employees found."
          columns={[
            { key: 'name', header: 'Employee', render: (r) => (<span><Link to={`/employees/${r.id}`} onClick={(e) => e.stopPropagation()}><strong>{fullName(r)}</strong></Link> <span className="muted mono">{r.employee_code}</span></span>) },
            { key: 'department_name', header: 'Department', render: (r) => r.department_name || '—' },
            { key: 'position_title', header: 'Position', render: (r) => r.position_title || '—' },
            { key: 'join_date', header: 'Joined', render: (r) => fmtDate(r.join_date) },
            { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} label={label(r.status)} /> },
            { key: 'current', header: 'Current stage', render: (r) => r.journey.current_stage || (r.journey.total ? <span className="muted">All done</span> : <span className="muted">No stages</span>) },
            { key: 'progress', header: 'Progress', width: '220px', render: (r) => (
              <div className="progress-wrap">
                <div className="progress" title={`${r.journey.percent}%`}><span style={{ width: `${r.journey.percent}%` }} /></div>
                <span className="muted num" style={{ whiteSpace: 'nowrap' }}>{r.journey.completed} of {r.journey.total}</span>
              </div>
            ) },
          ]}
        />
      </Card>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* One employee's journey                                              */
/* ------------------------------------------------------------------ */
function EmployeeJourney({ employeeId, canManage, canTick, onBack }: { employeeId: number; canManage: boolean; canTick: boolean; onBack?: () => void }) {
  const toast = useToast();
  const { confirm, dialog } = useConfirm();
  const j = useFetch<JourneyResp>(() => api.get(`/api/journey/employee/${employeeId}`), [employeeId]);
  const [editStage, setEditStage] = useState<Stage | 'new' | null>(null);
  const [busy, setBusy] = useState<number | 'all' | null>(null);
  const stages = j.data?.stages || [];
  const emp = j.data?.employee;
  const summary = j.data?.summary;

  const mutate = async (id: number | 'all', fn: () => Promise<any>, msg?: string) => {
    setBusy(id);
    try {
      await fn();
      if (msg) toast.success(msg);
      await j.reload();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(null);
    }
  };
  const setStatus = (s: Stage, status: StageStatus) => mutate(s.id, () => api.put(`/api/journey/stages/${s.id}`, { status }), `${s.name}: ${label(status)}`);
  const toggleItem = async (s: Stage, idx: number) => {
    const checklist = s.checklist.map((c, i) => (i === idx ? { ...c, done: !c.done } : c));
    j.setData((d) => (d ? { ...d, stages: d.stages.map((x) => (x.id === s.id ? { ...x, checklist } : x)) } : d));
    try {
      await api.put(`/api/journey/stages/${s.id}`, { checklist });
    } catch (err) {
      toast.error(err);
      j.reload();
    }
  };
  const move = (s: Stage, dir: -1 | 1) => {
    const ids = stages.map((x) => x.id);
    const i = ids.indexOf(s.id);
    const t = i + dir;
    if (t < 0 || t >= ids.length) return;
    [ids[i], ids[t]] = [ids[t], ids[i]];
    mutate(s.id, () => api.put(`/api/journey/employee/${employeeId}/reorder`, { ids }));
  };
  const remove = async (s: Stage) => {
    if (!(await confirm('Delete stage?', `"${s.name}" and its checklist will be removed from this journey.`))) return;
    mutate(s.id, () => api.delete(`/api/journey/stages/${s.id}`), 'Stage deleted');
  };
  const reapply = async () => {
    if (!(await confirm('Re-apply stage templates?', 'Stages from the current templates that are missing here will be added and ordered like the templates. Existing progress and custom stages are kept.', false))) return;
    mutate('all', () => api.post(`/api/journey/employee/${employeeId}/apply-templates`, { remove_others: false }), 'Templates applied');
  };
  const scrollTo = (s: Stage) => document.getElementById(`stage-${s.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  const barStyle = (s: Stage): React.CSSProperties => {
    const c = s.color || DEFAULT_COLOR;
    if (s.status === 'completed') return { background: c };
    if (s.status === 'in_progress') return { background: `linear-gradient(90deg, ${c} 0 55%, ${c}44 55% 100%)` };
    if (s.status === 'skipped') return { background: `repeating-linear-gradient(45deg, ${c}55 0 4px, transparent 4px 8px)` };
    return {};
  };

  if (j.loading && !j.data) return <Spinner />;
  if (j.error) return <Card><EmptyState title="Could not load this journey" description={j.error} action={onBack ? <Button onClick={onBack}>← Back</Button> : undefined} /></Card>;
  if (!emp || !summary) return null;

  return (
    <>
      {dialog}
      <Card tour="journey-header" className="journey-header-card">
        <div className="journey-head">
          <div>
            {onBack ? <Button variant="link" size="sm" onClick={onBack} style={{ paddingLeft: 0 }}>← Back to overview</Button> : null}
            <div className="row" style={{ gap: 8 }}>
              <h2 style={{ margin: 0 }}><Link to={`/employees/${emp.id}`}>{fullName(emp)}</Link></h2>
              <span className="muted mono">{emp.employee_code}</span>
              <StatusBadge status={emp.status} label={label(emp.status)} />
            </div>
            <div className="muted" style={{ marginTop: 4 }}>
              Joined {fmtDate(emp.join_date)}
              {emp.vacancy_title ? <> · Hired against vacancy <strong>{emp.vacancy_title}</strong>{emp.vacancy_opened_at ? ` (raised ${fmtDate(emp.vacancy_opened_at)})` : ''}</> : <> · <span>No vacancy linked</span></>}
              {summary.current_stage ? <> · Current stage: <strong>{summary.current_stage}</strong></> : summary.total ? ' · Journey complete' : null}
            </div>
          </div>
          <div className="stack" style={{ gap: 6, minWidth: 220 }}>
            <div className="row between"><span className="muted">Overall progress</span><strong className="num">{summary.percent}%</strong></div>
            <div className="progress"><span style={{ width: `${summary.percent}%` }} /></div>
            <div className="muted">{summary.completed} of {summary.total} stage{summary.total === 1 ? '' : 's'} completed</div>
          </div>
        </div>
        {canManage ? (
          <div className="row journey-toolbar" data-tour="journey-actions">
            <Button variant="primary" size="sm" data-testid="stage-add" onClick={() => setEditStage('new')}>+ Add custom stage</Button>
            <Button size="sm" loading={busy === 'all'} onClick={reapply}>Re-apply templates</Button>
            <span className="help">Changed the templates? Re-apply to add any new stages to this employee.</span>
          </div>
        ) : null}
      </Card>

      {stages.length === 0 ? (
        <Card><EmptyState title="No journey stages yet" description={canManage ? 'Apply the stage templates or add a custom stage to start this employee\'s journey.' : 'HR has not set up your journey yet.'} icon="🧭" action={canManage ? <Button variant="primary" onClick={reapply} loading={busy === 'all'}>Apply stage templates</Button> : undefined} /></Card>
      ) : (
        <>
          <Card padded={false}>
            <div className="journey-horizontal" data-tour="journey-stepper" style={{ padding: '14px 16px 10px' }}>
              {stages.map((s, i) => (
                <div key={s.id} className={`journey-chip ${s.status}`} role="button" tabIndex={0} onClick={() => scrollTo(s)} onKeyDown={(e) => e.key === 'Enter' && scrollTo(s)} title={`${s.name} — ${label(s.status)}`}>
                  <span className="bar" style={barStyle(s)} />
                  <span className="journey-chip-name">{i + 1}. {s.name}</span>
                  <span className="muted">{label(s.status)}</span>
                </div>
              ))}
            </div>
          </Card>

          <div className="journey" data-tour="journey-timeline">
            {stages.map((s, i) => (
              <div key={s.id} id={`stage-${s.id}`} className={`journey-step ${s.status}`} data-testid="journey-stage">
                <div className="journey-dot" style={{ background: s.color || DEFAULT_COLOR }}>{i + 1}</div>
                <div className="journey-card">
                  <div className="row between" style={{ alignItems: 'flex-start' }}>
                    <div className="row" style={{ gap: 8 }}>
                      <strong>{s.name}</strong>
                      {s.icon && s.icon !== 'flag' ? <span className="chip">{s.icon}</span> : null}
                      <StatusBadge status={s.status} label={label(s.status)} />
                    </div>
                    {canManage ? (
                      <div className="row" style={{ gap: 2 }}>
                        <Button size="sm" variant="ghost" aria-label="Move up" disabled={i === 0 || busy === s.id} onClick={() => move(s, -1)}>↑</Button>
                        <Button size="sm" variant="ghost" aria-label="Move down" disabled={i === stages.length - 1 || busy === s.id} onClick={() => move(s, 1)}>↓</Button>
                        <Button size="sm" variant="ghost" onClick={() => setEditStage(s)} data-testid="stage-edit">Edit</Button>
                        <Button size="sm" variant="ghost" aria-label="Delete stage" onClick={() => remove(s)}>🗑</Button>
                      </div>
                    ) : canTick ? (
                      <Button size="sm" variant="ghost" onClick={() => setEditStage(s)}>Notes</Button>
                    ) : null}
                  </div>
                  {s.description ? <p className="muted" style={{ margin: '6px 0 0' }}>{s.description}</p> : null}
                  <div className="journey-meta muted">
                    Owner: <strong>{s.owner ? label(s.owner) : '—'}</strong>
                    {' · '}Started: {fmtDateTime(s.started_at)}
                    {' · '}Completed: {fmtDateTime(s.completed_at)}
                  </div>
                  {s.notes ? <div className="journey-notes">{s.notes}</div> : null}
                  {s.checklist.length ? (
                    <ul className="journey-checklist">
                      {s.checklist.map((c, idx) => (
                        <li key={idx} className={c.done ? 'done' : ''}>
                          <Checkbox label={c.label} checked={!!c.done} disabled={!canTick} onChange={() => toggleItem(s, idx)} />
                        </li>
                      ))}
                      <li className="muted" style={{ fontSize: 12.5 }}>{s.checklist.filter((c) => c.done).length} of {s.checklist.length} done</li>
                    </ul>
                  ) : null}
                  {canManage ? (
                    <div className="row journey-actions">
                      {s.status === 'pending' ? <Button size="sm" variant="primary" loading={busy === s.id} onClick={() => setStatus(s, 'in_progress')} data-testid="stage-start">Start</Button> : null}
                      {s.status === 'pending' || s.status === 'in_progress' ? <Button size="sm" variant={s.status === 'in_progress' ? 'primary' : 'secondary'} loading={busy === s.id} onClick={() => setStatus(s, 'completed')} data-testid="stage-complete">Complete</Button> : null}
                      {s.status === 'pending' || s.status === 'in_progress' ? <Button size="sm" loading={busy === s.id} onClick={() => setStatus(s, 'skipped')}>Skip</Button> : null}
                      {s.status !== 'pending' ? <Button size="sm" variant="ghost" loading={busy === s.id} onClick={() => setStatus(s, 'pending')}>Reset to pending</Button> : null}
                    </div>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {editStage ? (
        <StageModal employeeId={employeeId} stage={editStage === 'new' ? null : editStage} full={canManage} onClose={() => setEditStage(null)} onSaved={() => { setEditStage(null); j.reload(); }} />
      ) : null}
    </>
  );
}

function StageModal({ employeeId, stage, full, onClose, onSaved }: { employeeId: number; stage: Stage | null; full: boolean; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const f = useForm({ name: stage?.name || '', description: stage?.description || '', color: stage?.color || DEFAULT_COLOR, icon: stage?.icon || 'flag', owner: stage?.owner || 'hr', notes: stage?.notes || '', status: stage?.status || 'pending' });
  const [checklist, setChecklist] = useState<ChecklistItem[]>(stage?.checklist || []);
  const [newItem, setNewItem] = useState('');
  const addItem = () => {
    const t = newItem.trim();
    if (!t) return;
    setChecklist([...checklist, { label: t, done: false }]);
    setNewItem('');
  };
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (full && !f.values.name.trim()) return toast.error('Name is required');
    setBusy(true);
    try {
      const v = f.values;
      const body = full
        ? { name: v.name.trim(), description: v.description, color: v.color, icon: v.icon.trim() || 'flag', owner: v.owner, notes: v.notes, status: v.status, checklist }
        : { notes: v.notes, checklist };
      if (stage) await api.put(`/api/journey/stages/${stage.id}`, body);
      else await api.post(`/api/journey/employee/${employeeId}/stages`, body);
      toast.success(stage ? 'Stage updated' : 'Stage added');
      onSaved();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open title={stage ? (full ? 'Edit stage' : `${stage.name}: notes and checklist`) : 'Add custom stage'} onClose={onClose} testId="stage-modal"
      footer={<>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" loading={busy} onClick={save as any} data-testid="stage-save">Save</Button>
      </>}>
      <form onSubmit={save} className="form-grid">
        {full ? (
          <>
            <Field label="Name" required className="span-2"><Input {...f.bind('name')} required autoFocus placeholder="e.g. Laptop handover" /></Field>
            <Field label="Description" className="span-2"><Textarea rows={2} {...f.bind('description')} /></Field>
            <Field label="Colour"><Input type="color" {...f.bind('color')} /></Field>
            <Field label="Icon (short text)" hint="A word or emoji shown next to the name, e.g. 💻 or 'docs'."><Input {...f.bind('icon')} maxLength={24} /></Field>
            <Field label="Owner">
              <Select {...f.bind('owner')}>
                {OWNER_ROLES.map((r) => <option key={r} value={r}>{label(r)}</option>)}
                {f.values.owner && !OWNER_ROLES.includes(f.values.owner) ? <option value={f.values.owner}>{f.values.owner}</option> : null}
              </Select>
            </Field>
            <Field label="Status">
              <Select {...f.bind('status')}>
                {(['pending', 'in_progress', 'completed', 'skipped'] as StageStatus[]).map((s) => <option key={s} value={s}>{label(s)}</option>)}
              </Select>
            </Field>
          </>
        ) : null}
        <Field label="Notes" className="span-2"><Textarea rows={3} {...f.bind('notes')} autoFocus={!full} placeholder="Anything worth recording about this stage…" /></Field>
        <div className="span-2">
          <div className="field-label">Checklist</div>
          {checklist.length === 0 ? <div className="help">No items yet.</div> : null}
          <ul className="journey-checklist">
            {checklist.map((c, i) => (
              <li key={i} className="row" style={{ flexWrap: 'nowrap' }}>
                <input type="checkbox" checked={!!c.done} onChange={(e) => setChecklist(checklist.map((x, k) => (k === i ? { ...x, done: e.target.checked } : x)))} aria-label="Done" />
                <Input value={c.label} onChange={(e) => setChecklist(checklist.map((x, k) => (k === i ? { ...x, label: e.target.value } : x)))} />
                <Button size="sm" variant="ghost" aria-label="Remove item" onClick={() => setChecklist(checklist.filter((_, k) => k !== i))} type="button">✕</Button>
              </li>
            ))}
          </ul>
          <div className="row" style={{ flexWrap: 'nowrap', marginTop: 6 }}>
            <Input value={newItem} onChange={(e) => setNewItem(e.target.value)} placeholder="New checklist item" onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addItem(); } }} />
            <Button size="sm" type="button" onClick={addItem} data-testid="checklist-add">Add</Button>
          </div>
        </div>
      </form>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Stage templates (HR)                                                */
/* ------------------------------------------------------------------ */
function TemplatesTab() {
  const toast = useToast();
  const templates = useFetch<Template[]>(() => api.get('/api/journey/templates'), []);
  const [edit, setEdit] = useState<Partial<Template> | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const list = templates.data || [];
  const move = async (t: Template, dir: -1 | 1) => {
    const ids = list.map((x) => x.id);
    const i = ids.indexOf(t.id);
    const k = i + dir;
    if (k < 0 || k >= ids.length) return;
    [ids[i], ids[k]] = [ids[k], ids[i]];
    setBusyId(t.id);
    try {
      const updated = await api.put<Template[]>('/api/journey/templates/reorder', { ids });
      templates.setData(updated);
    } catch (err) {
      toast.error(err);
    } finally {
      setBusyId(null);
    }
  };
  const activeCount = list.filter((t) => t.active).length;
  return (
    <>
      <div className="callout" data-tour="journey-templates">
        <strong>Every new employee automatically gets these stages, in this order.</strong> We recommend 10–15 stages that follow the hire from the vacancy being raised to settling into their current role — for example: Vacancy raised → Requisition approval → Budget &amp; accounting → Job description → Publishing → Sourcing &amp; screening → Interviews → Offer → Document collection → Background verification → Onboarding → Probation → Confirmation → Current role. Inactive stages are skipped for new hires; existing journeys are not changed until you re-apply templates on them.
      </div>
      <div className="toolbar">
        <span className="muted">{activeCount} active of {list.length} stage{list.length === 1 ? '' : 's'}</span>
        <span style={{ marginLeft: 'auto' }}>
          <Button variant="primary" data-testid="template-add" onClick={() => setEdit({ color: DEFAULT_COLOR, icon: 'flag', owner_role: 'hr', active: 1 })}>+ Add stage template</Button>
        </span>
      </div>
      <Card padded={false}>
        <Table<Template>
          loading={templates.loading && !templates.data}
          rows={list}
          onRowClick={(t) => setEdit(t)}
          empty="No stage templates. Add one to start building the journey."
          columns={[
            { key: 'order', header: '#', width: '50px', render: (t) => <span className="muted num">{list.indexOf(t) + 1}</span> },
            { key: 'name', header: 'Stage', render: (t) => (<span><span className="color-swatch" style={{ background: t.color || DEFAULT_COLOR }} /><strong>{t.name}</strong>{t.icon && t.icon !== 'flag' ? <span className="muted"> {t.icon}</span> : null}</span>) },
            { key: 'description', header: 'Description', render: (t) => <span className="muted">{t.description || '—'}</span> },
            { key: 'owner_role', header: 'Owner', render: (t) => label(t.owner_role) },
            { key: 'sla_days', header: 'SLA', align: 'right', render: (t) => (t.sla_days != null ? `${t.sla_days} day${t.sla_days === 1 ? '' : 's'}` : '—') },
            { key: 'active', header: 'Status', render: (t) => <Badge tone={t.active ? 'success' : 'neutral'}>{t.active ? 'Active' : 'Inactive'}</Badge> },
            { key: 'reorder', header: 'Order', width: '90px', render: (t) => (
              <span className="row" style={{ gap: 2 }} onClick={(e) => e.stopPropagation()}>
                <Button size="sm" variant="ghost" aria-label="Move up" disabled={list.indexOf(t) === 0 || busyId === t.id} onClick={() => move(t, -1)}>↑</Button>
                <Button size="sm" variant="ghost" aria-label="Move down" disabled={list.indexOf(t) === list.length - 1 || busyId === t.id} onClick={() => move(t, 1)}>↓</Button>
              </span>
            ) },
          ]}
        />
      </Card>
      {edit ? <TemplateModal tpl={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); templates.reload(); }} /> : null}
    </>
  );
}

function TemplateModal({ tpl, onClose, onSaved }: { tpl: Partial<Template>; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const { confirm, dialog } = useConfirm();
  const [busy, setBusy] = useState(false);
  const f = useForm({ name: tpl.name || '', description: tpl.description || '', color: tpl.color || DEFAULT_COLOR, icon: tpl.icon || 'flag', owner_role: tpl.owner_role || 'hr', sla_days: tpl.sla_days ?? '', active: tpl.active ?? 1 });
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!f.values.name.trim()) return toast.error('Name is required');
    setBusy(true);
    try {
      const v = f.values;
      const body = { name: v.name.trim(), description: v.description, color: v.color, icon: v.icon.trim() || 'flag', owner_role: v.owner_role, sla_days: v.sla_days === '' ? null : Number(v.sla_days), active: Number(v.active) };
      if (tpl.id) await api.put(`/api/journey/templates/${tpl.id}`, body);
      else await api.post('/api/journey/templates', body);
      toast.success(tpl.id ? 'Template updated' : 'Template added');
      onSaved();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!(await confirm('Delete stage template?', 'Existing employee journeys keep their copy of this stage; new employees will no longer get it.'))) return;
    try {
      await api.delete(`/api/journey/templates/${tpl.id}`);
      toast.success('Template deleted');
      onSaved();
    } catch (err) {
      toast.error(err);
    }
  };
  return (
    <Modal open title={tpl.id ? 'Edit stage template' : 'New stage template'} onClose={onClose} testId="template-modal"
      footer={<>
        {tpl.id ? <Button variant="danger" onClick={remove} style={{ marginRight: 'auto' }}>Delete</Button> : null}
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" loading={busy} onClick={save as any} data-testid="template-save">Save</Button>
      </>}>
      {dialog}
      <form onSubmit={save} className="form-grid">
        <Field label="Name" required className="span-2"><Input {...f.bind('name')} required autoFocus placeholder="e.g. Background verification" /></Field>
        <Field label="Description" className="span-2"><Textarea rows={2} {...f.bind('description')} placeholder="What happens in this stage and what 'done' means." /></Field>
        <Field label="Colour"><Input type="color" {...f.bind('color')} /></Field>
        <Field label="Icon (short text)" hint="A word or emoji, e.g. 🔎 or 'verify'."><Input {...f.bind('icon')} maxLength={24} /></Field>
        <Field label="Owner role" hint="Who is responsible for completing it.">
          <Select {...f.bind('owner_role')}>
            {OWNER_ROLES.map((r) => <option key={r} value={r}>{label(r)}</option>)}
            {f.values.owner_role && !OWNER_ROLES.includes(f.values.owner_role) ? <option value={f.values.owner_role}>{f.values.owner_role}</option> : null}
          </Select>
        </Field>
        <Field label="SLA (days)" hint="Target duration; leave blank for none."><Input type="number" min={0} {...f.bind('sla_days')} /></Field>
        <Field label="Status"><Select {...f.bind('active')}><option value={1}>Active</option><option value={0}>Inactive</option></Select></Field>
      </form>
    </Modal>
  );
}
