import React, { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { Button, Field, Input, Select, Textarea, Modal, Spinner, useToast, downloadUrl, KeyValue } from '../../components/ui';
import { Icon } from '../../components/Icons';
import { fmtDate, todayIso } from '../../lib/format';
import { money, minorToInput, pct, InvoiceStatus, CompanyChip, periodLabel, newIdempotencyKey, METHOD_LABEL, SCHEME_LABEL, type InvoiceDetail } from './shared';

/** Side drawer with an invoice's lines, tax, payments and its actions. */
export default function InvoiceDrawer({ id, onClose, onChanged, methods }: { id: number; onClose: () => void; onChanged: () => void; methods: string[] }) {
  const toast = useToast();
  const [inv, setInv] = useState<InvoiceDetail | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [payOpen, setPayOpen] = useState(false);
  const [voidOpen, setVoidOpen] = useState(false);
  const [line, setLine] = useState({ description: '', quantity: '1', unit: '' });
  const [notes, setNotes] = useState('');

  const load = () => api.get<InvoiceDetail>(`/api/agency/billing/invoices/${id}`).then((d) => { setInv(d); setNotes(d.notes || ''); }).catch((e) => toast.error(e));
  useEffect(() => { setInv(null); load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [id]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !payOpen && !voidOpen) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, payOpen, voidOpen]);

  const act = async (key: string, fn: () => Promise<any>, ok: string) => {
    setBusy(key);
    try {
      const out = await fn();
      if (out && out.lines) { setInv({ ...inv!, ...out }); setNotes(out.notes || ''); } else await load();
      toast.success(ok);
      onChanged();
      return true;
    } catch (e: any) {
      toast.error(e);
      return false;
    } finally { setBusy(null); }
  };
  const issue = () => act('issue', () => api.post(`/api/agency/billing/invoices/${id}/issue`), 'Invoice issued');
  const addLine = async () => {
    if (!line.description.trim() || !line.unit) return toast.error('Add a description and a unit price');
    if (await act('line', () => api.put(`/api/agency/billing/invoices/${id}`, { add_lines: [line] }), 'Line added')) setLine({ description: '', quantity: '1', unit: '' });
  };
  const removeLine = (lineId: number) => act(`rm${lineId}`, () => api.put(`/api/agency/billing/invoices/${id}`, { remove_line_ids: [lineId] }), 'Line removed');
  const saveNotes = () => act('notes', () => api.put(`/api/agency/billing/invoices/${id}`, { notes }), 'Notes saved');
  const pdf = async () => {
    setBusy('pdf');
    try { await downloadUrl(`/api/agency/billing/invoices/${id}/pdf?download=1`, `${(inv?.number || `draft-${id}`).replace(/[^A-Za-z0-9-]+/g, '-')}.pdf`); toast.success('PDF downloaded'); } catch (e: any) { toast.error(e); } finally { setBusy(null); }
  };

  return (
    <>
      <div className="bill-drawer-backdrop" onClick={onClose} />
      <aside className="bill-drawer" role="dialog" aria-modal="true" aria-label="Invoice" data-testid="invoice-drawer">
        {!inv ? <Spinner /> : (
          <>
            <header className="bill-drawer-head">
              <div>
                <div className="bill-drawer-title"><span className="mono" data-testid="invoice-number">{inv.number || 'Draft — no number yet'}</span> <span data-testid="invoice-status"><InvoiceStatus inv={inv} /></span></div>
                <div className="row bill-drawer-sub"><CompanyChip name={inv.company_name} color={inv.brand_color} logo={inv.logo_text} /><span className="muted">{periodLabel(inv.period)} · {inv.entity_name}</span></div>
              </div>
              <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close"><Icon name="x" size={16} /></button>
            </header>

            <div className="bill-drawer-actions">
              {inv.can_edit && inv.status === 'draft' ? <Button variant="primary" loading={busy === 'issue'} onClick={issue} data-testid="invoice-issue"><Icon name="check" size={15} /> Issue invoice</Button> : null}
              {inv.can_edit && inv.status === 'issued' ? <Button variant="primary" onClick={() => setPayOpen(true)} data-testid="invoice-record-payment"><Icon name="banknote" size={15} /> Record payment</Button> : null}
              <Button loading={busy === 'pdf'} onClick={pdf} data-testid="invoice-pdf"><Icon name="download" size={15} /> PDF</Button>
              {inv.can_edit && inv.status === 'issued' && inv.paid_minor === 0 ? <Button variant="danger" onClick={() => setVoidOpen(true)} data-testid="invoice-void">Void</Button> : null}
            </div>

            <div className="bill-drawer-body">
              <KeyValue items={[
                { k: 'Invoice date', v: fmtDate(inv.issue_date) },
                { k: 'Due date', v: inv.due_date ? <span className={inv.overdue ? 'bill-danger' : ''}>{fmtDate(inv.due_date)}</span> : 'On issue' },
                { k: 'Bill to', v: <>{inv.company.legal_name || inv.company_name}{inv.billing?.billing_email ? <div className="muted">{inv.billing.billing_email}</div> : null}</> },
                { k: inv.billing?.client_tax_label || 'Tax ID', v: inv.billing?.client_tax_id || '—' },
                { k: 'Place of supply', v: inv.place_of_supply || '—' },
                { k: 'Tax', v: SCHEME_LABEL[inv.tax_scheme] || inv.tax_scheme },
              ]} />
              {inv.status === 'void' ? <div className="bill-callout danger"><Icon name="alert" size={16} /> Voided: {inv.void_reason}. The number stays used.</div> : null}
              {inv.zatca_note ? <div className="bill-callout"><Icon name="info" size={16} /> {inv.zatca_note}</div> : null}

              <h3 className="section-title">Lines</h3>
              <div className="table-wrap">
                <table className="table dense bill-lines" data-testid="invoice-lines">
                  <thead><tr><th>Description</th><th style={{ textAlign: 'right' }}>Qty</th><th style={{ textAlign: 'right' }}>Rate</th><th style={{ textAlign: 'right' }}>Amount</th>{inv.status === 'draft' && inv.can_edit ? <th /> : null}</tr></thead>
                  <tbody>
                    {inv.lines.map((l) => (
                      <tr key={l.id} data-kind={l.kind}>
                        <td>{l.description}{l.sac_code ? <div className="muted bill-sac">SAC {l.sac_code}</div> : null}</td>
                        <td className="num" style={{ textAlign: 'right' }}>{Number.isInteger(l.quantity) ? l.quantity : l.quantity.toFixed(2)}</td>
                        <td className="num" style={{ textAlign: 'right' }}>{money(l.unit_minor, inv.exponent, inv.currency)}</td>
                        <td className="num" style={{ textAlign: 'right' }}>{money(l.amount_minor, inv.exponent, inv.currency)}</td>
                        {inv.status === 'draft' && inv.can_edit ? <td>{l.kind === 'adhoc' ? <button className="btn btn-ghost btn-sm" aria-label="Remove line" disabled={busy === `rm${l.id}`} onClick={() => removeLine(l.id)}><Icon name="trash" size={14} /></button> : null}</td> : null}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {inv.status === 'draft' && inv.can_edit ? (
                <div className="bill-addline">
                  <Input placeholder="Ad-hoc line, e.g. Full & final settlement" value={line.description} onChange={(e) => setLine({ ...line, description: e.target.value })} data-testid="adhoc-description" />
                  <Input type="number" min="0.01" step="0.01" aria-label="Quantity" value={line.quantity} onChange={(e) => setLine({ ...line, quantity: e.target.value })} />
                  <Input inputMode="decimal" placeholder={`Unit (${inv.currency})`} value={line.unit} onChange={(e) => setLine({ ...line, unit: e.target.value })} data-testid="adhoc-unit" />
                  <Button size="sm" loading={busy === 'line'} onClick={addLine} data-testid="adhoc-add"><Icon name="plus" size={14} /> Add</Button>
                </div>
              ) : null}

              <div className="bill-totals" data-testid="invoice-totals">
                <div><span>Subtotal</span><span className="num">{money(inv.subtotal_minor, inv.exponent, inv.currency)}</span></div>
                {inv.tax_breakdown.map((t) => <div key={t.name} data-testid={`tax-${t.name}`}><span>{t.name} @ {pct(t.rate_bp)}</span><span className="num">{money(t.amount_minor, inv.exponent, inv.currency)}</span></div>)}
                <div className="bill-total"><span>Total</span><span className="num">{money(inv.total_minor, inv.exponent, inv.currency)}</span></div>
                {inv.paid_minor ? <div><span>Paid</span><span className="num">{money(inv.paid_minor, inv.exponent, inv.currency)}</span></div> : null}
                {inv.status === 'issued' ? <div className="bill-total"><span>Balance due</span><span className="num" data-testid="invoice-balance">{money(inv.total_minor - inv.paid_minor, inv.exponent, inv.currency)}</span></div> : null}
              </div>

              <h3 className="section-title">Payments</h3>
              {inv.payments.length ? (
                <ul className="bill-payments" data-testid="invoice-payments">
                  {inv.payments.map((p) => (
                    <li key={p.id}><span><strong className="num">{money(p.amount_minor, inv.exponent, inv.currency)}</strong><small className="muted">{METHOD_LABEL[p.method] || p.method}{p.reference ? ` · ${p.reference}` : ''}</small></span><span className="muted">{fmtDate(p.received_on)}</span></li>
                  ))}
                </ul>
              ) : <p className="muted">No payments recorded.</p>}

              {inv.status === 'draft' && inv.can_edit ? (
                <>
                  <h3 className="section-title">Notes on the invoice</h3>
                  <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
                  <div className="row end" style={{ marginTop: 6 }}><Button size="sm" loading={busy === 'notes'} onClick={saveNotes} disabled={notes === (inv.notes || '')}>Save notes</Button></div>
                </>
              ) : inv.notes ? <><h3 className="section-title">Notes</h3><p>{inv.notes}</p></> : null}
              {inv.entity.bank_details ? <p className="muted bill-note">Pay to {inv.entity.legal_name} · {inv.entity.bank_details}</p> : null}
            </div>
          </>
        )}
      </aside>
      {inv && payOpen ? <PaymentModal inv={inv} methods={methods} onClose={() => setPayOpen(false)} onDone={(d) => { setInv({ ...inv, ...d }); setPayOpen(false); onChanged(); }} /> : null}
      {inv && voidOpen ? <VoidModal inv={inv} onClose={() => setVoidOpen(false)} onDone={(d) => { setInv({ ...inv, ...d }); setVoidOpen(false); onChanged(); }} /> : null}
    </>
  );
}

function PaymentModal({ inv, methods, onClose, onDone }: { inv: InvoiceDetail; methods: string[]; onClose: () => void; onDone: (d: InvoiceDetail) => void }) {
  const toast = useToast();
  // One key per dialog: a double click or a retried request records the payment once.
  const [key] = useState(newIdempotencyKey);
  const outstanding = inv.total_minor - inv.paid_minor;
  const [f, setF] = useState({ amount: minorToInput(outstanding, inv.exponent), received_on: todayIso(), method: inv.currency === 'INR' ? 'neft' : inv.currency === 'USD' ? 'ach' : 'bank_transfer', reference: '' });
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      const out = await api.post<{ invoice: InvoiceDetail; replayed: boolean }>(`/api/agency/billing/invoices/${inv.id}/payments`, { ...f, idempotency_key: key });
      toast.success(out.invoice.status === 'paid' ? 'Payment recorded — invoice paid' : 'Payment recorded');
      onDone(out.invoice);
    } catch (e: any) { toast.error(e); } finally { setBusy(false); }
  };
  return (
    <Modal open title={`Record payment · ${inv.number}`} onClose={onClose} testId="payment-modal"
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={submit} data-testid="payment-save">Record payment</Button></>}>
      <p className="muted">Outstanding {money(outstanding, inv.exponent, inv.currency)} of {money(inv.total_minor, inv.exponent, inv.currency)}. Partial payments are fine.</p>
      <div className="form-grid">
        <Field label={`Amount (${inv.currency})`} required><Input inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} data-testid="payment-amount" /></Field>
        <Field label="Received on" required><Input type="date" value={f.received_on} onChange={(e) => setF({ ...f, received_on: e.target.value })} data-testid="payment-date" /></Field>
        <Field label="Method"><Select value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })} data-testid="payment-method">{methods.map((m) => <option key={m} value={m}>{METHOD_LABEL[m] || m}</option>)}</Select></Field>
        <Field label="Reference" hint="UTR, wire or cheque number"><Input value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} data-testid="payment-reference" /></Field>
      </div>
    </Modal>
  );
}

function VoidModal({ inv, onClose, onDone }: { inv: InvoiceDetail; onClose: () => void; onDone: (d: InvoiceDetail) => void }) {
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try { onDone(await api.post<InvoiceDetail>(`/api/agency/billing/invoices/${inv.id}/void`, { reason })); toast.success(`Invoice ${inv.number} voided`); } catch (e: any) { toast.error(e); } finally { setBusy(false); }
  };
  return (
    <Modal open title={`Void ${inv.number}?`} onClose={onClose} testId="void-modal"
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="danger" loading={busy} disabled={!reason.trim()} onClick={submit} data-testid="void-confirm">Void invoice</Button></>}>
      <p>The number <strong className="mono">{inv.number}</strong> stays used and is never reissued. Generate a new draft for {periodLabel(inv.period)} afterwards if the client should still be billed.</p>
      <Field label="Reason" required><Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} data-testid="void-reason" /></Field>
    </Modal>
  );
}
