import React, { useMemo, useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { usePageTour, type TourStep } from '../lib/tour';
import { fmtDateTime } from '../lib/format';
import { Avatar, Badge, Button, Card, Field, Input, Modal, PageHeader, SearchInput, Select, Stat, Switch, Table, useConfirm, useFetch, useToast } from '../components/ui';
import { Icon } from '../components/Icons';
import { LogoTile, ROLE_LABEL, plural } from './portfolio/bits';
import './portfolio.css';

interface Member { id: number; email: string; first_name: string; last_name: string; role: string; phone: string | null; active: number; last_login_at: string | null; created_at: string; company_ids: number[]; all_companies: boolean }
interface CompanyLite { id: number; slug: string; name: string; country_code: string; status: string; logo_text: string | null; brand_color: string | null }

const ROLES = ['admin', 'account_manager', 'payroll', 'recruiter'];
const ROLE_HINT: Record<string, string> = {
  owner: 'Everything, including the team and billing.',
  admin: 'All companies, the team, billing and reassignment.',
  account_manager: 'Their own companies: onboarding, services and client relationship.',
  payroll: 'Runs payroll across the companies they are given.',
  recruiter: 'Hiring work for the companies they are given.',
};
const ROLE_TONE: Record<string, 'success' | 'info' | 'warning' | 'neutral'> = { owner: 'success', admin: 'success', account_manager: 'info', payroll: 'warning', recruiter: 'neutral' };

const TOUR: TourStep[] = [
  { title: 'Agency team', description: 'Who works at the agency and which client companies each person covers. Assignments decide what everyone sees: the portfolio, calendar, service desk and billing only show a person the companies they are assigned to. The flow: 1) add a colleague with a role, 2) assign their companies, 3) keep roles and access up to date.' },
  { element: '[data-tour="team-stats"]', title: 'Team at a glance', description: 'Active members (and how many are inactive), account managers and payroll specialists, and the client companies the agency runs. Click a role tile to filter the list to that role.' },
  { element: '[data-tour="team-add"]', title: 'Add a team member', description: 'Owners and admins add a colleague: name, email, role and the client companies they work on. A temporary password is shown once; they change it at first sign-in.' },
  { element: '[data-tour="team-filters"]', title: 'Search and filter', description: 'Find someone by name or email, or filter by role.' },
  { element: '[data-tour="team-table"]', title: 'Team and their companies', description: 'Each person with their role, the companies they cover, their last sign-in and whether the account is active.' },
  { element: '[data-tour="team-table"] .badge', title: 'Roles', description: 'Owner and admin: every company, the team, billing and reassigning account managers. Account manager: their own companies, onboarding new clients and billing for them. Payroll specialist: runs payroll for the companies they are given. Recruiter: hiring work, acting as a manager inside their companies.' },
  { element: '[data-tour="team-table"] .chip', title: 'Company assignments', description: 'Owners and admins always cover all companies. Everyone else sees only the companies listed here; a company\'s account manager is set in the portfolio drawer or when onboarding it.' },
  { element: '[data-tour="team-table"] [data-testid^="team-edit-"]', title: 'Edit access', description: 'Change someone\'s role or companies, or deactivate them when they leave. A deactivated person can no longer sign in; their companies stay as they are.' },
  { element: '[data-tour="team-readonly"]', title: 'Read-only for you', description: 'Only agency owners and admins can add or change team members.' },
  { title: 'What to do next', description: 'Make sure every client company has an account manager and a payroll specialist assigned, so its payroll milestones, filings and requests always have an owner. New clients are added from Add a client company.' },
];

export default function Team() {
  usePageTour('Agency team', TOUR);
  const { agency } = useAuth();
  const canManage = !!agency && ['owner', 'admin'].includes(agency.role);
  const team = useFetch<Member[]>(() => api.get('/api/agency/team'), []);
  const companies = useFetch<CompanyLite[]>(() => api.get('/api/agency/companies?light=1'), []);
  const [q, setQ] = useState('');
  const [role, setRole] = useState('');
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Member | null>(null);
  const [created, setCreated] = useState<{ email: string; temporary_password: string } | null>(null);

  const byId = useMemo(() => new Map((companies.data || []).map((c) => [c.id, c])), [companies.data]);
  const rows = (team.data || []).filter((m) => (!role || m.role === role) && (!q || `${m.first_name} ${m.last_name} ${m.email}`.toLowerCase().includes(q.toLowerCase())));
  const all = team.data || [];
  const active = all.filter((m) => m.active);

  return (
    <div className="pf-page">
      <PageHeader title="Agency team" subtitle="The people at Saiga HR Services, their roles and the client companies each one covers."
        actions={canManage ? <span data-tour="team-add"><Button variant="primary" onClick={() => setAdding(true)} data-testid="team-add"><Icon name="userPlus" size={15} /> Add team member</Button></span> : undefined} />

      <div className="stat-strip" data-tour="team-stats">
        <Stat label="Active members" value={team.data ? active.length : '…'} icon="users" color="var(--brand)" hint={team.data ? `${all.length - active.length} inactive` : undefined} />
        <Stat label="Account managers" value={team.data ? active.filter((m) => m.role === 'account_manager').length : '…'} icon="briefcase" color="var(--info)" onClick={() => setRole('account_manager')} />
        <Stat label="Payroll specialists" value={team.data ? active.filter((m) => m.role === 'payroll').length : '…'} icon="banknote" color="var(--warning)" onClick={() => setRole('payroll')} />
        <Stat label="Client companies" value={companies.data ? companies.data.filter((c) => c.status !== 'offboarded').length : '…'} icon="building" color="var(--accent)" />
      </div>

      <div className="toolbar" data-tour="team-filters">
        <SearchInput value={q} onChange={setQ} placeholder="Search name or email…" />
        <Select value={role} onChange={(e) => setRole(e.target.value)} aria-label="Role" data-testid="team-filter-role">
          <option value="">All roles</option>
          {['owner', ...ROLES].map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
        </Select>
        {q || role ? <Button size="sm" variant="ghost" onClick={() => { setQ(''); setRole(''); }}>Clear</Button> : null}
        <span className="muted" style={{ marginLeft: 'auto' }}>{team.data ? plural(rows.length, 'person', 'people') : ''}</span>
      </div>

      <Card padded={false} tour="team-table">
        {team.error ? <div className="alert alert-error" style={{ margin: 12 }}>{team.error}</div> : null}
        <Table<Member>
          rows={rows}
          loading={team.loading && !team.data}
          onRowClick={canManage ? (m) => setEditing(m) : undefined}
          empty="No team members match."
          columns={[
            { key: 'name', header: 'Name', render: (m) => <span className="pf-table-name"><Avatar name={`${m.first_name} ${m.last_name}`} size={30} /><span><strong data-testid="team-row-name">{m.first_name} {m.last_name}</strong><div className="muted">{m.email}</div></span></span> },
            { key: 'role', header: 'Role', render: (m) => <Badge tone={ROLE_TONE[m.role] || 'neutral'}>{ROLE_LABEL[m.role] || m.role}</Badge> },
            { key: 'companies', header: 'Companies', render: (m) => (m.all_companies ? <span className="chip">All companies</span> : m.company_ids.length ? (
              <span className="pf-chips">
                {m.company_ids.slice(0, 4).map((id) => { const c = byId.get(id); return c ? <span key={id} className="chip pf-co-chip"><LogoTile c={c} size="sm" />{c.name}</span> : null; })}
                {m.company_ids.length > 4 ? <span className="chip chip-muted">+{m.company_ids.length - 4}</span> : null}
              </span>) : <span className="muted">None assigned</span>) },
            { key: 'login', header: 'Last sign-in', render: (m) => (m.last_login_at ? fmtDateTime(m.last_login_at) : <span className="muted">Never</span>) },
            { key: 'active', header: 'Status', render: (m) => (m.active ? <Badge tone="success">Active</Badge> : <Badge tone="neutral">Inactive</Badge>) },
            ...(canManage ? [{ key: 'edit', header: '', align: 'right' as const, render: (m: Member) => <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); setEditing(m); }} data-testid={`team-edit-${m.id}`}><Icon name="edit" size={14} /> Edit</Button> }] : []),
          ]}
        />
      </Card>
      {!canManage ? <p className="help" data-tour="team-readonly">You have read-only access. Agency owners and admins manage the team.</p> : null}

      {adding ? <MemberModal companies={companies.data || []} onClose={() => setAdding(false)} onSaved={(r) => { setAdding(false); team.reload(); if (r) setCreated(r); }} /> : null}
      {editing ? <MemberModal member={editing} companies={companies.data || []} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); team.reload(); }} /> : null}
      {created ? <PasswordModal {...created} onClose={() => setCreated(null)} /> : null}
    </div>
  );
}

