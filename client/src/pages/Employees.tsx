import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, qs, apiUrl } from '../lib/api';
import { useAuth } from '../lib/auth';
import { usePageTour, type TourStep } from '../lib/tour';
import { fmtDate, fullName, label } from '../lib/format';
import { Avatar, Button, Card, Checkbox, PageHeader, SearchInput, Select, Stat, StatusBadge, Table, useFetch, useToast } from '../components/ui';
import { EmployeeFormModal, EMPLOYEE_STATUSES, type Department, type Employee, type Position } from '../components/EmployeeForm';
import { Icon } from '../components/Icons';
import { DeptBadge } from '../components/DeptBadge';
import { CandidatePicker, HireModal } from '../components/recruitment/HireModal';
import type { Candidate } from '../components/recruitment/types';
import { ImportEmployeesModal } from '../components/import/ImportEmployeesModal';

const TOUR: TourStep[] = [
  { title: 'The staff directory', description: 'Everyone in the company, one row per employee. The flow on this page: 1) check headcount by status, 2) search and filter, 3) read the list, 4) add a new employee (by hand, from a recruitment candidate, or many at once from a spreadsheet), 5) open a profile to complete it.' },
  { element: '[data-tour="employees-stats"]', title: 'Headcount at a glance', description: 'Total staff and a count per status (onboarding, probation, active, notice). Click a tile to filter the list to that status; click it again, or Total, to clear. The counts follow the filters below.' },
  { element: '[data-tour="employees-search"]', title: 'Search', description: 'Type part of a name, employee code, email or job title. The list updates as you type.' },
  { element: '[data-tour="employees-filter-org"]', title: 'Department and position', description: 'Narrow the list to one department, then to a position inside it (the position list only offers titles from the chosen department). Departments and positions are set up under Org structure.' },
  { element: '[data-tour="employees-filter-status"]', title: 'Status and type', description: 'Status follows the employee lifecycle: onboarding, probation, active, notice and exited. Employment type (full time, contract, intern and so on) comes from the list HR maintains in Settings.' },
  { element: '[data-tour="employees-filter-exited"]', title: 'Former staff', description: 'Exited employees are hidden by default. Tick "Include exited" to bring them back, for example to look up a past record. "Clear" appears when any filter is on and resets them all.' },
  { element: '[data-tour="employees-table"]', title: 'The list', description: 'HR sees everyone; managers see themselves and their direct reports; employees see only their own row. Columns show position, department, manager, join date, employment type and status.' },
  { element: '[data-tour="employees-row-name"]', title: 'Name and employee ID', description: 'The photo (or initials in the department colour), full name and the unique employee code generated when the record was created.' },
  { element: '[data-tour="employees-row-dept"]', title: 'Department badge', description: 'The department icon and colour set in Org structure. The same badge is used across the app, so teams are easy to recognise.' },
  { element: '[data-tour="employees-row-status"]', title: 'Status chip', description: 'Where the person is in their lifecycle. Change it from the profile with Edit, for example from probation to active after confirmation, or to notice when they resign.' },
  { element: '[data-tour="employees-add-btn"]', title: 'Add an employee', description: 'Opens the employee form: basic details, job (department, position, manager, work location, shift, join date, status), your custom fields, emergency contact, and bank and statutory details. Only first name and email are required to start.' },
  { element: '[data-tour="employees-add-btn"]', title: 'Employee ID and login', description: 'At the bottom of the form the employee ID is filled in automatically from the company prefix (regenerate or edit it by hand). Tick "Create a login" to give them access as an employee or manager; the user ID is their email.' },
  { element: '[data-tour="employees-add-btn"]', title: 'What happens on save', description: 'You land on the new profile. If a login was created, the temporary password is shown once at the top for you to copy and share; they must change it at first sign-in. Journey stages and this year\'s leave balances are created automatically.' },
  { element: '[data-tour="employees-from-recruitment"]', title: 'Add from recruitment', description: 'Lists candidates in the Interview or Offer stage. Pick one and the same employee form opens prefilled from their CV; saving marks the candidate as hired and links the new profile back to the vacancy.' },
  { element: '[data-tour="employees-import-btn"]', title: 'Import many from a spreadsheet', description: 'Onboarding a whole team or a new client company? Import opens a three-step wizard: download the template, upload the filled file and check every row, then import. Nothing is saved until you confirm.' },
  { element: '[data-tour="employees-import-btn"]', title: '1. Download the template', description: 'The CSV template has the columns and two example rows for this company\'s country: PAN, IFSC and UAN in India; IBAN, SWIFT and Emirates ID / Iqama / QID in the GCC; masked SSN and ABA routing number in the US. The column guide in the wizard explains each format. Only first name, email and join date are required.' },
  { element: '[data-tour="employees-import-btn"]', title: '2. Upload and check', description: 'Upload the filled CSV (or Excel .xlsx). Every row is validated without saving anything: required fields, email and employee code duplicates (in the file and against existing staff), dates, managers (an existing employee or another row of the file, no loops), departments and positions, and the country formats and checksums.' },
  { element: '[data-tour="employees-import-btn"]', title: '3. Fix errors', description: 'Summary chips count valid rows, errors, warnings and departments/positions to be created. Errors are red, warnings amber, per field; tick "Only problems" to focus. Fix the file and upload again, or turn on "Skip rows with errors" to import only the valid rows. "Create missing departments/positions" adds the ones the file names.' },
  { element: '[data-tour="employees-import-btn"]', title: '4. Import', description: 'Everything is created in one go (all or nothing unless you skip errors): employee codes from the company prefix, managers before their reports, journey stages, leave balances, an opening salary structure from basic_monthly in the company currency, and logins when "Create logins" is on.' },
  { element: '[data-tour="employees-import-btn"]', title: '5. Share temporary passwords', description: 'The result lists each new employee code with its temporary password, shown only once. Use "Copy all" and share each password securely; people must change it at first sign-in. The new staff then appear in this list.' },
  { element: '[data-tour="employees-row-name"]', title: 'Open a profile', description: 'Click any row to open the full profile: header facts, personal and job details, documents, salary, attendance, leave, assets and the onboarding journey.' },
  { title: 'Next steps', description: 'After adding someone, open their profile to upload documents and set a salary structure so they are included in Payroll. Their attendance, leave and assets then build up on the same profile. Use Org tree to see where they sit in the reporting line.' },
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
  const [searchParams, setSearchParams] = useSearchParams();
  const [importing, setImporting] = useState(() => searchParams.get('import') === '1');
  const closeImport = () => {
    setImporting(false);
    if (searchParams.has('import')) { const next = new URLSearchParams(searchParams); next.delete('import'); setSearchParams(next, { replace: true }); }
  };

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
  const firstId = rows[0]?.id;

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
              <Button variant="primary" onClick={() => setAdding(true)} data-testid="employee-add" data-tour="employees-add-btn">+ Add employee</Button>
              <Button variant="primary" onClick={() => setPicking(true)} data-testid="employee-from-recruitment" data-tour="employees-from-recruitment" title="Create the employee from a recruitment candidate (Interview / Offer stage)"><Icon name="userPlus" size={15} /> From recruitment</Button>
            </span>
            <Button onClick={() => setImporting(true)} data-testid="employee-import" data-tour="employees-import-btn" title="Import many employees from a CSV or Excel file"><Icon name="upload" size={15} /> Import</Button>
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
        <SearchInput tour="employees-search" value={q} onChange={setQ} placeholder="Search name, code, email, title…" />
        <span className="row" data-tour="employees-filter-org">
        <Select value={department_id} onChange={(e) => setDepartment(e.target.value)} aria-label="Department" data-testid="filter-department">
          <option value="">All departments</option>
          {(depts.data || []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </Select>
        <Select value={position_id} onChange={(e) => setPosition(e.target.value)} aria-label="Position" data-testid="filter-position">
          <option value="">All positions</option>
          {(positions.data || []).filter((p) => !department_id || !p.department_id || String(p.department_id) === department_id).map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
        </Select>
        </span>
        <span className="row" data-tour="employees-filter-status">
        <Select value={status} onChange={(e) => { setStatus(e.target.value); if (e.target.value === 'exited') setIncludeExited(true); }} aria-label="Status" data-testid="filter-status">
          <option value="">All statuses</option>
          {EMPLOYEE_STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}
        </Select>
        <Select value={employment_type} onChange={(e) => setEmploymentType(e.target.value)} aria-label="Employment type" data-testid="filter-type">
          <option value="">All types</option>
          {(empTypes.data || []).map((t) => <option key={t} value={t}>{label(t)}</option>)}
        </Select>
        </span>
        <span className="row" data-tour="employees-filter-exited">
        <Checkbox label="Include exited" checked={includeExited} onChange={(e) => { setIncludeExited(e.target.checked); if (!e.target.checked && status === 'exited') setStatus(''); }} data-testid="filter-include-exited" />
        {hasFilters ? <Button variant="ghost" size="sm" onClick={clearFilters}>Clear</Button> : null}
        </span>
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
                <span className="row" style={{ flexWrap: 'nowrap' }} data-tour={e.id === firstId ? 'employees-row-name' : undefined}>
                  <Avatar name={fullName(e)} src={e.photo_path ? apiUrl(`/api/employees/${e.id}/photo`) : null} size={34} color={e.department_color || undefined} />
                  <span>
                    <strong>{fullName(e)}</strong>
                    <div className="muted mono">{e.employee_code}</div>
                  </span>
                </span>
              ),
            },
            { key: 'position_title', header: 'Position', render: (e) => e.position_title || '—' },
            { key: 'department_name', header: 'Department', render: (e) => <span data-tour={e.id === firstId ? 'employees-row-dept' : undefined}><DeptBadge name={e.department_name} icon={e.department_icon} color={e.department_color} /></span> },
            { key: 'manager_name', header: 'Manager', render: (e) => e.manager_name || '—' },
            { key: 'join_date', header: 'Joined', render: (e) => fmtDate(e.join_date) },
            { key: 'employment_type', header: 'Type', render: (e) => label(e.employment_type) },
            { key: 'status', header: 'Status', render: (e) => <span data-tour={e.id === firstId ? 'employees-row-status' : undefined}><StatusBadge status={e.status} label={label(e.status)} /></span> },
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
      {importing && isHr ? <ImportEmployeesModal onClose={closeImport} onImported={() => list.reload()} /> : null}
      {hireCandidate ? <HireModal candidate={hireCandidate} onClose={() => setHireCandidate(null)} /> : null}
    </>
  );
}
