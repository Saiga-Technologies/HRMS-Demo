import React, { useCallback, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, qs } from '../lib/api';
import { usePageTour } from '../lib/tour';
import { PageHeader, Tabs, Button, Modal, Field, Input, Spinner, useFetch, useToast } from '../components/ui';
import { Icon } from '../components/Icons';
import Overview, { type OverviewData } from './billing/Overview';
import Invoices, { type InvoiceFilters } from './billing/Invoices';
import InvoiceDrawer from './billing/InvoiceDrawer';
import Pricing from './billing/Pricing';
import { currentPeriod, periodLabel, type InvoiceRow, type BillingProfile } from './billing/shared';
import './billing.css';

/**
 * Agency billing: what clients owe (overview + aging), the invoice register (generate drafts →
 * issue → payments / void, PDF) and per-client pricing. Money arrives as integer minor units.
 */
export default function Billing() {
  usePageTour('Billing', [
    { element: '[data-tour="bill-header"]', title: 'Agency billing', description: 'Invoices for every client you manage, issued from the right entity (India GST, UAE / KSA VAT, US) with statutory numbering per entity and financial year.' },
    { element: '[data-tour="bill-tabs"]', title: 'Overview, invoices, pricing', description: 'The red counters show overdue invoices and drafts that still need to be issued.' },
    { element: '[data-tour="bill-stats"]', title: 'Totals per currency', description: 'Outstanding, overdue and invoiced this month, kept separate per currency. Click a card to see the invoices behind it.' },
    { element: '[data-tour="bill-aging"]', title: 'Receivables aging', description: 'Unpaid balances by age: 0–30, 31–60, 61–90 and 90+ days.' },
    { element: '[data-tour="bill-top-overdue"]', title: 'Who to chase', description: 'Clients with overdue invoices, longest late first. Click one to open its invoices.' },
    { element: '[data-tour="bill-generate"]', title: 'Generate drafts', description: 'Creates one draft per client for a service month from its pricing: PEPM × employees active in the month, a fee per processed payroll run, a minimum-charge top-up and any setup fee. Drafts get a number only when issued.' },
  ]);
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || 'overview';
  const setTab = (t: string) => { const p = new URLSearchParams(params); p.set('tab', t); setParams(p, { replace: true }); };
  const [filters, setFiltersState] = useState<InvoiceFilters>({ status: params.get('status') || '', company: params.get('company') || '', period: params.get('period') || '', market: params.get('market') || '' });
  const [openId, setOpenId] = useState<number | null>(params.get('invoice') ? Number(params.get('invoice')) : null);
  const [genOpen, setGenOpen] = useState(false);

  const overview = useFetch<OverviewData>(() => api.get('/api/agency/billing/overview'), []);
  const invoices = useFetch<InvoiceRow[]>(() => api.get(`/api/agency/billing/invoices${qs(filters)}`), [JSON.stringify(filters)]);
  const profiles = useFetch<{ profiles: BillingProfile[]; gst_states: { name: string; code: string }[]; payment_methods: string[]; can_edit: boolean }>(() => api.get('/api/agency/billing/profiles'), []);
  const companies = useFetch<{ slug: string; name: string }[]>(() => api.get('/api/agency/companies?light=1'), []);

  const setFilters = (f: InvoiceFilters) => setFiltersState(f);
  const refresh = useCallback(() => { overview.reload(); invoices.reload(); }, [overview.reload, invoices.reload]); // eslint-disable-line react-hooks/exhaustive-deps
  const canEdit = !!overview.data?.can_edit;
  const filterTo = (f: Partial<InvoiceFilters>) => { setFiltersState({ status: '', company: '', period: '', market: '', ...f }); setTab('invoices'); };
  const companyList = useMemo(() => (companies.data || []).slice().sort((a, b) => a.name.localeCompare(b.name)), [companies.data]);

  return (
    <div className="billing-page">
      <PageHeader title="Billing" tour="bill-header"
        subtitle="Invoices, payments and pricing for the clients you manage"
        actions={canEdit ? <Button variant="primary" onClick={() => setGenOpen(true)} data-tour="bill-generate" data-testid="billing-generate"><Icon name="plus" size={15} /> Generate drafts</Button> : null} />
      <Tabs tour="bill-tabs" value={tab} onChange={setTab} tabs={[
        { key: 'overview', label: 'Overview', icon: 'dashboard', badge: overview.data?.counts.overdue },
        { key: 'invoices', label: 'Invoices', icon: 'file', badge: overview.data?.counts.drafts },
        { key: 'pricing', label: 'Pricing', icon: 'banknote', count: profiles.data?.profiles.length },
      ]} />
      {tab === 'overview' ? (
        overview.data ? <Overview data={overview.data} onFilter={filterTo} onGenerate={() => setGenOpen(true)} /> : overview.error ? <div className="muted">{overview.error}</div> : <Spinner />
      ) : null}
      {tab === 'invoices' ? (
        <>
          {overview.data?.counts.drafts ? (
            <div className="bill-callout" data-testid="drafts-callout">
              <Icon name="file" size={16} />
              <span><strong>{overview.data.counts.drafts}</strong> draft{overview.data.counts.drafts === 1 ? '' : 's'} awaiting review and issue.</span>
              {filters.status !== 'draft' ? <Button size="sm" onClick={() => setFiltersState({ ...filters, status: 'draft' })}>Show drafts</Button> : null}
            </div>
          ) : null}
          <Invoices rows={invoices.data || []} loading={invoices.loading && !invoices.data} filters={filters} setFilters={setFilters} companies={companyList} onOpen={setOpenId} />
        </>
      ) : null}
      {tab === 'pricing' ? <Pricing profiles={profiles.data?.profiles || []} loading={profiles.loading && !profiles.data} canEdit={!!profiles.data?.can_edit} gstStates={profiles.data?.gst_states || []} onSaved={() => profiles.reload()} /> : null}

      {openId ? <InvoiceDrawer id={openId} methods={profiles.data?.payment_methods || ['bank_transfer']} onClose={() => setOpenId(null)} onChanged={refresh} /> : null}
      {genOpen ? (
        <GenerateModal onClose={() => setGenOpen(false)} onDone={(period, created, skipped) => {
          setGenOpen(false);
          toast.success(created ? `${created} draft${created === 1 ? '' : 's'} created for ${periodLabel(period)}${skipped ? ` · ${skipped} already invoiced` : ''}` : `Every client already has an invoice for ${periodLabel(period)}`);
          overview.reload();
          filterTo({ period, status: created ? 'draft' : '' });
        }} />
      ) : null}
    </div>
  );
}

function GenerateModal({ onClose, onDone }: { onClose: () => void; onDone: (period: string, created: number, skipped: number) => void }) {
  const toast = useToast();
  const [period, setPeriod] = useState(currentPeriod());
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const out = await api.post<{ created: any[]; skipped: any[] }>('/api/agency/billing/invoices/generate', { period });
      onDone(period, out.created.length, out.skipped.length);
    } catch (e: any) { toast.error(e); } finally { setBusy(false); }
  };
  return (
    <Modal open title="Generate draft invoices" onClose={onClose} testId="generate-modal"
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={run} disabled={!period} data-testid="generate-confirm">Generate drafts for {period ? periodLabel(period) : '…'}</Button></>}>
      <p>One draft per client that has no invoice for the month yet. Lines come from each client's pricing: employees active at any point in the month × PEPM, each processed payroll run, a top-up to the minimum monthly charge and any unbilled setup fee. Tax follows the billing entity and place of supply.</p>
      <Field label="Service month" required><Input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} data-testid="generate-period" /></Field>
    </Modal>
  );
}
