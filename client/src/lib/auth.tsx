import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api, companyFromPath } from './api';
import { useTheme } from './theme';

export type Role = 'hr' | 'manager' | 'employee';
export interface User {
  id: number;
  email: string;
  role: Role;
  employee_id: number | null;
  must_change_password: number;
  first_name?: string;
  last_name?: string;
  employee_code?: string;
  photo_path?: string | null;
  department_name?: string;
  position_title?: string;
}
export interface Company {
  name: string;
  tagline?: string;
  logo_text?: string;
  brand_color?: string;
  currency?: string;
  currency_symbol?: string;
  [k: string]: any;
}

export interface AgencyProfile { id: number; email: string; first_name: string; last_name: string; role: 'owner' | 'admin' | 'account_manager' | 'payroll' | 'recruiter' }
export interface CompanyRef { slug: string; name: string; country_code?: string; currency?: string; timezone?: string; logo_text?: string; brand_color?: string }
interface MeResponse { kind?: 'agency' | 'company'; user: User; agency?: AgencyProfile | null; company?: CompanyRef | null }

interface AuthCtx {
  user: User | null;
  /** Agency staff profile (also while working inside a client company). */
  agency: AgencyProfile | null;
  /** Company the session is working in (null for agency staff on the portfolio). */
  companyRef: CompanyRef | null;
  isAgency: boolean;
  company: Company;
  loading: boolean;
  login: (email: string, password: string) => Promise<MeResponse>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  refreshCompany: () => Promise<void>;
  isHr: boolean;
  isManager: boolean;
}

const Ctx = createContext<AuthCtx>(null!);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [agency, setAgency] = useState<AgencyProfile | null>(null);
  const [companyRef, setCompanyRef] = useState<CompanyRef | null>(null);
  const apply = (r: MeResponse | null) => {
    setUser(r?.user ?? null);
    setAgency(r?.agency ?? null);
    setCompanyRef(r?.company ?? null);
  };
  const [company, setCompany] = useState<Company>({ name: 'HRMS' });
  const [loading, setLoading] = useState(true);
  const { applyPalette } = useTheme();

  const refresh = useCallback(async () => {
    try {
      apply(await api.get<MeResponse>('/api/auth/me'));
    } catch {
      apply(null);
    }
  }, []);
  const refreshCompany = useCallback(async () => {
    try {
      const pub = await api.get<Company>('/api/settings/public');
      setCompany(pub);
      applyPalette(pub);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    (async () => {
      await Promise.all([refresh(), refreshCompany()]);
      setLoading(false);
    })();
    const onUnauthorized = () => apply(null);
    window.addEventListener('hrms:unauthorized', onUnauthorized);
    return () => window.removeEventListener('hrms:unauthorized', onUnauthorized);
  }, [refresh, refreshCompany]);

  useEffect(() => {
    // Agency staff on the portfolio have no company settings to load.
    if (user && (!agency || companyFromPath())) {
      api.get<Company>('/api/settings/company').then((c) => {
        setCompany((prev) => ({ ...prev, ...c }));
        applyPalette(c);
      }).catch(() => {});
    }
  }, [user?.id]);

  const login = async (email: string, password: string) => {
    const r = await api.post<MeResponse>('/api/auth/login', { email, password });
    apply(r);
    return r;
  };
  const logout = async () => {
    try {
      await api.post('/api/auth/logout');
    } finally {
      apply(null);
    }
  };

  return (
    <Ctx.Provider value={{ user, agency, companyRef, isAgency: !!agency, company, loading, login, logout, refresh, refreshCompany, isHr: user?.role === 'hr', isManager: user?.role === 'hr' || user?.role === 'manager' }}>
      {children}
    </Ctx.Provider>
  );
}

export const useAuth = () => useContext(Ctx);
