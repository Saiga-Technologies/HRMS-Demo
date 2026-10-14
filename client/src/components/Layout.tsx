import React, { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { useTour } from '../lib/tour';
import { Button, Avatar } from './ui';

interface NavItem { to: string; label: string; icon: string; roles?: ('hr' | 'manager' | 'employee')[] }
const NAV: { group: string; items: NavItem[] }[] = [
  { group: 'Overview', items: [{ to: '/', label: 'Dashboard', icon: '▦' }] },
  {
    group: 'People',
    items: [
      { to: '/employees', label: 'Employees', icon: '👥' },
      { to: '/org', label: 'Org structure', icon: '🏢' },
      { to: '/org-tree', label: 'Org tree', icon: '🌳' },
      { to: '/jobs', label: 'Job descriptions', icon: '📋', roles: ['hr', 'manager'] },
      { to: '/journey', label: 'Employee journey', icon: '🧭' },
      { to: '/documents', label: 'Documents', icon: '📁' },
    ],
  },
  {
    group: 'Operations',
    items: [
      { to: '/attendance', label: 'Attendance', icon: '⏱' },
      { to: '/leave', label: 'Leave', icon: '🌴' },
      { to: '/payroll', label: 'Payroll', icon: '💸' },
      { to: '/assets', label: 'Assets', icon: '💻' },
    ],
  },
  { group: 'Admin', items: [{ to: '/settings', label: 'Settings', icon: '⚙️', roles: ['hr'] }] },
];

export default function Layout() {
  const { user, company, logout } = useAuth();
  const { start, steps, pageName } = useTour();
  const navigate = useNavigate();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [autoTour, setAutoTour] = useState(() => {
    try { return localStorage.getItem('hrms:auto-tour') === '1'; } catch { return false; }
  });
  useEffect(() => setSidebarOpen(false), [location.pathname]);
  if (!user) return null;
  const role = user.role;
  const name = user.first_name ? `${user.first_name} ${user.last_name || ''}`.trim() : user.email;

  return (
    <div className="app">
      <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`} data-tour="sidebar">
        <div className="brand">
          <span className="brand-logo">{company.logo_text || 'H'}</span>
          <span className="brand-name">{company.name || 'HRMS'}</span>
        </div>
        <nav className="nav">
          {NAV.map((g) => {
            const items = g.items.filter((i) => !i.roles || i.roles.includes(role));
            if (!items.length) return null;
            return (
              <div key={g.group} className="nav-group">
                <div className="nav-group-label">{g.group}</div>
                {items.map((i) => (
                  <NavLink key={i.to} to={i.to} end={i.to === '/'} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`} data-nav={i.to}>
                    <span className="nav-icon" aria-hidden>{i.icon}</span>
                    {i.label}
                  </NavLink>
                ))}
              </div>
            );
          })}
        </nav>
        <div className="sidebar-footer">
          <small>{company.tagline}</small>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <button className="btn btn-ghost btn-sm menu-toggle" onClick={() => setSidebarOpen((o) => !o)} aria-label="Toggle navigation">☰</button>
          <div className="topbar-spacer" />
          <Button variant="primary" size="sm" onClick={start} disabled={!steps.length} data-tour="tour-button" data-testid="tour-button" title={steps.length ? `Guided tour of ${pageName}` : 'No tour on this page'}>
            ✨ Tour this page
          </Button>
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
                {user.employee_id ? <button onClick={() => { setMenuOpen(false); navigate(`/employees/${user.employee_id}`); }}>My profile</button> : null}
                <button onClick={() => { setMenuOpen(false); navigate('/account'); }}>Change password</button>
                <label className="dropdown-toggle">
                  <input type="checkbox" checked={autoTour} onChange={(e) => { setAutoTour(e.target.checked); try { localStorage.setItem('hrms:auto-tour', e.target.checked ? '1' : '0'); } catch { /* ignore */ } }} />
                  Auto-start tours on first visit
                </label>
                <button className="danger" onClick={() => logout().then(() => navigate('/login'))} data-testid="logout">Sign out</button>
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
