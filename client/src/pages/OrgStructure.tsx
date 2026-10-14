import React, { useMemo, useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { usePageTour } from '../lib/tour';
import { Button, Card, Field, Input, Modal, PageHeader, Select, Table, Tabs, Textarea, useConfirm, useFetch, useForm, useToast, SearchInput, Badge } from '../components/ui';

interface Department { id: number; name: string; code?: string; parent_id?: number | null; parent_name?: string; head_employee_id?: number | null; head_name?: string; description?: string; color?: string; employee_count: number; position_count: number; active: number }
interface Position { id: number; title: string; code?: string; department_id?: number | null; department_name?: string; reports_to_position_id?: number | null; reports_to_title?: string; level: number; grade?: string; headcount: number; filled: number; description?: string; active: number; jd_count: number }

const TOUR = [
  { element: '[data-tour="org-tabs"]', title: 'Departments and positions', description: 'Switch between the department list and the position (job title) list. Both feed the org tree.' },
  { element: '[data-tour="org-add"]', title: 'Add a department or position', description: 'HR can create new departments (with a parent department) and positions (with a reporting line and headcount).' },
  { element: '[data-tour="org-table"]', title: 'Manage the structure', description: 'Click any row to edit it. Department colours are used in the org tree. Positions track filled vs planned headcount.' },
];

export default function OrgStructure() {
  usePageTour('Org structure', TOUR);
  const { isHr } = useAuth();
  const [tab, setTab] = useState<'departments' | 'positions'>('departments');
  const [q, setQ] = useState('');
  const depts = useFetch<Department[]>(() => api.get('/api/org/departments'), []);
  const positions = useFetch<Position[]>(() => api.get('/api/org/positions'), []);
  const employees = useFetch<any[]>(() => api.get('/api/employees/directory/all'), []);
  const [editDept, setEditDept] = useState<Partial<Department> | null>(null);
  const [editPos, setEditPos] = useState<Partial<Position> | null>(null);

  const filteredDepts = useMemo(() => (depts.data || []).filter((d) => !q || d.name.toLowerCase().includes(q.toLowerCase()) || (d.code || '').toLowerCase().includes(q.toLowerCase())), [depts.data, q]);
  const filteredPos = useMemo(() => (positions.data || []).filter((p) => !q || p.title.toLowerCase().includes(q.toLowerCase()) || (p.department_name || '').toLowerCase().includes(q.toLowerCase())), [positions.data, q]);

  return (
    <>
      <PageHeader
        title="Org structure"
        subtitle="Departments, positions and reporting lines that make up your organisation."
        actions={isHr ? (
          <div className="row" data-tour="org-add">
            <Button variant="primary" onClick={() => (tab === 'departments' ? setEditDept({}) : setEditPos({ level: 1, headcount: 1 }))} data-testid="org-add">
              + Add {tab === 'departments' ? 'department' : 'position'}
            </Button>
          </div>
        ) : undefined}
      />
      <Tabs tour="org-tabs" value={tab} onChange={(k) => setTab(k as any)} tabs={[{ key: 'departments', label: 'Departments', count: depts.data?.length }, { key: 'positions', label: 'Positions', count: positions.data?.length }]} />
      <div className="toolbar">
        <SearchInput value={q} onChange={setQ} placeholder={`Search ${tab}…`} />
      </div>
      {tab === 'departments' ? (
        <Card padded={false} tour="org-table">
          <Table<Department>
            loading={depts.loading}
            rows={filteredDepts}
            onRowClick={isHr ? (d) => setEditDept(d) : undefined}
            columns={[
              { key: 'name', header: 'Department', render: (d) => (<span><span className="color-swatch" style={{ background: d.color || '#94a3b8' }} /><strong>{d.name}</strong> {d.code ? <span className="muted mono">{d.code}</span> : null}</span>) },
              { key: 'parent_name', header: 'Parent', render: (d) => d.parent_name || '—' },
              { key: 'head_name', header: 'Head', render: (d) => d.head_name || '—' },
              { key: 'position_count', header: 'Positions', align: 'right' },
              { key: 'employee_count', header: 'Employees', align: 'right' },
              { key: 'active', header: 'Status', render: (d) => <Badge tone={d.active ? 'success' : 'neutral'}>{d.active ? 'Active' : 'Inactive'}</Badge> },
            ]}
          />
        </Card>
      ) : (
        <Card padded={false} tour="org-table">
          <Table<Position>
            loading={positions.loading}
            rows={filteredPos}
            onRowClick={isHr ? (p) => setEditPos(p) : undefined}
            columns={[
              { key: 'title', header: 'Position', render: (p) => (<span><strong>{p.title}</strong> {p.code ? <span className="muted mono">{p.code}</span> : null}</span>) },
              { key: 'department_name', header: 'Department', render: (p) => p.department_name || '—' },
              { key: 'reports_to_title', header: 'Reports to', render: (p) => p.reports_to_title || '—' },
              { key: 'level', header: 'Level', align: 'right' },
              { key: 'headcount', header: 'Headcount', align: 'right', render: (p) => (<span className={p.filled > p.headcount ? 'muted' : ''}>{p.filled} / {p.headcount}</span>) },
              { key: 'jd_count', header: 'JDs', align: 'right' },
              { key: 'active', header: 'Status', render: (p) => <Badge tone={p.active ? 'success' : 'neutral'}>{p.active ? 'Active' : 'Inactive'}</Badge> },
            ]}
          />
        </Card>
      )}
      {editDept ? (
        <DepartmentModal dept={editDept} departments={depts.data || []} employees={employees.data || []} onClose={() => setEditDept(null)} onSaved={() => { setEditDept(null); depts.reload(); positions.reload(); }} />
      ) : null}
      {editPos ? (
        <PositionModal pos={editPos} departments={depts.data || []} positions={positions.data || []} onClose={() => setEditPos(null)} onSaved={() => { setEditPos(null); positions.reload(); depts.reload(); }} />
      ) : null}
    </>
  );
}

function DepartmentModal({ dept, departments, employees, onClose, onSaved }: { dept: Partial<Department>; departments: Department[]; employees: any[]; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const { confirm, dialog } = useConfirm();
  const f = useForm({ name: dept.name || '', code: dept.code || '', parent_id: dept.parent_id ?? '', head_employee_id: dept.head_employee_id ?? '', description: dept.description || '', color: dept.color || '#2563eb', active: dept.active ?? 1 });
  const [busy, setBusy] = useState(false);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const body = { ...f.values, parent_id: f.values.parent_id === '' ? null : Number(f.values.parent_id), head_employee_id: f.values.head_employee_id === '' ? null : Number(f.values.head_employee_id), active: Number(f.values.active) };
      if (dept.id) await api.put(`/api/org/departments/${dept.id}`, body);
      else await api.post('/api/org/departments', body);
      toast.success(dept.id ? 'Department updated' : 'Department created');
      onSaved();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!(await confirm('Delete department?', 'Positions in it will be left without a department.'))) return;
    try {
      await api.delete(`/api/org/departments/${dept.id}`);
      toast.success('Department deleted');
      onSaved();
    } catch (err) {
      toast.error(err);
    }
  };
  return (
    <Modal open title={dept.id ? 'Edit department' : 'New department'} onClose={onClose} testId="department-modal"
      footer={<>
        {dept.id ? <Button variant="danger" onClick={remove} style={{ marginRight: 'auto' }}>Delete</Button> : null}
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" loading={busy} onClick={save as any} data-testid="department-save">Save</Button>
      </>}>
      {dialog}
      <form onSubmit={save} className="form-grid">
        <Field label="Name" required><Input {...f.bind('name')} required autoFocus /></Field>
        <Field label="Code"><Input {...f.bind('code')} placeholder="e.g. ENG" /></Field>
        <Field label="Parent department">
          <Select {...f.bind('parent_id')}>
            <option value="">— None (top level) —</option>
            {departments.filter((d) => d.id !== dept.id).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </Select>
        </Field>
        <Field label="Department head">
          <Select {...f.bind('head_employee_id')}>
            <option value="">— None —</option>
            {employees.map((e) => <option key={e.id} value={e.id}>{e.first_name} {e.last_name} ({e.employee_code})</option>)}
          </Select>
        </Field>
        <Field label="Colour (used in org tree)"><Input type="color" {...f.bind('color')} /></Field>
        <Field label="Status"><Select {...f.bind('active')}><option value={1}>Active</option><option value={0}>Inactive</option></Select></Field>
        <Field label="Description" className="span-2"><Textarea {...f.bind('description')} /></Field>
      </form>
    </Modal>
  );
}

function PositionModal({ pos, departments, positions, onClose, onSaved }: { pos: Partial<Position>; departments: Department[]; positions: Position[]; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const { confirm, dialog } = useConfirm();
  const f = useForm({ title: pos.title || '', code: pos.code || '', department_id: pos.department_id ?? '', reports_to_position_id: pos.reports_to_position_id ?? '', level: pos.level ?? 1, grade: pos.grade || '', headcount: pos.headcount ?? 1, description: pos.description || '', active: pos.active ?? 1 });
  const [busy, setBusy] = useState(false);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const body = { ...f.values, department_id: f.values.department_id === '' ? null : Number(f.values.department_id), reports_to_position_id: f.values.reports_to_position_id === '' ? null : Number(f.values.reports_to_position_id), level: Number(f.values.level), headcount: Number(f.values.headcount), active: Number(f.values.active) };
      if (pos.id) await api.put(`/api/org/positions/${pos.id}`, body);
      else await api.post('/api/org/positions', body);
      toast.success(pos.id ? 'Position updated' : 'Position created');
      onSaved();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!(await confirm('Delete position?'))) return;
    try {
      await api.delete(`/api/org/positions/${pos.id}`);
      toast.success('Position deleted');
      onSaved();
    } catch (err) {
      toast.error(err);
    }
  };
  return (
    <Modal open title={pos.id ? 'Edit position' : 'New position'} onClose={onClose} testId="position-modal"
      footer={<>
        {pos.id ? <Button variant="danger" onClick={remove} style={{ marginRight: 'auto' }}>Delete</Button> : null}
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" loading={busy} onClick={save as any} data-testid="position-save">Save</Button>
      </>}>
      {dialog}
      <form onSubmit={save} className="form-grid">
        <Field label="Title" required><Input {...f.bind('title')} required autoFocus /></Field>
        <Field label="Code"><Input {...f.bind('code')} placeholder="e.g. SSE" /></Field>
        <Field label="Department">
          <Select {...f.bind('department_id')}>
            <option value="">— None —</option>
            {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </Select>
        </Field>
        <Field label="Reports to (position)">
          <Select {...f.bind('reports_to_position_id')}>
            <option value="">— None —</option>
            {positions.filter((p) => p.id !== pos.id).map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
          </Select>
        </Field>
        <Field label="Level" hint="Higher = more senior"><Input type="number" min={1} max={20} {...f.bind('level')} /></Field>
        <Field label="Grade"><Input {...f.bind('grade')} placeholder="e.g. L5" /></Field>
        <Field label="Planned headcount"><Input type="number" min={0} {...f.bind('headcount')} /></Field>
        <Field label="Status"><Select {...f.bind('active')}><option value={1}>Active</option><option value={0}>Inactive</option></Select></Field>
        <Field label="Description" className="span-2"><Textarea {...f.bind('description')} /></Field>
      </form>
    </Modal>
  );
}
