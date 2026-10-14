import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api';
import { useAuth } from './auth';

/**
 * Unread-style counters (pending approvals, new candidates, expiring documents…) used by the
 * sidebar badges and by tab badges inside pages. Polled every 30 s and refreshed after mutations
 * via `refreshCounts()`.
 */
export type Counts = Record<string, number>;
interface Ctx { counts: Counts; refreshCounts: () => Promise<void>; loaded: boolean }
const NotificationsCtx = createContext<Ctx>({ counts: {}, refreshCounts: async () => {}, loaded: false });

export function NotificationsProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [counts, setCounts] = useState<Counts>({});
  const [loaded, setLoaded] = useState(false);
  const inFlight = useRef<Promise<void> | null>(null);
  const refreshCounts = useCallback(async () => {
    if (!user) return;
    if (inFlight.current) return inFlight.current;
    inFlight.current = api.get<{ counts: Counts }>('/api/notifications/counts').then((r) => { setCounts(r.counts); setLoaded(true); }).catch(() => {}).finally(() => { inFlight.current = null; });
    return inFlight.current;
  }, [user?.id]);
  useEffect(() => {
    if (!user) { setCounts({}); setLoaded(false); return; }
    refreshCounts();
    const t = setInterval(refreshCounts, 30000);
    const onFocus = () => refreshCounts();
    window.addEventListener('focus', onFocus);
    return () => { clearInterval(t); window.removeEventListener('focus', onFocus); };
  }, [user?.id, refreshCounts]);
  const value = useMemo(() => ({ counts, refreshCounts, loaded }), [counts, refreshCounts, loaded]);
  return <NotificationsCtx.Provider value={value}>{children}</NotificationsCtx.Provider>;
}
export const useCounts = () => useContext(NotificationsCtx);
