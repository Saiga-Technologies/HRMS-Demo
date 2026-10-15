import React from 'react';
import { Card, Table, Select, Input, Button } from '../../components/ui';
import { Icon } from '../../components/Icons';
import { fmtDate } from '../../lib/format';
import { money, CompanyChip, InvoiceStatus, periodLabel, MARKET_LABEL, type InvoiceRow } from './shared';

export interface InvoiceFilters { status: string; company: string; period: string; market: string }

/** Invoice register with filters; a row opens the invoice drawer. */
export default function Invoices({ rows, loading, filters, setFilters, companies, onOpen }: {
  rows: InvoiceRow[]; loading: boolean; filters: InvoiceFilters; setFilters: (f: InvoiceFilters) => void;
  companies: { slug: string; name: string }[]; onOpen: (id: number) => void;
}) {
  const set = (k: keyof InvoiceFilters, v: string) => setFilters({ ...filters, [k]: v });
  const any = filters.status || filters.company || filters.period || filters.market;
  return (
    <>
      <div className="toolbar" data-tour="bill-filters">
        <Select value={filters.status} onChange={(e) => set('status', e.target.value)} aria-label="Status" data-testid="filter-status">
          <option value="">All statuses</option>
          <option value="draft">Drafts</option>
          <option value="outstanding">Awaiting payment</option>
          <option value="overdue">Overdue</option>
          <option value="paid">Paid</option>
          <option value="void">Void</option>
        </Select>
        <Select value={filters.company} onChange={(e) => set('company', e.target.value)} aria-label="Company" data-testid="filter-company">
          <option value="">All companies</option>
          {companies.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
        </Select>
        <Select value={filters.market} onChange={(e) => set('market', e.target.value)} aria-label="Market" data-testid="filter-market">
          <option value="">All markets</option>
          {Object.entries(MARKET_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
        <Input type="month" value={filters.period} onChange={(e) => set('period', e.target.value)} aria-label="Service month" data-testid="filter-period" />
        {any ? <Button variant="ghost" size="sm" onClick={() => setFilters({ status: '', company: '', period: '', market: '' })}><Icon name="x" size={14} /> Clear</Button> : null}
      </div>
      <Card padded={false} tour="bill-invoices">
        <Table<InvoiceRow>
          rows={rows} loading={loading} onRowClick={(r) => onOpen(r.id)} empty="No invoices match these filters."
          columns={[
            { key: 'number', header: 'Number', render: (r) => r.number ? <span className="mono">{r.number}</span> : <span className="muted">Draft</span> },
            { key: 'company', header: 'Company', render: (r) => <CompanyChip name={r.company_name} color={r.brand_color} logo={r.logo_text} /> },
            { key: 'period', header: 'Period', render: (r) => periodLabel(r.period) },
            { key: 'dates', header: 'Issued / due', render: (r) => r.issue_date ? <span className="bill-dates">{fmtDate(r.issue_date)}<small className={r.overdue ? 'bill-danger' : 'muted'}>due {fmtDate(r.due_date)}</small></span> : <span className="muted">—</span> },
            { key: 'total', header: 'Total', align: 'right', render: (r) => <span className="num">{money(r.total_minor, r.exponent, r.currency)}</span> },
            { key: 'paid', header: 'Paid', align: 'right', render: (r) => <span className="num muted">{r.paid_minor ? money(r.paid_minor, r.exponent, r.currency) : '—'}</span> },
            { key: 'status', header: 'Status', render: (r) => <span data-testid={`invoice-row-${r.company_slug}-${r.period}`}><InvoiceStatus inv={r} /></span> },
          ]}
        />
      </Card>
    </>
  );
}
