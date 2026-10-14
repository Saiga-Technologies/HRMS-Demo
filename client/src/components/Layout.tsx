import React, { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { useTour } from '../lib/tour';
import { useTheme } from '../lib/theme';
import { useCounts } from '../lib/notifications';
import { Button, Avatar } from './ui';
import { Icon } from './Icons';

interface NavItem { to: string; label: string; icon: string; roles?: ('hr' | 'manager' | 'employee')[]; badge?: string; employeeLabel?: string }
const NAV: { group: string; items: NavItem[] }[] = [
  { group: 'Overview', items: [{ to: '/', label: 'Dashboard', icon: 'dashboard' }] },
  {
    group: 'People',
    items: [
      { to: '/employees', label: 'Employees', icon: 'users', employeeLabel: 'My profile' },
      { to: '/org', label: 'Org structure', icon: 'sitemap' },
      { to: '/org-tree', label: 'Org tree', icon: 'tree' },
      { to: '/recruitment', label: 'Recruitment', icon: 'userPlus', roles: ['hr', 'manager'], badge: 'nav_recruitment' },
      { to: '/jobs', label: 'Job descriptions', icon: 'briefcase', roles: ['hr', 'manager'] },
      { to: '/journey', label: 'Employee journey', icon: 'compass', badge: 'nav_journey' },
      { to: '/documents', label: 'Documents', icon: 'folder', badge: 'nav_documents' },
    ],
  },
  {
    group: 'Operations',
    items: [
      { to: '/attendance', label: 'Attendance', icon: 'clock', badge: 'nav_attendance' },
      { to: '/leave', label: 'Leave', icon: 'leaf', badge: 'nav_leave' },
      { to: '/payroll', label: 'Payroll', icon: 'banknote', badge: 'nav_payroll' },
      { to: '/assets', label: 'Assets', icon: 'laptop' },
    ],
  },
  { group: 'Admin', items: [{ to: '/settings', label: 'Settings', icon: 'settings', roles: ['hr'] }] },
];

export default function Layout() {
  const { user, company, logout } = useAuth();
  const { start, steps, pageName } = useTour();
  const { theme, toggle } = useTheme();
  const { counts } = useCounts();
  const navigate = useNavigate();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [pinned, setPinned] = useState(() => {
    try { return localStorage.getItem('hrms:sidebar-pinned') === '1'; } catch { return false; }
  });
  const [autoTour, setAutoTour] = useState(() => {
    try { return localStorage.getItem('hrms:auto-tour') === '1'; } catch { return false; }
  });
  useEffect(() => setSidebarOpen(false), [location.pathname]);
  if (!user) return null;
  const role = user.role;
  const name = user.first_name ? `${user.first_name} ${user.last_name || ''}`.trim() : user.email;
  const togglePin = () => {
    const v = !pinned;
    setPinned(v);
    try { localStorage.setItem('hrms:sidebar-pinned', v ? '1' : '0'); } catch { /* ignore */ }
  };
  const total = counts.total_actions || 0;

  return (
    <div className="app">
      <div className={`sidebar-overlay ${sidebarOpen ? 'show' : ''}`} onClick={() => setSidebarOpen(false)} />
      <aside className={`sidebar ${pinned ? 'pinned' : ''} ${sidebarOpen ? 'open' : ''}`} data-tour="sidebar" aria-label="Main navigation">
        <div className="brand">
          <span className="brand-logo">{company.logo_text || 'H'}</span>
          <span className="brand-name label">{company.name || 'HRMS'}</span>
        </div>
        <nav className="nav">
          {NAV.map((g) => {
            const items = g.items.filter((i) => !i.roles || i.roles.includes(role));
            if (!items.length) return null;
            return (
              <div key={g.group} className="nav-group">
                <div className="nav-group-label">{g.group}</div>
                {items.map((i) => {
                  const n = i.badge ? counts[i.badge] || 0 : 0;
                  const label = role === 'employee' && i.employeeLabel ? i.employeeLabel : i.label;
                  return (
                    <NavLink key={i.to} to={i.to} end={i.to === '/'} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`} data-nav={i.to} title={label}>
                      <span className="nav-icon" aria-hidden><Icon name={i.icon} size={19} /></span>
                      <span className="label">{label}</span>
                      {n ? <span className="nav-badge" data-testid={`nav-badge-${i.to.slice(1) || 'home'}`}>{n > 99 ? '99+' : n}</span> : null}
                    </NavLink>
                  );
                })}
              </div>
            );
          })}
        </nav>
        <div className="sidebar-footer">
          <button className={`sidebar-pin ${pinned ? 'active' : ''}`} onClick={togglePin} title={pinned ? 'Unpin sidebar (collapse on mouse out)' : 'Pin sidebar open'} aria-label="Pin sidebar" data-testid="sidebar-pin">
            <Icon name={pinned ? 'chevronLeft' : 'pin'} size={16} />
          </button>
          <small className="label">{company.tagline}</small>
        </div>
      </aside>
      <div className={`main ${pinned ? 'pinned' : ''}`}>
        <header className="topbar">
          <button className="icon-btn menu-toggle" onClick={() => setSidebarOpen((o) => !o)} aria-label="Toggle navigation"><Icon name="menu" /></button>
          <div className="topbar-spacer" />
          <Button variant="primary" size="sm" onClick={start} disabled={!steps.length} data-tour="tour-button" data-testid="tour-button" title={steps.length ? `Guided tour of ${pageName}` : 'No tour on this page'}>
            <Icon name="sparkles" size={15} /> Tour this page
          </Button>
          <button className="icon-btn theme-toggle" onClick={toggle} aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'} title={theme === 'dark' ? 'Light theme' : 'Dark theme'} data-testid="theme-toggle">
            <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
          </button>
          <button className="icon-btn" aria-label={`${total} items need your attention`} title={total ? `${total} items need your attention` : 'Nothing pending'} onClick={() => navigate(role === 'employee' ? '/attendance' : '/leave?tab=approvals')} data-testid="bell">
            <Icon name="bell" />
            {total ? <span className="nav-badge">{total > 99 ? '99+' : total}</span> : null}
          </button>
          <div className="user-menu">
            <button className="user-btn" onClick={() => setMenuOpen((o) => !o)} data-testid="user-menu">
              <Avatar name={name} src={user.employee_id && user.photo_path ? `/api/employees/${user.employee_id}/photo` : null} size={30} />
              <span className="user-name">{name}</span>
              <span className="user-role">{role}</span>
            </button>
            {menuOpen ? (
              <div className="dropdown" onMouseLeave={() => setMenuOpen(false)}>
                <div className="dropdown-head">
                  <strong>{name}</strong>
                  <small>{user.email}</small>
                </div>
                {user.employee_id ? <button onClick={() => { setMenuOpen(false); navigate(`/employees/${user.employee_id}`); }}><Icon name="user" size={15} /> My profile</button> : null}
                <button onClick={() => { setMenuOpen(false); navigate('/account'); }}><Icon name="lock" size={15} /> Change password</button>
                <button onClick={() => { toggle(); }}><Icon name={theme === 'dark' ? 'sun' : 'moon'} size={15} /> {theme === 'dark' ? 'Light theme' : 'Dark theme'}</button>
                <label className="dropdown-toggle">
                  <input type="checkbox" checked={autoTour} onChange={(e) => { setAutoTour(e.target.checked); try { localStorage.setItem('hrms:auto-tour', e.target.checked ? '1' : '0'); } catch { /* ignore */ } }} />
                  Auto-start tours on first visit
                </label>
                <button className="danger" onClick={() => logout().then(() => navigate('/login'))} data-testid="logout"><Icon name="logout" size={15} /> Sign out</button>
              </div>
            ) : null}
          </div>
        </header>
        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
