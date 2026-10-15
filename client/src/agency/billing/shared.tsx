import React from 'react';
import { Badge } from '../../components/ui';

/** Shapes returned by /api/agency/billing (all money in integer minor units + exponent). */
export interface TaxPart { name: string; rate_bp: number; amount_minor: number }
export interface InvoiceRow {
  id: number; number: string | null; company_id: number; company_slug: string; company_name: string; country_code: string; brand_color: string | null; logo_text: string | null;
  entity_code: string; entity_name: string; period: string; issue_date: string | null; due_date: string | null; currency: string; exponent: number;
  subtotal_minor: number; tax_minor: number; total_minor: number; paid_minor: number; outstanding_minor: number; tax_scheme: string; tax_rate_bp: number; tax_breakdown: TaxPart[];
  place_of_supply: string | null; status: 'draft' | 'issued' | 'paid' | 'void'; display_status: string; overdue: number; days_overdue: number; notes: string | null; void_reason: string | null;
}
export interface InvoiceLine { id: number; kind: string; description: string; sac_code: string | null; quantity: number; unit_minor: number; amount_minor: number }
export interface Payment { id: number; amount_minor: number; received_on: string; method: string; reference: string | null; created_at: string }
export interface InvoiceDetail extends InvoiceRow {
  lines: InvoiceLine[]; payments: Payment[]; can_edit: boolean; zatca_note: string | null;
  entity: { code: string; name: string; legal_name: string; tax_label: string; tax_id: string; address: string; bank_details: string | null };
  company: { slug: string; name: string; legal_name: string | null; region: string | null; brand_color: string | null; logo_text: string | null };
  billing: { plan_name: string; billing_email: string | null; billing_contact: string | null; billing_address: string | null; client_tax_id: string | null; client_tax_label: string; place_of_supply: string | null; place_of_supply_code: string | null; payment_terms_days: number } | null;
}
export interface BillingProfile {
  company_id: number; company_slug: string; company_name: string; country_code: string; region: string | null; brand_color: string | null; logo_text: string | null; company_status: string;
  entity_code: string; entity_name: string; entity_tax_label: string; entity_tax_id: string; plan_name: string; currency: string; exponent: number;
  pepm_minor: number; payroll_run_minor: number; min_monthly_minor: number; setup_fee_minor: number; setup_fee_billed: number; tax_scheme: string;
  place_of_supply: string | null; place_of_supply_code: string | null; client_tax_id: string | null; client_tax_label: string; payment_terms_days: number;
  billing_email: string | null; billing_contact: string | null; billing_address: string | null; active: number;
}

/** Format minor units with the currency's own number of decimals. */
export function money(minor: number | null | undefined, exponent: number, currency: string): string {
  if (minor === null || minor === undefined) return '—';
  const v = minor / 10 ** exponent; // display only — never summed
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency, minimumFractionDigits: exponent, maximumFractionDigits: exponent }).format(v);
  } catch {
    return `${currency} ${v.toFixed(exponent)}`;
  }
}
/** Minor units → an exact decimal string for an input ("450.00"). */
export function minorToInput(minor: number, exponent: number): string {
  if (!exponent) return String(minor);
  const neg = minor < 0;
  const abs = Math.abs(minor);
  const unit = 10 ** exponent;
  return `${neg ? '-' : ''}${Math.floor(abs / unit)}.${String(abs % unit).padStart(exponent, '0')}`;
}
export const pct = (bp: number) => `${(bp / 100).toFixed(bp % 100 ? 2 : 0)}%`;
export const marketOf = (country: string) => (country === 'IN' ? 'IN' : country === 'US' ? 'US' : 'GCC');
export const MARKET_LABEL: Record<string, string> = { IN: 'India', GCC: 'GCC', US: 'United States' };
export const SCHEME_LABEL: Record<string, string> = { IN_GST: 'GST (India)', AE_VAT: 'UAE VAT 5%', SA_VAT: 'KSA VAT 15%', AE_EXPORT: 'Zero-rated export', US_NONE: 'No sales tax' };
export const METHOD_LABEL: Record<string, string> = { bank_transfer: 'Bank transfer', neft: 'NEFT', rtgs: 'RTGS', upi: 'UPI', cheque: 'Cheque', wire: 'Wire', ach: 'ACH', card: 'Card', cash: 'Cash', other: 'Other' };
export function periodLabel(p: string) {
  const [y, m] = p.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
}
export function currentPeriod() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
/** Random idempotency key, one per payment dialog. */
export function newIdempotencyKey() {
  try { if (crypto?.randomUUID) return crypto.randomUUID(); } catch { /* ignore */ }
  return `k-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function CompanyChip({ name, color, logo }: { name: string; color?: string | null; logo?: string | null }) {
  return (
    <span className="bill-company">
      <span className="agency-logo sm" style={{ background: color || 'var(--brand)' }} aria-hidden>{(logo || name[0] || '?').slice(0, 2)}</span>
      <span className="bill-company-name">{name}</span>
    </span>
  );
}
export function InvoiceStatus({ inv }: { inv: Pick<InvoiceRow, 'status' | 'overdue' | 'days_overdue' | 'paid_minor'> }) {
  if (inv.overdue) return <Badge tone="danger">Overdue {inv.days_overdue}d</Badge>;
  if (inv.status === 'issued' && inv.paid_minor > 0) return <Badge tone="warning">Part paid</Badge>;
  const tone = ({ draft: 'neutral', issued: 'info', paid: 'success', void: 'neutral' } as const)[inv.status];
  return <Badge tone={tone} className={inv.status === 'void' ? 'bill-void' : ''}>{inv.status === 'issued' ? 'Awaiting payment' : inv.status[0].toUpperCase() + inv.status.slice(1)}</Badge>;
}
