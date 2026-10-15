import React, { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Icon } from '../components/Icons';

interface CompanyLite { id: number; slug: string; name: string; country_code: string; status: string; logo_text: string | null; brand_color: string | null }
export const FLAG: Record<string, string> = { IN: 'India', AE: 'UAE', SA: 'KSA', QA: 'Qatar', US: 'USA' };

/**
 * Shown in the top bar while agency staff work inside a client company: which company this is, a
 * switcher to jump to another company, and the way back to the portfolio.
 */
export default function AgencyBar() {
  const { companyRef } = useAuth();
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<CompanyLite[] | null>(null);
  const [q, setQ] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open || list) return;
    api.get<CompanyLite[]>('/api/agency/companies?light=1').then(setList).catch(() => setList([]));
  }, [open, list]);
  useEffect(() => {
    const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);
  const shown = (list || []).filter((c) => c.status !== 'offboarded' && (!q || c.name.toLowerCase().includes(q.toLowerCase())));
  return (
    <div className="agency-bar" ref={ref} data-tour="agency-bar">
      <button className="agency-back" onClick={() => window.location.assign('/agency')} title="Back to the agency portfolio" data-testid="agency-portfolio">
        <Icon name="grid" size={15} /> <span className="hide-sm">Portfolio</span>
      </button>
      <button className="agency-company" onClick={() => setOpen((o) => !o)} data-testid="company-switcher" aria-expanded={open}>
        <span className="agency-logo" style={{ background: companyRef?.brand_color || 'var(--brand)' }}>{companyRef?.logo_text || companyRef?.name?.[0] || '?'}</span>
        <span className="agency-company-name">{companyRef?.name || 'Company'}</span>
        {companyRef?.country_code ? <span className="chip chip-muted hide-sm">{FLAG[companyRef.country_code] || companyRef.country_code}</span> : null}
        <Icon name="chevronDown" size={14} />
      </button>
      <span className="agency-acting hide-sm">Acting as agency</span>
      {open ? (
        <div className="dropdown agency-switcher">
          <input className="input" placeholder="Find a company…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
          <div className="agency-switcher-list">
            {!list ? <div className="muted" style={{ padding: 8 }}>Loading…</div> : shown.map((c) => (
              <button key={c.slug} onClick={() => window.location.assign(`/c/${c.slug}/`)} className={c.slug === companyRef?.slug ? 'active' : ''} data-testid={`switch-${c.slug}`}>
                <span className="agency-logo sm" style={{ background: c.brand_color || 'var(--brand)' }}>{c.logo_text || c.name[0]}</span>
                <span style={{ flex: 1, textAlign: 'left' }}>{c.name}</span>
                <small className="muted">{FLAG[c.country_code] || c.country_code}</small>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
