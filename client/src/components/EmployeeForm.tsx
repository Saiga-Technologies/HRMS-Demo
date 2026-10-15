import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { fmtDate, label } from '../lib/format';
import { Button, Checkbox, Field, Input, Modal, Select, Switch, Textarea, useFetch, useToast } from './ui';
import { Icon } from './Icons';

/* ------------------------------------------------------------------ */
/* Shared employee types                                               */
/* ------------------------------------------------------------------ */
export interface Employee {
  id: number;
  employee_code: string;
  first_name: string;
  last_name: string;
  email: string;
  phone?: string | null;
  dob?: string | null;
  gender?: string | null;
  marital_status?: string | null;
  nationality?: string | null;
  address?: string | null;
  city?: string | null;
  country?: string | null;
  photo_path?: string | null;
  department_id?: number | null;
  position_id?: number | null;
  manager_id?: number | null;
  work_location_id?: number | null;
  shift_id?: number | null;
  vacancy_id?: number | null;
  vacancy_title?: string | null;
  candidate_id?: number | null;
  join_date?: string | null;
  confirmation_date?: string | null;
  exit_date?: string | null;
  employment_type: string;
  status: string;
  emergency_contact_name?: string | null;
  emergency_contact_phone?: string | null;
  bank_name?: string | null;
  bank_account_name?: string | null;
  bank_account_number?: string | null;
  bank_ifsc?: string | null;
  tax_id?: string | null;
  pf_number?: string | null;
  custom_fields: Record<string, any>;
  notes?: string | null;
  department_name?: string | null;
  department_color?: string | null;
  department_icon?: string | null;
  position_title?: string | null;
  manager_name?: string | null;
  work_location_name?: string | null;
  shift_name?: string | null;
  direct_reports?: number;
  created_at?: string;
  updated_at?: string;
}
export type CustomFieldType = 'text' | 'number' | 'date' | 'select' | 'boolean' | 'textarea';
export interface CustomFieldDef { id: number; entity: string; key: string; label: string; type: CustomFieldType; options: string[]; required: number; section?: string | null; sort_order: number; active: number }
export interface Department { id: number; name: string; code?: string | null; color?: string | null; active?: number }
export interface Position { id: number; title: string; code?: string | null; department_id?: number | null; department_name?: string | null; active?: number }
export interface WorkLocation { id: number; name: string; active?: number }
export interface Shift { id: number; name: string; start_time: string; end_time: string; active?: number }
export interface DirectoryEmployee { id: number; employee_code: string; first_name: string; last_name: string; department_name?: string | null; position_title?: string | null }

export const EMPLOYEE_STATUSES = ['onboarding', 'probation', 'active', 'notice', 'exited'];
export const GENDERS = ['male', 'female', 'other', 'prefer_not_to_say'];
export const MARITAL = ['single', 'married', 'other'];
/** Columns a non-HR employee may change on their own record (mirrors the API). */
export const SELF_EDITABLE = ['phone', 'address', 'city', 'country', 'marital_status', 'nationality', 'emergency_contact_name', 'emergency_contact_phone'];
const TEXT_FIELDS = [
  'employee_code', 'first_name', 'last_name', 'email', 'phone', 'dob', 'gender', 'marital_status', 'nationality', 'address', 'city', 'country',
  'join_date', 'confirmation_date', 'exit_date', 'employment_type', 'status', 'emergency_contact_name', 'emergency_contact_phone',
  'bank_name', 'bank_account_name', 'bank_account_number', 'bank_ifsc', 'tax_id', 'pf_number', 'notes',
];
const ID_FIELDS = ['department_id', 'position_id', 'manager_id', 'work_location_id', 'shift_id'];
const NOT_NULL_TEXT = ['first_name', 'last_name', 'email', 'employment_type', 'status'];

export const isTruthy = (v: any) => v === true || v === 1 || v === 'true' || v === '1' || v === 'yes';

