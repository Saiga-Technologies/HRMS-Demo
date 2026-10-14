import React, { useEffect, useState } from 'react';
import { api, qs } from '../../lib/api';
import { Badge, Button, Card, Checkbox, Field, Input, Modal, Select, Switch, Table, useConfirm, useFetch, useForm, useToast } from '../ui';
import { CompOffSettings, DEFAULT_COMP_OFF, DirectoryEmployee, LeaveBalance, LeaveSettings, LeaveType, MONTHS, TypeChip, TypeRules } from './shared';

/* ------------------------------------------------------------------ */
/* Balances matrix (HR)                                                */
/* ------------------------------------------------------------------ */
interface MatrixResponse { year: number; types: { id: number; name: string; code: string; color: string }[]; rows: { employee: DirectoryEmployee; balances: LeaveBalance[] }[] }

export function BalancesMatrix() {
  const [year, setYear] = useState(new Date().getFullYear());
  const data = useFetch<MatrixResponse>(() => api.get(`/api/leave/balances${qs({ year })}`), [year]);
  const [edit, setEdit] = useState<{ employee: DirectoryEmployee; balance: LeaveBalance | null; type: { id: number; name: string } } | null>(null);
  const [q, setQ] = useState('');
  const types = data.data?.types || [];
  const rows = (data.data?.rows || []).filter((r) => !q || `${r.employee.first_name} ${r.employee.last_name} ${r.employee.employee_code}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <>
      <div className="toolbar">
        <Input type="number" min={2000} max={2100} value={year} onChange={(e) => setYear(Number(e.target.value) || year)} style={{ width: 110 }} aria-label="Year" data-testid="balances-year" />
        <Input type="search" placeholder="Search employee…" value={q} onChange={(e) => setQ(e.target.value)} className="search" />
        <span className="muted">Each cell shows <strong>available</strong> / used. Click a cell to adjust.</span>
      </div>
      <Card padded={false} tour="leave-balances-matrix">
        <div className="table-wrap">
          <table className="table matrix dense">
            <thead>
              <tr>
                <th>Employee</th>
                {types.map((t) => <th key={t.id} style={{ textAlign: 'center' }}><span className="color-swatch" style={{ background: t.color }} />{t.code}<div className="muted" style={{ fontWeight: 400 }}>{t.name}</div></th>)}
              </tr>
            </thead>
            <tbody>
              {data.loading && !data.data ? <tr><td colSpan={types.length + 1} className="table-empty">Loading…</td></tr> : null}
              {!data.loading && !rows.length ? <tr><td colSpan={types.length + 1} className="table-empty">No employees.</td></tr> : null}
              {rows.map((r) => (
                <tr key={r.employee.id}>
                  <td><strong>{r.employee.first_name} {r.employee.last_name}</strong> <span className="muted mono">{r.employee.employee_code}</span></td>
                  {types.map((t) => {
                    const b = r.balances.find((x) => x.leave_type_id === t.id) || null;
                    return (
                      <td key={t.id} className="cell">
                        <button type="button" className={`balance-cell ${b && b.available < 0 ? 'negative' : ''}`} onClick={() => setEdit({ employee: r.employee, balance: b, type: t })} data-testid="balance-cell" title={b ? `Allocated ${b.allocated} + carried ${b.carried} ${b.adjusted >= 0 ? '+' : ''}${b.adjusted} adj − used ${b.used}` : 'No balance row yet'}>
                          {b ? <><strong>{b.available}</strong><span className="muted"> / {b.used}</span>{b.pending ? <span className="muted" title="pending"> (+{b.pending}p)</span> : null}</> : <span className="muted">—</span>}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      {edit ? <AdjustBalanceModal year={year} employee={edit.employee} type={edit.type} balance={edit.balance} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); data.reload(); }} /> : null}
    </>
  );
}

function AdjustBalanceModal({ year, employee, type, balance, onClose, onSaved }: { year: number; employee: DirectoryEmployee; type: { id: number; name: string }; balance: LeaveBalance | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const f = useForm({ allocated: balance?.allocated ?? 0, carried: balance?.carried ?? 0, adjusted: balance?.adjusted ?? 0 });
  const [busy, setBusy] = useState(false);
  const available = Number(f.values.allocated) + Number(f.values.carried) + Number(f.values.adjusted) - (balance?.used ?? 0);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.put(`/api/leave/balances/${employee.id}/${type.id}`, { year, allocated: Number(f.values.allocated), carried: Number(f.values.carried), adjusted: Number(f.values.adjusted) });
      toast.success('Balance updated');
      onSaved();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open title={`${type.name} · ${employee.first_name} ${employee.last_name} · ${year}`} onClose={onClose} testId="balance-modal"
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={save as any} data-testid="balance-save">Save</Button></>}>
      <form onSubmit={save} className="form-grid">
        <Field label="Allocated" hint="Annual quota for this employee"><Input type="number" step="0.5" {...f.bind('allocated')} /></Field>
        <Field label="Carried forward" hint="Brought in from last year"><Input type="number" step="0.5" {...f.bind('carried')} /></Field>
        <Field label="Adjustment" hint="Positive to grant extra, negative to deduct"><Input type="number" step="0.5" {...f.bind('adjusted')} /></Field>
        <Field label="Used"><Input value={balance?.used ?? 0} readOnly disabled /></Field>
        <p className="help span-2">Available after save: <strong className={available < 0 ? 'late' : ''}>{available}</strong>{balance?.pending ? ` (${balance.pending} pending)` : ''}</p>
      </form>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Leave types (HR)                                                    */
/* ------------------------------------------------------------------ */
export function LeaveTypesTab({ types, loading, reload }: { types: LeaveType[]; loading: boolean; reload: () => void }) {
  const toast = useToast();
  const { confirm, dialog } = useConfirm();
  const [edit, setEdit] = useState<Partial<LeaveType> | null>(null);
  const remove = async (t: LeaveType) => {
    if (!(await confirm(`Delete ${t.name}?`, 'Only possible when no requests use it; otherwise deactivate it.'))) return;
    try {
      await api.delete(`/api/leave/types/${t.id}`);
      toast.success('Leave type deleted');
      reload();
    } catch (err) {
      toast.error(err);
    }
  };
  return (
    <>
      {dialog}
      <div className="toolbar">
        <span className="muted">Creating a type gives every active employee a balance for this year.</span>
        <Button variant="primary" style={{ marginLeft: 'auto' }} onClick={() => setEdit({ paid: 1, allow_half_day: 1, active: 1, color: '#2563eb', annual_quota: 12 })} data-testid="leavetype-add">+ Add leave type</Button>
      </div>
      <Card padded={false} tour="leave-types">
        <Table<LeaveType>
          loading={loading}
          rows={types}
          onRowClick={(t) => setEdit(t)}
          empty="No leave types yet."
          columns={[
            { key: 'name', header: 'Type', render: (t) => <TypeChip name={t.name} color={t.color} code={t.code} /> },
            { key: 'annual_quota', header: 'Quota / yr', align: 'right' },
            { key: 'paid', header: 'Paid', render: (t) => <Badge tone={t.paid ? 'success' : 'neutral'}>{t.paid ? 'Paid' : 'Unpaid'}</Badge> },
            { key: 'carry_forward', header: 'Carry forward', render: (t) => (t.carry_forward ? `Yes (max ${t.max_carry_forward})` : 'No') },
            { key: 'rules', header: 'Rules', render: (t) => <TypeRules t={t} /> },
            { key: 'active', header: 'Status', render: (t) => <Badge tone={t.active ? 'success' : 'neutral'}>{t.active ? 'Active' : 'Inactive'}</Badge> },
            { key: 'actions', header: '', align: 'right', render: (t) => <Button size="sm" variant="danger" onClick={(e) => { e.stopPropagation(); remove(t); }}>Delete</Button> },
          ]}
        />
      </Card>
      {edit ? <LeaveTypeModal type={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} /> : null}
    </>
  );
}

function LeaveTypeModal({ type, onClose, onSaved }: { type: Partial<LeaveType>; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const f = useForm({ name: type.name || '', code: type.code || '', annual_quota: type.annual_quota ?? 12, paid: type.paid ?? 1, carry_forward: type.carry_forward ?? 0, max_carry_forward: type.max_carry_forward ?? 0, requires_document: type.requires_document ?? 0, min_notice_days: type.min_notice_days ?? 0, allow_half_day: type.allow_half_day ?? 1, color: type.color || '#2563eb', active: type.active ?? 1 });
  const [applyAll, setApplyAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const bool = (k: 'paid' | 'carry_forward' | 'requires_document' | 'allow_half_day' | 'active') => ({ checked: !!Number(f.values[k]), onChange: (v: boolean) => f.set(k, v ? 1 : 0) });
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const body: any = { ...f.values, annual_quota: Number(f.values.annual_quota), max_carry_forward: Number(f.values.max_carry_forward), min_notice_days: Number(f.values.min_notice_days) };
      if (type.id) {
        body.apply_quota_to_all = applyAll;
        await api.put(`/api/leave/types/${type.id}`, body);
      } else await api.post('/api/leave/types', body);
      toast.success(type.id ? 'Leave type updated' : 'Leave type created');
      onSaved();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open title={type.id ? 'Edit leave type' : 'New leave type'} onClose={onClose} testId="leavetype-modal"
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={save as any} data-testid="leavetype-save">Save</Button></>}>
      <form onSubmit={save} className="form-grid">
        <Field label="Name" required><Input {...f.bind('name')} required autoFocus placeholder="e.g. Casual leave" data-testid="leavetype-name" /></Field>
        <Field label="Code" required hint={type.id ? 'Code cannot be changed' : 'Letters and digits, e.g. CL'}><Input {...f.bind('code')} required disabled={!!type.id} placeholder="CL" style={{ textTransform: 'uppercase' }} data-testid="leavetype-code" /></Field>
        <Field label="Annual quota (days)"><Input type="number" min={0} step="0.5" {...f.bind('annual_quota')} /></Field>
        <Field label="Colour"><Input type="color" {...f.bind('color')} /></Field>
        <Field label="Minimum notice (days)"><Input type="number" min={0} {...f.bind('min_notice_days')} /></Field>
        <Field label="Max carry forward (days)"><Input type="number" min={0} step="0.5" {...f.bind('max_carry_forward')} disabled={!Number(f.values.carry_forward)} /></Field>
        <div className="form-section">Rules</div>
        <Switch label="Paid leave (deducts from balance)" {...bool('paid')} />
        <Switch label="Carry forward unused days" {...bool('carry_forward')} />
        <Switch label="Requires supporting document" {...bool('requires_document')} />
        <Switch label="Allow half day" {...bool('allow_half_day')} />
        <Switch label="Active (employees can apply)" {...bool('active')} />
        {type.id ? <div className="span-2"><Checkbox label={`Apply the quota of ${f.values.annual_quota} days to all employees for ${new Date().getFullYear()}`} checked={applyAll} onChange={(e) => setApplyAll(e.target.checked)} data-testid="leavetype-apply-all" /></div> : null}
      </form>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Leave settings (HR)                                                 */
/* ------------------------------------------------------------------ */
export function LeaveSettingsTab({ onSaved }: { onSaved?: (s: LeaveSettings) => void }) {
  const toast = useToast();
  const current = useFetch<LeaveSettings>(() => api.get('/api/settings/leave'), []);
  const [v, setV] = useState<LeaveSettings | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (current.data) setV(current.data); }, [current.data]);
  if (!v) return <Card><span className="muted">Loading settings…</span></Card>;
  const co: CompOffSettings = { ...DEFAULT_COMP_OFF, ...(v.comp_off || {}) };
  const setCo = (patch: Partial<CompOffSettings>) => setV({ ...v, comp_off: { ...co, ...patch } });
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const saved = await api.put<LeaveSettings>('/api/settings/leave', { ...v, comp_off: co });
      setV(saved);
      onSaved?.(saved);
      toast.success('Leave settings saved');
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card title="Leave settings" tour="leave-settings" actions={<Button variant="primary" loading={busy} onClick={save as any} data-testid="leave-settings-save">Save</Button>}>
      <form onSubmit={save} className="form-grid">
        <Field label="Leave year starts in" hint="Balances are tracked per calendar year of the start date">
          <Select value={v.year_start_month} onChange={(e) => setV({ ...v, year_start_month: Number(e.target.value) })}>
            {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </Select>
        </Field>
        <Field label="Max consecutive days per request"><Input type="number" min={1} max={365} value={v.max_consecutive_days} onChange={(e) => setV({ ...v, max_consecutive_days: Number(e.target.value) })} /></Field>
        <div className="form-section">Rules</div>
        <Switch label="Allow negative balance (apply beyond available days)" checked={!!v.allow_negative_balance} onChange={(c) => setV({ ...v, allow_negative_balance: c })} />
        <Switch label="Sandwich rule (weekends and holidays inside a leave count as leave)" checked={!!v.sandwich_rule} onChange={(c) => setV({ ...v, sandwich_rule: c })} />
        <Switch label="Managers can approve their reports' leave (otherwise HR only)" checked={!!v.managers_can_approve} onChange={(c) => setV({ ...v, managers_can_approve: c })} />
        <div className="form-section" data-tour="leave-compoff-settings">Comp off (automatic detection of extra working days)</div>
        <Switch label="Comp off enabled (scan attendance for extra working days)" checked={!!co.enabled} onChange={(c) => setCo({ enabled: c })} />
        <Switch label="Requires manager approval (otherwise credits are added as soon as the employee confirms)" checked={!!co.requires_manager_approval} onChange={(c) => setCo({ requires_manager_approval: c })} />
        <Switch label="Working on a weekly off earns comp off" checked={!!co.on_weekly_off} onChange={(c) => setCo({ on_weekly_off: c })} />
        <Switch label="Working on a holiday earns comp off" checked={!!co.on_holiday} onChange={(c) => setCo({ on_holiday: c })} />
        <Field label="Extra hours threshold (minutes)" hint="On normal days, minutes beyond the standard day before comp off is earned; 0 disables extra-hours credits"><Input type="number" min={0} value={co.extra_hours_threshold_minutes} onChange={(e) => setCo({ extra_hours_threshold_minutes: Number(e.target.value) || 0 })} data-testid="compoff-threshold" /></Field>
        <Field label="Expiry (days)" hint="Credits must be claimed and used within this many days of the worked date"><Input type="number" min={1} value={co.expiry_days} onChange={(e) => setCo({ expiry_days: Number(e.target.value) || 0 })} data-testid="compoff-expiry" /></Field>
        <Field label="Full day credit from (minutes worked)"><Input type="number" min={1} value={co.full_day_minutes} onChange={(e) => setCo({ full_day_minutes: Number(e.target.value) || 0 })} /></Field>
        <Field label="Half day credit from (minutes worked)"><Input type="number" min={1} value={co.half_day_minutes} onChange={(e) => setCo({ half_day_minutes: Number(e.target.value) || 0 })} /></Field>
        <p className="help span-2">Credits land in the <strong>{co.leave_type_code || 'CO'}</strong> leave type balance once approved. Detection looks at the last 60 days and never credits the same date twice.</p>
      </form>
    </Card>
  );
}
