import React, { useMemo, useState } from 'react';
import { api } from '../../lib/api';
import { Badge, Button, Field, FileInput, Input, Modal, Select, Textarea, useToast } from '../ui';
import { Icon } from '../Icons';
import { ScoreRing, SkillChips } from './ScoreBits';
import { SOURCES, candidateName, type Candidate, type RecruitingVacancy } from './types';

interface Position { id: number; title: string; department_id?: number | null }

/**
 * "Upload CV / Add candidate" modal. Single mode: one CV (or manual entry) → shows the parsed summary
 * and score straight away. Bulk mode: several files → sequential uploads with a progress list.
 */
export function CandidateModal({ vacancies, positions, defaultVacancyId, onClose, onCreated, bulk: bulkInitial = false }: { vacancies: RecruitingVacancy[]; positions: Position[]; defaultVacancyId?: number | null; onClose: () => void; onCreated: (c: Candidate | null) => void; bulk?: boolean }) {
  const toast = useToast();
  const [bulk, setBulk] = useState(bulkInitial);
  const [files, setFiles] = useState<File[]>([]);
  const [v, setV] = useState({ vacancy_id: defaultVacancyId ? String(defaultVacancyId) : '', position_id: '', first_name: '', last_name: '', email: '', phone: '', source: '', notes: '', expected_salary: '', notice_days: '', cv_text: '' });
  const set = (k: keyof typeof v, val: string) => setV((s) => ({ ...s, [k]: val }));
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Candidate | null>(null);
  const [progress, setProgress] = useState<{ name: string; status: 'pending' | 'uploading' | 'done' | 'error'; message?: string; candidate?: Candidate }[]>([]);
  const [manual, setManual] = useState(false);

  const openVacancies = useMemo(() => vacancies.filter((x) => x.status === 'open' || String(x.id) === v.vacancy_id), [vacancies, v.vacancy_id]);
  const pickVacancy = (id: string) => {
    const vac = vacancies.find((x) => String(x.id) === id);
    setV((s) => ({ ...s, vacancy_id: id, position_id: vac?.position_id ? String(vac.position_id) : s.position_id }));
  };
  const form = (extra: Record<string, string> = {}) => {
    const fd = new FormData();
    for (const [k, val] of Object.entries({ ...v, ...extra })) if (val !== '' && k !== 'cv_text') fd.append(k, val);
    return fd;
  };

  const submitSingle = async () => {
    const file = files[0];
    if (!file && !manual) return toast.error('Choose a CV file, or switch to manual entry');
    if (manual && !v.first_name.trim()) return toast.error('First name is required for manual entry');
    setBusy(true);
    try {
      let created: Candidate;
      if (file) {
        const fd = form();
        fd.append('cv', file);
        created = await api.upload<Candidate>('/api/recruitment/candidates', fd);
      } else {
        created = await api.post<Candidate>('/api/recruitment/candidates', { ...v, vacancy_id: v.vacancy_id || null, position_id: v.position_id || null, expected_salary: v.expected_salary || null, notice_days: v.notice_days || null });
      }
      setResult(created);
      setV((s) => ({ ...s, first_name: created.first_name, last_name: created.last_name || '', email: created.email || '', phone: created.phone || '' }));
      toast.success(created.score !== null ? `Parsed and scored ${created.score} / 100` : 'Candidate added');
      onCreated(created);
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };

  const submitBulk = async () => {
    if (!files.length) return toast.error('Choose one or more CV files');
    setBusy(true);
    const list = files.map((f) => ({ name: f.name, status: 'pending' as const }));
    setProgress(list);
    let ok = 0;
    for (let i = 0; i < files.length; i++) {
      setProgress((p) => p.map((x, j) => (j === i ? { ...x, status: 'uploading' } : x)));
      try {
        const fd = form({ first_name: '', last_name: '', email: '', phone: '' });
        fd.append('cv', files[i]);
        const c = await api.upload<Candidate>('/api/recruitment/candidates', fd);
        ok++;
        setProgress((p) => p.map((x, j) => (j === i ? { ...x, status: 'done', candidate: c, message: `${candidateName(c)} · score ${c.score ?? '–'}` } : x)));
      } catch (err: any) {
        setProgress((p) => p.map((x, j) => (j === i ? { ...x, status: 'error', message: err?.message || 'Failed' } : x)));
      }
    }
    setBusy(false);
    setFiles([]);
    if (ok) { toast.success(`${ok} of ${files.length} CV${files.length === 1 ? '' : 's'} added`); onCreated(null); }
  };

  const title = bulk ? 'Bulk upload CVs' : result ? `Added ${candidateName(result)}` : 'Upload CV / Add candidate';
  return (
    <Modal open wide title={title} onClose={onClose} testId="candidate-modal"
      footer={result ? (
        <>
          <Button onClick={() => { setResult(null); setFiles([]); setV((s) => ({ ...s, first_name: '', last_name: '', email: '', phone: '', notes: '', cv_text: '' })); }}>Add another</Button>
          <Button variant="primary" onClick={onClose} data-testid="candidate-done">Done</Button>
        </>
      ) : (
        <>
          <Button onClick={onClose}>{progress.length && !busy ? 'Close' : 'Cancel'}</Button>
          <Button variant="primary" loading={busy} onClick={bulk ? submitBulk : submitSingle} data-testid="candidate-submit">{bulk ? `Upload ${files.length || ''} CV${files.length === 1 ? '' : 's'}` : file1Label(files, manual)}</Button>
        </>
      )}>
      {result ? <ParsedResult c={result} /> : (
        <div className="stack">
          <div className="row between">
            <div className="row">
              <Button size="sm" variant={!bulk ? 'primary' : 'secondary'} onClick={() => { setBulk(false); setFiles([]); }}>Single</Button>
              <Button size="sm" variant={bulk ? 'primary' : 'secondary'} onClick={() => { setBulk(true); setManual(false); setFiles([]); }} data-testid="candidate-bulk">Bulk</Button>
            </div>
            {!bulk ? <label className="checkbox"><input type="checkbox" checked={manual} onChange={(e) => setManual(e.target.checked)} data-testid="candidate-manual" /><span>Manual entry (no file)</span></label> : null}
          </div>
          <div className="form-grid">
            <Field label="Vacancy" hint="Picking a vacancy fills the position and selects the job description to score against">
              <Select value={v.vacancy_id} onChange={(e) => pickVacancy(e.target.value)} data-testid="candidate-vacancy">
                <option value="">— Unassigned (CV pool) —</option>
                {openVacancies.map((x) => <option key={x.id} value={x.id}>{x.title}{x.status !== 'open' ? ` (${x.status})` : ''}</option>)}
              </Select>
            </Field>
            <Field label="Position">
              <Select value={v.position_id} onChange={(e) => set('position_id', e.target.value)}>
                <option value="">— None —</option>
                {positions.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
              </Select>
            </Field>
            {!manual ? (
              <div className="span-2">
                <FileInput accept=".pdf,.docx,.txt" multiple={bulk} file={files} onChange={(list) => setFiles(bulk ? list : list.slice(0, 1))} hint="Accepted: PDF, DOCX, TXT · max 10 MB each. Name, email and phone are read from the CV." testId="cv-file" disabled={busy} />
              </div>
            ) : null}
            {!bulk ? (
              <>
                <Field label="First name" required={manual} hint={manual ? undefined : 'Optional: filled from the CV when blank'}><Input value={v.first_name} onChange={(e) => set('first_name', e.target.value)} data-testid="candidate-first-name" /></Field>
                <Field label="Last name"><Input value={v.last_name} onChange={(e) => set('last_name', e.target.value)} /></Field>
                <Field label="Email"><Input type="email" value={v.email} onChange={(e) => set('email', e.target.value)} /></Field>
                <Field label="Phone"><Input value={v.phone} onChange={(e) => set('phone', e.target.value)} /></Field>
              </>
            ) : null}
            <Field label="Source">
              <Select value={v.source} onChange={(e) => set('source', e.target.value)} data-testid="candidate-source">
                <option value="">— Select —</option>
                {SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
              </Select>
            </Field>
            {!bulk ? (
              <>
                <Field label="Expected salary (annual)"><Input type="number" min={0} value={v.expected_salary} onChange={(e) => set('expected_salary', e.target.value)} /></Field>
                <Field label="Notice period (days)"><Input type="number" min={0} value={v.notice_days} onChange={(e) => set('notice_days', e.target.value)} /></Field>
                {manual ? <Field label="CV text (optional)" className="span-2" hint="Paste the CV text to parse and score it"><Textarea rows={6} value={v.cv_text} onChange={(e) => set('cv_text', e.target.value)} data-testid="candidate-cv-text" /></Field> : null}
                <Field label="Notes" className="span-2"><Textarea rows={2} value={v.notes} onChange={(e) => set('notes', e.target.value)} /></Field>
              </>
            ) : null}
          </div>
          {bulk && progress.length ? (
            <ul className="list upload-progress" data-testid="bulk-progress">
              {progress.map((p, i) => (
                <li key={i}>
                  <span className="row" style={{ gap: 8 }}>
                    {p.status === 'uploading' ? <span className="spinner" /> : p.status === 'done' ? <Icon name="check" size={14} className="ok" /> : p.status === 'error' ? <Icon name="alert" size={14} className="err" /> : <Icon name="file" size={14} />}
                    <span>{p.name}</span>
                  </span>
                  <span className="meta">{p.status === 'pending' ? 'Waiting' : p.status === 'uploading' ? 'Uploading…' : p.message}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      )}
    </Modal>
  );
}
const file1Label = (files: File[], manual: boolean) => (manual ? 'Add candidate' : files.length ? 'Upload & score' : 'Upload CV');

/** Parsed summary + score shown right after a successful upload. */
function ParsedResult({ c }: { c: Candidate }) {
  const b = c.score_breakdown;
  return (
    <div className="stack" data-testid="candidate-result">
      <div className="row between">
        <div>
          <div style={{ fontSize: 18, fontWeight: 700 }}>{candidateName(c)}</div>
          <div className="muted">{c.parsed?.title || '—'}{c.email ? ` · ${c.email}` : ''}{c.phone ? ` · ${c.phone}` : ''}</div>
          <div className="muted" style={{ marginTop: 4 }}>{c.vacancy_title ? <>Vacancy: <strong>{c.vacancy_title}</strong></> : <Badge tone="neutral">Unassigned</Badge>}</div>
        </div>
        <div className="row" style={{ gap: 12 }}>
          <ScoreRing score={c.score} size={64} testId="score-value" />
          <div className="help" style={{ maxWidth: 200 }}>{b?.jd_title ? <>Scored against <strong>{b.jd_title}</strong></> : b?.note || 'Not scored'}</div>
        </div>
      </div>
      <div className="grid grid-2">
        <div>
          <div className="section-title">Parsed from the CV</div>
          <dl className="kv">
            <div className="kv-row"><dt>Experience</dt><dd>{c.parsed?.experience_years != null ? `${c.parsed.experience_years} yrs` : '—'}</dd></div>
            <div className="kv-row"><dt>Education</dt><dd>{c.parsed?.education?.length ? c.parsed.education.join(', ') : '—'}</dd></div>
            <div className="kv-row"><dt>Skills</dt><dd><SkillChips skills={c.parsed?.skills || []} max={12} /></dd></div>
          </dl>
        </div>
        <div>
          <div className="section-title">Match</div>
          {b?.skills ? (
            <dl className="kv">
              <div className="kv-row"><dt>Matched</dt><dd><SkillChips skills={b.skills.matched} tone="success" empty="None" /></dd></div>
              <div className="kv-row"><dt>Missing</dt><dd><SkillChips skills={b.skills.missing} tone="danger" empty="None" /></dd></div>
              <div className="kv-row"><dt>Experience</dt><dd>{b.experience?.note}</dd></div>
            </dl>
          ) : <p className="help">{b?.note || 'Attach the candidate to a vacancy with a published job description to score them.'}</p>}
        </div>
      </div>
      {c.parsed?.summary ? <p className="help" style={{ margin: 0 }}>{c.parsed.summary}</p> : null}
    </div>
  );
}
