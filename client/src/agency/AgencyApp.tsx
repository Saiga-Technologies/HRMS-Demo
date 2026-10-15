import React, { useEffect, useState } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useTour } from '../lib/tour';
import { useTheme } from '../lib/theme';
import { Avatar, Button } from '../components/ui';
import { Icon } from '../components/Icons';
import { BrandMark } from '../components/BrandMark';
import Portfolio from './Portfolio';
import AgencyCalendar from './AgencyCalendar';
import ServiceDesk from './ServiceDesk';
import Billing from './Billing';
import Team from './Team';
import NewCompany from './NewCompany';
import './agency.css';

export interface AgencyAlert { id: string; company_slug: string; company_name: string; kind: string; severity: 'critical' | 'warning' | 'info'; title: string; detail: string; due: string | null; days_left: number | null; link: string }
/** Open a page inside a client company (full navigation: the company app runs under /c/<slug>/). */
export const openCompany = (slug: string, path = '/') => window.location.assign(`/c/${slug}${path.startsWith('/') ? path : `/${path}`}`);
/** Follow an alert/event link: agency pages stay in the portal, company pages open the company. */
export const followLink = (slug: string, link: string, navigate: (to: string) => void) => (link.startsWith('/agency') ? navigate(link) : openCompany(slug, link));

const NAV: { to: string; label: string; title?: string; icon: string; end?: boolean; badge?: string }[] = [
  { to: '/agency', label: 'Portfolio', icon: 'grid', end: true },
  { to: '/agency/calendar', label: 'Calendar', title: 'Payroll & compliance calendar', icon: 'calendar' },
  { to: '/agency/requests', label: 'Service desk', icon: 'heartHandshake', badge: 'requests' },
  { to: '/agency/billing', label: 'Billing', icon: 'banknote', badge: 'billing' },
  { to: '/agency/team', label: 'Agency team', icon: 'users' },
];