function MemberModal({ member, companies, onClose, onSaved }: { member?: Member; companies: CompanyLite[]; onClose: () => void; onSaved: (created?: { email: string; temporary_password: string }) => void }) {
  const toast = useToast();
  const { confirm, dialog } = useConfirm();
  const isOwner = member?.role === 'owner';
  const [f, setF] = useState({ first_name: member?.first_name || '', last_name: member?.last_name || '', email: member?.email || '', phone: member?.phone || '', role: member?.role || 'account_manager', active: member ? !!member.active : true, company_ids: member?.company_ids || [] as number[] });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [cq, setCq] = useState('');
  const allAccess = ['owner', 'admin'].includes(f.role);
  const set = (k: keyof typeof f, v: any) => setF((s) => ({ ...s, [k]: v }));
  const toggle = (id: number) => set('company_ids', f.company_ids.includes(id) ? f.company_ids.filter((x) => x !== id) : [...f.company_ids, id]);
  const shown = companies.filter((c) => c.status !== 'offboarded' && (!cq || c.name.toLowerCase().includes(cq.toLowerCase())));

  const save = async () => {
    setErr(null);
    if (!member && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim())) return setErr('A valid email is required');
    if (!f.first_name.trim()) return setErr('First name is required');
    if (member && member.active && !f.active && !(await confirm(`Deactivate ${member.first_name}?`, 'They will no longer be able to sign in. Their companies stay as they are.'))) return;
    setBusy(true);
    try {
      if (member) {
        await api.put(`/api/agency/team/${member.id}`, { first_name: f.first_name.trim(), last_name: f.last_name.trim(), phone: f.phone.trim(), ...(isOwner ? {} : { role: f.role, active: f.active }), company_ids: f.company_ids });
        toast.success(`${f.first_name} updated`);
        onSaved();
      } else {
        const r = await api.post<Member & { temporary_password: string }>('/api/agency/team', { first_name: f.first_name.trim(), last_name: f.last_name.trim(), email: f.email.trim(), phone: f.phone.trim() || undefined, role: f.role, company_ids: allAccess ? [] : f.company_ids });
        toast.success(`${f.first_name} added to the team`);
        onSaved({ email: r.email, temporary_password: r.temporary_password });
      }
    } catch (e: any) {
      setErr(e?.message || 'Save failed');
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open wide title={member ? `Edit ${member.first_name} ${member.last_name}` : 'Add team member'} onClose={onClose} testId="team-modal"
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={save} data-testid="team-submit">{member ? 'Save changes' : 'Add member'}</Button></>}>
      <div className="form-grid">
        <Field label="First name" required><Input value={f.first_name} onChange={(e) => set('first_name', e.target.value)} data-testid="team-first" autoFocus /></Field>
        <Field label="Last name"><Input value={f.last_name} onChange={(e) => set('last_name', e.target.value)} data-testid="team-last" /></Field>
        <Field label="Email" required><Input type="email" value={f.email} onChange={(e) => set('email', e.target.value)} disabled={!!member} data-testid="team-email" /></Field>
        <Field label="Phone"><Input value={f.phone} onChange={(e) => set('phone', e.target.value)} data-testid="team-phone" /></Field>
        <Field label="Role" hint={ROLE_HINT[f.role]}>
          <Select value={f.role} onChange={(e) => set('role', e.target.value)} disabled={isOwner} data-testid="team-role">
            {isOwner ? <option value="owner">Owner</option> : null}
            {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
          </Select>
        </Field>
        {member ? (
          <div className="field">
            <span className="field-label">Account</span>
            <Switch checked={f.active} onChange={(v) => set('active', v)} disabled={isOwner} label={f.active ? 'Active (can sign in)' : 'Inactive'} />
          </div>
        ) : null}
        <div className="field span-2">
          <span className="field-label">Client companies</span>
          {allAccess ? <p className="muted" style={{ margin: 0 }}>Owners and admins work across every client company.</p> : (
            <>
              <div className="row" style={{ marginBottom: 6 }}>
                <input className="input search" type="search" placeholder="Filter companies…" value={cq} onChange={(e) => setCq(e.target.value)} aria-label="Filter companies" style={{ flex: 1 }} />
                <span className="muted" style={{ fontSize: 12.5 }}>{f.company_ids.length} selected</span>
              </div>
              <div className="pf-picklist" data-testid="team-companies">
                {shown.map((c) => (
                  <label key={c.id} className={`pf-pick ${f.company_ids.includes(c.id) ? 'on' : ''}`}>
                    <input type="checkbox" checked={f.company_ids.includes(c.id)} onChange={() => toggle(c.id)} data-testid={`team-company-${c.slug}`} />
                    <LogoTile c={c} size="sm" />
                    <span>{c.name}</span>
                  </label>
                ))}
                {!shown.length ? <span className="muted">No companies.</span> : null}
              </div>
              {f.role === 'account_manager' ? <span className="field-hint">Companies they are the account manager of are always included.</span> : null}
            </>
          )}
        </div>
      </div>
      {err ? <div className="alert alert-error" style={{ marginTop: 12 }}>{err}</div> : null}
      {dialog}
    </Modal>
  );
}

function PasswordModal({ email, temporary_password, onClose }: { email: string; temporary_password: string; onClose: () => void }) {
  const toast = useToast();
  const copy = async () => {
    try { await navigator.clipboard.writeText(temporary_password); toast.success('Password copied'); } catch { toast.error('Copy failed. Select the password and copy it manually.'); }
  };
  return (
    <Modal open title="Team member added" onClose={onClose} testId="team-password-modal" footer={<Button variant="primary" onClick={onClose} data-testid="team-password-done">Done</Button>}>
      <p className="muted" style={{ marginTop: 0 }}>Share these sign-in details securely. The temporary password is shown only once.</p>
      <div className="nc-cred">
        <div><span className="muted">Email</span><strong>{email}</strong></div>
        <div><span className="muted">Temporary password</span><code data-testid="team-temp-password">{temporary_password}</code></div>
        <Button size="sm" onClick={copy} data-testid="team-copy"><Icon name="clipboard" size={14} /> Copy password</Button>
      </div>
    </Modal>
  );
}