/** Render an input matching a custom field definition. */
export function CustomFieldInput({ def, value, onChange }: { def: CustomFieldDef; value: any; onChange: (v: any) => void }) {
  const required = !!def.required;
  switch (def.type) {
    case 'number':
      return <Input type="number" value={value ?? ''} required={required} onChange={(e) => onChange(e.target.value)} data-testid={`cf-${def.key}`} />;
    case 'date':
      return <Input type="date" value={value ?? ''} required={required} onChange={(e) => onChange(e.target.value)} data-testid={`cf-${def.key}`} />;
    case 'select':
      return (
        <Select value={value ?? ''} required={required} onChange={(e) => onChange(e.target.value)} data-testid={`cf-${def.key}`}>
          <option value="">— Select —</option>
          {(def.options || []).map((o) => <option key={o} value={o}>{o}</option>)}
        </Select>
      );
    case 'boolean':
      return <Switch checked={isTruthy(value)} onChange={(v) => onChange(v)} label={isTruthy(value) ? 'Yes' : 'No'} />;
    case 'textarea':
      return <Textarea value={value ?? ''} required={required} rows={2} onChange={(e) => onChange(e.target.value)} data-testid={`cf-${def.key}`} />;
    default:
      return <Input value={value ?? ''} required={required} onChange={(e) => onChange(e.target.value)} data-testid={`cf-${def.key}`} />;
  }
}
/** Display a stored custom-field value. */
export function customFieldDisplay(def: CustomFieldDef, value: any): React.ReactNode {
  if (value === undefined || value === null || value === '') return '—';
  if (def.type === 'boolean') return isTruthy(value) ? 'Yes' : 'No';
  if (def.type === 'date') return fmtDate(String(value));
  return String(value);
}
/** Group active custom field definitions by section (keeps definition order). */
export function groupDefs(defs: CustomFieldDef[]): { section: string; defs: CustomFieldDef[] }[] {
  const groups: { section: string; defs: CustomFieldDef[] }[] = [];
  for (const d of defs.filter((x) => x.active)) {
    const section = d.section || 'Custom fields';
    let g = groups.find((x) => x.section === section);
    if (!g) { g = { section, defs: [] }; groups.push(g); }
    g.defs.push(d);
  }
  return groups;
}

/* ------------------------------------------------------------------ */
/* Create / edit modal (dynamic form)                                  */
/* ------------------------------------------------------------------ */
export type EmployeeFormMode = 'create' | 'edit' | 'self';
type Values = Record<string, any>;

function initialValues(e?: Partial<Employee> | null, prefill?: Prefill | null): Values {
  const v: Values = {};
  for (const k of TEXT_FIELDS) v[k] = (e as any)?.[k] ?? '';
  for (const k of ID_FIELDS) v[k] = (e as any)?.[k] ?? '';
  v.employment_type = e?.employment_type || 'full_time';
  v.status = e?.status || 'onboarding';
  v.create_login = true;
  v.login_role = 'employee';
  v.login_password = '';
  if (prefill) {
    for (const [k, val] of Object.entries(prefill)) {
      if (val === undefined) continue;
      if (TEXT_FIELDS.includes(k) || ID_FIELDS.includes(k) || ['create_login', 'login_role'].includes(k)) v[k] = val === null ? '' : k === 'create_login' ? !!val : val;
    }
  }
  return v;
}

/** Values to prefill the create form with (e.g. from a recruitment candidate). Any employee column plus create_login / login_role. */
export type Prefill = Partial<Employee> & { create_login?: boolean; login_role?: string; [k: string]: any };

/**
 * Create / edit modal. In `create` mode with `candidateId` set the form submits to the recruitment hire
 * endpoint instead of POST /api/employees, so the candidate becomes the employee (stage → hired, journey
 * stages pre-completed, CV copied). `prefill` seeds the fields (names, contact, position, department…).
 */
