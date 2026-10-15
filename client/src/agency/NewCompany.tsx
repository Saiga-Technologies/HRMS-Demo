import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { usePageTour } from '../lib/tour';
import { fmtMoney } from '../lib/format';
import { Button, Card, Field, Input, KeyValue, PageHeader, Select, Spinner, useFetch, useToast } from '../components/ui';
import { Icon } from '../components/Icons';
import { openCompany } from './AgencyApp';
import { DAY_SHORT, LogoTile, type Staff } from './portfolio/bits';
import './portfolio.css';

interface Country { code: string; name: string; currency: string; timezone: string; weekly_offs: number[]; regions: string[] }
interface Entity { id: number; code: string; name: string; country_code: string; tax_label: string | null; tax_id: string | null }
interface Meta { countries: Country[]; staff: Staff[]; entities: Entity[] }
interface Created { slug: string; id: number; admin_email: string; temporary_password: string }

const STEPS = [
  { key: 'company', label: 'Company', icon: 'building' },
  { key: 'calendar', label: 'Country & calendar', icon: 'calendar' },
  { key: 'admin', label: 'Client HR admin', icon: 'user' },
  { key: 'billing', label: 'Billing', icon: 'banknote' },
  { key: 'review', label: 'Review', icon: 'check' },
] as const;
const SWATCHES = ['#4A8F49', '#0F766E', '#1D4ED8', '#6D28D9', '#BE123C', '#B45309', '#0369A1', '#7C2D12', '#166534', '#A16207'];
const ENTITY_FOR: Record<string, string> = { IN: 'IN', SA: 'SA', US: 'US', AE: 'AE', QA: 'AE' };
const WEEKEND_NOTE: Record<string, string> = {
  IN: 'Most Indian offices take Saturday and Sunday off; retail and factories often work six days (Sunday only).',
  AE: 'The UAE moved to a Saturday–Sunday weekend in 2022 (Friday afternoons are often short).',
  SA: 'Saudi Arabia keeps a Friday–Saturday weekend.',
  QA: 'Qatar keeps a Friday–Saturday weekend.',
  US: 'Saturday and Sunday are the usual weekly offs in the US.',
};
const TAX_ID_LABEL: Record<string, string> = { IN: 'Client GSTIN', AE: 'Client TRN', SA: 'Client VAT number', QA: 'Client CR number', US: 'Client EIN' };

const EMPTY = {
  name: '', legal_name: '', industry: '', logo_text: '', brand_color: SWATCHES[0], account_manager_id: '',
  country_code: 'IN', region: '', city: '', weekly_offs: [0, 6] as number[], pay_mode: 'day' as 'day' | 'last', pay_day: '28',
  admin_first: '', admin_last: '', admin_email: '', admin_phone: '',
  pepm: '', payroll_run: '', min_monthly: '', setup_fee: '', client_tax_id: '', billing_email: '', payment_terms_days: '15',
};
type FormState = typeof EMPTY;

const TOUR = [
  { element: '[data-tour="nc-steps"]', title: 'Five steps', description: 'Company details, country and payroll calendar, the client HR admin login, billing terms, then a final review.' },
  { element: '[data-tour="nc-form"]', title: 'Fill in each step', description: 'Required fields are marked. Next checks this step before moving on; you can go back at any time.' },
  { element: '[data-tour="nc-preview"]', title: 'Live preview', description: 'How the company will appear in the portfolio, with its country, currency, weekly offs and pay day.' },
  { element: '[data-tour="nc-nav"]', title: 'Create the company', description: 'On the review step, Create sets up the company with its statutory calendar and gives you a temporary password for the client HR admin.' },
];

