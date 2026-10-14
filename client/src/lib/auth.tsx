import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api } from './api';
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

interface AuthCtx {
  user: User | null;
  company: Company;
  loading: boolean;
  login: (email: string, password: string) => Promise<User>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  refreshCompany: () => Promise<void>;
  isHr: boolean;
  isManager: boolean;
}

const Ctx = createContext<AuthCtx>(null!);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [company, setCompany] = useState<Company>({ name: 'HRMS' });
  const [loading, setLoading] = useState(true);
  const { applyPalette } = useTheme();

  const refresh = useCallback(async () => {
    try {
      const r = await api.get<{ user: User }>('/api/auth/me');
      setUser(r.user);
    } catch {
      setUser(null);
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
    const onUnauthorized = () => setUser(null);
    window.addEventListener('hrms:unauthorized', onUnauthorized);
    return () => window.removeEventListener('hrms:unauthorized', onUnauthorized);
  }, [refresh, refreshCompany]);

  useEffect(() => {
    if (user) {
      api.get<Company>('/api/settings/company').then((c) => {
        setCompany((prev) => ({ ...prev, ...c }));
        applyPalette(c);
      }).catch(() => {});
    }
  }, [user?.id]);

  const login = async (email: string, password: string) => {
    const r = await api.post<{ user: User }>('/api/auth/login', { email, password });
    setUser(r.user);
    return r.user;
  };
  const logout = async () => {
    try {
      await api.post('/api/auth/logout');
    } finally {
      setUser(null);
    }
  };

  return (
    <Ctx.Provider value={{ user, company, loading, login, logout, refresh, refreshCompany, isHr: user?.role === 'hr', isManager: user?.role === 'hr' || user?.role === 'manager' }}>
      {children}
    </Ctx.Provider>
  );
}

export const useAuth = () => useContext(Ctx);
