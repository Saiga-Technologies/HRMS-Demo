import React, { useCallback, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, qs } from '../lib/api';
import { usePageTour, type TourStep } from '../lib/tour';
import { PageHeader, Tabs, Button, Modal, Field, Input, Spinner, useFetch, useToast } from '../components/ui';
import { Icon } from '../components/Icons';
import Overview, { type OverviewData } from './billing/Overview';
import Invoices, { type InvoiceFilters } from './billing/Invoices';
import InvoiceDrawer from './billing/InvoiceDrawer';
import Pricing from './billing/Pricing';
import { currentPeriod, periodLabel, type InvoiceRow, type BillingProfile } from './billing/shared';
import './billing.css';

const BILLING_TOUR: TourStep[] = [
  { title: 'Agency billing', description: 'How the agency gets paid for running each client\'s HR and payroll. The monthly loop: 1) pricing per client, 2) generate draft invoices for the month, 3) review and issue them, 4) record payments, 5) chase what is overdue on the aging view.' },
  { element: '[data-tour="bill-header"]', title: 'Billed from the right entity', description: 'Each client is invoiced by the agency entity for its market: India (GSTIN, CGST + SGST within Kerala, IGST otherwise), UAE TRN (which also bills Qatar as a zero-rated export), KSA VAT and US EIN. Owners, admins and account managers can generate, issue and record payments; other roles see billing read-only.' },
  { element: '[data-tour="bill-tabs"]', title: 'Overview, invoices, pricing', description: 'The red counters show overdue invoices on Overview and drafts still waiting to be issued on Invoices.' },
  { element: '[data-tour="bill-pricing"]', title: '1. Pricing per client', description: 'What every invoice is built from: fee per employee per month (PEPM), fee per payroll run, a minimum monthly charge, a one-off setup fee, payment terms and the tax treatment. These come from the onboarding wizard.', tab: 'pricing' },
  { element: '[data-tour="bill-pricing"] [data-testid^="pricing-edit-"]', title: 'Change a client\'s pricing', description: 'Opens the pricing form: fees, payment terms, billing contact, the client\'s tax ID and (India) the place of supply that decides CGST + SGST or IGST. Changes apply to drafts generated from now on; issued invoices are never restated.' },
  { element: '[data-tour="bill-generate"]', title: '2. Generate drafts', description: 'Pick a service month and the agency creates one draft per active client that has no invoice for it yet: employees active in the month × PEPM, each processed payroll run, a top-up to the minimum charge and any unbilled setup fee. You land on the Invoices tab filtered to the new drafts.' },
  { element: '[data-tour="bill-drafts-callout"]', title: 'Drafts to review', description: 'Drafts have no invoice number yet. Use Show drafts to list only them.', tab: 'invoices' },
  { element: '[data-tour="bill-filters"]', title: 'Filter the register', description: 'By status (drafts, awaiting payment, overdue, paid, void), company, market and service month.' },
  { element: '[data-tour="bill-invoices"]', title: '3. Review and issue', description: 'The invoice register. Click a draft to open it: check the lines, add an ad-hoc line (for example a full and final settlement) and press Issue invoice. Issuing gives it the next consecutive number for that entity and financial year and sets the due date from the payment terms; the client then sees it, with a PDF, under Agency services, Invoices.' },
  { element: '[data-tour="bill-invoices"] [data-testid^="invoice-row-"]', title: 'Status of each invoice', description: 'Draft, Awaiting payment, Part paid, Overdue (with days late, once past the due date), Paid or Void.' },
  { element: '[data-tour="bill-invoices"]', title: '4. Record payments', description: 'Open an issued invoice and choose Record payment: amount, date received, method and the bank reference. Part payments reduce the balance; the invoice turns Paid when the balance reaches zero. An issued invoice with no payments can be voided with a reason; its number is never reused.' },
  { element: '[data-tour="bill-callout"]', title: 'Clients not yet invoiced', description: 'Shown when some clients have no invoice for this month yet; Generate drafts here does the same as the header button.', tab: 'overview' },
  { element: '[data-tour="bill-stats"]', title: 'Totals per currency', description: 'Outstanding, overdue, invoiced this month and collected this month, kept separate per currency, never added together. Click Outstanding or Overdue to open the invoices behind them.' },
  { element: '[data-tour="bill-aging"]', title: '5. Receivables aging', description: 'Unpaid balances by invoice age: 0–30, 31–60, 61–90 and over 90 days. Switch currency with the pills when you bill in more than one. Click a bar to list the outstanding invoices.' },
  { element: '[data-tour="bill-top-overdue"]', title: 'Who to chase', description: 'Clients with overdue invoices, with the amount, how many invoices and how many days late. Click one to see its overdue invoices. Overdue balances also show on the company\'s portfolio card.' },
  { title: 'What to do next', description: 'At month end, generate drafts once payroll has run, review and issue them, and record payments as they arrive. Check the aging and the most overdue clients weekly and raise them with the account manager.' },
];

/**
 * Agency billing: what clients owe (overview + aging), the invoice register (generate drafts →
 * issue → payments / void, PDF) and per-client pricing. Money arrives as integer minor units.
 */
export default function Billing() {
  usePageTour('Billing', BILLING_TOUR);
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
            <div className="bill-callout" data-testid="drafts-callout" data-tour="bill-drafts-callout">
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
