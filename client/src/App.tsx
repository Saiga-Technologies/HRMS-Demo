import React from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './lib/auth';
import Layout from './components/Layout';
import Login from './pages/Login';
import Account from './pages/Account';
import Dashboard from './pages/Dashboard';
import Employees from './pages/Employees';
import EmployeeDetail from './pages/EmployeeDetail';
import OrgStructure from './pages/OrgStructure';
import OrgTree from './pages/OrgTree';
import Jobs from './pages/Jobs';
import Documents from './pages/Documents';
import Payroll from './pages/Payroll';
import Attendance from './pages/Attendance';
import Leave from './pages/Leave';
import Assets from './pages/Assets';
import Journey from './pages/Journey';
import Settings from './pages/Settings';
import Recruitment from './pages/Recruitment';
import Letters from './pages/Letters';
import Performance from './pages/Performance';
import Clients from './pages/Clients';
import Announcements from './pages/Announcements';
import Roster from './pages/Roster';
import Integrations from './pages/Integrations';
import Careers from './pages/Careers';
import Services from './pages/Services';
import AgencyApp from './agency/AgencyApp';
import { companyFromPath } from './lib/api';
import { Spinner } from './components/ui';

function RequireAuth({ children, roles }: { children: React.ReactElement; roles?: string[] }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <div className="fullscreen-center"><Spinner /></div>;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  if (roles && !roles.includes(user.role)) return <Navigate to="/" replace />;
  // Logins created with a temporary password (new client HR admins, new employees) must set their own first.
  if (user.must_change_password && location.pathname !== '/account') return <Navigate to="/account" replace />;
  return children;
}

/** Agency staff need a company open to use the company app; send them to the portfolio otherwise. */
function CompanyGate({ children }: { children: React.ReactElement }) {
  const { isAgency } = useAuth();
  if (isAgency && !companyFromPath()) return <Navigate to="/agency" replace />;
  return children;
}
function RequireAgency({ children }: { children: React.ReactElement }) {
  const { user, loading, isAgency } = useAuth();
  const location = useLocation();
  if (loading) return <div className="fullscreen-center"><Spinner /></div>;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  if (!isAgency) return <Navigate to="/" replace />;
  return children;
}

export default function App() {
  const { user, loading, isAgency } = useAuth();
  const inCompany = !!companyFromPath();
  const home = isAgency && !inCompany ? '/agency' : '/';
  return (
    <Routes>
      <Route path="/careers/*" element={<Careers />} />
      <Route path="/login" element={loading ? <div className="fullscreen-center"><Spinner /></div> : user ? <Navigate to={home} replace /> : <Login />} />
      {!inCompany ? <Route path="/agency/*" element={<RequireAgency><AgencyApp /></RequireAgency>} /> : null}
      <Route element={<RequireAuth><CompanyGate><Layout /></CompanyGate></RequireAuth>}>
        <Route index element={<Dashboard />} />
        <Route path="employees" element={<Employees />} />
        <Route path="employees/:id" element={<EmployeeDetail />} />
        <Route path="org" element={<OrgStructure />} />
        <Route path="org-tree" element={<OrgTree />} />
        <Route path="jobs/*" element={<Jobs />} />
        <Route path="recruitment/*" element={<RequireAuth roles={['hr', 'manager']}><Recruitment /></RequireAuth>} />
        <Route path="letters/*" element={<Letters />} />
        <Route path="performance/*" element={<Performance />} />
        <Route path="clients/*" element={<RequireAuth roles={['hr', 'manager']}><Clients /></RequireAuth>} />
        <Route path="announcements/*" element={<Announcements />} />
        <Route path="roster/*" element={<Roster />} />
        <Route path="services/*" element={<RequireAuth roles={['hr']}><Services /></RequireAuth>} />
        <Route path="integrations/*" element={<RequireAuth roles={['hr']}><Integrations /></RequireAuth>} />
        <Route path="documents/*" element={<Documents />} />
        <Route path="payroll/*" element={<Payroll />} />
        <Route path="attendance/*" element={<Attendance />} />
        <Route path="leave/*" element={<Leave />} />
        <Route path="assets/*" element={<Assets />} />
        <Route path="journey/*" element={<Journey />} />
        <Route path="settings/*" element={<RequireAuth roles={['hr']}><Settings /></RequireAuth>} />
        <Route path="account" element={<Account />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
