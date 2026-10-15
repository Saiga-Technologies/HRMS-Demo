import React, { useState } from 'react';
import { api } from '../../lib/api';
import { fmtMoney, todayIso } from '../../lib/format';
import { Button, Field, Input, Modal, Pill, Select, Textarea, useFetch, useForm, useToast } from '../ui';
import {
  MONTH_FACTOR, PLACEMENT_STATUS_LABEL, RATE_UNITS, UNIT_LABEL,
  type CandidateLite, type Client, type DirEmployee, type Placement, type RateUnit,
} from './types';

const num = (s: string) => (s.trim() === '' ? null : Number(s));

/**
 * Create a placement for a client (POST /api/clients/:id/placements) or edit one (PUT /api/clients/placements/:id).
 * `clientId` fixes the client (opened from the client detail); otherwise HR picks one.
 */
export function PlacementFormModal({ placement, clientId, clients, onClose, onSaved }: {
  placement?: Placement | null;
  clientId?: number | null;
  clients: Client[];
  onClose: () => void;
  onSaved: (p: Placement) => void;
}) {
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const employees = useFetch<DirEmployee[]>(() => api.get('/api/employees/directory/all'), []);
  const candidates = useFetch<{ items: CandidateLite[] }>(() => api.get('/api/recruitment/candidates'), []);
  const f = useForm({
    client_id: String(placement?.client_id ?? clientId ?? ''),
    person_type: (placement?.person_type || 'employee') as 'employee' | 'candidate',
    employee_id: placement?.employee_id ? String(placement.employee_id) : '',
    candidate_id: placement?.candidate_id ? String(placement.candidate_id) : '',
    role_title: placement?.role_title || '',
    start_date: placement?.start_date || todayIso(),
    end_date: placement?.end_date || '',
    rate_unit: (placement?.rate_unit || 'month') as RateUnit,
    bill_rate: placement?.bill_rate != null ? String(placement.bill_rate) : '',
    pay_rate: placement?.pay_rate != null ? String(placement.pay_rate) : '',
    placement_fee: placement?.placement_fee != null ? String(placement.placement_fee) : '',
    status: placement?.status || 'proposed',
    location: placement?.location || '',
    notes: placement?.notes || '',
  });
  const v = f.values;
  const client = clients.find((c) => String(c.id) === v.client_id);
  const currency = placement?.billing_currency || client?.billing_currency || 'INR';
  const bill = num(v.bill_rate);
  const pay = num(v.pay_rate);
  const margin = bill != null && pay != null ? bill - pay : null;
  const factor = MONTH_FACTOR[v.rate_unit] || 1;
  const activeCandidates = (candidates.data?.items || []).filter((c) => !['rejected', 'withdrawn'].includes(c.stage) || String(c.id) === v.candidate_id);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!v.client_id) return toast.error('Choose a client');
    if (!v.role_title.trim()) return toast.error('Role title is required');
    const personId = v.person_type === 'employee' ? v.employee_id : v.candidate_id;
    if (!personId) return toast.error(`Choose ${v.person_type === 'employee' ? 'an employee' : 'a candidate'}`);
    setSaving(true);
    try {
      const body: Record<string, any> = {
        employee_id: v.person_type === 'employee' ? Number(v.employee_id) : null,
        candidate_id: v.person_type === 'candidate' ? Number(v.candidate_id) : null,
        role_title: v.role_title.trim(),
        start_date: v.start_date || null,
        end_date: v.end_date || null,
        rate_unit: v.rate_unit,
        bill_rate: bill,
        pay_rate: pay,
        placement_fee: num(v.placement_fee),
        location: v.location.trim() || null,
        notes: v.notes.trim() || null,
      };
      if (!placement) body.status = v.status;
      const saved = placement
        ? await api.put<Placement>(`/api/clients/placements/${placement.id}`, body)
        : await api.post<Placement>(`/api/clients/${v.client_id}/placements`, body);
      toast.success(placement ? 'Placement updated' : `Placement added for ${saved.person_name || 'the client'}`);
      onSaved(saved);
    } catch (err) {
      toast.error(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open wide title={placement ? `Edit placement · ${placement.role_title}` : 'Add placement'} onClose={onClose} testId="placement-modal"
      footer={(
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="placement-form" loading={saving} data-testid="placement-submit">{placement ? 'Save changes' : 'Add placement'}</Button>
        </>
      )}>
      <form id="placement-form" className="form-grid" onSubmit={submit}>
        <Field label="Client" required>
          <Select {...f.bind('client_id')} disabled={!!placement || !!clientId} data-testid="placement-client">
            <option value="">Choose a client…</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.name}{c.code ? ` (${c.code})` : ''}</option>)}
          </Select>
        </Field>
        <Field label="Role title" required><Input {...f.bind('role_title')} placeholder="e.g. Backend Engineer" data-testid="placement-role" /></Field>

        <div className="form-section">Who is placed</div>
        <div className="span-2 row" role="radiogroup" aria-label="Person type">
          <Pill active={v.person_type === 'employee'} onClick={() => f.set('person_type', 'employee')}>Employee</Pill>
          <Pill active={v.person_type === 'candidate'} onClick={() => f.set('person_type', 'candidate')}>Candidate</Pill>
          <span className="help">Place an existing employee on contract, or a candidate from the recruitment pool.</span>
        </div>
        {v.person_type === 'employee' ? (
          <Field label="Employee" required className="span-2">
            <Select {...f.bind('employee_id')} data-testid="placement-employee">
              <option value="">{employees.loading ? 'Loading…' : 'Choose an employee…'}</option>
              {(employees.data || []).map((e) => <option key={e.id} value={e.id}>{e.first_name} {e.last_name} ({e.employee_code}){e.position_title ? ` · ${e.position_title}` : ''}</option>)}
            </Select>
          </Field>
        ) : (
          <Field label="Candidate" required className="span-2">
            <Select {...f.bind('candidate_id')} data-testid="placement-candidate">
              <option value="">{candidates.loading ? 'Loading…' : 'Choose a candidate…'}</option>
              {activeCandidates.map((c) => <option key={c.id} value={c.id}>{c.first_name} {c.last_name}{c.vacancy_title ? ` · ${c.vacancy_title}` : ''} ({c.stage})</option>)}
            </Select>
          </Field>
        )}

        <div className="form-section">Dates</div>
        <Field label="Start date"><Input type="date" {...f.bind('start_date')} data-testid="placement-start" /></Field>
        <Field label="End date" hint="Leave blank for open-ended"><Input type="date" {...f.bind('end_date')} min={v.start_date || undefined} data-testid="placement-end" /></Field>

        <div className="form-section">Rates ({currency})</div>
        <Field label="Rate unit">
          <Select {...f.bind('rate_unit')} data-testid="placement-unit">
            {RATE_UNITS.map((u) => <option key={u} value={u}>{UNIT_LABEL[u]}</option>)}
          </Select>
        </Field>
        <Field label="Placement fee" hint="One-off fee charged to the client (optional)"><Input type="number" min={0} step="0.01" {...f.bind('placement_fee')} data-testid="placement-fee" /></Field>
        <Field label="Bill rate" hint="What the client pays"><Input type="number" min={0} step="0.01" {...f.bind('bill_rate')} data-testid="placement-bill" /></Field>
        <Field label="Pay rate" hint="What the person is paid"><Input type="number" min={0} step="0.01" {...f.bind('pay_rate')} data-testid="placement-pay" /></Field>
        <div className="span-2 alert alert-info" data-testid="placement-margin-preview">
          {margin == null ? 'Enter bill and pay rates to see the margin.' : (
            <>Margin {fmtMoney(margin, currency)} {UNIT_LABEL[v.rate_unit]}{bill ? ` (${((margin / bill) * 100).toFixed(1)}%)` : ''} · about <strong>{fmtMoney(margin * factor, currency)}</strong> a month{v.rate_unit === 'hour' ? ' at 160 h' : v.rate_unit === 'day' ? ' at 22 days' : ''}.</>
          )}
        </div>

        <div className="form-section">Other</div>
        {!placement ? (
          <Field label="Initial status">
            <Select {...f.bind('status')} data-testid="placement-initial-status">
              <option value="proposed">{PLACEMENT_STATUS_LABEL.proposed}</option>
              <option value="active">{PLACEMENT_STATUS_LABEL.active}</option>
            </Select>
          </Field>
        ) : null}
        <Field label="Location" className={placement ? 'span-2' : undefined}><Input {...f.bind('location')} placeholder="Client site, Remote…" /></Field>
        <Field label="Notes" className="span-2"><Textarea rows={2} {...f.bind('notes')} /></Field>
      </form>
    </Modal>
  );
}
