import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

export type Theme = 'light' | 'dark';
interface ThemeCtx { theme: Theme; setTheme: (t: Theme) => void; toggle: () => void; applyPalette: (p: { brand_color?: string; accent_color?: string; default_theme?: string }) => void }
const Ctx = createContext<ThemeCtx>(null!);

function readStored(): Theme | null {
  try {
    const v = localStorage.getItem('hrms:theme');
    return v === 'dark' || v === 'light' ? v : null;
  } catch {
    return null;
  }
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => readStored() || (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
  const [explicit, setExplicit] = useState<boolean>(() => readStored() !== null);
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);
  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    setExplicit(true);
    try { localStorage.setItem('hrms:theme', t); } catch { /* ignore */ }
  }, []);
  const toggle = useCallback(() => setTheme(theme === 'dark' ? 'light' : 'dark'), [theme, setTheme]);
  /** Company palette from settings: brand + accent colours and the default theme for users who never chose one. */
  const applyPalette = useCallback((p: { brand_color?: string; accent_color?: string; default_theme?: string }) => {
    const root = document.documentElement.style;
    if (p.brand_color) root.setProperty('--brand-base', p.brand_color);
    if (p.accent_color) root.setProperty('--accent-base', p.accent_color);
    if (!explicit && (p.default_theme === 'dark' || p.default_theme === 'light')) setThemeState(p.default_theme);
  }, [explicit]);
  const value = useMemo(() => ({ theme, setTheme, toggle, applyPalette }), [theme, setTheme, toggle, applyPalette]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
export const useTheme = () => useContext(Ctx);
