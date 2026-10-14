import React, { useEffect } from 'react';
import { fmtMoney, fmtDate } from '../lib/format';
import { Button } from './ui';
import type { Company } from '../lib/auth';

export interface PayLine { code: string; name: string; amount: number; full_amount?: number; taxable?: boolean; statutory?: boolean; adjustment_id?: number }
export interface PayslipData {
  id: number;
  run_id?: number;
  employee_id?: number;
  period?: string;
  run_status?: string;
  employee_name?: string;
  employee_code?: string;
  department_name?: string;
  position_title?: string;
  bank_name?: string | null;
  bank_account_number?: string | null;
  pf_number?: string | null;
  tax_id?: string | null;
  working_days: number;
  paid_days: number;
  lop_days: number;
  basic: number;
  earnings: PayLine[];
  deductions: PayLine[];
  gross: number;
  total_deductions: number;
  net: number;
  currency?: string;
  notes?: string | null;
  status?: string;
  created_at?: string;
}

/** "2026-03" → "March 2026". */
export function fmtPeriod(p?: string | null): string {
  if (!p || !/^\d{4}-\d{2}$/.test(p)) return p || '—';
  const [y, m] = p.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

function maskAccount(v?: string | null): string {
  if (!v) return '—';
  const s = String(v);
  return s.length > 4 ? `${'•'.repeat(Math.max(0, Math.min(8, s.length - 4)))}${s.slice(-4)}` : s;
}

/**
 * Printable payslip. While mounted it tags <body> with `print-payslip` so the print stylesheet
 * shows only this block (see styles.css). The Print button is hidden on paper.
 */
export default function Payslip({ payslip, company, currency, showPrint = true }: { payslip: PayslipData; company: Company; currency?: string; showPrint?: boolean }) {
  const cur = currency || payslip.currency || company.currency || 'INR';
  useEffect(() => {
    document.body.classList.add('print-payslip');
    return () => document.body.classList.remove('print-payslip');
  }, []);
  const earnings = payslip.earnings || [];
  const deductions = payslip.deductions || [];
  return (
    <div className="payslip" data-testid="payslip">
      <div className="payslip-head">
        <div>
          <div className="row" style={{ gap: 10 }}>
            <span className="brand-logo" aria-hidden>{company.logo_text || (company.name || 'H')[0]}</span>
            <div>
              <h2 style={{ fontSize: 18 }}>{company.legal_name || company.name}</h2>
              {company.address ? <div className="muted" style={{ fontSize: 12.5 }}>{company.address}</div> : null}
              {company.email || company.phone ? <div className="muted" style={{ fontSize: 12.5 }}>{[company.email, company.phone].filter(Boolean).join(' · ')}</div> : null}
            </div>
          </div>
        </div>
        <div className="right">
          <div style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.06em' }} className="muted">Payslip</div>
          <div style={{ fontSize: 18, fontWeight: 700 }}>{fmtPeriod(payslip.period)}</div>
          <div className="muted" style={{ fontSize: 12.5 }}>#{payslip.id}{payslip.status ? ` · ${payslip.status}` : ''}</div>
          {showPrint ? (
            <div className="no-print" style={{ marginTop: 8 }}>
              <Button size="sm" onClick={() => window.print()} data-testid="payslip-print">🖨 Print</Button>
            </div>
          ) : null}
        </div>
      </div>

      <div className="payslip-cols" style={{ marginBottom: 16 }}>
        <dl className="kv">
          <div className="kv-row"><dt>Employee</dt><dd>{payslip.employee_name || '—'}</dd></div>
          <div className="kv-row"><dt>Employee code</dt><dd className="mono">{payslip.employee_code || '—'}</dd></div>
          <div className="kv-row"><dt>Department</dt><dd>{payslip.department_name || '—'}</dd></div>
          <div className="kv-row"><dt>Designation</dt><dd>{payslip.position_title || '—'}</dd></div>
        </dl>
        <dl className="kv">
          <div className="kv-row"><dt>Working days</dt><dd className="num">{payslip.working_days}</dd></div>
          <div className="kv-row"><dt>Paid days</dt><dd className="num">{payslip.paid_days}</dd></div>
          <div className="kv-row"><dt>LOP days</dt><dd className="num">{payslip.lop_days}</dd></div>
          <div className="kv-row"><dt>Bank</dt><dd>{payslip.bank_name ? `${payslip.bank_name} · ${maskAccount(payslip.bank_account_number)}` : maskAccount(payslip.bank_account_number)}</dd></div>
          <div className="kv-row"><dt>PF / Tax ID</dt><dd className="mono">{[payslip.pf_number, payslip.tax_id].filter(Boolean).join(' / ') || '—'}</dd></div>
        </dl>
      </div>

      <div className="payslip-cols">
        <div>
          <table className="table dense">
            <thead><tr><th>Earnings</th><th className="right">Amount</th></tr></thead>
            <tbody>
              {earnings.length === 0 ? <tr><td colSpan={2} className="muted">No earnings</td></tr> : null}
              {earnings.map((l, i) => (
                <tr key={`${l.code}-${i}`}>
                  <td>{l.name} <span className="muted mono" style={{ fontSize: 11 }}>{l.code}</span></td>
                  <td className="right num">{fmtMoney(l.amount, cur)}</td>
                </tr>
              ))}
              <tr><td><strong>Gross earnings</strong></td><td className="right num"><strong>{fmtMoney(payslip.gross, cur)}</strong></td></tr>
            </tbody>
          </table>
        </div>
        <div>
          <table className="table dense">
            <thead><tr><th>Deductions</th><th className="right">Amount</th></tr></thead>
            <tbody>
              {deductions.length === 0 ? <tr><td colSpan={2} className="muted">No deductions</td></tr> : null}
              {deductions.map((l, i) => (
                <tr key={`${l.code}-${i}`}>
                  <td>{l.name} <span className="muted mono" style={{ fontSize: 11 }}>{l.code}</span></td>
                  <td className="right num">{fmtMoney(l.amount, cur)}</td>
                </tr>
              ))}
              <tr><td><strong>Total deductions</strong></td><td className="right num"><strong>{fmtMoney(payslip.total_deductions, cur)}</strong></td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="payslip-total">
        <span>Net pay</span>
        <span className="num" data-testid="payslip-net">{fmtMoney(payslip.net, cur)}</span>
      </div>
      {payslip.notes ? <p className="muted" style={{ fontSize: 12.5, marginTop: 10 }}>{payslip.notes}</p> : null}
      <p className="muted" style={{ fontSize: 11.5, marginTop: 14, marginBottom: 0 }}>
        This is a computer-generated payslip and does not require a signature.{payslip.created_at ? ` Generated ${fmtDate(payslip.created_at)}.` : ''}
      </p>
    </div>
  );
}
