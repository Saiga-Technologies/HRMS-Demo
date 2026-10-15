import React, { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { fmtDate, fmtMoney, label } from '../lib/format';
import { usePageTour, useTour, type TourStep } from '../lib/tour';
import { useTheme } from '../lib/theme';
import { Icon } from '../components/Icons';
import { Button, Card, Field, Input, Textarea, Select, FileInput, EmptyState, Spinner, SearchInput, useFetch, useToast } from '../components/ui';

interface Job {
  id: number; title: string; openings: number; opened_at: string | null; created_at: string; department_name: string | null; position_title: string | null;
  summary: string | null; responsibilities: string[] | null; requirements: string[] | null; skills: string[] | null; employment_type: string | null;
  experience_min: number | null; experience_max: number | null; salary_min: number | null; salary_max: number | null; location: string | null;
}
interface Company { name: string; tagline?: string; logo_text?: string; currency: string }

const TOUR: TourStep[] = [
  { title: 'How it works', description: 'Applying takes a few minutes: 1) browse the open roles, 2) search or filter to find yours, 3) open a role to read what it involves, 4) apply with your details and CV, and 5) keep the reference number you get back.' },
  { element: '[data-tour="careers-hero"]', title: 'Open roles', description: 'Every role on this page is open right now, and the count shows how many. Roles are added and removed as hiring needs change, so check back if nothing fits today.' },
  { element: '[data-tour="careers-search"]', title: 'Search roles', description: 'Type a job title or a skill, such as "React" or "payroll", to narrow the list as you type.' },
  { element: '[data-testid="careers-dept"]', title: 'Filter by team', description: 'Show only the roles in one team or department.' },
  { element: '[data-tour="careers-list"]', title: 'The list of roles', description: 'One card per role. If nothing matches your search, clear it or try another keyword.' },
  { element: '[data-testid="job-card"]', title: 'A role at a glance', description: 'The team, location, experience range and type of role, a short summary and the key skills. Click the card to read the full description and apply.' },
  { element: '[data-tour="careers-back"]', title: 'Back to all roles', description: 'Return to the full list at any time to look at other roles.' },
  { element: '[data-tour="careers-meta"]', title: 'Role basics', description: 'The team, location, experience, type of role, the salary range when one is published, and when the role was posted.' },
  { element: '[data-tour="careers-detail"]', title: 'About the role', description: 'A summary, what you will do day to day, what we look for and the skills that matter most. Check these against your CV before you apply.' },
  { element: '[data-tour="careers-apply"]', title: 'Apply for this role', description: 'Your first name and email are required; phone, notice period and a short note help us move faster. No account or password is needed.' },
  { element: '[data-tour="careers-apply"] .file-input', title: 'Attach your CV', description: 'Drag your CV here or click to choose it: PDF, DOCX or TXT, up to 10 MB. A CV is required; the form tells you if it is missing.' },
  { element: '[data-testid="apply-submit"]', title: 'Send it', description: 'Your application goes straight to our recruitment team, who review every one. You can apply once per role; a second application for the same role is refused.' },
  { element: '[data-testid="apply-reference"]', title: 'Your reference', description: 'Keep this reference number and quote it if you contact us about your application.' },
  { element: '[data-tour="careers-theme"]', title: 'Light or dark', description: 'Switch the page between light and dark at any time.' },
  { title: 'What happens next', description: 'Our team reviews your application and replies by email. Meanwhile, you are welcome to apply for other roles that fit you.' },
];

const exp = (j: Job) => (j.experience_min != null || j.experience_max != null ? `${j.experience_min ?? 0}${j.experience_max != null ? `–${j.experience_max}` : '+'} yrs` : null);

export default function Careers() {
  usePageTour('Careers', TOUR);
  const { start } = useTour();
  const { theme, toggle } = useTheme();
  const params = useParams();
  const jobId = Number((params['*'] || '').split('/')[0]) || null;
  const list = useFetch<{ company: Company; jobs: Job[] }>(() => api.get('/api/public/jobs'), []);
  const company = list.data?.company;

  return (
    <div className="careers-page">
      <header className="careers-top">
        <Link to="/careers" className="brand large careers-brand">
          <span className="brand-logo">{company?.logo_text || 'H'}</span>
          <span><span className="brand-name">{company?.name || 'Careers'}</span><br /><small className="muted">Careers</small></span>
        </Link>
        <div className="row">
          <Button variant="ghost" size="sm" onClick={start} data-testid="tour-button"><Icon name="compass" size={15} /> How it works</Button>
          <Button variant="ghost" size="sm" onClick={toggle} data-tour="careers-theme" data-testid="theme-toggle" aria-label="Toggle theme"><Icon name={theme === 'dark' ? 'sun' : 'moon'} size={16} /></Button>
        </div>
      </header>
      <main className="careers-main">
        {list.loading && !list.data ? <Spinner /> : list.error ? <div className="alert alert-error">{list.error}</div> : jobId ? (
          <JobDetail id={jobId} company={company!} />
        ) : (
          <JobList jobs={list.data?.jobs || []} company={company!} />
        )}
      </main>
      <footer className="careers-footer muted">© {new Date().getFullYear()} {company?.name}. We review every application and reply by email.</footer>
    </div>
  );
}

function JobList({ jobs, company }: { jobs: Job[]; company: Company }) {
  const [q, setQ] = useState('');
  const [dept, setDept] = useState('');
  const depts = useMemo(() => [...new Set(jobs.map((j) => j.department_name).filter(Boolean))] as string[], [jobs]);
  const shown = jobs.filter((j) => (!dept || j.department_name === dept) && (!q || `${j.title} ${j.summary || ''} ${(j.skills || []).join(' ')}`.toLowerCase().includes(q.toLowerCase())));
  return (
    <>
      <section className="careers-hero" data-tour="careers-hero">
        <h1>Join {company.name}</h1>
        <p className="muted">{company.tagline || 'Build your career with us.'} {jobs.length ? `${jobs.length} open ${jobs.length === 1 ? 'role' : 'roles'}.` : ''}</p>
      </section>
      <div className="toolbar" data-tour="careers-search">
        <SearchInput value={q} onChange={setQ} placeholder="Search roles or skills…" />
        {depts.length > 1 ? (
          <Select value={dept} onChange={(e) => setDept(e.target.value)} aria-label="Team" data-testid="careers-dept">
            <option value="">All teams</option>
            {depts.map((d) => <option key={d}>{d}</option>)}
          </Select>
        ) : null}
      </div>
      <div className="careers-grid" data-tour="careers-list">
        {shown.length === 0 ? (
          <EmptyState title={jobs.length ? 'No roles match your search' : 'No open roles right now'} description={jobs.length ? 'Try a different keyword or team.' : 'Check back soon — new roles are posted here first.'} />
        ) : shown.map((j) => (
          <Link key={j.id} to={`/careers/${j.id}`} className="careers-card" data-testid="job-card">
            <div className="row between"><strong className="careers-card-title">{j.title}</strong>{j.openings > 1 ? <span className="chip">{j.openings} openings</span> : null}</div>
            <div className="careers-meta">
              {j.department_name ? <span><Icon name="users" size={13} /> {j.department_name}</span> : null}
              {j.location ? <span><Icon name="mapPin" size={13} /> {j.location}</span> : null}
              {exp(j) ? <span><Icon name="briefcase" size={13} /> {exp(j)}</span> : null}
              {j.employment_type ? <span><Icon name="clock" size={13} /> {label(j.employment_type)}</span> : null}
            </div>
            {j.summary ? <p className="careers-summary">{j.summary}</p> : null}
            {j.skills?.length ? <div className="chip-list">{j.skills.slice(0, 6).map((s) => <span key={s} className="chip">{s}</span>)}</div> : null}
            <span className="careers-cta">View and apply <Icon name="chevronRight" size={14} /></span>
          </Link>
        ))}
      </div>
    </>
  );
}

function JobDetail({ id, company }: { id: number; company: Company }) {
  const job = useFetch<{ job: Job }>(() => api.get(`/api/public/jobs/${id}`), [id]);
  if (job.loading && !job.data) return <Spinner />;
  if (job.error || !job.data) {
    return <EmptyState title="This role is no longer open" description={job.error || undefined} action={<Link to="/careers" className="btn btn-primary btn-md">See open roles</Link>} />;
  }
  const j = job.data.job;
  const salary = j.salary_min || j.salary_max ? `${fmtMoney(j.salary_min ?? j.salary_max, company.currency)}${j.salary_max && j.salary_min ? ` – ${fmtMoney(j.salary_max, company.currency)}` : ''} a year` : null;
  return (
    <>
      <Link to="/careers" className="careers-back" data-tour="careers-back"><Icon name="chevronLeft" size={14} /> All open roles</Link>
      <div className="careers-detail">
        <div className="stack" data-tour="careers-detail">
          <div data-tour="careers-meta">
            <h1 className="page-title" data-testid="job-title">{j.title}</h1>
            <div className="careers-meta">
              {j.department_name ? <span><Icon name="users" size={13} /> {j.department_name}</span> : null}
              {j.location ? <span><Icon name="mapPin" size={13} /> {j.location}</span> : null}
              {exp(j) ? <span><Icon name="briefcase" size={13} /> {exp(j)}</span> : null}
              {j.employment_type ? <span><Icon name="clock" size={13} /> {label(j.employment_type)}</span> : null}
              {salary ? <span><Icon name="banknote" size={13} /> {salary}</span> : null}
              {j.opened_at ? <span><Icon name="calendar" size={13} /> Posted {fmtDate(j.opened_at)}</span> : null}
            </div>
          </div>
          {j.summary ? <Card><p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{j.summary}</p></Card> : null}
          {j.responsibilities?.length ? <Card title="What you will do"><ul className="careers-list">{j.responsibilities.map((x, i) => <li key={i}>{x}</li>)}</ul></Card> : null}
          {j.requirements?.length ? <Card title="What we look for"><ul className="careers-list">{j.requirements.map((x, i) => <li key={i}>{x}</li>)}</ul></Card> : null}
          {j.skills?.length ? <Card title="Skills"><div className="chip-list">{j.skills.map((s) => <span key={s} className="chip">{s}</span>)}</div></Card> : null}
        </div>
        <ApplyForm job={j} />
      </div>
    </>
  );
}

function ApplyForm({ job }: { job: Job }) {
  const toast = useToast();
  const [v, setV] = useState({ first_name: '', last_name: '', email: '', phone: '', notice_days: '', notes: '' });
  const [cv, setCv] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ reference: string } | null>(null);
  const bind = (k: keyof typeof v) => ({ value: v[k], onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setV((s) => ({ ...s, [k]: e.target.value })) });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!cv) { setError('Please attach your CV.'); return; }
    const form = new FormData();
    Object.entries(v).forEach(([k, val]) => { if (val) form.append(k, val); });
    form.append('cv', cv);
    setBusy(true);
    try {
      const res = await api.upload<{ reference: string }>(`/api/public/jobs/${job.id}/apply`, form);
      setDone(res);
      toast.success('Application sent');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <Card className="careers-apply" tour="careers-apply">
        <div className="stack" data-testid="apply-success" style={{ alignItems: 'flex-start' }}>
          <span className="stat-icon" style={{ color: 'var(--success)', background: 'var(--success-bg)' }}><Icon name="check" size={20} /></span>
          <h2 style={{ margin: 0 }}>Thank you, {v.first_name}!</h2>
          <p className="muted" style={{ margin: 0 }}>Your application for <strong>{job.title}</strong> is in. Keep this reference if you contact us:</p>
          <span className="mono" style={{ fontSize: 18 }} data-testid="apply-reference">{done.reference}</span>
          <Link to="/careers" className="btn btn-secondary btn-md">See other roles</Link>
        </div>
      </Card>
    );
  }
  return (
    <Card className="careers-apply" title="Apply for this role" tour="careers-apply">
      <form className="stack" onSubmit={submit} data-testid="apply-form">
        <div className="grid grid-2">
          <Field label="First name" required><Input {...bind('first_name')} required maxLength={60} autoComplete="given-name" data-testid="apply-first-name" /></Field>
          <Field label="Last name"><Input {...bind('last_name')} maxLength={60} autoComplete="family-name" data-testid="apply-last-name" /></Field>
        </div>
        <Field label="Email" required><Input type="email" {...bind('email')} required autoComplete="email" data-testid="apply-email" /></Field>
        <div className="grid grid-2">
          <Field label="Phone"><Input type="tel" {...bind('phone')} autoComplete="tel" data-testid="apply-phone" /></Field>
          <Field label="Notice period (days)"><Input type="number" min={0} max={365} {...bind('notice_days')} /></Field>
        </div>
        <Field label="CV" required>
          <FileInput accept=".pdf,.docx,.txt" file={cv} onChange={(f) => setCv(f[0] || null)} hint="PDF, DOCX or TXT, up to 10 MB" testId="apply-cv" />
        </Field>
        <Field label="Anything else we should know?"><Textarea rows={3} {...bind('notes')} maxLength={2000} /></Field>
        {error ? <div className="alert alert-error" role="alert" data-testid="apply-error">{error}</div> : null}
        <Button type="submit" variant="primary" loading={busy} data-testid="apply-submit">Submit application</Button>
        <small className="muted">We use your details only to assess this application.</small>
      </form>
    </Card>
  );
}
