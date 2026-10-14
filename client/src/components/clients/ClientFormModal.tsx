import React, { useState } from 'react';
import { api } from '../../lib/api';
import { Button, Field, Input, Modal, Select, Textarea, useForm, useToast } from '../ui';
import { CLIENT_STATUSES, CLIENT_STATUS_LABEL, CURRENCIES, type Client } from './types';

/** Create or edit a client (HR only). */
export function ClientFormModal({ client, onClose, onSaved }: { client?: Client | null; onClose: () => void; onSaved: (c: Client) => void }) {
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const f = useForm({
    name: client?.name || '',
    code: client?.code || '',
    industry: client?.industry || '',
    website: client?.website || '',
    address: client?.address || '',
    contact_name: client?.contact_name || '',
    contact_email: client?.contact_email || '',
    contact_phone: client?.contact_phone || '',
    status: client?.status || 'active',
    billing_currency: client?.billing_currency || 'INR',
    payment_terms_days: String(client?.payment_terms_days ?? 30),
    notes: client?.notes || '',
  });
  const v = f.values;
  const currencies = CURRENCIES.includes(v.billing_currency) ? CURRENCIES : [...CURRENCIES, v.billing_currency];

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!v.name.trim()) return toast.error('Client name is required');
    setSaving(true);
    try {
      const body: Record<string, any> = { ...v, name: v.name.trim(), payment_terms_days: Number(v.payment_terms_days || 0) };
      for (const k of ['industry', 'website', 'address', 'contact_name', 'contact_email', 'contact_phone', 'notes']) body[k] = String(body[k] || '').trim() || null;
      if (!String(body.code).trim()) delete body.code;
      const saved = client ? await api.put<Client>(`/api/clients/${client.id}`, body) : await api.post<Client>('/api/clients', body);
      toast.success(client ? 'Client updated' : `Client ${saved.name} added`);
      onSaved(saved);
    } catch (err) {
      toast.error(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open wide title={client ? `Edit ${client.name}` : 'Add client'} onClose={onClose} testId="client-modal"
      footer={(
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="client-form" loading={saving} data-testid="client-submit">{client ? 'Save changes' : 'Add client'}</Button>
        </>
      )}>
      <form id="client-form" className="form-grid" onSubmit={submit}>
        <Field label="Client name" required><Input {...f.bind('name')} autoFocus data-testid="client-name" /></Field>
        <Field label="Code" hint={client ? undefined : 'Leave blank to generate (CL-0005…)'}><Input {...f.bind('code')} data-testid="client-code" /></Field>
        <Field label="Industry"><Input {...f.bind('industry')} data-testid="client-industry" /></Field>
        <Field label="Status">
          <Select {...f.bind('status')} data-testid="client-status">
            {CLIENT_STATUSES.map((s) => <option key={s} value={s}>{CLIENT_STATUS_LABEL[s]}</option>)}
          </Select>
        </Field>
        <div className="form-section">Primary contact</div>
        <Field label="Contact name"><Input {...f.bind('contact_name')} data-testid="client-contact-name" /></Field>
        <Field label="Contact email"><Input type="email" {...f.bind('contact_email')} data-testid="client-contact-email" /></Field>
        <Field label="Contact phone"><Input {...f.bind('contact_phone')} /></Field>
        <Field label="Website"><Input type="url" placeholder="https://" {...f.bind('website')} /></Field>
        <div className="form-section">Billing</div>
        <Field label="Billing currency">
          <Select {...f.bind('billing_currency')} data-testid="client-currency">
            {currencies.map((c) => <option key={c} value={c}>{c}</option>)}
          </Select>
        </Field>
        <Field label="Payment terms (days)"><Input type="number" min={0} {...f.bind('payment_terms_days')} data-testid="client-terms" /></Field>
        <Field label="Address" className="span-2"><Input {...f.bind('address')} /></Field>
        <Field label="Notes" className="span-2"><Textarea rows={3} {...f.bind('notes')} /></Field>
      </form>
    </Modal>
  );
}
