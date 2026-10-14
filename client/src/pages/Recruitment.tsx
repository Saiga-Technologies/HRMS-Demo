import React, { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, qs } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useCounts } from '../lib/notifications';
import { usePageTour } from '../lib/tour';
import { fmtDate } from '../lib/format';
import { Badge, Button, Card, Checkbox, EmptyState, Input, PageHeader, SearchInput, Select, Spinner, Stat, StatusBadge, Table, Tabs, useFetch, useToast } from '../components/ui';
import { BarChart } from '../components/charts';
import { Icon } from '../components/Icons';
import { CandidateCard } from '../components/recruitment/CandidateCard';
import { CandidateModal } from '../components/recruitment/CandidateModal';
import { CandidateDetail } from '../components/recruitment/CandidateDetail';
import { ScoreBar } from '../components/recruitment/ScoreBits';
import { BOARD_STAGES, STAGE_COLOR, STAGE_LABEL, candidateName, type Candidate, type RecruitingVacancy, type RecruitmentSummary, type Stage } from '../components/recruitment/types';

type Tab = 'pipeline' | 'pool' | 'vacancies';
interface Position { id: number; title: string; department_id?: number | null; active?: number }

const TOUR = [
  { element: '[data-tour="recruitment-stats"]', title: 'Hiring at a glance', description: 'How many candidates are in the pool, how many are new or being interviewed, and the average match score.' },
  { element: '[data-tour="recruitment-add"]', title: 'Upload CVs', description: 'Drop a PDF, DOCX or TXT CV. The text is extracted, parsed (experience, education, skills, contact) and scored against the vacancy’s job description straight away. Bulk upload handles several files in one go.' },
  { element: '[data-tour="recruitment-tabs"]', title: 'Three views', description: 'Pipeline is a kanban board per stage, CV pool is the sortable table of everyone, Vacancies shows the funnel for each open role. Red badges count new candidates and scheduled interviews.' },
  { element: '[data-tour="recruitment-filters"]', title: 'Filter the pool', description: 'Narrow to one vacancy, search by name, email or skill, and hide weak matches with a minimum score.' },
  { element: '[data-tour="recruitment-board"]', title: 'Move candidates along', description: 'Drag a card to another column (or use the arrows) to change the stage. Click a card to open the full profile with the explainable score, parsed CV and timeline.' },
  { element: '[data-tour="recruitment-pool"]', title: 'CV pool', description: 'Every candidate with score, experience, education and stage. Sort by score to shortlist quickly.' },
  { element: '[data-tour="recruitment-vacancies"]', title: 'Vacancy funnels', description: 'Openings, hires and the stage funnel for each vacancy. Hiring a candidate from the Interview or Offer stage creates the employee record, completes the recruitment journey stages and closes the vacancy when all openings are filled.' },
];

