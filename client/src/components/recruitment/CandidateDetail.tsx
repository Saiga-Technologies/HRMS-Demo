import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useCounts } from '../../lib/notifications';
import { fmtDate, fmtDateTime, fmtMoney, todayIso } from '../../lib/format';
import { Badge, Button, Field, Input, Modal, Select, Spinner, Textarea, useConfirm, useFetch, useToast } from '../ui';
import { Icon } from '../Icons';
import { BreakdownBars, ScoreRing, SkillChips, Stars, scoreTone } from './ScoreBits';
import { HireModal } from './HireModal';
import { STAGES, STAGE_LABEL, STAGE_COLOR, candidateName, cvUrl, type Candidate, type CandidateEvent, type Stage } from './types';

interface JDOption { id: number; title: string; status: string; position_title?: string | null }

/** Candidate drawer: header, score panel, parsed CV, timeline and the Hire action. */
export function CandidateDetail({ id, onClose, onChanged }: { id: number; onClose: () => void; onChanged: () => void }) {
  const { isHr, company } = useAuth();
  const { refreshCounts } = useCounts();
  const toast = useToast();
  const { confirm, dialog } = useConfirm();
  const detail = useFetch<Candidate>(() => api.get(`/api/recruitment/candidates/${id}`), [id]);
  const jds = useFetch<JDOption[]>(() => api.get('/api/jobs/descriptions?status=published'), []);
  const c = detail.data;
  const [busy, setBusy] = useState(false);
  const [hiring, setHiring] = useState(false);
  const [rescoreJd, setRescoreJd] = useState('');
  const [noteText, setNoteText] = useState('');
  const [interview, setInterview] = useState({ date: todayIso(), interviewer: '', round: 'Technical', feedback: '' });
  const [showInterview, setShowInterview] = useState(false);
  const [editing, setEditing] = useState(false);
  const [edit, setEdit] = useState({ first_name: '', last_name: '', email: '', phone: '', expected_salary: '', notice_days: '', notes: '', source: '' });
  useEffect(() => { if (c) setEdit({ first_name: c.first_name, last_name: c.last_name || '', email: c.email || '', phone: c.phone || '', expected_salary: c.expected_salary != null ? String(c.expected_salary) : '', notice_days: c.notice_days != null ? String(c.notice_days) : '', notes: c.notes || '', source: c.source || '' }); }, [c?.id, c?.updated_at]);

  const mutate = async (fn: () => Promise<any>, msg?: string) => {
    setBusy(true);
    try {
      const updated = await fn();
      if (updated && updated.id) detail.setData(updated);
      else await detail.reload();
      if (msg) toast.success(msg);
      onChanged();
      refreshCounts();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };
  const setStage = (stage: Stage) => mutate(() => api.put(`/api/recruitment/candidates/${id}`, { stage }), `Moved to ${STAGE_LABEL[stage]}`);
  const setRating = (rating: number | null) => mutate(() => api.put(`/api/recruitment/candidates/${id}`, { rating }));
  const addNote = () => { if (!noteText.trim()) return; mutate(() => api.post(`/api/recruitment/candidates/${id}/events`, { type: 'note', note: noteText.trim() }), 'Note added').then(() => setNoteText('')); };
  const scheduleInterview = () => {
    if (!interview.date) return toast.error('Pick a date');
    mutate(() => api.post(`/api/recruitment/candidates/${id}/events`, { type: 'interview', note: interview.round ? `${interview.round} interview` : 'Interview', data: interview }), 'Interview scheduled').then(() => { setShowInterview(false); setInterview({ date: todayIso(), interviewer: '', round: 'Technical', feedback: '' }); });
  };
  const rescore = () => mutate(() => api.post(`/api/recruitment/candidates/${id}/rescore`, rescoreJd ? { job_description_id: Number(rescoreJd) } : {}), 'Rescored');
  const saveEdit = () => mutate(() => api.put(`/api/recruitment/candidates/${id}`, { ...edit, expected_salary: edit.expected_salary || null, notice_days: edit.notice_days || null }), 'Candidate updated').then(() => setEditing(false));
  const remove = async () => {
    if (!c || !(await confirm('Delete candidate?', `${candidateName(c)} and their CV will be removed permanently.`))) return;
    try { await api.delete(`/api/recruitment/candidates/${id}`); toast.success('Candidate deleted'); onChanged(); refreshCounts(); onClose(); } catch (err) { toast.error(err); }
  };

  const title = c ? (
    <span className="row" style={{ gap: 10 }}>
      <span>{candidateName(c)}</span>
      <Badge color={STAGE_COLOR[c.stage]}>{STAGE_LABEL[c.stage]}</Badge>
      {c.hired_employee_id ? <Link to={`/employees/${c.hired_employee_id}`} className="badge badge-success" data-testid="candidate-employee-link">Employee {c.hired_employee_code}</Link> : null}
    </span>
  ) : 'Candidate';
  const canHire = isHr && c && ['interview', 'offer'].includes(c.stage);
  const b = c?.score_breakdown;
  const currency = company?.currency || 'INR';

  return (
    <Modal open wide title={title} onClose={onClose} testId="candidate-detail"
      footer={c ? (
        <>
          {isHr ? <Button variant="danger" onClick={remove} disabled={busy}>Delete</Button> : null}
          <span style={{ flex: 1 }} />
          {c.cv_stored_name ? <a className="btn" href={cvUrl(c.id)} target="_blank" rel="noreferrer" data-testid="candidate-open-cv"><Icon name="file" size={15} /> Open CV</a> : null}
          <Button onClick={onClose}>Close</Button>
          {c.stage !== 'hired' && isHr ? (
            <Button variant="primary" onClick={() => setHiring(true)} disabled={!canHire || busy} title={canHire ? 'Create the employee record from this candidate' : 'Move the candidate to Interview or Offer first'} data-testid="candidate-hire"><Icon name="userPlus" size={15} /> Hire → Create employee</Button>
          ) : null}
        </>
      ) : undefined}>
      {!c ? (detail.error ? <div className="alert alert-error">{detail.error}</div> : <Spinner />) : (
        <div className="stack cand-detail">
          {/* Header */}
          <div className="cand-head">
            <ScoreRing score={c.score} size={72} testId="score-value" />
            <div className="stack" style={{ gap: 6, flex: 1, minWidth: 220 }}>
              <div className="muted">{c.parsed?.title || c.position_title || '—'}</div>
              <div className="emp-meta">
                {c.email ? <a href={`mailto:${c.email}`}>{c.email}</a> : <span className="muted">No email</span>}
                {c.phone ? <a href={`tel:${c.phone}`}>{c.phone}</a> : null}
                {c.source ? <span><Icon name="compass" size={13} /> {c.source}</span> : null}
                <span>Added {fmtDate(c.created_at)}</span>
              </div>
              <div className="emp-meta">
                <span>Vacancy: {c.vacancy_title ? <Link to={`/recruitment?tab=pipeline&vacancy=${c.vacancy_id}`}>{c.vacancy_title}</Link> : <span className="muted">Unassigned</span>}</span>
                {c.expected_salary ? <span>Expects {fmtMoney(c.expected_salary, currency)}</span> : null}
                {c.notice_days != null ? <span>Notice {c.notice_days} days</span> : null}
              </div>
            </div>
            <div className="stack" style={{ gap: 8, alignItems: 'flex-end' }}>
              <Field label="Stage">
                <Select value={c.stage} disabled={busy || c.stage === 'hired'} onChange={(e) => setStage(e.target.value as Stage)} data-testid="candidate-stage" aria-label="Stage">
                  {STAGES.map((s) => <option key={s} value={s} disabled={s === 'hired' && c.stage !== 'hired'}>{STAGE_LABEL[s]}{s === 'hired' && c.stage !== 'hired' ? ' (use Hire)' : ''}</option>)}
                </Select>
              </Field>
              <Stars value={c.rating} onChange={busy ? undefined : setRating} size={18} />
            </div>
          </div>

          <div className="grid grid-2">
            {/* Score panel */}
            <section className="card" style={{ marginBottom: 0 }} data-testid="score-panel">
              <header className="card-header"><h2 className="card-title">Match score</h2>{b?.jd_title ? <Badge tone={scoreTone(c.score)}>vs {b.jd_title}</Badge> : null}</header>
              <div className="card-body stack">
                {b?.skills ? (
                  <>
                    <BreakdownBars breakdown={b} />
                    <div>
                      <div className="section-title">Matched skills</div>
                      <SkillChips skills={b.skills.matched} tone="success" empty="None of the required skills were found" />
                      {b.skills.partial?.length ? <div className="help" style={{ marginTop: 4 }}>Via synonyms: {b.skills.partial.map((p) => `${p.skill} ← "${p.via}"`).join(', ')}</div> : null}
                    </div>
                    <div>
                      <div className="section-title">Missing skills</div>
                      <SkillChips skills={b.skills.missing} tone="danger" empty="Nothing missing" />
                    </div>
                    {b.requirements?.uncovered?.length ? (
                      <div>
                        <div className="section-title">Requirements not evidenced</div>
                        <ul className="list" style={{ fontSize: 13 }}>{b.requirements.uncovered.map((r) => <li key={r}><span><Icon name="alert" size={13} /> {r}</span></li>)}</ul>
                      </div>
                    ) : null}
                  </>
                ) : <p className="help">{b?.note || 'Not scored yet.'}</p>}
                <div className="row" style={{ borderTop: '1px dashed var(--border)', paddingTop: 10 }}>
                  <Select value={rescoreJd} onChange={(e) => setRescoreJd(e.target.value)} aria-label="Rescore against" data-testid="rescore-jd" style={{ flex: 1, minWidth: 160 }}>
                    <option value="">Rescore against… {c.vacancy_title ? `(vacancy's JD)` : '(position JD)'}</option>
                    {(jds.data || []).map((j) => <option key={j.id} value={j.id}>{j.title}{j.position_title ? ` · ${j.position_title}` : ''}</option>)}
                  </Select>
                  <Button size="sm" onClick={rescore} loading={busy} data-testid="rescore-submit"><Icon name="sparkles" size={14} /> Rescore</Button>
                </div>
              </div>
            </section>

            {/* Parsed CV */}
            <section className="card" style={{ marginBottom: 0 }} data-testid="parsed-panel">
              <header className="card-header"><h2 className="card-title">Parsed CV</h2>{c.cv_original_name ? <span className="help mono" title={c.cv_original_name}>{c.cv_original_name}</span> : <Badge tone="neutral">No file</Badge>}</header>
              <div className="card-body">
                <dl className="kv">
                  <div className="kv-row"><dt>Experience</dt><dd>{c.parsed?.experience_years != null ? `${c.parsed.experience_years} year${c.parsed.experience_years === 1 ? '' : 's'}` : '—'}{c.parsed?.experience_sources?.length ? <div className="help">from: {c.parsed.experience_sources.slice(0, 3).join(' · ')}</div> : null}</dd></div>
                  <div className="kv-row"><dt>Education</dt><dd>{c.parsed?.education?.length ? c.parsed.education.join(', ') : '—'}</dd></div>
                  <div className="kv-row"><dt>Current title</dt><dd>{c.parsed?.title || '—'}</dd></div>
                  <div className="kv-row"><dt>Skills</dt><dd><SkillChips skills={c.parsed?.skills || []} empty="No skills recognised" /></dd></div>
                  <div className="kv-row"><dt>Contact found</dt><dd>{[...(c.parsed?.emails || []), ...(c.parsed?.phones || [])].join(' · ') || '—'}</dd></div>
                </dl>
                {c.parsed?.summary ? <><div className="section-title" style={{ marginTop: 10 }}>Summary</div><p className="help" style={{ margin: 0 }}>{c.parsed.summary}</p></> : null}
                {c.cv_stored_name ? <div style={{ marginTop: 10 }}><a href={cvUrl(c.id)} target="_blank" rel="noreferrer"><Icon name="eye" size={14} /> Open CV</a> · <a href={cvUrl(c.id, true)} download><Icon name="download" size={14} /> Download</a></div> : null}
              </div>
            </section>
          </div>

          {/* Details (editable) */}
          <section className="card" style={{ marginBottom: 0 }}>
            <header className="card-header"><h2 className="card-title">Details</h2>{!editing ? <Button size="sm" onClick={() => setEditing(true)} data-testid="candidate-edit"><Icon name="edit" size={14} /> Edit</Button> : null}</header>
            <div className="card-body">
              {editing ? (
                <div className="form-grid">
                  <Field label="First name" required><Input value={edit.first_name} onChange={(e) => setEdit((s) => ({ ...s, first_name: e.target.value }))} /></Field>
                  <Field label="Last name"><Input value={edit.last_name} onChange={(e) => setEdit((s) => ({ ...s, last_name: e.target.value }))} /></Field>
                  <Field label="Email"><Input type="email" value={edit.email} onChange={(e) => setEdit((s) => ({ ...s, email: e.target.value }))} /></Field>
                  <Field label="Phone"><Input value={edit.phone} onChange={(e) => setEdit((s) => ({ ...s, phone: e.target.value }))} /></Field>
                  <Field label="Source"><Input value={edit.source} onChange={(e) => setEdit((s) => ({ ...s, source: e.target.value }))} /></Field>
                  <Field label="Expected salary"><Input type="number" min={0} value={edit.expected_salary} onChange={(e) => setEdit((s) => ({ ...s, expected_salary: e.target.value }))} /></Field>
                  <Field label="Notice (days)"><Input type="number" min={0} value={edit.notice_days} onChange={(e) => setEdit((s) => ({ ...s, notice_days: e.target.value }))} /></Field>
                  <Field label="Notes" className="span-2"><Textarea rows={2} value={edit.notes} onChange={(e) => setEdit((s) => ({ ...s, notes: e.target.value }))} /></Field>
                  <div className="row end span-2"><Button onClick={() => setEditing(false)}>Cancel</Button><Button variant="primary" loading={busy} onClick={saveEdit}>Save</Button></div>
                </div>
              ) : (
                <dl className="kv">
                  <div className="kv-row"><dt>Position</dt><dd>{c.position_title || '—'}{c.department_name ? <span className="muted"> · {c.department_name}</span> : null}</dd></div>
                  <div className="kv-row"><dt>Job description</dt><dd>{c.jd ? <Link to="/jobs">{c.jd.title} <Badge tone={c.jd.status === 'published' ? 'success' : 'neutral'}>{c.jd.status}</Badge></Link> : <span className="muted">None linked</span>}</dd></div>
                  <div className="kv-row"><dt>Notes</dt><dd style={{ whiteSpace: 'pre-wrap' }}>{c.notes || '—'}</dd></div>
                </dl>
              )}
            </div>
          </section>

          {/* Timeline */}
          <section className="card" style={{ marginBottom: 0 }} data-testid="timeline-panel">
            <header className="card-header"><h2 className="card-title">Timeline</h2>
              <div className="card-actions">
                <Button size="sm" onClick={() => setShowInterview((x) => !x)} data-testid="interview-toggle"><Icon name="calendar" size={14} /> Schedule interview</Button>
              </div>
            </header>
            <div className="card-body stack">
              {showInterview ? (
                <div className="form-grid interview-form" data-testid="interview-form">
                  <Field label="Date" required><Input type="date" value={interview.date} onChange={(e) => setInterview((s) => ({ ...s, date: e.target.value }))} data-testid="interview-date" /></Field>
                  <Field label="Interviewer"><Input value={interview.interviewer} onChange={(e) => setInterview((s) => ({ ...s, interviewer: e.target.value }))} placeholder="e.g. Meera Iyer" data-testid="interview-interviewer" /></Field>
                  <Field label="Round"><Input value={interview.round} onChange={(e) => setInterview((s) => ({ ...s, round: e.target.value }))} /></Field>
                  <Field label="Feedback (optional)"><Input value={interview.feedback} onChange={(e) => setInterview((s) => ({ ...s, feedback: e.target.value }))} /></Field>
                  <div className="row end span-2">
                    {['new', 'screening'].includes(c.stage) ? <span className="help">Scheduling moves the candidate to Interview.</span> : null}
                    <Button onClick={() => setShowInterview(false)}>Cancel</Button>
                    <Button variant="primary" loading={busy} onClick={scheduleInterview} data-testid="interview-submit">Schedule</Button>
                  </div>
                </div>
              ) : null}
              <div className="row">
                <Input value={noteText} placeholder="Add a note…" onChange={(e) => setNoteText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addNote(); } }} style={{ flex: 1, minWidth: 200 }} data-testid="note-input" />
                <Button onClick={addNote} disabled={!noteText.trim() || busy} data-testid="note-submit">Add note</Button>
              </div>
              <Timeline events={c.events || []} />
            </div>
          </section>
        </div>
      )}
      {hiring && c ? <HireModal candidate={c} onClose={() => setHiring(false)} /> : null}
      {dialog}
    </Modal>
  );
}

