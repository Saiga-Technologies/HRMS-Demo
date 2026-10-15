import React, { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { usePageTour, type TourStep } from '../lib/tour';
import { fmtDate, fmtMoney, label } from '../lib/format';
import { Badge, Button, Card, EmptyState, Field, Input, Modal, PageHeader, SearchInput, Select, Spinner, StatusBadge, Table, Tabs, Textarea, useConfirm, useFetch, useForm, useToast } from '../components/ui';

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */
type Tab = 'descriptions' | 'vacancies';
interface JD { id: number; title: string; position_id?: number | null; position_title?: string | null; department_id?: number | null; department_name?: string | null; summary?: string | null; responsibilities: string[]; requirements: string[]; skills: string[]; employment_type: string; experience_min?: number | null; experience_max?: number | null; salary_min?: number | null; salary_max?: number | null; location?: string | null; status: 'draft' | 'published' | 'archived'; version: number; open_vacancies: number; created_at: string; updated_at: string }
interface Vacancy { id: number; title: string; position_id?: number | null; position_title?: string | null; department_id?: number | null; department_name?: string | null; job_description_id?: number | null; jd_title?: string | null; openings: number; hires: number; budget_annual?: number | null; status: 'draft' | 'open' | 'on_hold' | 'closed' | 'filled'; opened_at?: string | null; closed_at?: string | null; notes?: string | null; created_at: string }
interface Dept { id: number; name: string }
interface Pos { id: number; title: string; department_id?: number | null; department_name?: string }

const num = (v: any): number | null => (v === '' || v === null || v === undefined ? null : Number(v));
const expRange = (j: JD) => (j.experience_min == null && j.experience_max == null ? null : j.experience_min != null && j.experience_max != null ? `${j.experience_min}–${j.experience_max} yrs` : j.experience_min != null ? `${j.experience_min}+ yrs` : `up to ${j.experience_max} yrs`);
const salaryRange = (j: JD, cur: string) => (j.salary_min == null && j.salary_max == null ? null : j.salary_min != null && j.salary_max != null ? `${fmtMoney(j.salary_min, cur)} – ${fmtMoney(j.salary_max, cur)}` : j.salary_min != null ? `from ${fmtMoney(j.salary_min, cur)}` : `up to ${fmtMoney(j.salary_max, cur)}`);

const TOUR: TourStep[] = [
  { title: 'Jobs', description: 'Where hiring starts. The flow: 1) write a job description for the role, 2) publish it, 3) raise a vacancy that uses it, 4) open vacancies appear on the careers page and in Recruitment, where CVs are scored against the description.' },
  { element: '[data-tour="jobs-tabs"]', title: 'Two views', description: 'Job descriptions are reusable, versioned write-ups of a role. Vacancies are concrete openings with a headcount and budget. HR edits both; managers can read them.' },
  { element: '[data-tour="jd-add"]', title: 'Write a job description', tab: 'descriptions', description: 'Opens the editor: title, position and department, summary, responsibilities, requirements and skills (one per line), employment type, experience and salary range, location and status. Save it as a draft until it is ready.' },
  { element: '[data-tour="jd-filters"]', title: 'Find a description', description: 'Search by title, summary or position, and narrow by status (draft, published, archived) or department. The counter shows how many match.' },
  { element: '[data-tour="jd-grid"]', title: 'Description cards', description: 'One card per job description with its position, department, employment type, experience, salary range and location chips, and the summary.' },
  { element: '[data-tour="jd-status"]', title: 'Draft, published, archived', description: 'Only published descriptions can be attached to a vacancy. Archive a description that is no longer used; restoring brings it back as a draft.' },
  { element: '[data-tour="jd-meta"]', title: 'Version and usage', description: 'The version goes up automatically whenever the content changes (status changes do not), so you can tell which wording a vacancy used. Also shows how many open vacancies use it and how many skills it lists — skills drive the CV match score in Recruitment.' },
  { element: '[data-tour="jd-actions"]', title: 'Card actions', description: 'View opens a clean, printable version. HR can Edit, Duplicate (creates a draft copy, version 1), Publish a draft, Archive a published one, or delete it.' },
  { element: '[data-tour="vac-note"]', title: 'Next: vacancies', tab: 'vacancies', description: 'A vacancy is the first step of the Employee journey: raising one starts requisition, budget, publishing, sourcing and interviews.' },
  { element: '[data-tour="vac-add"]', title: 'Raise a vacancy', description: 'Opens the vacancy form. Pick a published job description and it pre-fills the title, position and department; then set the number of openings, the annual budget, status and opening date.' },
  { element: '[data-tour="vac-filters"]', title: 'Find a vacancy', description: 'Search by title, department or position and filter by status. The summary counts open vacancies and their total openings.' },
  { element: '[data-tour="vac-table"]', title: 'Vacancy list', description: 'Each vacancy with its position, department, linked job description, openings, budget and dates. HR clicks a row to edit it or delete it.' },
  { element: '[data-tour="vac-hires"]', title: 'Openings and hires', description: 'Hires count up as candidates are hired in Recruitment. When every opening is filled the vacancy closes as Filled.' },
  { element: '[data-tour="vac-status"]', title: 'Vacancy status', description: 'Draft, Open, On hold, Closed or Filled. Only Open vacancies are listed on the public careers page and take applications; closing or filling one stamps the closed date.' },
  { title: 'What to do next', description: 'With a vacancy open, go to Recruitment to upload CVs (or receive them from the careers page), score them against this description and move candidates through to hire. Each hire is linked back to the vacancy and starts their Employee journey.' },
];

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */
export default function Jobs() {
  usePageTour('Jobs', TOUR);
  const { isHr } = useAuth();
  const [params, setParams] = useSearchParams();
  const tab: Tab = params.get('tab') === 'vacancies' ? 'vacancies' : 'descriptions';
  const setTab = (k: string) => setParams((p) => { const n = new URLSearchParams(p); n.set('tab', k); return n; });

  const jds = useFetch<JD[]>(() => api.get('/api/jobs/descriptions'), []);
  const vacancies = useFetch<Vacancy[]>(() => api.get('/api/jobs/vacancies'), []);
  const depts = useFetch<Dept[]>(() => api.get('/api/org/departments'), []);
  const positions = useFetch<Pos[]>(() => api.get('/api/org/positions'), []);
  const empTypes = useFetch<string[]>(() => api.get('/api/settings/employment_types'), []);

  const [editJd, setEditJd] = useState<Partial<JD> | null>(null);
  const [viewJd, setViewJd] = useState<JD | null>(null);
  const [editVac, setEditVac] = useState<Partial<Vacancy> | null>(null);

  return (
    <>
      <PageHeader
        title="Jobs"
        subtitle="Job descriptions and vacancies. A vacancy is the first step of every employee's journey."
        actions={isHr ? (
          tab === 'descriptions'
            ? <Button variant="primary" data-testid="jd-add" data-tour="jd-add" onClick={() => setEditJd({})}>+ New job description</Button>
            : <Button variant="primary" data-testid="vacancy-add" data-tour="vac-add" onClick={() => setEditVac({})}>+ New vacancy</Button>
        ) : undefined}
      />
      <Tabs tour="jobs-tabs" value={tab} onChange={setTab} tabs={[{ key: 'descriptions', label: 'Job descriptions', count: jds.data?.length }, { key: 'vacancies', label: 'Vacancies', count: vacancies.data?.length }]} />

      {tab === 'descriptions' ? (
        <DescriptionsTab jds={jds.data || []} loading={jds.loading} departments={depts.data || []} isHr={isHr} reload={jds.reload} onEdit={setEditJd} onView={setViewJd} />
      ) : (
        <VacanciesTab vacancies={vacancies.data || []} loading={vacancies.loading} isHr={isHr} onEdit={setEditVac} />
      )}

      {editJd ? (
        <JdModal jd={editJd} departments={depts.data || []} positions={positions.data || []} employmentTypes={empTypes.data || ['full_time', 'part_time', 'contract', 'intern', 'consultant']} onClose={() => setEditJd(null)} onSaved={() => { setEditJd(null); jds.reload(); }} />
      ) : null}
      {viewJd ? <JdViewModal jd={viewJd} onClose={() => setViewJd(null)} /> : null}
      {editVac ? (
        <VacancyModal vac={editVac} departments={depts.data || []} positions={positions.data || []} jds={jds.data || []} onClose={() => setEditVac(null)} onSaved={() => { setEditVac(null); vacancies.reload(); jds.reload(); }} />
      ) : null}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Job descriptions                                                    */
/* ------------------------------------------------------------------ */
function DescriptionsTab({ jds, loading, departments, isHr, reload, onEdit, onView }: { jds: JD[]; loading: boolean; departments: Dept[]; isHr: boolean; reload: () => void; onEdit: (j: Partial<JD>) => void; onView: (j: JD) => void }) {
  const toast = useToast();
  const { confirm, dialog } = useConfirm();
  const { company } = useAuth();
  const currency = company.currency || 'INR';
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [dept, setDept] = useState('');
  const [busyId, setBusyId] = useState<number | null>(null);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return jds.filter((j) => (!status || j.status === status) && (!dept || String(j.department_id) === dept) && (!needle || j.title.toLowerCase().includes(needle) || (j.summary || '').toLowerCase().includes(needle) || (j.position_title || '').toLowerCase().includes(needle)));
  }, [jds, q, status, dept]);

  const act = async (j: JD, fn: () => Promise<any>, msg: string) => {
    setBusyId(j.id);
    try {
      await fn();
      toast.success(msg);
      reload();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusyId(null);
    }
  };
  const setJdStatus = (j: JD, s: JD['status']) => act(j, () => api.put(`/api/jobs/descriptions/${j.id}`, { status: s }), `"${j.title}" ${s === 'published' ? 'published' : s === 'archived' ? 'archived' : 'moved back to draft'}`);
  const duplicate = (j: JD) => act(j, () => api.post(`/api/jobs/descriptions/${j.id}/duplicate`), `Copy of "${j.title}" created as a draft`);
  const remove = async (j: JD) => {
    if (!(await confirm('Delete job description?', `"${j.title}" will be removed. Vacancies linked to it keep their other details.`))) return;
    act(j, () => api.delete(`/api/jobs/descriptions/${j.id}`), 'Job description deleted');
  };

  return (
    <>
      {dialog}
      <div className="toolbar" data-tour="jd-filters">
        <SearchInput value={q} onChange={setQ} placeholder="Search job descriptions…" />
        <Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          <option value="">All statuses</option>
          <option value="draft">Draft</option>
          <option value="published">Published</option>
          <option value="archived">Archived</option>
        </Select>
        <Select value={dept} onChange={(e) => setDept(e.target.value)} aria-label="Department">
          <option value="">All departments</option>
          {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </Select>
        <span className="muted">{filtered.length} of {jds.length}</span>
      </div>
      <div data-tour="jd-grid">
        {loading && !jds.length ? (
          <Spinner />
        ) : filtered.length === 0 ? (
          <Card><EmptyState title={jds.length ? 'No job descriptions match' : 'No job descriptions yet'} description={jds.length ? 'Try clearing the filters.' : isHr ? 'Create the first one with "+ New job description".' : 'HR has not published any job descriptions yet.'} icon="📄" /></Card>
        ) : (
          <div className="jd-grid">
            {filtered.map((j) => (
              <div key={j.id} className="card jd-card" data-testid="jd-card">
                <div className="row between" style={{ alignItems: 'flex-start' }}>
                  <div>
                    <div className="jd-title">{j.title}</div>
                    <div className="muted">{[j.position_title, j.department_name].filter(Boolean).join(' · ') || 'No position / department'}</div>
                  </div>
                  <span data-tour="jd-status"><StatusBadge status={j.status} /></span>
                </div>
                <div className="chip-list">
                  <span className="chip">{label(j.employment_type)}</span>
                  {expRange(j) ? <span className="chip">{expRange(j)}</span> : null}
                  {salaryRange(j, currency) ? <span className="chip">{salaryRange(j, currency)}</span> : null}
                  {j.location ? <span className="chip">{j.location}</span> : null}
                </div>
                {j.summary ? <p className="jd-summary">{j.summary}</p> : <p className="jd-summary muted">No summary.</p>}
                <div className="row between jd-foot">
                  <span className="muted" data-tour="jd-meta">v{j.version} · {j.open_vacancies} open vacanc{j.open_vacancies === 1 ? 'y' : 'ies'} · {j.skills.length} skill{j.skills.length === 1 ? '' : 's'}</span>
                  <div className="row" style={{ gap: 4 }} data-tour="jd-actions">
                    <Button size="sm" variant="ghost" onClick={() => onView(j)}>View</Button>
                    {isHr ? (
                      <>
                        <Button size="sm" variant="ghost" onClick={() => onEdit(j)} data-testid="jd-edit">Edit</Button>
                        <Button size="sm" variant="ghost" loading={busyId === j.id} onClick={() => duplicate(j)}>Duplicate</Button>
                        {j.status === 'draft' ? <Button size="sm" variant="primary" loading={busyId === j.id} onClick={() => setJdStatus(j, 'published')} data-testid="jd-publish">Publish</Button> : null}
                        {j.status === 'published' ? <Button size="sm" variant="ghost" loading={busyId === j.id} onClick={() => setJdStatus(j, 'archived')}>Archive</Button> : null}
                        {j.status === 'archived' ? <Button size="sm" variant="ghost" loading={busyId === j.id} onClick={() => setJdStatus(j, 'draft')}>Restore to draft</Button> : null}
                        <Button size="sm" variant="ghost" loading={busyId === j.id} onClick={() => remove(j)} aria-label="Delete">🗑</Button>
                      </>
                    ) : null}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function JdModal({ jd, departments, positions, employmentTypes, onClose, onSaved }: { jd: Partial<JD>; departments: Dept[]; positions: Pos[]; employmentTypes: string[]; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const f = useForm({
    title: jd.title || '',
    position_id: jd.position_id ?? '',
    department_id: jd.department_id ?? '',
    summary: jd.summary || '',
    responsibilities: (jd.responsibilities || []).join('\n'),
    requirements: (jd.requirements || []).join('\n'),
    skills: (jd.skills || []).join('\n'),
    employment_type: jd.employment_type || employmentTypes[0] || 'full_time',
    experience_min: jd.experience_min ?? '',
    experience_max: jd.experience_max ?? '',
    salary_min: jd.salary_min ?? '',
    salary_max: jd.salary_max ?? '',
    location: jd.location || '',
    status: jd.status || 'draft',
  });
  const onPosition = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const v = e.target.value;
    f.set('position_id', v);
    const p = positions.find((x) => String(x.id) === v);
    if (p?.department_id && !f.values.department_id) f.set('department_id', String(p.department_id));
  };
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!f.values.title.trim()) return toast.error('Title is required');
    setBusy(true);
    try {
      const v = f.values;
      const body = {
        title: v.title.trim(),
        position_id: num(v.position_id),
        department_id: num(v.department_id),
        summary: v.summary,
        responsibilities: v.responsibilities,
        requirements: v.requirements,
        skills: v.skills,
        employment_type: v.employment_type,
        experience_min: num(v.experience_min),
        experience_max: num(v.experience_max),
        salary_min: num(v.salary_min),
        salary_max: num(v.salary_max),
        location: v.location,
        status: v.status,
      };
      if (jd.id) await api.put(`/api/jobs/descriptions/${jd.id}`, body);
      else await api.post('/api/jobs/descriptions', body);
      toast.success(jd.id ? 'Job description updated' : 'Job description created');
      onSaved();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open wide title={jd.id ? `Edit job description${jd.version ? ` (v${jd.version})` : ''}` : 'New job description'} onClose={onClose} testId="jd-modal"
      footer={<>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" loading={busy} onClick={save as any} data-testid="jd-save">Save</Button>
      </>}>
      <form onSubmit={save} className="form-grid">
        <Field label="Title" required className="span-2"><Input {...f.bind('title')} required autoFocus placeholder="e.g. Senior Software Engineer" /></Field>
        <Field label="Position">
          <Select name="position_id" value={f.values.position_id} onChange={onPosition}>
            <option value="">— None —</option>
            {positions.map((p) => <option key={p.id} value={p.id}>{p.title}{p.department_name ? ` · ${p.department_name}` : ''}</option>)}
          </Select>
        </Field>
        <Field label="Department">
          <Select {...f.bind('department_id')}>
            <option value="">— None —</option>
            {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </Select>
        </Field>
        <Field label="Summary" className="span-2" hint="A short paragraph about the role and the team."><Textarea rows={3} {...f.bind('summary')} /></Field>
        <Field label="Responsibilities" hint="One per line."><Textarea rows={6} {...f.bind('responsibilities')} placeholder={'Own the design of…\nMentor junior engineers…'} /></Field>
        <Field label="Requirements" hint="One per line."><Textarea rows={6} {...f.bind('requirements')} placeholder={'5+ years with…\nDegree in…'} /></Field>
        <Field label="Skills" hint="One per line." className="span-2"><Textarea rows={3} {...f.bind('skills')} placeholder={'TypeScript\nSQL\nCommunication'} /></Field>
        <Field label="Employment type">
          <Select {...f.bind('employment_type')}>
            {employmentTypes.map((t) => <option key={t} value={t}>{label(t)}</option>)}
          </Select>
        </Field>
        <Field label="Location"><Input {...f.bind('location')} placeholder="e.g. Bengaluru / Remote" /></Field>
        <Field label="Experience (years)">
          <div className="row" style={{ flexWrap: 'nowrap' }}>
            <Input type="number" min={0} max={60} {...f.bind('experience_min')} placeholder="Min" aria-label="Minimum experience" />
            <span className="muted">to</span>
            <Input type="number" min={0} max={60} {...f.bind('experience_max')} placeholder="Max" aria-label="Maximum experience" />
          </div>
        </Field>
        <Field label="Salary range (annual)">
          <div className="row" style={{ flexWrap: 'nowrap' }}>
            <Input type="number" min={0} step="1000" {...f.bind('salary_min')} placeholder="Min" aria-label="Minimum salary" />
            <span className="muted">to</span>
            <Input type="number" min={0} step="1000" {...f.bind('salary_max')} placeholder="Max" aria-label="Maximum salary" />
          </div>
        </Field>
        <Field label="Status" hint="Only published descriptions can be attached to vacancies.">
          <Select {...f.bind('status')}>
            <option value="draft">Draft</option>
            <option value="published">Published</option>
            <option value="archived">Archived</option>
          </Select>
        </Field>
      </form>
    </Modal>
  );
}

function JdViewModal({ jd, onClose }: { jd: JD; onClose: () => void }) {
  const { company } = useAuth();
  const currency = company.currency || 'INR';
  const Section = ({ title, items }: { title: string; items: string[] }) => (items.length ? (
    <>
      <h3>{title}</h3>
      <ul>{items.map((s, i) => <li key={i}>{s}</li>)}</ul>
    </>
  ) : null);
  return (
    <Modal open wide title={<span>{jd.title} <span className="muted">v{jd.version}</span></span>} onClose={onClose} testId="jd-view-modal"
      footer={<>
        <Button onClick={() => window.print()} data-testid="jd-print">Print</Button>
        <Button variant="primary" onClick={onClose}>Close</Button>
      </>}>
      <div className="jd-view">
        <div className="print-only jd-print-head">
          <div className="jd-title">{jd.title}</div>
          <div className="muted">{company.name}</div>
        </div>
        <div className="row" style={{ gap: 6 }}>
          <StatusBadge status={jd.status} />
          <Badge>{label(jd.employment_type)}</Badge>
          {jd.position_title ? <Badge tone="info">{jd.position_title}</Badge> : null}
          {jd.department_name ? <Badge tone="info">{jd.department_name}</Badge> : null}
          {jd.location ? <Badge>{jd.location}</Badge> : null}
        </div>
        <div className="row muted" style={{ marginTop: 8, gap: 16 }}>
          <span>Experience: <strong>{expRange(jd) || 'Not specified'}</strong></span>
          <span>Salary: <strong>{salaryRange(jd, currency) || 'Not specified'}</strong></span>
          <span>Updated {fmtDate(jd.updated_at)}</span>
        </div>
        {jd.summary ? (<><h3>About the role</h3><p>{jd.summary}</p></>) : null}
        <Section title="Responsibilities" items={jd.responsibilities} />
        <Section title="Requirements" items={jd.requirements} />
        {jd.skills.length ? (<><h3>Skills</h3><div className="chip-list">{jd.skills.map((s, i) => <span key={i} className="chip">{s}</span>)}</div></>) : null}
        {!jd.summary && !jd.responsibilities.length && !jd.requirements.length && !jd.skills.length ? <p className="muted">This description has no content yet.</p> : null}
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Vacancies                                                           */
/* ------------------------------------------------------------------ */
function VacanciesTab({ vacancies, loading, isHr, onEdit }: { vacancies: Vacancy[]; loading: boolean; isHr: boolean; onEdit: (v: Partial<Vacancy>) => void }) {
  const { company } = useAuth();
  const currency = company.currency || 'INR';
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return vacancies.filter((v) => (!status || v.status === status) && (!needle || v.title.toLowerCase().includes(needle) || (v.department_name || '').toLowerCase().includes(needle) || (v.position_title || '').toLowerCase().includes(needle)));
  }, [vacancies, q, status]);
  const open = vacancies.filter((v) => v.status === 'open');
  const openings = open.reduce((a, v) => a + (v.openings || 0), 0);
  return (
    <>
      <div className="callout" data-tour="vac-note">
        <strong>A vacancy is the first step of the Employee journey.</strong> Raising one kicks off requisition approval, budgeting, the job description, publishing, sourcing and interviews — the stages you configure under <em>Journey → Stage templates</em>. When someone is hired, link their employee record to the vacancy so their journey starts from here.
      </div>
      <div className="toolbar" data-tour="vac-filters">
        <SearchInput value={q} onChange={setQ} placeholder="Search vacancies…" />
        <Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          <option value="">All statuses</option>
          {['draft', 'open', 'on_hold', 'closed', 'filled'].map((s) => <option key={s} value={s}>{label(s)}</option>)}
        </Select>
        <span className="muted">{open.length} open vacanc{open.length === 1 ? 'y' : 'ies'} · {openings} opening{openings === 1 ? '' : 's'}</span>
      </div>
      <Card padded={false} tour="vac-table">
        <Table<Vacancy>
          loading={loading && !vacancies.length}
          rows={filtered}
          onRowClick={isHr ? (v) => onEdit(v) : undefined}
          empty={vacancies.length ? 'No vacancies match.' : isHr ? 'No vacancies yet. Raise one with "+ New vacancy".' : 'No vacancies yet.'}
          columns={[
            { key: 'title', header: 'Vacancy', render: (v) => <strong>{v.title}</strong> },
            { key: 'position_title', header: 'Position', render: (v) => v.position_title || '—' },
            { key: 'department_name', header: 'Department', render: (v) => v.department_name || '—' },
            { key: 'jd_title', header: 'Job description', render: (v) => v.jd_title || <span className="muted">—</span> },
            { key: 'openings', header: 'Openings', align: 'right' },
            { key: 'hires', header: 'Hires', align: 'right', render: (v) => <span data-tour="vac-hires" className={v.hires >= v.openings && v.openings > 0 ? 'muted' : ''}>{v.hires}</span> },
            { key: 'budget_annual', header: 'Budget / yr', align: 'right', render: (v) => fmtMoney(v.budget_annual, currency) },
            { key: 'status', header: 'Status', render: (v) => <span data-tour="vac-status"><StatusBadge status={v.status} /></span> },
            { key: 'opened_at', header: 'Opened', render: (v) => fmtDate(v.opened_at) },
            { key: 'closed_at', header: 'Closed', render: (v) => fmtDate(v.closed_at) },
          ]}
        />
      </Card>
    </>
  );
}

function VacancyModal({ vac, departments, positions, jds, onClose, onSaved }: { vac: Partial<Vacancy>; departments: Dept[]; positions: Pos[]; jds: JD[]; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const { confirm, dialog } = useConfirm();
  const [busy, setBusy] = useState(false);
  const f = useForm({
    title: vac.title || '',
    position_id: vac.position_id ?? '',
    department_id: vac.department_id ?? '',
    job_description_id: vac.job_description_id ?? '',
    openings: vac.openings ?? 1,
    budget_annual: vac.budget_annual ?? '',
    status: vac.status || 'open',
    opened_at: vac.opened_at || '',
    closed_at: vac.closed_at || '',
    notes: vac.notes || '',
  });
  const selectableJds = jds.filter((j) => j.status === 'published' || j.id === vac.job_description_id);
  const onJd = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const v = e.target.value;
    f.set('job_description_id', v);
    const j = jds.find((x) => String(x.id) === v);
    if (!j) return;
    if (!f.values.title) f.set('title', j.title);
    if (!f.values.position_id && j.position_id) f.set('position_id', String(j.position_id));
    if (!f.values.department_id && j.department_id) f.set('department_id', String(j.department_id));
  };
  const onPosition = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const v = e.target.value;
    f.set('position_id', v);
    const p = positions.find((x) => String(x.id) === v);
    if (p?.department_id && !f.values.department_id) f.set('department_id', String(p.department_id));
  };
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!f.values.title.trim()) return toast.error('Title is required');
    setBusy(true);
    try {
      const v = f.values;
      const body = {
        title: v.title.trim(),
        position_id: num(v.position_id),
        department_id: num(v.department_id),
        job_description_id: num(v.job_description_id),
        openings: Math.max(0, Number(v.openings) || 0),
        budget_annual: num(v.budget_annual),
        status: v.status,
        opened_at: v.opened_at || null,
        closed_at: v.closed_at || null,
        notes: v.notes,
      };
      if (vac.id) await api.put(`/api/jobs/vacancies/${vac.id}`, body);
      else await api.post('/api/jobs/vacancies', body);
      toast.success(vac.id ? 'Vacancy updated' : 'Vacancy raised');
      onSaved();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!(await confirm('Delete vacancy?', 'Employees hired against it will be unlinked from it.'))) return;
    try {
      await api.delete(`/api/jobs/vacancies/${vac.id}`);
      toast.success('Vacancy deleted');
      onSaved();
    } catch (err) {
      toast.error(err);
    }
  };
  return (
    <Modal open title={vac.id ? 'Edit vacancy' : 'New vacancy'} onClose={onClose} testId="vacancy-modal"
      footer={<>
        {vac.id ? <Button variant="danger" onClick={remove} style={{ marginRight: 'auto' }}>Delete</Button> : null}
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" loading={busy} onClick={save as any} data-testid="vacancy-save">Save</Button>
      </>}>
      {dialog}
      <form onSubmit={save} className="form-grid">
        <Field label="Job description" className="span-2" hint="Published descriptions only. Picking one pre-fills the title, position and department.">
          <Select name="job_description_id" value={f.values.job_description_id} onChange={onJd}>
            <option value="">— None —</option>
            {selectableJds.map((j) => <option key={j.id} value={j.id}>{j.title} (v{j.version}{j.status !== 'published' ? `, ${j.status}` : ''})</option>)}
          </Select>
        </Field>
        <Field label="Title" required className="span-2"><Input {...f.bind('title')} required autoFocus placeholder="e.g. Senior Software Engineer — Platform" /></Field>
        <Field label="Position">
          <Select name="position_id" value={f.values.position_id} onChange={onPosition}>
            <option value="">— None —</option>
            {positions.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
          </Select>
        </Field>
        <Field label="Department">
          <Select {...f.bind('department_id')}>
            <option value="">— None —</option>
            {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </Select>
        </Field>
        <Field label="Openings"><Input type="number" min={0} {...f.bind('openings')} /></Field>
        <Field label="Annual budget"><Input type="number" min={0} step="1000" {...f.bind('budget_annual')} placeholder="Optional" /></Field>
        <Field label="Status">
          <Select {...f.bind('status')}>
            {['draft', 'open', 'on_hold', 'closed', 'filled'].map((s) => <option key={s} value={s}>{label(s)}</option>)}
          </Select>
        </Field>
        <Field label="Opened on" hint="Defaults to today."><Input type="date" {...f.bind('opened_at')} /></Field>
        {vac.id ? <Field label="Closed on" hint="Set automatically when closed or filled."><Input type="date" {...f.bind('closed_at')} /></Field> : null}
        <Field label="Notes" className="span-2"><Textarea rows={3} {...f.bind('notes')} placeholder="Hiring manager, urgency, interview panel…" /></Field>
      </form>
    </Modal>
  );
}
