import React, { useMemo, useState } from 'react';
import { api } from '../../lib/api';
import { useCounts } from '../../lib/notifications';
import { fmtDate } from '../../lib/format';
import { Button, Card, EmptyState, Field, Input, Modal, Select, Spinner, Stat, Table, Textarea, downloadUrl, useConfirm, useFetch, useForm, useToast } from '../ui';
import { BarChart, CHART_COLORS } from '../charts';
import { Icon } from '../Icons';
import { ReviewModal } from './ReviewModal';
import { CycleStatusBadge, DEFAULT_COMPETENCIES, REVIEW_STATUS_LABEL, RatingBar, ReviewStatusBadge, fmtRating, type Competency, type Cycle, type CycleSummary, type Review, type ReviewStatus } from './shared';

/* ------------------------------------------------------------------ */
/* Cycle list                                                          */
/* ------------------------------------------------------------------ */
export function CyclesTab({ cycles, loading, reload, onView }: { cycles: Cycle[]; loading: boolean; reload: () => void; onView: (id: number) => void }) {
  const toast = useToast();
  const { refreshCounts } = useCounts();
  const { confirm, dialog } = useConfirm();
  const [editing, setEditing] = useState<Cycle | 'new' | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const act = async (c: Cycle, action: 'open' | 'close' | 'delete') => {
    const msgs = {
      open: [`Open ${c.name}?`, c.status === 'draft' ? 'A review is created for every active employee, assigned to their reporting manager. Competencies and the rating scale are then locked.' : 'Creates reviews for employees who joined since the cycle opened.'],
      close: [`Close ${c.name}?`, 'No more ratings can be entered. Reviews still in progress stay as they are. A closed cycle cannot be reopened.'],
      delete: [`Delete ${c.name}?`, 'The draft cycle is removed permanently.'],
    } as const;
    const ok = await confirm(msgs[action][0], msgs[action][1], action !== 'open');
    if (!ok) return;
    setBusy(`${c.id}-${action}`);
    try {
      if (action === 'delete') {
        await api.delete(`/api/performance/cycles/${c.id}`);
        toast.success(`${c.name} deleted`);
      } else if (action === 'open') {
        const res = await api.post<Cycle & { created: number }>(`/api/performance/cycles/${c.id}/open`);
        toast.success(`${c.name} is open: ${res.created} review${res.created === 1 ? '' : 's'} created`);
      } else {
        await api.post(`/api/performance/cycles/${c.id}/close`);
        toast.success(`${c.name} closed`);
      }
      reload();
      refreshCounts();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(null);
    }
  };

  const exportCsv = async (c: Cycle) => {
    try {
      await downloadUrl(`/api/performance/cycles/${c.id}/export.csv`, `reviews-${c.name.replace(/[^a-zA-Z0-9_-]+/g, '-')}.csv`);
      toast.success('Export downloaded');
    } catch (err) {
      toast.error(err);
    }
  };

  return (
    <>
      <div className="toolbar">
        <span className="muted">Draft cycles can be edited freely. Opening a cycle creates the reviews; closing it locks them.</span>
        <Button variant="primary" style={{ marginLeft: 'auto' }} onClick={() => setEditing('new')} data-testid="cycle-add" data-tour="perf-cycle-add"><Icon name="plus" size={15} /> New cycle</Button>
      </div>
      <Card padded={false} tour="perf-cycles">
        <Table<Cycle>
          loading={loading}
          rows={cycles}
          empty="No review cycles yet. Create one to start."
          onRowClick={(c) => onView(c.id)}
          columns={[
            { key: 'name', header: 'Cycle', render: (c) => <span><strong data-testid="cycle-name">{c.name}</strong><div className="muted">{c.competencies?.length || 0} competencies · scale 1–{c.rating_scale}</div></span> },
            { key: 'period', header: 'Period', render: (c) => `${fmtDate(c.period_start)} – ${fmtDate(c.period_end)}` },
            { key: 'due_date', header: 'Due', render: (c) => fmtDate(c.due_date) },
            { key: 'status', header: 'Status', render: (c) => <CycleStatusBadge status={c.status} /> },
            {
              key: 'progress', header: 'Completed', render: (c) => c.review_count ? (
                <span className="progress-wrap"><span className="progress"><span style={{ width: `${Math.round((c.completed_count / c.review_count) * 100)}%` }} /></span><span className="muted" data-testid="cycle-progress">{c.completed_count} / {c.review_count}</span></span>
              ) : <span className="muted">No reviews yet</span>,
            },
            {
              key: 'actions', header: '', align: 'right', render: (c) => (
                <span className="row end" style={{ gap: 6 }} onClick={(e) => e.stopPropagation()} data-tour="perf-cycle-actions">
                  {c.status === 'draft' ? <Button size="sm" variant="primary" loading={busy === `${c.id}-open`} onClick={() => act(c, 'open')} data-testid="cycle-open"><Icon name="play" size={14} /> Open</Button> : null}
                  {c.status === 'open' ? <Button size="sm" loading={busy === `${c.id}-close`} onClick={() => act(c, 'close')} data-testid="cycle-close"><Icon name="stop" size={14} /> Close</Button> : null}
                  {c.status !== 'closed' ? <Button size="sm" variant="ghost" aria-label="Edit cycle" onClick={() => setEditing(c)} data-testid="cycle-edit"><Icon name="edit" size={14} /></Button> : null}
                  {c.review_count ? <Button size="sm" variant="ghost" aria-label="Export CSV" title="Export CSV" onClick={() => exportCsv(c)} data-testid="cycle-export"><Icon name="download" size={14} /></Button> : null}
                  {c.status === 'draft' ? <Button size="sm" variant="ghost" aria-label="Delete cycle" loading={busy === `${c.id}-delete`} onClick={() => act(c, 'delete')} data-testid="cycle-delete"><Icon name="trash" size={14} /></Button> : null}
                </span>
              ),
            },
          ]}
        />
      </Card>
      {editing ? (
        <CycleModal
          cycle={editing === 'new' ? null : editing}
          template={cycles[0]?.competencies?.length ? cycles[0].competencies : DEFAULT_COMPETENCIES}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); reload(); }}
        />
      ) : null}
      {dialog}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Create / edit                                                       */
