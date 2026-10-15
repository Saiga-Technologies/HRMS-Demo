import React, { useState } from 'react';
import { api } from '../../lib/api';
import { Card, Table, Modal, Button, Field, Input, Select, Textarea, Badge, useToast } from '../../components/ui';
import { Icon } from '../../components/Icons';
import { money, minorToInput, CompanyChip, SCHEME_LABEL, type BillingProfile } from './shared';

/** Billing profiles (pricing and invoicing details per client) with an edit dialog. */
export default function Pricing({ profiles, loading, canEdit, gstStates, onSaved }: { profiles: BillingProfile[]; loading: boolean; canEdit: boolean; gstStates: { name: string; code: string }[]; onSaved: () => void }) {
  const [edit, setEdit] = useState<BillingProfile | null>(null);
  return (
    <>
      <Card padded={false} tour="bill-pricing">
        <Table<BillingProfile>
          rows={profiles} loading={loading} keyField="company_id" onRowClick={canEdit ? (p) => setEdit(p) : undefined}
          columns={[
            { key: 'company', header: 'Company', render: (p) => <CompanyChip name={p.company_name} color={p.brand_color} logo={p.logo_text} /> },
            { key: 'plan', header: 'Plan', render: (p) => <span>{p.plan_name}{!p.active ? <> <Badge>Inactive</Badge></> : null}</span> },
            { key: 'pepm', header: 'PEPM', align: 'right', render: (p) => <span className="num">{money(p.pepm_minor, p.exponent, p.currency)}</span> },
            { key: 'run', header: 'Per run', align: 'right', render: (p) => <span className="num">{money(p.payroll_run_minor, p.exponent, p.currency)}</span> },
            { key: 'min', header: 'Minimum', align: 'right', render: (p) => <span className="num">{money(p.min_monthly_minor, p.exponent, p.currency)}</span> },
            { key: 'setup', header: 'Setup', align: 'right', render: (p) => <span className="num">{p.setup_fee_minor ? <>{money(p.setup_fee_minor, p.exponent, p.currency)} <small className="muted">{p.setup_fee_billed ? 'billed' : 'next invoice'}</small></> : '—'}</span> },
            { key: 'terms', header: 'Terms', render: (p) => `${p.payment_terms_days} days` },
            { key: 'tax', header: 'Tax', render: (p) => <span className="bill-dates">{SCHEME_LABEL[p.tax_scheme] || p.tax_scheme}<small className="muted">{p.entity_name}{p.place_of_supply ? ` · ${p.place_of_supply}` : ''}</small></span> },
            ...(canEdit ? [{ key: 'edit', header: '', render: (p: BillingProfile) => <Button size="sm" variant="ghost" aria-label={`Edit pricing for ${p.company_name}`} data-testid={`pricing-edit-${p.company_slug}`} onClick={(e) => { e.stopPropagation(); setEdit(p); }}><Icon name="edit" size={14} /></Button> }] : []),
          ]}
        />
      </Card>
      {edit ? <ProfileModal p={edit} gstStates={gstStates} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); onSaved(); }} /> : null}
    </>
  );
}

function ProfileModal({ p, gstStates, onClose, onSaved }: { p: BillingProfile; gstStates: { name: string; code: string }[]; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({
    plan_name: p.plan_name, pepm: minorToInput(p.pepm_minor, p.exponent), payroll_run: minorToInput(p.payroll_run_minor, p.exponent), min_monthly: minorToInput(p.min_monthly_minor, p.exponent), setup_fee: minorToInput(p.setup_fee_minor, p.exponent),
    payment_terms_days: String(p.payment_terms_days), billing_email: p.billing_email || '', billing_contact: p.billing_contact || '', billing_address: p.billing_address || '', client_tax_id: p.client_tax_id || '', place_of_supply: p.place_of_supply || '', active: !!p.active,
  });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    setBusy(true);
    try {
      await api.put(`/api/agency/billing/profiles/${p.company_id}`, { ...f, place_of_supply_code: p.country_code === 'IN' ? gstStates.find((s) => s.name === f.place_of_supply)?.code : undefined });
      toast.success(`Pricing for ${p.company_name} saved`);
      onSaved();
    } catch (e: any) { toast.error(e); } finally { setBusy(false); }
  };
  return (
    <Modal open wide title={`Pricing · ${p.company_name}`} onClose={onClose} testId="pricing-modal"
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={save} data-testid="pricing-save">Save</Button></>}>
      <p className="muted">Amounts in {p.currency}. Changes apply to drafts generated from now on; issued invoices are never restated.</p>
      <div className="form-grid">
        <Field label="Plan name"><Input value={f.plan_name} onChange={set('plan_name')} /></Field>
        <Field label="Payment terms (days)"><Input type="number" min="0" max="120" value={f.payment_terms_days} onChange={set('payment_terms_days')} data-testid="pricing-terms" /></Field>
        <Field label="Per employee per month (PEPM)"><Input inputMode="decimal" value={f.pepm} onChange={set('pepm')} data-testid="pricing-pepm" /></Field>
        <Field label="Per payroll run"><Input inputMode="decimal" value={f.payroll_run} onChange={set('payroll_run')} /></Field>
        <Field label="Minimum monthly charge" hint="Topped up when PEPM + run fees fall short"><Input inputMode="decimal" value={f.min_monthly} onChange={set('min_monthly')} /></Field>
        <Field label="One-time setup fee" hint={p.setup_fee_billed ? 'Already billed' : 'Billed on the next invoice'}><Input inputMode="decimal" value={f.setup_fee} onChange={set('setup_fee')} /></Field>
        <Field label="Billing email"><Input type="email" value={f.billing_email} onChange={set('billing_email')} /></Field>
        <Field label="Billing contact"><Input value={f.billing_contact} onChange={set('billing_contact')} /></Field>
        <Field label={`Client ${p.client_tax_label}`}><Input value={f.client_tax_id} onChange={set('client_tax_id')} data-testid="pricing-tax-id" /></Field>
        <Field label="Place of supply" hint={p.country_code === 'IN' ? 'Same state as the agency entity → CGST + SGST, otherwise IGST' : undefined}>
          {p.country_code === 'IN' ? (
            <Select value={f.place_of_supply} onChange={set('place_of_supply')} data-testid="pricing-pos">
              <option value="">Choose a state</option>
              {gstStates.map((s) => <option key={s.code} value={s.name}>{s.name} ({s.code})</option>)}
            </Select>
          ) : <Input value={f.place_of_supply} onChange={set('place_of_supply')} />}
        </Field>
        <Field label="Billing address" className="span-2"><Textarea rows={2} value={f.billing_address} onChange={set('billing_address')} /></Field>
        <Field label="Status"><Select value={f.active ? '1' : '0'} onChange={(e) => setF({ ...f, active: e.target.value === '1' })}><option value="1">Active — invoiced monthly</option><option value="0">Paused — skip when generating</option></Select></Field>
      </div>
    </Modal>
  );
}
