import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, qs } from '../lib/api';
import { useAuth } from '../lib/auth';
import { usePageTour } from '../lib/tour';
import { fmtDate, fullName, label } from '../lib/format';
import { Avatar, Button, Card, Checkbox, PageHeader, SearchInput, Select, Stat, StatusBadge, Table, useFetch, useToast } from '../components/ui';
import { EmployeeFormModal, EMPLOYEE_STATUSES, type Department, type Employee, type Position } from '../components/EmployeeForm';
import { Icon } from '../components/Icons';
import { CandidatePicker, HireModal } from '../components/recruitment/HireModal';
import type { Candidate } from '../components/recruitment/types';

const TOUR = [
  { element: '[data-tour="employees-stats"]', title: 'Headcount at a glance', description: 'Total staff and a breakdown by status. Click a tile to filter the directory to that status.' },
  { element: '[data-tour="employees-filters"]', title: 'Search and filter', description: 'Search by name, code, email or job title, and narrow by department, position, status or employment type. Tick "Include exited" to see former staff.' },
  { element: '[data-tour="employees-add"]', title: 'Add an employee', description: 'HR can create a new employee record with an auto-generated employee ID and login, or pick a candidate from Recruitment ("From recruitment") so the CV details are prefilled and the hiring journey is completed automatically.' },
  { element: '[data-tour="employees-table"]', title: 'Staff directory', description: 'Every employee you are allowed to see. Click a row to open the full profile with documents, salary, attendance, leave, assets and journey.' },
];

const STATUS_COLORS: Record<string, string> = { active: '#16a34a', probation: '#ca8a04', onboarding: '#2563eb', notice: '#ea580c', exited: '#dc2626' };

