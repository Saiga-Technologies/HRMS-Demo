import React, { useState } from 'react';
import { Card, EmptyState, Pill, Button } from '../../components/ui';
import { BarChart } from '../../components/charts';
import { Icon } from '../../components/Icons';
import { fmtDate } from '../../lib/format';
import { money, CompanyChip, periodLabel } from './shared';

export interface OverviewData {
  today: string; period: string; can_edit: boolean;
  totals: { currency: string; exponent: number; invoiced_month_minor: number; outstanding_minor: number; overdue_minor: number; overdue_count: number; outstanding_count: number; collected_month_minor: number; aging: { key: string; label: string; amount_minor: number; count: number }[] }[];
  top_overdue: { company_id: number; company_slug: string; company_name: string; brand_color: string | null; logo_text: string | null; currency: string; exponent: number; overdue_minor: number; count: number; oldest_due: string; max_days: number }[];
  counts: { drafts: number; overdue: number; issued: number; missing_this_month: number };
}

const AGING_COLORS = ['var(--info)', 'var(--warning)', 'var(--accent)', 'var(--danger)'];

/** Billing overview: per-currency stat cards, receivables aging and the clients most overdue. */
export default function Overview({ data, onFilter, onGenerate }: { data: OverviewData; onFilter: (f: { status?: string; company?: string }) => void; onGenerate: () => void }) {
  const [cur, setCur] = useState<string | null>(null);
  const active = data.totals.find((t) => t.currency === cur) || data.totals.find((t) => t.outstanding_minor > 0) || data.totals[0];
  return (
    <div className="bill-overview">
      {data.counts.missing_this_month > 0 && data.can_edit ? (
        <div className="bill-callout" data-tour="bill-callout">
          <Icon name="info" size={18} />
          <span><strong>{data.counts.missing_this_month}</strong> client{data.counts.missing_this_month === 1 ? ' has' : 's have'} no invoice for {periodLabel(data.period)} yet.</span>
          <Button size="sm" variant="primary" onClick={onGenerate}>Generate drafts</Button>
        </div>
      ) : null}

      <div className="bill-currencies" data-tour="bill-stats">
        {data.totals.length ? data.totals.map((t) => (
          <section key={t.currency} className={`bill-currency ${t.overdue_minor ? 'has-overdue' : ''}`} data-testid={`bill-currency-${t.currency}`}>
            <header className="bill-currency-head"><span className="bill-currency-code">{t.currency}</span><small className="muted">{t.outstanding_count} open invoice{t.outstanding_count === 1 ? '' : 's'}</small></header>
            <button type="button" className="bill-currency-main" onClick={() => onFilter({ status: 'outstanding' })}>
              <small>Outstanding</small>
              <strong className="num">{money(t.outstanding_minor, t.exponent, t.currency)}</strong>
            </button>
            <div className="bill-currency-rows">
              <button type="button" onClick={() => onFilter({ status: 'overdue' })} className={t.overdue_minor ? 'bill-danger' : ''}>
                <span><Icon name="alert" size={14} /> Overdue{t.overdue_count ? ` (${t.overdue_count})` : ''}</span><span className="num">{money(t.overdue_minor, t.exponent, t.currency)}</span>
              </button>
              <div><span><Icon name="trendingUp" size={14} /> Invoiced this month</span><span className="num">{money(t.invoiced_month_minor, t.exponent, t.currency)}</span></div>
              <div className="muted"><span><Icon name="check" size={14} /> Collected this month</span><span className="num">{money(t.collected_month_minor, t.exponent, t.currency)}</span></div>
            </div>
          </section>
        )) : <Card><EmptyState title="No invoices yet" description="Generate drafts for a month to start billing your clients." /></Card>}
      </div>

      <div className="bill-two">
        <Card title="Receivables aging" tour="bill-aging" actions={data.totals.length > 1 ? (
          <div className="row">{data.totals.map((t) => <Pill key={t.currency} active={active?.currency === t.currency} onClick={() => setCur(t.currency)}>{t.currency}</Pill>)}</div>
        ) : null}>
          {active ? (
            <>
              <BarChart height={180} valueFormat={(v) => money(Math.round(v), active.exponent, active.currency)}
                data={active.aging.map((b, i) => ({ key: b.key, label: b.label, value: b.amount_minor, color: AGING_COLORS[i], hint: `${b.label}: ${money(b.amount_minor, active.exponent, active.currency)} across ${b.count} invoice${b.count === 1 ? '' : 's'}` }))}
                onSelect={() => onFilter({ status: 'outstanding' })} />
              <p className="muted bill-note">Unpaid balances by invoice age (days since the invoice date), in {active.currency}.</p>
            </>
          ) : <div className="muted">Nothing outstanding.</div>}
        </Card>
        <Card title="Most overdue clients" tour="bill-top-overdue" padded={false}>
          {data.top_overdue.length ? (
            <ul className="bill-overdue-list">
              {data.top_overdue.map((o) => (
                <li key={o.company_id}>
                  <button type="button" onClick={() => onFilter({ status: 'overdue', company: o.company_slug })} data-testid={`overdue-${o.company_slug}`}>
                    <CompanyChip name={o.company_name} color={o.brand_color} logo={o.logo_text} />
                    <span className="bill-overdue-meta"><strong className="num">{money(o.overdue_minor, o.exponent, o.currency)}</strong><small>{o.count} invoice{o.count === 1 ? '' : 's'} · due {fmtDate(o.oldest_due)} · {o.max_days}d late</small></span>
                  </button>
                </li>
              ))}
            </ul>
          ) : <EmptyState title="Nothing overdue" description="Every issued invoice is within its payment terms." />}
        </Card>
      </div>
    </div>
  );
}