/** Shell of the agency portal: its own sidebar, alerts bell, theme toggle, tour and user menu. */
export default function AgencyApp() {
  const { user, agency, logout } = useAuth();
  const { start, steps, pageName } = useTour();
  const { theme, toggle } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const [alerts, setAlerts] = useState<{ alerts: AgencyAlert[]; counts: Record<string, number> } | null>(null);
  const [bellOpen, setBellOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [pinned, setPinned] = useState(() => { try { return localStorage.getItem('hrms:sidebar-pinned') === '1'; } catch { return false; } });
  const loadAlerts = () => api.get<{ alerts: AgencyAlert[]; counts: Record<string, number> }>('/api/agency/alerts').then(setAlerts).catch(() => {});
  useEffect(() => { loadAlerts(); const t = setInterval(loadAlerts, 60000); return () => clearInterval(t); }, []);
  useEffect(() => { setSidebarOpen(false); setBellOpen(false); }, [location.pathname]);
  const badges: Record<string, number> = {
    requests: alerts?.alerts.filter((a) => a.kind === 'request').length || 0,
    billing: alerts?.alerts.filter((a) => a.kind === 'invoice').length || 0,
  };
  const urgent = (alerts?.counts.critical || 0) + (alerts?.counts.warning || 0);
  const name = agency ? `${agency.first_name} ${agency.last_name}` : user?.email || '';
  const togglePin = () => { const v = !pinned; setPinned(v); try { localStorage.setItem('hrms:sidebar-pinned', v ? '1' : '0'); } catch { /* ignore */ } };

  return (
    <div className="app agency-app">
      <div className={`sidebar-overlay ${sidebarOpen ? 'show' : ''}`} onClick={() => setSidebarOpen(false)} />
      <aside className={`sidebar ${pinned ? 'pinned' : ''} ${sidebarOpen ? 'open' : ''}`} data-tour="sidebar" aria-label="Agency navigation">
        <div className="brand">
          <BrandMark size={36} variant="onDark" />
          <span className="label agency-brand-text"><span className="brand-name">Saiga HR Services</span><small>Agency portal</small></span>
        </div>
        <nav className="nav">
          <div className="nav-group">
            <div className="nav-group-label">Agency</div>
            {NAV.map((i) => {
              const n = i.badge ? badges[i.badge] : 0;
              return (
                <NavLink key={i.to} to={i.to} end={i.end} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`} data-nav={i.to} title={i.title || i.label}>
                  <span className="nav-icon" aria-hidden><Icon name={i.icon} size={19} /></span>
                  <span className="label">{i.label}</span>
                  {n ? <span className="nav-badge">{n > 99 ? '99+' : n}</span> : null}
                </NavLink>
              );
            })}
          </div>
          {agency && ['owner', 'admin', 'account_manager'].includes(agency.role) ? (
            <div className="nav-group">
              <div className="nav-group-label">Onboarding</div>
              <NavLink to="/agency/companies/new" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`} title="Add a client company" data-testid="nav-new-company">
                <span className="nav-icon" aria-hidden><Icon name="plus" size={19} /></span>
                <span className="label">Add a client company</span>
              </NavLink>
            </div>
          ) : null}
        </nav>
        <div className="sidebar-footer">
          <button className={`sidebar-pin ${pinned ? 'active' : ''}`} onClick={togglePin} aria-label="Pin sidebar" data-testid="sidebar-pin"><Icon name={pinned ? 'chevronLeft' : 'pin'} size={16} /></button>
          <small className="label">Saiga HR Services</small>
        </div>
      </aside>
      <div className={`main ${pinned ? 'pinned' : ''}`}>
        <header className="topbar">
          <button className="icon-btn menu-toggle" onClick={() => setSidebarOpen((o) => !o)} aria-label="Toggle navigation"><Icon name="menu" /></button>
          <div className="topbar-spacer" />
          <Button variant="primary" size="sm" onClick={start} data-tour="tour-button" data-testid="tour-button" title={steps.length ? `Guided tour of ${pageName}` : 'Guided tour'}>
            <Icon name="sparkles" size={15} /> Tour this page
          </Button>
          <button className="icon-btn theme-toggle" onClick={toggle} aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'} data-testid="theme-toggle"><Icon name={theme === 'dark' ? 'sun' : 'moon'} /></button>
          <div className="user-menu">
            <button className="icon-btn" aria-label={`${urgent} alerts need attention`} onClick={() => setBellOpen((o) => !o)} data-testid="bell">
              <Icon name="bell" />
              {urgent ? <span className="nav-badge">{urgent > 99 ? '99+' : urgent}</span> : null}
            </button>
            {bellOpen ? (
              <div className="dropdown agency-alerts" onMouseLeave={() => setBellOpen(false)} data-testid="alerts-panel">
                <div className="dropdown-head"><strong>Needs attention</strong><small>{alerts ? `${alerts.alerts.length} alerts across your companies` : 'Loading…'}</small></div>
                <div className="agency-alerts-list">
                  {(alerts?.alerts || []).slice(0, 25).map((a) => (
                    <button key={a.id} className={`agency-alert sev-${a.severity}`} onClick={() => followLink(a.company_slug, a.link, navigate)}>
                      <span className="agency-alert-dot" />
                      <span className="agency-alert-body"><strong>{a.title}</strong><small>{a.company_name} · {a.detail}</small></span>
                    </button>
                  ))}
                  {alerts && !alerts.alerts.length ? <div className="muted" style={{ padding: 12 }}>All clear.</div> : null}
                </div>
              </div>
            ) : null}
          </div>
          <div className="user-menu">
            <button className="user-btn" onClick={() => setMenuOpen((o) => !o)} data-testid="user-menu">
              <Avatar name={name} size={30} />
              <span className="user-name">{name}</span>
              <span className="user-role">{agency?.role.replace('_', ' ')}</span>
            </button>
            {menuOpen ? (
              <div className="dropdown" onMouseLeave={() => setMenuOpen(false)}>
                <div className="dropdown-head"><strong>{name}</strong><small>{agency?.email}</small></div>
                <button onClick={() => toggle()}><Icon name={theme === 'dark' ? 'sun' : 'moon'} size={15} /> {theme === 'dark' ? 'Light theme' : 'Dark theme'}</button>
                <button className="danger" onClick={() => logout().then(() => navigate('/login'))} data-testid="logout"><Icon name="logout" size={15} /> Sign out</button>
              </div>
            ) : null}
          </div>
        </header>
        <main className="content">
          <Routes>
            <Route index element={<Portfolio alerts={alerts?.alerts || []} />} />
            <Route path="calendar" element={<AgencyCalendar />} />
            <Route path="requests" element={<ServiceDesk />} />
            <Route path="billing/*" element={<Billing />} />
            <Route path="team" element={<Team />} />
            <Route path="companies/new" element={<NewCompany />} />
            <Route path="*" element={<Navigate to="/agency" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}