export default function Recruitment() {
  usePageTour('Recruitment', TOUR);
  const { isHr } = useAuth();
  const { counts, refreshCounts } = useCounts();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const tab: Tab = params.get('tab') === 'pool' ? 'pool' : params.get('tab') === 'vacancies' ? 'vacancies' : 'pipeline';
  const vacancyParam = params.get('vacancy') || '';
  const candidateParam = params.get('candidate');
  const setParam = (k: string, v: string | null) => setParams((p) => { const n = new URLSearchParams(p); if (v) n.set(k, v); else n.delete(k); return n; }, { replace: true });
  const setTab = (k: string) => setParam('tab', k);

  const [q, setQ] = useState('');
  const [dq, setDq] = useState('');
  const [minScore, setMinScore] = useState('');
  const [adding, setAdding] = useState<null | 'single' | 'bulk'>(null);
  const [includeClosed, setIncludeClosed] = useState(false);
  useEffect(() => { const t = setTimeout(() => setDq(q.trim()), 250); return () => clearTimeout(t); }, [q]);

  const summary = useFetch<RecruitmentSummary>(() => api.get('/api/recruitment/summary'), []);
  const vacancies = useFetch<RecruitingVacancy[]>(() => api.get('/api/recruitment/vacancies?all=1'), []);
  const positions = useFetch<Position[]>(() => api.get('/api/org/positions'), []);
  const list = useFetch<{ items: Candidate[]; total: number }>(
    () => api.get(`/api/recruitment/candidates${qs({ vacancy_id: vacancyParam, q: dq, min_score: minScore, sort: tab === 'pool' ? 'score' : 'created' })}`),
    [vacancyParam, dq, minScore, tab],
  );
  const reloadAll = () => { list.reload(); summary.reload(); vacancies.reload(); refreshCounts(); };
  const candidates = list.data?.items || [];
  const s = summary.data;

  const move = async (c: Candidate, stage: Stage) => {
    if (c.stage === stage) return;
    if (stage === 'hired') return toast.error('Open the candidate and use "Hire → Create employee"');
    try {
      await api.put(`/api/recruitment/candidates/${c.id}`, { stage });
      toast.success(`${candidateName(c)} moved to ${STAGE_LABEL[stage]}`);
      reloadAll();
    } catch (err) {
      toast.error(err);
    }
  };

  const vacancyOptions = (vacancies.data || []).filter((v) => v.status === 'open' || String(v.id) === vacancyParam || includeClosed);

  return (
    <>
      <PageHeader
        title="Recruitment"
        subtitle="CV pool, ATS-style scoring against job descriptions, pipeline and hiring into the employee journey."
        actions={(
          <div className="row" data-tour="recruitment-add">
            <Button onClick={() => setAdding('bulk')} data-testid="candidate-bulk-add"><Icon name="upload" size={15} /> Bulk upload</Button>
            <Button variant="primary" onClick={() => setAdding('single')} data-testid="candidate-add"><Icon name="plus" size={15} /> Upload CV / Add candidate</Button>
          </div>
        )}
      />

      <div className="stat-strip" data-tour="recruitment-stats">
        <Stat label="Candidates" value={s ? s.total : '…'} icon="users" hint={s ? `${s.unassigned} unassigned` : undefined} onClick={() => { setTab('pool'); setParam('vacancy', null); }} />
        <Stat label="New" value={s ? s.stages.new : '…'} icon="sparkles" color={STAGE_COLOR.new} onClick={() => setTab('pipeline')} />
        <Stat label="Interviewing" value={s ? s.stages.interview : '…'} icon="calendar" color={STAGE_COLOR.interview} onClick={() => setTab('pipeline')} />
        <Stat label="Offers" value={s ? s.stages.offer : '…'} icon="award" color={STAGE_COLOR.offer} onClick={() => setTab('pipeline')} />
        <Stat label="Hired" value={s ? s.stages.hired : '…'} icon="check" color={STAGE_COLOR.hired} />
        <Stat label="Avg score" value={s ? (s.avg_score ?? '–') : '…'} icon="trendingUp" hint={s ? `${s.scored} scored` : undefined} />
      </div>

      <Tabs tour="recruitment-tabs" value={tab} onChange={setTab} tabs={[
        { key: 'pipeline', label: 'Pipeline', icon: 'route', badge: (counts.candidates_new || 0) + (counts.candidates_interview || 0) },
        { key: 'pool', label: 'CV pool', icon: 'folder', count: s?.total, badge: counts.candidates_new },
        { key: 'vacancies', label: 'Vacancies', icon: 'briefcase', count: (vacancies.data || []).filter((v) => v.status === 'open').length },
      ]} />

      {tab !== 'vacancies' ? (
        <div className="toolbar" data-tour="recruitment-filters">
          <Select value={vacancyParam} onChange={(e) => setParam('vacancy', e.target.value || null)} aria-label="Vacancy" data-testid="filter-vacancy">
            <option value="">All vacancies</option>
            {vacancyOptions.map((v) => <option key={v.id} value={v.id}>{v.title}{v.status !== 'open' ? ` (${v.status})` : ''}</option>)}
          </Select>
          <SearchInput value={q} onChange={setQ} placeholder="Search name, email, skill…" />
          <label className="row" style={{ gap: 6 }}>
            <span className="help">Min score</span>
            <Input type="number" min={0} max={100} value={minScore} onChange={(e) => setMinScore(e.target.value)} placeholder="0" style={{ width: 80 }} aria-label="Minimum score" data-testid="filter-min-score" />
          </label>
          {vacancyParam || q || minScore ? <Button variant="ghost" size="sm" onClick={() => { setQ(''); setMinScore(''); setParam('vacancy', null); }}>Clear</Button> : null}
          <span className="muted" style={{ marginLeft: 'auto' }}>{list.loading && !list.data ? '…' : `${candidates.length} candidate${candidates.length === 1 ? '' : 's'}`}</span>
        </div>
      ) : null}

      {tab === 'pipeline' ? (
        <PipelineBoard candidates={candidates} loading={list.loading && !list.data} onOpen={(c) => setParam('candidate', String(c.id))} onMove={move} />
      ) : tab === 'pool' ? (
        <Card padded={false} tour="recruitment-pool">
          {list.error ? <div className="alert alert-error" style={{ margin: 12 }}>{list.error}</div> : null}
          <Table<Candidate>
            loading={list.loading && !list.data}
            rows={candidates}
            empty={vacancyParam || dq || minScore ? 'No candidates match these filters.' : 'No candidates yet. Upload a CV to start the pool.'}
            onRowClick={(c) => setParam('candidate', String(c.id))}
            columns={[
              { key: 'name', header: 'Candidate', render: (c) => <span><strong data-testid="pool-candidate-name">{candidateName(c)}</strong><div className="muted">{c.parsed?.title || c.source || '—'}</div></span> },
              { key: 'email', header: 'Contact', render: (c) => <span>{c.email || '—'}{c.phone ? <div className="muted">{c.phone}</div> : null}</span> },
              { key: 'vacancy_title', header: 'Vacancy', render: (c) => c.vacancy_title ? <span>{c.vacancy_title}<div className="muted">{c.position_title}</div></span> : <Badge tone="neutral">Unassigned</Badge> },
              { key: 'score', header: 'Score', width: '150px', render: (c) => <ScoreBar score={c.score} /> },
              { key: 'experience', header: 'Experience', align: 'right', render: (c) => (c.parsed?.experience_years != null ? `${c.parsed.experience_years} yrs` : '—') },
              { key: 'education', header: 'Education', render: (c) => c.parsed?.education?.length ? c.parsed.education.slice(0, 2).join(', ') : '—' },
              { key: 'stage', header: 'Stage', render: (c) => <Badge color={STAGE_COLOR[c.stage]}>{STAGE_LABEL[c.stage]}</Badge> },
              { key: 'created_at', header: 'Added', render: (c) => fmtDate(c.created_at) },
            ]}
          />
        </Card>
      ) : (
        <VacanciesTab vacancies={vacancies.data || []} loading={vacancies.loading && !vacancies.data} includeClosed={includeClosed} setIncludeClosed={setIncludeClosed} isHr={isHr} onView={(id) => { setParams((p) => { const n = new URLSearchParams(p); n.set('tab', 'pipeline'); n.set('vacancy', String(id)); return n; }); }} onRescored={reloadAll} />
      )}

      {adding ? (
        <CandidateModal
          bulk={adding === 'bulk'}
          vacancies={vacancies.data || []}
          positions={(positions.data || []).filter((p) => p.active !== 0)}
          defaultVacancyId={vacancyParam ? Number(vacancyParam) : null}
          onClose={() => setAdding(null)}
          onCreated={() => reloadAll()}
        />
      ) : null}
      {candidateParam ? <CandidateDetail id={Number(candidateParam)} onClose={() => setParam('candidate', null)} onChanged={reloadAll} /> : null}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Kanban                                                              */
/* ------------------------------------------------------------------ */
function PipelineBoard({ candidates, loading, onOpen, onMove }: { candidates: Candidate[]; loading: boolean; onOpen: (c: Candidate) => void; onMove: (c: Candidate, stage: Stage) => void }) {
  const { isManager } = useAuth();
  const [over, setOver] = useState<Stage | null>(null);
  const byStage = useMemo(() => {
    const m: Record<Stage, Candidate[]> = { new: [], screening: [], interview: [], offer: [], hired: [], rejected: [], withdrawn: [] };
    for (const c of candidates) (c.stage === 'withdrawn' ? m.rejected : m[c.stage]).push(c);
    for (const k of Object.keys(m) as Stage[]) m[k].sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
    return m;
  }, [candidates]);
  if (loading) return <Card><Spinner /></Card>;
  return (
    <div className="kanban" data-tour="recruitment-board" data-testid="pipeline-board">
      {BOARD_STAGES.map((stage) => (
        <div
          key={stage}
          className={`kanban-col ${over === stage ? 'over' : ''} ${stage === 'hired' ? 'locked' : ''}`}
          data-testid={`column-${stage}`}
          onDragOver={(e) => { if (stage === 'hired') return; e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (over !== stage) setOver(stage); }}
          onDragLeave={() => setOver((o) => (o === stage ? null : o))}
          onDrop={(e) => {
            e.preventDefault();
            setOver(null);
            const id = Number(e.dataTransfer.getData('text/candidate'));
            const c = candidates.find((x) => x.id === id);
            if (c) onMove(c, stage);
          }}>
          <div className="kanban-head">
            <span className="kanban-dot" style={{ background: STAGE_COLOR[stage] }} />
            <strong>{STAGE_LABEL[stage]}</strong>
            <span className="tab-count">{byStage[stage].length}</span>
          </div>
          <div className="kanban-body">
            {byStage[stage].length === 0 ? <div className="kanban-empty">{stage === 'hired' ? 'Hire from the candidate detail' : 'Drop candidates here'}</div> : null}
            {byStage[stage].map((c) => <CandidateCard key={c.id} c={c} canMove={isManager} onOpen={() => onOpen(c)} onMove={(st) => onMove(c, st)} />)}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Vacancies                                                           */
/* ------------------------------------------------------------------ */
function VacanciesTab({ vacancies, loading, includeClosed, setIncludeClosed, isHr, onView, onRescored }: { vacancies: RecruitingVacancy[]; loading: boolean; includeClosed: boolean; setIncludeClosed: (v: boolean) => void; isHr: boolean; onView: (id: number) => void; onRescored: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState<number | null>(null);
  const rows = vacancies.filter((v) => includeClosed || v.status === 'open');
  const rescoreAll = async (v: RecruitingVacancy) => {
    setBusy(v.id);
    try {
      const r = await api.post<{ candidates: number; scored: number }>(`/api/recruitment/vacancies/${v.id}/rescore-all`);
      toast.success(`Rescored ${r.scored} of ${r.candidates} candidates`);
      onRescored();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(null);
    }
  };
  if (loading) return <Card><Spinner /></Card>;
  return (
    <>
      <div className="toolbar">
        <Checkbox label="Include on-hold, filled and closed" checked={includeClosed} onChange={(e) => setIncludeClosed(e.target.checked)} />
        {isHr ? <Link className="btn btn-sm" to="/jobs?tab=vacancies">Manage vacancies</Link> : null}
      </div>
      {!rows.length ? <Card><EmptyState title="No open vacancies" description="Raise a vacancy under Jobs → Vacancies to start sourcing." action={isHr ? <Link className="btn btn-primary" to="/jobs?tab=vacancies">Open Jobs</Link> : undefined} /></Card> : (
        <div className="vac-grid" data-tour="recruitment-vacancies">
          {rows.map((v) => {
            const funnel = BOARD_STAGES.filter((st) => st !== 'rejected').map((st) => ({ label: STAGE_LABEL[st], value: v.stages[st] || 0, color: STAGE_COLOR[st], key: st }));
            const pct = Math.min(100, Math.round(((v.hired_count || 0) / Math.max(1, v.openings)) * 100));
            return (
              <Card key={v.id} className="vac-card" title={<span className="row" style={{ gap: 8 }}>{v.title}<StatusBadge status={v.status} /></span>} actions={<span className="help">{v.department_name || '—'} · {v.position_title || '—'}</span>}>
                <div className="stack" style={{ gap: 10 }}>
                  <div className="row between">
                    <span className="help">Openings <strong>{v.openings}</strong> · Hired <strong>{v.hired_count || 0}</strong></span>
                    <span className="help">{v.candidates} candidate{v.candidates === 1 ? '' : 's'}{v.avg_score != null ? ` · avg ${v.avg_score}` : ''}{v.top_score != null ? ` · top ${v.top_score}` : ''}</span>
                  </div>
                  <div className="progress" title={`${v.hired_count || 0} of ${v.openings} filled`}><span style={{ width: `${pct}%`, background: STAGE_COLOR.hired }} /></div>
                  <BarChart data={funnel} horizontal onSelect={() => onView(v.id)} />
                  <div className="row between" style={{ borderTop: '1px dashed var(--border)', paddingTop: 8 }}>
                    <span className="help">{v.job_description_id ? <Link to="/jobs">JD: {v.jd_title} {v.jd_status !== 'published' ? <Badge tone="warning">{v.jd_status}</Badge> : null}</Link> : <span><Icon name="alert" size={13} /> No job description linked — candidates cannot be scored</span>}</span>
                    <span className="row">
                      {v.job_description_id ? <Button size="sm" loading={busy === v.id} onClick={() => rescoreAll(v)} title="Re-run parsing and scoring for every candidate of this vacancy"><Icon name="sparkles" size={14} /> Rescore all</Button> : null}
                      <Button size="sm" variant="primary" onClick={() => onView(v.id)} data-testid={`vacancy-view-${v.id}`}>View candidates</Button>
                    </span>
                  </div>
                  {v.opened_at ? <span className="help">Opened {fmtDate(v.opened_at)}</span> : null}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