export function EmployeeFormModal({ employee, mode, onClose, onSaved, prefill, candidateId, candidateName }: { employee?: Partial<Employee> | null; mode: EmployeeFormMode; onClose: () => void; onSaved: (saved: Employee & { temporary_password?: string }) => void; prefill?: Prefill | null; candidateId?: number | null; candidateName?: string }) {
  const toast = useToast();
  const full = mode !== 'self';
  const [v, setV] = useState<Values>(() => initialValues(employee, prefill));
  const [editCode, setEditCode] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [cf, setCf] = useState<Record<string, any>>(() => ({ ...(employee?.custom_fields || {}) }));
  const [busy, setBusy] = useState(false);
  const set = (k: string, val: any) => setV((s) => ({ ...s, [k]: val }));
  const bind = (k: string) => ({ name: k, value: v[k] ?? '', onChange: (e: React.ChangeEvent<any>) => set(k, e.target.value) });

  const depts = useFetch<Department[]>(() => (full ? api.get('/api/org/departments') : Promise.resolve([])), [full]);
  const positions = useFetch<Position[]>(() => (full ? api.get('/api/org/positions') : Promise.resolve([])), [full]);
  const directory = useFetch<DirectoryEmployee[]>(() => (full ? api.get('/api/employees/directory/all') : Promise.resolve([])), [full]);
  const locations = useFetch<WorkLocation[]>(() => (full ? api.get('/api/attendance/locations') : Promise.resolve([])), [full]);
  const shifts = useFetch<Shift[]>(() => (full ? api.get('/api/attendance/shifts') : Promise.resolve([])), [full]);
  const empTypes = useFetch<string[]>(() => (full ? api.get('/api/settings/employment_types') : Promise.resolve([])), [full]);
  const defs = useFetch<CustomFieldDef[]>(() => (full ? api.get('/api/settings/custom-fields/employee') : Promise.resolve([])), [full]);
  const nextCode = useFetch<{ employee_code: string }>(() => (mode === 'create' ? api.get('/api/employees/next-code') : Promise.resolve({ employee_code: '' })), [mode]);
  useEffect(() => {
    if (mode === 'create' && nextCode.data?.employee_code) setV((s) => (s.employee_code ? s : { ...s, employee_code: nextCode.data!.employee_code }));
  }, [mode, nextCode.data]);
  const regenerateCode = async () => {
    setRegenerating(true);
    try {
      const r = await api.get<{ employee_code: string }>('/api/employees/next-code');
      set('employee_code', r.employee_code);
      setEditCode(false);
    } catch (err) {
      toast.error(err);
    } finally {
      setRegenerating(false);
    }
  };

  const positionOptions = useMemo(() => {
    const all = (positions.data || []).filter((p) => p.active !== 0 || String(p.id) === String(v.position_id));
    if (!v.department_id) return all;
    const inDept = all.filter((p) => !p.department_id || String(p.department_id) === String(v.department_id) || String(p.id) === String(v.position_id));
    return inDept.length ? inDept : all;
  }, [positions.data, v.department_id, v.position_id]);
  const managerOptions = useMemo(() => (directory.data || []).filter((e) => e.id !== employee?.id), [directory.data, employee?.id]);
  const groups = useMemo(() => groupDefs(defs.data || []), [defs.data]);
  const typeOptions = useMemo(() => {
    const list = [...(empTypes.data || [])];
    if (v.employment_type && !list.includes(v.employment_type)) list.push(v.employment_type);
    return list.length ? list : ['full_time'];
  }, [empTypes.data, v.employment_type]);

  const save = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (full && (!String(v.first_name).trim() || !String(v.email).trim())) return toast.error('First name and email are required');
    for (const d of (defs.data || []).filter((x) => x.active && x.required)) {
      const val = cf[d.key];
      if (val === undefined || val === null || val === '') return toast.error(`"${d.label}" is required`);
    }
    const body: Values = {};
    if (full) {
      for (const k of TEXT_FIELDS) {
        const val = typeof v[k] === 'string' ? v[k].trim() : v[k];
        body[k] = NOT_NULL_TEXT.includes(k) ? val || '' : val === '' ? null : val;
      }
      for (const k of ID_FIELDS) body[k] = v[k] === '' || v[k] === null || v[k] === undefined ? null : Number(v[k]);
      body.custom_fields = cf;
      if (mode === 'create') {
        body.create_login = !!v.create_login;
        body.login_role = v.login_role === 'manager' ? 'manager' : 'employee';
        if (v.create_login && v.login_password) body.login_password = v.login_password;
      }
    } else {
      for (const k of SELF_EDITABLE) body[k] = v[k] === '' ? null : v[k];
    }
    setBusy(true);
    try {
      const saved = mode === 'create'
        ? candidateId
          ? await api.post<Employee & { temporary_password?: string }>(`/api/recruitment/candidates/${candidateId}/hire`, body)
          : await api.post<Employee & { temporary_password?: string }>('/api/employees', body)
        : await api.put<Employee>(`/api/employees/${employee!.id}`, body);
      toast.success(mode === 'create' ? (candidateId ? 'Candidate hired and employee created' : 'Employee created') : 'Employee updated');
      onSaved(saved);
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };

  const title = mode === 'create' ? (candidateId ? `Hire ${candidateName || 'candidate'} → Create employee` : 'New employee') : mode === 'edit' ? `Edit ${employee?.first_name || 'employee'}` : 'Edit my contact details';
  return (
    <Modal open wide title={title} onClose={onClose} testId="employee-modal"
      footer={<>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" loading={busy} onClick={() => save()} data-testid={candidateId ? 'hire-submit' : 'employee-save'}>{mode === 'create' ? (candidateId ? 'Hire & create employee' : 'Create employee') : 'Save changes'}</Button>
      </>}>
      <form onSubmit={save} className="form-grid">
        {full ? (
          <>
            {candidateId ? (
              <div className="callout span-2" style={{ marginBottom: 0 }}>
                <Icon name="userPlus" size={15} /> Hiring from recruitment: the candidate moves to <strong>Hired</strong>, the vacancy's hired count goes up, the journey stages up to <em>Offer</em> are completed and a PDF CV is copied into the employee's documents.
              </div>
            ) : null}
            <div className="form-section">Basic</div>
            <Field label="First name" required><Input {...bind('first_name')} required autoFocus data-testid="employee-first-name" /></Field>
            <Field label="Last name"><Input {...bind('last_name')} data-testid="employee-last-name" /></Field>
            <Field label="Email" required hint="Also used as the login email"><Input type="email" {...bind('email')} required data-testid="employee-email" /></Field>
            <Field label="Phone"><Input {...bind('phone')} /></Field>
            <Field label="Date of birth"><Input type="date" {...bind('dob')} /></Field>
            <Field label="Gender">
              <Select {...bind('gender')}>
                <option value="">— Not specified —</option>
                {GENDERS.map((g) => <option key={g} value={g}>{g.replace(/_/g, ' ')}</option>)}
              </Select>
            </Field>
            {mode !== 'create' ? (
              <Field label="Employee code" required>
                <Input {...bind('employee_code')} required className="mono" data-testid="employee-code" />
              </Field>
            ) : null}
            <Field label="Employment type">
              <Select {...bind('employment_type')} data-testid="employee-type">
                {typeOptions.map((t) => <option key={t} value={t}>{label(t)}</option>)}
              </Select>
            </Field>
            <Field label="Marital status">
              <Select {...bind('marital_status')}>
                <option value="">— Not specified —</option>
                {MARITAL.map((m) => <option key={m} value={m}>{m}</option>)}
              </Select>
            </Field>
            <Field label="Nationality"><Input {...bind('nationality')} /></Field>
            <Field label="Address" className="span-2"><Input {...bind('address')} /></Field>
            <Field label="City"><Input {...bind('city')} /></Field>
            <Field label="Country"><Input {...bind('country')} /></Field>

            <div className="form-section">Job</div>
            <Field label="Department">
              <Select {...bind('department_id')} data-testid="employee-department">
                <option value="">— None —</option>
                {(depts.data || []).filter((d) => d.active !== 0 || String(d.id) === String(v.department_id)).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </Select>
            </Field>
            <Field label="Position">
              <Select {...bind('position_id')} data-testid="employee-position">
                <option value="">— None —</option>
                {positionOptions.map((p) => <option key={p.id} value={p.id}>{p.title}{p.department_name && !v.department_id ? ` · ${p.department_name}` : ''}</option>)}
              </Select>
            </Field>
            <Field label="Manager">
              <Select {...bind('manager_id')} data-testid="employee-manager">
                <option value="">— None —</option>
                {managerOptions.map((m) => <option key={m.id} value={m.id}>{m.first_name} {m.last_name} ({m.employee_code})</option>)}
              </Select>
            </Field>
            <Field label="Work location">
              <Select {...bind('work_location_id')}>
                <option value="">— None —</option>
                {(locations.data || []).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </Select>
            </Field>
            <Field label="Shift">
              <Select {...bind('shift_id')}>
                <option value="">— None —</option>
                {(shifts.data || []).map((s) => <option key={s.id} value={s.id}>{s.name} ({s.start_time}–{s.end_time})</option>)}
              </Select>
            </Field>
            <Field label="Join date"><Input type="date" {...bind('join_date')} data-testid="employee-join-date" /></Field>
            <Field label="Status">
              <Select {...bind('status')} data-testid="employee-status">
                {EMPLOYEE_STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}
              </Select>
            </Field>
            <Field label="Confirmation date"><Input type="date" {...bind('confirmation_date')} /></Field>
            {v.status === 'exited' || v.exit_date ? <Field label="Exit date"><Input type="date" {...bind('exit_date')} /></Field> : null}

            {groups.map((g) => (
              <React.Fragment key={g.section}>
                <div className="form-section">{g.section}</div>
                {g.defs.map((d) => (
                  d.type === 'boolean' ? (
                    <div key={d.id} className="field">
                      <span className="field-label">{d.label}{d.required ? <span className="req"> *</span> : null}</span>
                      <CustomFieldInput def={d} value={cf[d.key]} onChange={(val) => setCf((s) => ({ ...s, [d.key]: val }))} />
                    </div>
                  ) : (
                    <Field key={d.id} label={d.label} required={!!d.required} className={d.type === 'textarea' ? 'span-2' : ''}>
                      <CustomFieldInput def={d} value={cf[d.key]} onChange={(val) => setCf((s) => ({ ...s, [d.key]: val }))} />
                    </Field>
                  )
                ))}
              </React.Fragment>
            ))}

            <div className="form-section">Emergency contact</div>
            <Field label="Contact name"><Input {...bind('emergency_contact_name')} /></Field>
            <Field label="Contact phone"><Input {...bind('emergency_contact_phone')} /></Field>

            <div className="form-section">Bank &amp; statutory</div>
            <Field label="Bank name"><Input {...bind('bank_name')} /></Field>
            <Field label="Account holder"><Input {...bind('bank_account_name')} /></Field>
            <Field label="Account number"><Input {...bind('bank_account_number')} className="mono" /></Field>
            <Field label="IFSC / routing code"><Input {...bind('bank_ifsc')} className="mono" /></Field>
            <Field label="Tax ID (PAN)"><Input {...bind('tax_id')} className="mono" /></Field>
            <Field label="PF number"><Input {...bind('pf_number')} className="mono" /></Field>
            <Field label="Notes" className="span-2"><Textarea {...bind('notes')} rows={2} /></Field>

            {mode === 'create' ? (
              <>
                <div className="form-section">Login &amp; user ID</div>
                <Field label="Employee ID" required hint={editCode ? 'Editing manually; must be unique' : 'Auto-generated from the company prefix. Regenerate to pick the next free code.'}>
                  <div className="input-group">
                    <Input {...bind('employee_code')} required readOnly={!editCode} className={`mono ${editCode ? '' : 'readonly'}`} data-testid="employee-code" aria-label="Employee ID" />
                    <button type="button" className="btn btn-sm" onClick={regenerateCode} disabled={regenerating} title="Regenerate the next free employee ID" aria-label="Regenerate employee ID" data-testid="employee-code-regenerate">{regenerating ? <span className="spinner" /> : <Icon name="sparkles" size={15} />}</button>
                    <button type="button" className="btn btn-sm" onClick={() => setEditCode((x) => !x)} title={editCode ? 'Lock' : 'Edit manually'} aria-label={editCode ? 'Lock employee ID' : 'Edit employee ID manually'}><Icon name={editCode ? 'lock' : 'edit'} size={15} /></button>
                  </div>
                </Field>
                <div className="field">
                  <span className="field-label">Login</span>
                  <Checkbox label="Create a login (user ID = the email above)" checked={!!v.create_login} onChange={(e) => set('create_login', e.target.checked)} data-testid="employee-create-login" />
                  <span className="field-hint">{v.create_login ? 'A temporary password is generated automatically and shown once after saving; the user must change it on first login.' : 'No login will be created; you can add one later.'}</span>
                </div>
                {v.create_login ? (
                  <>
                    <Field label="Role">
                      <Select {...bind('login_role')} data-testid="employee-login-role">
                        <option value="employee">Employee</option>
                        <option value="manager">Manager</option>
                      </Select>
                    </Field>
                    <Field label="Password (optional)" hint="Leave blank to auto-generate a readable temporary password such as Welcome-7f3a!">
                      <Input type="text" autoComplete="off" {...bind('login_password')} placeholder="Auto-generate" data-testid="employee-login-password" />
                    </Field>
                  </>
                ) : null}
              </>
            ) : null}
          </>
        ) : (
          <>
            <div className="form-section">Contact</div>
            <Field label="Phone"><Input {...bind('phone')} autoFocus /></Field>
            <Field label="Nationality"><Input {...bind('nationality')} /></Field>
            <Field label="Address" className="span-2"><Input {...bind('address')} /></Field>
            <Field label="City"><Input {...bind('city')} /></Field>
            <Field label="Country"><Input {...bind('country')} /></Field>
            <Field label="Marital status">
              <Select {...bind('marital_status')}>
                <option value="">— Not specified —</option>
                {MARITAL.map((m) => <option key={m} value={m}>{m}</option>)}
              </Select>
            </Field>
            <div className="form-section">Emergency contact</div>
            <Field label="Contact name"><Input {...bind('emergency_contact_name')} /></Field>
            <Field label="Contact phone"><Input {...bind('emergency_contact_phone')} /></Field>
            <p className="help span-2">Other details (job, bank, statutory) can only be changed by HR.</p>
          </>
        )}
      </form>
    </Modal>
  );
}
