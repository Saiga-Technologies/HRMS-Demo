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
import { Spinner } from './components/ui';

function RequireAuth({ children, roles }: { children: React.ReactElement; roles?: string[] }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <div className="fullscreen-center"><Spinner /></div>;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  if (roles && !roles.includes(user.role)) return <Navigate to="/" replace />;
  return children;
}

export default function App() {
  const { user, loading } = useAuth();
  return (
    <Routes>
      <Route path="/login" element={loading ? <div className="fullscreen-center"><Spinner /></div> : user ? <Navigate to="/" replace /> : <Login />} />
      <Route element={<RequireAuth><Layout /></RequireAuth>}>
        <Route index element={<Dashboard />} />
        <Route path="employees" element={<Employees />} />
        <Route path="employees/:id" element={<EmployeeDetail />} />
        <Route path="org" element={<OrgStructure />} />
        <Route path="org-tree" element={<OrgTree />} />
        <Route path="jobs/*" element={<Jobs />} />
        <Route path="recruitment/*" element={<RequireAuth roles={['hr', 'manager']}><Recruitment /></RequireAuth>} />
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