function Timeline({ events }: { events: CandidateEvent[] }) {
  if (!events.length) return <p className="help">No activity yet.</p>;
  const icon: Record<string, string> = { stage_change: 'route', note: 'edit', interview: 'calendar', score: 'sparkles', hired: 'award' };
  return (
    <ul className="timeline" data-testid="timeline">
      {events.map((e) => (
        <li key={e.id} className={`timeline-item ${e.type}`} data-testid={`event-${e.type}`}>
          <span className="timeline-icon" style={{ background: e.type === 'stage_change' ? STAGE_COLOR[(e.data?.to as Stage) || 'new'] : undefined }}><Icon name={icon[e.type] || 'info'} size={13} /></span>
          <div className="timeline-body">
            <div className="row between">
              <strong>
                {e.type === 'stage_change' ? <>Moved {e.data?.from ? <>from <Badge color={STAGE_COLOR[e.data.from as Stage]}>{STAGE_LABEL[e.data.from as Stage] || e.data.from}</Badge> </> : null}to <Badge color={STAGE_COLOR[e.data?.to as Stage]}>{STAGE_LABEL[e.data?.to as Stage] || e.data?.to}</Badge></>
                  : e.type === 'interview' ? <>Interview{e.data?.round ? ` · ${e.data.round}` : ''}{e.data?.date ? ` on ${fmtDate(e.data.date)}` : ''}</>
                  : e.type === 'score' ? 'Scored' : e.type === 'hired' ? 'Hired' : 'Note'}
              </strong>
              <span className="help">{fmtDateTime(e.created_at)}{e.by_email ? ` · ${e.by_email}` : ''}</span>
            </div>
            {e.note ? <div style={{ marginTop: 2 }}>{e.note}</div> : null}
            {e.type === 'interview' && (e.data?.interviewer || e.data?.feedback) ? <div className="help" style={{ marginTop: 2 }}>{e.data.interviewer ? <>Interviewer: {e.data.interviewer}</> : null}{e.data.feedback ? <> · Feedback: {e.data.feedback}</> : null}{e.data.outcome ? <> · Outcome: {e.data.outcome}</> : null}</div> : null}
          </div>
        </li>
      ))}
    </ul>
  );
}
