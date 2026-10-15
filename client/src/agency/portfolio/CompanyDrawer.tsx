import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { fmtDate, fmtDateTime, fmtMoney } from '../../lib/format';
import { Button, KeyValue, Select, Spinner, useConfirm, useFetch, useToast } from '../../components/ui';
import { Icon } from '../../components/Icons';
import { openCompany } from '../AgencyApp';
import { COUNTRY_NAME, Countdown, HealthPill, LogoTile, MilestoneStatus, STATUS_LABEL, fmtMinor, plural, type Milestone, type PortfolioCompany, type Staff } from './bits';

interface Detail extends PortfolioCompany {
  contact_name: string | null; contact_phone: string | null; onboarded_at: string | null;
  calendar: { current: { period: string; pay_date: string; stage: string; milestones: Milestone[] }; next: { period: string; pay_date: string } };
  client_users: { id: number; email: string; role: string; last_login_at: string | null; first_name: string | null; last_name: string | null }[];
  billing_profile: null | { plan_name: string; currency: string; pepm_minor: number; payroll_run_minor: number; min_monthly_minor: number; setup_fee_minor: number; payment_terms_days: number; billing_email: string | null; client_tax_id: string | null; entity_name: string; tax_label: string | null; tax_scheme: string };
}

/** Side drawer with one company's detail: payroll milestones, client HR users, billing and quick actions. */
export default function CompanyDrawer({ slug, staff, onClose, onChanged }: { slug: string; staff: Staff[]; onClose: () => void; onChanged: () => void }) {
  const { agency } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const { confirm, dialog } = useConfirm();
  const d = useFetch<Detail>(() => api.get(`/api/agency/companies/${slug}`), [slug]);
  const [saving, setSaving] = useState(false);
  const canAdmin = agency && ['owner', 'admin'].includes(agency.role);
  const canEdit = agency && ['owner', 'admin', 'account_manager'].includes(agency.role);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    document.body.classList.add('modal-open');
    return () => { window.removeEventListener('keydown', onKey); document.body.classList.remove('modal-open'); };
  }, [onClose]);

  const save = async (body: Record<string, any>, msg: string) => {
    setSaving(true);
    try {
      await api.put(`/api/agency/companies/${slug}`, body);
      toast.success(msg);
      d.reload();
      onChanged();
    } catch (e) {
      toast.error(e);
    } finally {
      setSaving(false);
    }
  };
  const changeStatus = async (status: string) => {
    if (status === 'offboarded' && !(await confirm('Offboard this company?', 'Offboarded companies leave the portfolio and their logins stop working. You can reactivate them later.'))) return;
    save({ status }, `Status changed to ${STATUS_LABEL[status].toLowerCase()}`);
  };

  const c = d.data;
  const managers = staff.filter((s) => ['owner', 'admin', 'account_manager'].includes(s.role));
  const bp = c?.billing_profile;
  return (
    <div className="pf-drawer-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="pf-drawer" role="dialog" aria-modal="true" aria-label={c ? c.name : 'Company'} data-testid="company-drawer">
        <header className="pf-drawer-head">
          {c ? <LogoTile c={c} size="lg" /> : null}
          <div className="pf-drawer-title">
            <h2>{c?.name || 'Loading…'}</h2>
            {c ? <small>{[c.city, c.region, COUNTRY_NAME[c.country_code] || c.country_code].filter(Boolean).join(', ')} · {c.industry || 'Industry not set'}</small> : null}
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close" data-testid="drawer-close"><Icon name="x" size={16} /></button>
        </header>
        <div className="pf-drawer-body">
          {d.error ? <div className="alert alert-error">{d.error}</div> : null}
          {!c ? <Spinner /> : (
            <>
              <div className="pf-drawer-actions">
                <Button variant="primary" onClick={() => openCompany(c.slug)} data-testid="drawer-open"><Icon name="play" size={14} /> Open company</Button>
                <Button onClick={() => openCompany(c.slug, '/services')}><Icon name="heartHandshake" size={14} /> Services</Button>
                <Button onClick={() => openCompany(c.slug, '/payroll?tab=runs')}><Icon name="banknote" size={14} /> Payroll</Button>
                <Button onClick={() => navigate(`/agency/calendar?company=${c.slug}`)}><Icon name="calendar" size={14} /> Calendar</Button>
              </div>

              {c.snapshot ? (
                <>
                  <div className="row" style={{ marginBottom: 10 }}>
                    <HealthPill health={c.snapshot.health} reasons={c.snapshot.reasons} />
                    <span className={`badge badge-${c.status === 'active' ? 'success' : c.status === 'onboarding' ? 'info' : 'warning'}`}>{STATUS_LABEL[c.status]}</span>
                    {c.snapshot.reasons.length ? <span className="muted" style={{ fontSize: 13 }}>{c.snapshot.reasons.join(' · ')}</span> : <span className="muted" style={{ fontSize: 13 }}>Nothing needs attention</span>}
                  </div>
                  <Countdown s={c.snapshot} />
                </>
              ) : null}

              <h3 className="section-title pf-drawer-section">Payroll {c.calendar.current.period} milestones</h3>
              <div className="table-wrap">
                <table className="table dense">
                  <thead><tr><th>Milestone</th><th>Owner</th><th>Due</th><th>Status</th></tr></thead>
                  <tbody>
                    {c.calendar.current.milestones.map((m) => (
                      <tr key={m.key} className={m.done ? 'pf-row-done' : ''}>
                        <td><strong>{m.label}</strong><div className="muted" style={{ fontSize: 12 }}>{m.description}</div></td>
                        <td><span className={`chip ${m.owner === 'client' ? 'chip-info' : ''}`}>{m.owner === 'client' ? 'Client' : 'Agency'}</span></td>
                        <td className="nowrap">{fmtDate(m.due, { day: '2-digit', month: 'short' })}</td>
                        <td><MilestoneStatus m={m} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="muted" style={{ fontSize: 12.5, margin: '6px 0 0' }}>Next period {c.calendar.next.period} pays on {fmtDate(c.calendar.next.pay_date)}.</p>

              {c.snapshot ? (
                <>
                  <h3 className="section-title pf-drawer-section">Operations</h3>
                  <KeyValue items={[
                    { k: 'Headcount', v: `${c.snapshot.headcount} (+${c.snapshot.joiners_30d} / -${c.snapshot.exits_30d} in 30 days)` },
                    { k: 'Pending approvals', v: c.snapshot.pending_approvals },
                    { k: 'Filings', v: `${c.snapshot.compliance.overdue} overdue · ${c.snapshot.compliance.due_7d} due this week` },
                    { k: 'Next filing', v: c.snapshot.compliance.next ? `${c.snapshot.compliance.next.name} · ${fmtDate(c.snapshot.compliance.next.due_date)}` : '—' },
                    { k: 'Service requests', v: `${c.snapshot.requests.open} open · ${c.snapshot.requests.waiting_client} waiting on client · ${c.snapshot.requests.breached} past SLA` },
                    { k: 'Last payroll', v: c.snapshot.payroll.last_net ? `${fmtMoney(c.snapshot.payroll.last_net, c.currency)} net (${c.snapshot.payroll.last_paid_period})` : 'No paid run yet' },
                  ]} />
                </>
              ) : null}

              <h3 className="section-title pf-drawer-section">Client HR users</h3>
              {c.client_users.length ? (
                <ul className="pf-userlist">
                  {c.client_users.map((u) => (
                    <li key={u.id}>
                      <span className="pf-userlist-name">{[u.first_name, u.last_name].filter(Boolean).join(' ') || u.email}</span>
                      <small className="muted">{u.email}</small>
                      <small className="muted">{u.last_login_at ? `Last sign-in ${fmtDateTime(u.last_login_at)}` : 'Never signed in'}</small>
                    </li>
                  ))}
                </ul>
              ) : <p className="muted">No client HR logins yet.</p>}

              <h3 className="section-title pf-drawer-section">Billing</h3>
              {bp ? (
                <KeyValue items={[
                  { k: 'Plan', v: `${bp.plan_name} · billed by ${bp.entity_name}` },
                  { k: 'Fees', v: `${fmtMinor(bp.pepm_minor, bp.currency)} per employee / month · ${fmtMinor(bp.payroll_run_minor, bp.currency)} per run` },
                  { k: 'Minimum / setup', v: `${fmtMinor(bp.min_monthly_minor, bp.currency)} min / month · ${fmtMinor(bp.setup_fee_minor, bp.currency)} setup` },
                  { k: 'Terms', v: `Net ${bp.payment_terms_days} days · ${bp.billing_email || 'no billing email'}` },
                  { k: bp.tax_label ? `Client ${bp.tax_label}` : 'Client tax ID', v: bp.client_tax_id || '—' },
                  { k: 'Outstanding', v: c.billing.outstanding_minor ? <span>{fmtMinor(c.billing.outstanding_minor, c.currency)}{c.billing.overdue_count ? <span className="pf-overdue-text"> · {plural(c.billing.overdue_count, 'invoice')} overdue</span> : null}</span> : 'Nothing outstanding' },
                ]} />
              ) : <p className="muted">No billing profile.</p>}

              {canEdit ? (
                <>
                  <h3 className="section-title pf-drawer-section">Manage</h3>
                  <div className="form-grid">
                    <label className="field">
                      <span className="field-label">Account manager</span>
                      <Select value={c.account_manager_id ?? ''} disabled={!canAdmin || saving} onChange={(e) => save({ account_manager_id: e.target.value || null }, 'Account manager updated')} data-testid="drawer-am">
                        <option value="">Unassigned</option>
                        {managers.map((s) => <option key={s.id} value={s.id}>{s.first_name} {s.last_name}</option>)}
                      </Select>
                      {!canAdmin ? <span className="field-hint">Only agency admins reassign companies.</span> : null}
                    </label>
                    <label className="field">
                      <span className="field-label">Status</span>
                      <Select value={c.status} disabled={saving} onChange={(e) => changeStatus(e.target.value)} data-testid="drawer-status">
                        {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                      </Select>
                    </label>
                  </div>
                </>
              ) : null}
            </>
          )}
        </div>
      </aside>
      {dialog}
    </div>
  );
}