export default function NewCompany() {
  usePageTour('Add a client company', TOUR);
  const { agency } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const meta = useFetch<Meta>(() => api.get('/api/agency/meta'), []);
  const [step, setStep] = useState(0);
  const [f, setF] = useState<FormState>(EMPTY);
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({});
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<Created | null>(null);
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => { setF((s) => ({ ...s, [k]: v })); setErrors((e) => ({ ...e, [k]: undefined })); };

  const country = meta.data?.countries.find((c) => c.code === f.country_code);
  const entity = meta.data?.entities.find((e) => e.code === ENTITY_FOR[f.country_code]);
  const managers = (meta.data?.staff || []).filter((s) => ['owner', 'admin', 'account_manager'].includes(s.role));

  // Account managers onboard companies for themselves by default.
  useEffect(() => {
    if (agency?.role === 'account_manager' && !f.account_manager_id) set('account_manager_id', String(agency.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agency?.id]);
  // First load: fill the country defaults.
  useEffect(() => {
    if (country && !f.region) setF((s) => ({ ...s, region: country.regions[0], weekly_offs: country.weekly_offs }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [country?.code]);
  const changeCountry = (code: string) => {
    const c = meta.data?.countries.find((x) => x.code === code);
    setF((s) => ({ ...s, country_code: code, region: c?.regions[0] || '', weekly_offs: c?.weekly_offs || [0, 6] }));
  };
  const toggleOff = (d: number) => set('weekly_offs', f.weekly_offs.includes(d) ? f.weekly_offs.filter((x) => x !== d) : [...f.weekly_offs, d].sort());

  const validate = (i: number) => {
    const e: Partial<Record<keyof FormState, string>> = {};
    const key = STEPS[i].key;
    if (key === 'company' && !f.name.trim()) e.name = 'Company name is required';
    if (key === 'calendar') {
      if (!f.weekly_offs.length) e.weekly_offs = 'Pick at least one weekly off';
      if (f.weekly_offs.length > 3) e.weekly_offs = 'At most three weekly offs';
      if (f.pay_mode === 'day' && !(Number(f.pay_day) >= 1 && Number(f.pay_day) <= 28)) e.pay_day = 'Choose a day between 1 and 28';
    }
    if (key === 'admin') {
      if (!f.admin_first.trim()) e.admin_first = 'First name is required';
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.admin_email.trim())) e.admin_email = 'A valid email is required';
    }
    if (key === 'billing') {
      for (const k of ['pepm', 'payroll_run', 'min_monthly', 'setup_fee'] as const) if (f[k] !== '' && !(Number(f[k]) >= 0)) e[k] = 'Enter an amount (0 or more)';
      if (!(Number(f.payment_terms_days) >= 0 && Number(f.payment_terms_days) <= 120)) e.payment_terms_days = '0 to 120 days';
      if (f.billing_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.billing_email.trim())) e.billing_email = 'Enter a valid email';
    }
    setErrors(e);
    return !Object.keys(e).length;
  };
  const next = () => { if (validate(step)) setStep((s) => Math.min(STEPS.length - 1, s + 1)); };
  const goTo = (i: number) => { if (i <= step) return setStep(i); for (let k = step; k < i; k++) if (!validate(k)) return setStep(k); setStep(i); };

  const submit = async () => {
    for (let k = 0; k < STEPS.length - 1; k++) if (!validate(k)) { setStep(k); return; }
    setBusy(true);
    try {
      const r = await api.post<Created>('/api/agency/companies', {
        name: f.name.trim(), legal_name: f.legal_name.trim() || undefined, industry: f.industry.trim() || undefined,
        logo_text: f.logo_text.trim() || undefined, brand_color: f.brand_color,
        country_code: f.country_code, region: f.region, city: f.city.trim() || undefined,
        weekly_offs: f.weekly_offs, pay_day: f.pay_mode === 'last' ? 'last_working_day' : Number(f.pay_day),
        account_manager_id: f.account_manager_id ? Number(f.account_manager_id) : undefined,
        admin: { first_name: f.admin_first.trim(), last_name: f.admin_last.trim(), email: f.admin_email.trim(), phone: f.admin_phone.trim() || undefined },
        billing: { pepm: f.pepm, payroll_run: f.payroll_run, min_monthly: f.min_monthly, setup_fee: f.setup_fee, client_tax_id: f.client_tax_id.trim() || undefined, billing_email: f.billing_email.trim() || undefined, payment_terms_days: f.payment_terms_days },
      });
      setCreated(r);
      toast.success(`${f.name.trim()} added to the portfolio`);
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  const cur = country?.currency || 'INR';
  const money = (v: string) => (v === '' ? '—' : fmtMoney(Number(v), cur));
  const offsText = f.weekly_offs.length ? f.weekly_offs.map((d) => DAY_SHORT[d]).join(', ') : 'none';
  const payText = f.pay_mode === 'last' ? 'Last working day' : `Day ${f.pay_day} (moved earlier if it falls on an off day)`;
  const amName = useMemo(() => { const s = managers.find((m) => String(m.id) === f.account_manager_id); return s ? `${s.first_name} ${s.last_name}` : 'Unassigned'; }, [managers, f.account_manager_id]);

  if (created) return <Success created={created} name={f.name.trim()} onBack={() => navigate('/agency')} />;

  return (
    <div className="pf-page">
      <PageHeader title="Add a client company" subtitle="Set up a new client: its payroll calendar, the client's HR admin login and how the agency bills it."
        actions={<Button variant="ghost" onClick={() => navigate('/agency')}><Icon name="chevronLeft" size={15} /> Portfolio</Button>} />
      {meta.loading && !meta.data ? <Spinner /> : null}
      {meta.error ? <div className="alert alert-error">{meta.error}</div> : null}
      {meta.data ? (
        <div className="nc-layout">
          <div>
            <ol className="nc-steps" data-tour="nc-steps">
              {STEPS.map((s, i) => (
                <li key={s.key} className={i === step ? 'active' : i < step ? 'done' : ''}>
                  <button type="button" onClick={() => goTo(i)} data-testid={`nc-step-${s.key}`}>
                    <span className="nc-step-num">{i < step ? <Icon name="check" size={13} /> : i + 1}</span>
                    <span className="nc-step-label">{s.label}</span>
                  </button>
                </li>
              ))}
            </ol>
            <Card tour="nc-form" title={STEPS[step].label}>
              <form onSubmit={(e) => { e.preventDefault(); if (step < STEPS.length - 1) next(); else submit(); }} className="nc-form">
                {STEPS[step].key === 'company' ? (
                  <div className="form-grid">
                    <Field label="Company name" required error={errors.name} className="span-2"><Input value={f.name} onChange={(e) => set('name', e.target.value)} data-testid="nc-name" autoFocus placeholder="e.g. Kaveri Textiles" /></Field>
                    <Field label="Legal name" hint="As registered; defaults to the company name"><Input value={f.legal_name} onChange={(e) => set('legal_name', e.target.value)} data-testid="nc-legal" /></Field>
                    <Field label="Industry"><Input value={f.industry} onChange={(e) => set('industry', e.target.value)} data-testid="nc-industry" placeholder="e.g. Textile manufacturing" /></Field>
                    <Field label="Logo letters" hint="One or two letters for the logo tile"><Input value={f.logo_text} maxLength={2} onChange={(e) => set('logo_text', e.target.value.toUpperCase())} data-testid="nc-logo" placeholder={f.name[0]?.toUpperCase() || 'K'} /></Field>
                    <Field label="Account manager" hint={agency?.role === 'account_manager' ? 'Companies you add are assigned to you' : undefined}>
                      <Select value={f.account_manager_id} onChange={(e) => set('account_manager_id', e.target.value)} disabled={agency?.role === 'account_manager'} data-testid="nc-am">
                        <option value="">Unassigned</option>
                        {managers.map((s) => <option key={s.id} value={s.id}>{s.first_name} {s.last_name}{s.role !== 'account_manager' ? ` (${s.role})` : ''}</option>)}
                      </Select>
                    </Field>
                    <div className="field span-2">
                      <span className="field-label">Brand colour</span>
                      <div className="nc-swatches" role="radiogroup" aria-label="Brand colour">
                        {SWATCHES.map((c) => <button type="button" key={c} role="radio" aria-checked={f.brand_color === c} aria-label={c} className={f.brand_color === c ? 'active' : ''} style={{ background: c }} onClick={() => set('brand_color', c)} />)}
                      </div>
                    </div>
                  </div>
                ) : null}

                {STEPS[step].key === 'calendar' ? (
                  <div className="form-grid">
                    <Field label="Country" required>
                      <Select value={f.country_code} onChange={(e) => changeCountry(e.target.value)} data-testid="nc-country">
                        {meta.data.countries.map((c) => <option key={c.code} value={c.code}>{c.name} ({c.currency})</option>)}
                      </Select>
                    </Field>
                    <Field label={f.country_code === 'IN' || f.country_code === 'US' ? 'State' : f.country_code === 'AE' ? 'Emirate' : 'Region'} hint={f.country_code === 'IN' ? 'Decides professional tax, LWF and GST place of supply' : undefined}>
                      <Select value={f.region} onChange={(e) => set('region', e.target.value)} data-testid="nc-region">
                        {(country?.regions || []).map((r) => <option key={r} value={r}>{r}</option>)}
                      </Select>
                    </Field>
                    <Field label="City"><Input value={f.city} onChange={(e) => set('city', e.target.value)} data-testid="nc-city" /></Field>
                    <Field label="Currency and time zone"><Input value={`${country?.currency || ''} · ${country?.timezone || ''}`} readOnly disabled /></Field>
                    <div className="field span-2">
                      <span className="field-label">Weekly offs <span className="req">*</span></span>
                      <div className="nc-days" role="group" aria-label="Weekly offs" data-testid="nc-weekly-offs">
                        {DAY_SHORT.map((d, i) => (
                          <button type="button" key={d} className={f.weekly_offs.includes(i) ? 'active' : ''} aria-pressed={f.weekly_offs.includes(i)} onClick={() => toggleOff(i)} data-testid={`nc-off-${i}`}>{d}</button>
                        ))}
                      </div>
                      {errors.weekly_offs ? <span className="field-error">{errors.weekly_offs}</span> : <span className="field-hint">{WEEKEND_NOTE[f.country_code]}</span>}
                    </div>
                    <div className="field span-2">
                      <span className="field-label">Pay day</span>
                      <div className="nc-payday">
                        <label className="nc-radio"><input type="radio" name="pay_mode" checked={f.pay_mode === 'day'} onChange={() => set('pay_mode', 'day')} data-testid="nc-pay-fixed" /> Fixed day</label>
                        <Input type="number" min={1} max={28} value={f.pay_day} disabled={f.pay_mode !== 'day'} onChange={(e) => set('pay_day', e.target.value)} className="nc-payday-input" aria-label="Pay day of month" data-testid="nc-pay-day" />
                        <label className="nc-radio"><input type="radio" name="pay_mode" checked={f.pay_mode === 'last'} onChange={() => set('pay_mode', 'last')} data-testid="nc-pay-last" /> Last working day</label>
                      </div>
                      {errors.pay_day ? <span className="field-error">{errors.pay_day}</span> : <span className="field-hint">Milestones count back from pay day: inputs T-7, attendance cut-off T-5, generation T-3, client approval T-2 (working days).</span>}
                    </div>
                  </div>
                ) : null}

                {STEPS[step].key === 'admin' ? (
                  <>
                    <p className="muted nc-note">This person runs HR at the client. They sign in with a temporary password, approve payroll registers and raise service requests.</p>
                    <div className="form-grid">
                      <Field label="First name" required error={errors.admin_first}><Input value={f.admin_first} onChange={(e) => set('admin_first', e.target.value)} data-testid="nc-admin-first" autoFocus /></Field>
                      <Field label="Last name"><Input value={f.admin_last} onChange={(e) => set('admin_last', e.target.value)} data-testid="nc-admin-last" /></Field>
                      <Field label="Work email" required error={errors.admin_email}><Input type="email" value={f.admin_email} onChange={(e) => set('admin_email', e.target.value)} data-testid="nc-admin-email" /></Field>
                      <Field label="Phone"><Input value={f.admin_phone} onChange={(e) => set('admin_phone', e.target.value)} data-testid="nc-admin-phone" /></Field>
                    </div>
                  </>
                ) : null}

                {STEPS[step].key === 'billing' ? (
                  <>
                    <p className="muted nc-note">Billed by <strong>{entity?.name || 'the agency'}</strong>{entity?.tax_label ? ` (${entity.tax_label} ${entity.tax_id || ''})` : ''}. Amounts in {cur}; leave blank for none.</p>
                    <div className="form-grid">
                      <Field label="Per employee per month" error={errors.pepm}><Input type="number" min={0} step="0.01" value={f.pepm} onChange={(e) => set('pepm', e.target.value)} data-testid="nc-pepm" /></Field>
                      <Field label="Per payroll run" error={errors.payroll_run}><Input type="number" min={0} step="0.01" value={f.payroll_run} onChange={(e) => set('payroll_run', e.target.value)} data-testid="nc-run-fee" /></Field>
                      <Field label="Minimum monthly charge" error={errors.min_monthly}><Input type="number" min={0} step="0.01" value={f.min_monthly} onChange={(e) => set('min_monthly', e.target.value)} data-testid="nc-min" /></Field>
                      <Field label="One-time setup fee" error={errors.setup_fee}><Input type="number" min={0} step="0.01" value={f.setup_fee} onChange={(e) => set('setup_fee', e.target.value)} data-testid="nc-setup" /></Field>
                      <Field label={TAX_ID_LABEL[f.country_code]}><Input value={f.client_tax_id} onChange={(e) => set('client_tax_id', e.target.value)} data-testid="nc-tax-id" /></Field>
                      <Field label="Payment terms (days)" error={errors.payment_terms_days}><Input type="number" min={0} max={120} value={f.payment_terms_days} onChange={(e) => set('payment_terms_days', e.target.value)} data-testid="nc-terms" /></Field>
                      <Field label="Billing email" hint="Defaults to the HR admin's email" error={errors.billing_email} className="span-2"><Input type="email" value={f.billing_email} onChange={(e) => set('billing_email', e.target.value)} placeholder={f.admin_email} data-testid="nc-billing-email" /></Field>
                    </div>
                  </>
                ) : null}

                {STEPS[step].key === 'review' ? (
                  <div className="nc-review" data-testid="nc-review">
                    <section><h3 className="section-title">Company <button type="button" className="btn btn-link btn-sm" onClick={() => setStep(0)}>Edit</button></h3>
                      <KeyValue items={[{ k: 'Name', v: f.name }, { k: 'Legal name', v: f.legal_name || f.name }, { k: 'Industry', v: f.industry || '—' }, { k: 'Account manager', v: amName }]} /></section>
                    <section><h3 className="section-title">Country & calendar <button type="button" className="btn btn-link btn-sm" onClick={() => setStep(1)}>Edit</button></h3>
                      <KeyValue items={[{ k: 'Location', v: [f.city, f.region, country?.name].filter(Boolean).join(', ') }, { k: 'Currency', v: `${cur} · ${country?.timezone}` }, { k: 'Weekly offs', v: offsText }, { k: 'Pay day', v: payText }]} /></section>
                    <section><h3 className="section-title">Client HR admin <button type="button" className="btn btn-link btn-sm" onClick={() => setStep(2)}>Edit</button></h3>
                      <KeyValue items={[{ k: 'Name', v: `${f.admin_first} ${f.admin_last}`.trim() }, { k: 'Email', v: f.admin_email }, { k: 'Phone', v: f.admin_phone || '—' }]} /></section>
                    <section><h3 className="section-title">Billing <button type="button" className="btn btn-link btn-sm" onClick={() => setStep(3)}>Edit</button></h3>
                      <KeyValue items={[{ k: 'Fees', v: `${money(f.pepm)} PEPM · ${money(f.payroll_run)} per run` }, { k: 'Minimum / setup', v: `${money(f.min_monthly)} · ${money(f.setup_fee)}` }, { k: 'Terms', v: `Net ${f.payment_terms_days} days` }, { k: 'Billing email', v: f.billing_email || f.admin_email }]} /></section>
                  </div>
                ) : null}

                <div className="nc-nav" data-tour="nc-nav">
                  {step > 0 ? <Button type="button" onClick={() => setStep(step - 1)} data-testid="nc-back"><Icon name="chevronLeft" size={15} /> Back</Button> : <span />}
                  {step < STEPS.length - 1
                    ? <Button type="submit" variant="primary" data-testid="nc-next">Next <Icon name="chevronRight" size={15} /></Button>
                    : <Button type="submit" variant="primary" loading={busy} data-testid="nc-create"><Icon name="check" size={15} /> Create company</Button>}
                </div>
              </form>
            </Card>
          </div>

          <aside className="nc-preview" data-tour="nc-preview">
            <div className="section-title">Preview</div>
            <div className="pf-card pf-card-green nc-preview-card">
              <header className="pf-card-head">
                <LogoTile c={{ name: f.name || 'New company', logo_text: f.logo_text || (f.name[0] || 'C').toUpperCase(), brand_color: f.brand_color }} />
                <div className="pf-card-title">
                  <strong>{f.name || 'New company'}</strong>
                  <small>{[f.city, country?.name].filter(Boolean).join(', ') || country?.name}{f.industry ? ` · ${f.industry}` : ''}</small>
                </div>
                <span className="badge badge-info">Onboarding</span>
              </header>
              <dl className="pf-facts nc-facts">
                <div><dt>Currency</dt><dd>{cur}</dd></div>
                <div><dt>Weekly offs</dt><dd>{offsText}</dd></div>
                <div><dt>Pay day</dt><dd>{f.pay_mode === 'last' ? 'Last working day' : `Day ${f.pay_day || '—'}`}</dd></div>
                <div><dt>Manager</dt><dd>{amName}</dd></div>
              </dl>
            </div>
            <p className="muted nc-note">The company starts in <strong>Onboarding</strong> with {country?.name || 'the country'}'s statutory filings, holidays and payroll settings. Client approval of every payroll register is switched on.</p>
          </aside>
        </div>
      ) : null}
    </div>
  );
}

function Success({ created, name, onBack }: { created: Created; name: string; onBack: () => void }) {
  const toast = useToast();
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(created.temporary_password);
      toast.success('Password copied');
    } catch {
      toast.error('Copy failed. Select the password and copy it manually.');
    }
  };
  return (
    <div className="pf-page">
      <PageHeader title={`${name} is set up`} subtitle="The company is in your portfolio in Onboarding status." />
      <Card className="nc-success">
        <div className="nc-success-icon"><Icon name="check" size={26} /></div>
        <h2>Share these sign-in details with the client's HR admin</h2>
        <p className="muted">The temporary password is shown only once. Send it over a secure channel and ask them to change it after signing in.</p>
        <div className="nc-cred">
          <div><span className="muted">Email</span><strong data-testid="nc-admin-email-out">{created.admin_email}</strong></div>
          <div><span className="muted">Temporary password</span><code data-testid="nc-temp-password">{created.temporary_password}</code></div>
          <Button size="sm" onClick={copy} data-testid="nc-copy"><Icon name="clipboard" size={14} /> Copy password</Button>
        </div>
        <div className="row" style={{ justifyContent: 'center', marginTop: 18 }}>
          <Button onClick={onBack} data-testid="nc-back-portfolio"><Icon name="grid" size={15} /> Back to portfolio</Button>
          <Button variant="primary" onClick={() => openCompany(created.slug)} data-testid="nc-open-company">Open company <Icon name="chevronRight" size={15} /></Button>
        </div>
      </Card>
    </div>
  );
}