export default function Employees() {
  usePageTour('Employees', TOUR);
  const { isHr } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [q, setQ] = useState('');
  const [dq, setDq] = useState('');
  const [department_id, setDepartment] = useState('');
  const [position_id, setPosition] = useState('');
  const [status, setStatus] = useState('');
  const [employment_type, setEmploymentType] = useState('');
  const [includeExited, setIncludeExited] = useState(false);
  const [adding, setAdding] = useState(false);
  const [picking, setPicking] = useState(false);
  const [hireCandidate, setHireCandidate] = useState<Candidate | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDq(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);

  const depts = useFetch<Department[]>(() => api.get('/api/org/departments'), []);
  const positions = useFetch<Position[]>(() => api.get('/api/org/positions'), []);
  const empTypes = useFetch<string[]>(() => api.get('/api/settings/employment_types'), []);
  const list = useFetch<{ items: Employee[]; total: number }>(
    () => api.get(`/api/employees${qs({ q: dq, department_id, position_id, status, employment_type, include_exited: includeExited ? '1' : '' })}`),
    [dq, department_id, position_id, status, employment_type, includeExited],
  );
  const rows = list.data?.items || [];

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const e of rows) c[e.status] = (c[e.status] || 0) + 1;
    return c;
  }, [rows]);
  const statTiles = EMPLOYEE_STATUSES.filter((s) => s !== 'exited' || includeExited || status === 'exited');

  const clearFilters = () => { setQ(''); setDepartment(''); setPosition(''); setStatus(''); setEmploymentType(''); setIncludeExited(false); };
  const hasFilters = !!(q || department_id || position_id || status || employment_type || includeExited);

  return (
    <>
      <PageHeader
        title="Employees"
        subtitle="Staff directory: search, filter and open any employee profile."
        actions={isHr ? (
          <div className="row" data-tour="employees-add">
            <span className="split-btn">
              <Button variant="primary" onClick={() => setAdding(true)} data-testid="employee-add">+ Add employee</Button>
              <Button variant="primary" onClick={() => setPicking(true)} data-testid="employee-from-recruitment" title="Create the employee from a recruitment candidate (Interview / Offer stage)"><Icon name="userPlus" size={15} /> From recruitment</Button>
            </span>
          </div>
        ) : undefined}
      />

      <div className="stat-strip" data-tour="employees-stats">
        <Stat label="Total" value={list.loading && !list.data ? '…' : list.data?.total ?? 0} hint={hasFilters ? 'matching filters' : includeExited ? 'including exited' : 'excluding exited'} onClick={() => setStatus('')} />
        {statTiles.map((s) => (
          <Stat key={s} label={label(s)} value={counts[s] || 0} color={STATUS_COLORS[s]} onClick={() => { if (s === 'exited') setIncludeExited(true); setStatus(status === s ? '' : s); }} hint={status === s ? 'filtered' : undefined} />
        ))}
      </div>

      <div className="toolbar" data-tour="employees-filters">
        <SearchInput value={q} onChange={setQ} placeholder="Search name, code, email, title…" />
        <Select value={department_id} onChange={(e) => setDepartment(e.target.value)} aria-label="Department" data-testid="filter-department">
          <option value="">All departments</option>
          {(depts.data || []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </Select>
        <Select value={position_id} onChange={(e) => setPosition(e.target.value)} aria-label="Position" data-testid="filter-position">
          <option value="">All positions</option>
          {(positions.data || []).filter((p) => !department_id || !p.department_id || String(p.department_id) === department_id).map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
        </Select>
        <Select value={status} onChange={(e) => { setStatus(e.target.value); if (e.target.value === 'exited') setIncludeExited(true); }} aria-label="Status" data-testid="filter-status">
          <option value="">All statuses</option>
          {EMPLOYEE_STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}
        </Select>
        <Select value={employment_type} onChange={(e) => setEmploymentType(e.target.value)} aria-label="Employment type" data-testid="filter-type">
          <option value="">All types</option>
          {(empTypes.data || []).map((t) => <option key={t} value={t}>{label(t)}</option>)}
        </Select>
        <Checkbox label="Include exited" checked={includeExited} onChange={(e) => { setIncludeExited(e.target.checked); if (!e.target.checked && status === 'exited') setStatus(''); }} data-testid="filter-include-exited" />
        {hasFilters ? <Button variant="ghost" size="sm" onClick={clearFilters}>Clear</Button> : null}
      </div>

      <Card padded={false} tour="employees-table">
        {list.error ? <div className="alert alert-error" style={{ margin: 12 }}>{list.error}</div> : null}
        <Table<Employee>
          loading={list.loading && !list.data}
          rows={rows}
          empty={hasFilters ? 'No employees match these filters.' : 'No employees yet.'}
          onRowClick={(e) => navigate(`/employees/${e.id}`)}
          columns={[
            {
              key: 'name', header: 'Employee', render: (e) => (
                <span className="row" style={{ flexWrap: 'nowrap' }}>
                  <Avatar name={fullName(e)} src={e.photo_path ? `/api/employees/${e.id}/photo` : null} size={34} color={e.department_color || undefined} />
                  <span>
                    <strong>{fullName(e)}</strong>
                    <div className="muted mono">{e.employee_code}</div>
                  </span>
                </span>
              ),
            },
            { key: 'position_title', header: 'Position', render: (e) => e.position_title || '—' },
            { key: 'department_name', header: 'Department', render: (e) => (e.department_name ? <span><span className="color-swatch" style={{ background: e.department_color || '#94a3b8' }} />{e.department_name}</span> : '—') },
            { key: 'manager_name', header: 'Manager', render: (e) => e.manager_name || '—' },
            { key: 'join_date', header: 'Joined', render: (e) => fmtDate(e.join_date) },
            { key: 'employment_type', header: 'Type', render: (e) => label(e.employment_type) },
            { key: 'status', header: 'Status', render: (e) => <StatusBadge status={e.status} label={label(e.status)} /> },
          ]}
        />
      </Card>

      {adding ? (
        <EmployeeFormModal
          mode="create"
          onClose={() => setAdding(false)}
          onSaved={(saved) => {
            setAdding(false);
            if (saved.temporary_password) toast.info(`Temporary password for ${saved.email}: ${saved.temporary_password}`);
            navigate(`/employees/${saved.id}`, { state: saved.temporary_password ? { temporary_password: saved.temporary_password, login_email: saved.email } : undefined });
          }}
        />
      ) : null}
      {picking ? <CandidatePicker onClose={() => setPicking(false)} onPick={(c) => { setPicking(false); setHireCandidate(c); }} /> : null}
      {hireCandidate ? <HireModal candidate={hireCandidate} onClose={() => setHireCandidate(null)} /> : null}
    </>
  );
}