/* ------------------------------------------------------------------ */
function CycleModal({ cycle, template, onClose, onSaved }: { cycle: Cycle | null; template: Competency[]; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const f = useForm({
    name: cycle?.name || '',
    period_start: cycle?.period_start || '',
    period_end: cycle?.period_end || '',
    due_date: cycle?.due_date || '',
    rating_scale: String(cycle?.rating_scale || 5),
  });
  const [comps, setComps] = useState<Competency[]>((cycle?.competencies?.length ? cycle.competencies : template).map((c) => ({ ...c })));
  const [saving, setSaving] = useState(false);
  const draft = !cycle || cycle.status === 'draft';
  const setComp = (i: number, patch: Partial<Competency>) => setComps((list) => list.map((c, j) => (j === i ? { ...c, ...patch } : c)));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const v = f.values;
    if (!v.name.trim() || !v.period_start || !v.period_end) return toast.error('Name and period are required');
    if (v.period_end < v.period_start) return toast.error('The period must end on or after it starts');
    const competencies = comps.filter((c) => c.label.trim()).map((c) => ({ key: c.key || undefined, label: c.label.trim(), description: c.description || '', weight: Number(c.weight) || 1 }));
    if (draft && !competencies.length) return toast.error('Add at least one competency');
    const body: any = { name: v.name.trim(), period_start: v.period_start, period_end: v.period_end, due_date: v.due_date || null };
    if (draft) { body.rating_scale = Number(v.rating_scale); body.competencies = competencies; }
    setSaving(true);
    try {
      if (cycle) await api.put(`/api/performance/cycles/${cycle.id}`, body);
      else await api.post('/api/performance/cycles', body);
      toast.success(cycle ? 'Cycle updated' : 'Cycle created as a draft');
      onSaved();
    } catch (err) {
      toast.error(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open wide onClose={onClose} testId="cycle-modal" title={cycle ? `Edit ${cycle.name}` : 'New review cycle'}
      footer={<>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" type="submit" form="cycle-form" loading={saving} data-testid="cycle-submit">{cycle ? 'Save changes' : 'Create draft'}</Button>
      </>}>
      <form id="cycle-form" onSubmit={submit} className="form-grid">
        <Field label="Name" required className="span-2"><Input {...f.bind('name')} placeholder="e.g. H1 2027" data-testid="cycle-name-input" autoFocus /></Field>
        <Field label="Period start" required><Input type="date" {...f.bind('period_start')} data-testid="cycle-start" /></Field>
        <Field label="Period end" required><Input type="date" {...f.bind('period_end')} data-testid="cycle-end" /></Field>
        <Field label="Due date" hint="When reviews should be completed."><Input type="date" {...f.bind('due_date')} data-testid="cycle-due" /></Field>
        <Field label="Rating scale" hint={draft ? 'Ratings run from 1 to this number.' : 'Locked once the cycle is open.'}>
          <Select {...f.bind('rating_scale')} disabled={!draft} data-testid="cycle-scale">
            {[3, 4, 5, 6, 7, 8, 9, 10].map((n) => <option key={n} value={n}>1 – {n}</option>)}
          </Select>
        </Field>
        <div className="form-section">Competencies</div>
        {!draft ? <div className="alert alert-info span-2">Competencies are locked because reviews already exist for this cycle.</div> : null}
        <div className="span-2 stack" data-testid="cycle-competencies">
          {comps.map((c, i) => (
            <div key={i} className="form-grid" style={{ gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 3fr) 80px auto', alignItems: 'start' }}>
              <Input value={c.label} onChange={(e) => setComp(i, { label: e.target.value })} placeholder="Competency" aria-label="Competency label" disabled={!draft} data-testid={`competency-label-${i}`} />
              <Textarea rows={1} value={c.description || ''} onChange={(e) => setComp(i, { description: e.target.value })} placeholder="What good looks like" aria-label="Competency description" disabled={!draft} />
              <Input type="number" min={0.5} step={0.5} value={c.weight} onChange={(e) => setComp(i, { weight: Number(e.target.value) })} aria-label="Weight" title="Weight" disabled={!draft} />
              <Button type="button" variant="ghost" size="sm" aria-label="Remove competency" disabled={!draft || comps.length <= 1} onClick={() => setComps((list) => list.filter((_, j) => j !== i))}><Icon name="trash" size={15} /></Button>
            </div>
          ))}
          {draft ? <div><Button type="button" size="sm" onClick={() => setComps((list) => [...list, { key: '', label: '', description: '', weight: 1 }])} data-testid="competency-add"><Icon name="plus" size={14} /> Add competency</Button></div> : null}
          <span className="field-hint">The final rating is the weighted average of the manager's ratings unless the manager overrides it.</span>
        </div>
      </form>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Cycle detail: summary + every review                                */
/* ------------------------------------------------------------------ */
interface DirEmployee { id: number; first_name: string; last_name: string; employee_code?: string; status?: string }

export function CycleDetail({ cycleId, onBack, onChanged }: { cycleId: number; onBack: () => void; onChanged: () => void }) {
  const toast = useToast();
  const cycle = useFetch<Cycle>(() => api.get(`/api/performance/cycles/${cycleId}`), [cycleId]);
  const summary = useFetch<CycleSummary>(() => api.get(`/api/performance/cycles/${cycleId}/summary`), [cycleId]);
  const reviews = useFetch<Review[]>(() => api.get(`/api/performance/reviews?cycle_id=${cycleId}`), [cycleId]);
  const [status, setStatus] = useState<'' | ReviewStatus>('');
  const [open, setOpen] = useState<number | null>(null);
  const [reassign, setReassign] = useState<Review | null>(null);
  const reloadAll = () => { cycle.reload(); summary.reload(); reviews.reload(); onChanged(); };
  const c = cycle.data;
  const s = summary.data;
  const rows = useMemo(() => (reviews.data || []).filter((r) => !status || r.status === status), [reviews.data, status]);

  if (cycle.error) return <div className="alert alert-error">{cycle.error}</div>;
  if (!c) return <Spinner />;
  const scale = c.rating_scale || 5;

  return (
    <div className="stack" data-testid="cycle-detail">
      <div className="row between">
        <div className="row">
          <Button variant="ghost" size="sm" onClick={onBack} data-testid="cycle-back"><Icon name="chevronLeft" size={15} /> All cycles</Button>
          <h2 className="card-title" style={{ margin: 0 }}>{c.name}</h2>
          <CycleStatusBadge status={c.status} />
          <span className="muted">{fmtDate(c.period_start)} – {fmtDate(c.period_end)}{c.due_date ? ` · due ${fmtDate(c.due_date)}` : ''}</span>
        </div>
        {c.review_count ? (
          <Button size="sm" onClick={() => downloadUrl(`/api/performance/cycles/${c.id}/export.csv`, `reviews-${c.name.replace(/[^a-zA-Z0-9_-]+/g, '-')}.csv`).then(() => toast.success('Export downloaded'), (err) => toast.error(err))} data-testid="cycle-detail-export" data-tour="perf-cycle-export">
            <Icon name="download" size={14} /> Export CSV
          </Button>
        ) : null}
      </div>

      {s ? (
        <>
          <div className="stat-strip" data-testid="cycle-summary" data-tour="perf-cycle-summary">
            <Stat label="Reviews" value={s.total} icon="users" hint={`${s.by_status.pending_self || 0} awaiting self-assessment`} />
            <Stat label="Awaiting manager" value={s.by_status.pending_manager || 0} icon="clock" color="var(--warning)" onClick={() => setStatus('pending_manager')} />
            <Stat label="Completion" value={`${s.completion_percent}%`} icon="check" color="var(--success)" hint={`${s.completed} of ${s.total} completed`} />
            <Stat label="Average rating" value={s.average_rating !== null ? `${fmtRating(s.average_rating)} / ${scale}` : '—'} icon="star" color="var(--accent)" />
          </div>
          <div className="detail-grid" data-tour="perf-cycle-charts">
            <Card title="Rating distribution">
              {s.completed ? (
                <BarChart data={s.distribution.map((d, i) => ({ label: String(d.rating), value: d.count, color: CHART_COLORS[i % CHART_COLORS.length] }))} height={150} />
              ) : <EmptyState icon="◎" title="No completed reviews yet" />}
            </Card>
            <Card title="Competency averages" padded={false}>
              <Table
                dense
                rows={s.competency_averages}
                keyField="key"
                columns={[
                  { key: 'label', header: 'Competency' },
                  { key: 'self_average', header: 'Self', render: (r) => fmtRating(r.self_average) },
                  { key: 'manager_average', header: 'Manager', render: (r) => <RatingBar value={r.manager_average} scale={scale} /> },
                ]}
              />
            </Card>
            <Card title="By department" padded={false}>
              <Table
                dense
                rows={s.department_averages}
                keyField="department"
                columns={[
                  { key: 'department', header: 'Department' },
                  { key: 'completed', header: 'Done', render: (r) => `${r.completed} / ${r.total}` },
                  { key: 'average', header: 'Average', render: (r) => fmtRating(r.average) },
                ]}
              />
            </Card>
            {s.top_performers.length ? (
              <Card title="Top rated" padded={false}>
                <Table
                  dense
                  rows={s.top_performers}
                  keyField="review_id"
                  onRowClick={(r) => setOpen(r.review_id)}
                  columns={[
                    { key: 'employee_name', header: 'Employee', render: (r) => <span>{r.employee_name}<div className="muted">{r.department_name || '—'}</div></span> },
                    { key: 'final_rating', header: 'Rating', render: (r) => <strong>{fmtRating(r.final_rating)}</strong> },
                  ]}
                />
              </Card>
            ) : null}
          </div>
        </>
      ) : summary.loading ? <Spinner /> : null}

      <Card
        title="Reviews"
        tour="perf-cycle-reviews"
        padded={false}
        actions={(
          <Select value={status} onChange={(e) => setStatus(e.target.value as ReviewStatus | '')} aria-label="Status" data-testid="cycle-review-status">
            <option value="">All statuses</option>
            {(Object.keys(REVIEW_STATUS_LABEL) as ReviewStatus[]).map((k) => <option key={k} value={k}>{REVIEW_STATUS_LABEL[k]}</option>)}
          </Select>
        )}
      >
        <Table<Review>
          loading={reviews.loading && !reviews.data}
          rows={rows}
          empty={c.status === 'draft' ? 'Reviews are created when the cycle is opened.' : 'No reviews match.'}
          onRowClick={(r) => setOpen(r.id)}
          columns={[
            { key: 'employee_name', header: 'Employee', render: (r) => <span><strong>{r.employee_name}</strong> <span className="muted mono">{r.employee_code}</span><div className="muted">{r.department_name || '—'}</div></span> },
            { key: 'reviewer_name', header: 'Reviewer', render: (r) => r.reviewer_name || <span className="muted">Not assigned</span> },
            { key: 'status', header: 'Status', render: (r) => <ReviewStatusBadge status={r.status} /> },
            { key: 'final_rating', header: 'Final rating', render: (r) => <RatingBar value={r.final_rating} scale={scale} /> },
            { key: 'completed_at', header: 'Completed', render: (r) => fmtDate(r.completed_at) },
            {
              key: 'actions', header: '', align: 'right', render: (r) => (
                <span className="row end" style={{ gap: 6 }} onClick={(e) => e.stopPropagation()}>
                  {r.status !== 'acknowledged' && c.status !== 'closed' ? <Button size="sm" variant="ghost" onClick={() => setReassign(r)} data-testid="review-reassign"><Icon name="user" size={14} /> Reviewer</Button> : null}
                  <Button size="sm" onClick={() => setOpen(r.id)}><Icon name="eye" size={14} /> Open</Button>
                </span>
              ),
            },
          ]}
        />
      </Card>

      {open ? <ReviewModal reviewId={open} onClose={() => setOpen(null)} onChanged={reloadAll} /> : null}
      {reassign ? <ReassignModal review={reassign} onClose={() => setReassign(null)} onSaved={() => { setReassign(null); reloadAll(); }} /> : null}
    </div>
  );
}

function ReassignModal({ review, onClose, onSaved }: { review: Review; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const { refreshCounts } = useCounts();
  const emps = useFetch<DirEmployee[]>(() => api.get('/api/employees/directory/all'), []);
  const [rid, setRid] = useState(review.reviewer_employee_id ? String(review.reviewer_employee_id) : '');
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    try {
      await api.put(`/api/performance/reviews/${review.id}`, { reviewer_employee_id: rid ? Number(rid) : null });
      toast.success(`Reviewer updated for ${review.employee_name}`);
      refreshCounts();
      onSaved();
    } catch (err) {
      toast.error(err);
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal open onClose={onClose} testId="reassign-modal" title={`Reviewer for ${review.employee_name}`}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={saving} onClick={save} data-testid="reassign-submit">Save</Button></>}>
      <Field label="Reviewer" hint="Defaults to the reporting manager when the cycle opens.">
        <Select value={rid} onChange={(e) => setRid(e.target.value)} data-testid="reassign-reviewer">
          <option value="">Not assigned</option>
          {(emps.data || []).filter((e) => e.id !== review.employee_id && e.status !== 'exited').map((e) => (
            <option key={e.id} value={e.id}>{e.first_name} {e.last_name}{e.employee_code ? ` (${e.employee_code})` : ''}</option>
          ))}
        </Select>
      </Field>
    </Modal>
  );
}
