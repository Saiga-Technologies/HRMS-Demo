import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { driver, type DriveStep, type Driver } from 'driver.js';
import 'driver.js/dist/driver.css';
import { useLocation } from 'react-router-dom';

/**
 * Every page registers its own guided tour with `usePageTour(steps)`.
 * The layout shows a "Tour this page" button that runs the registered steps with driver.js.
 * Steps target elements by `data-tour="..."` attributes; missing elements are skipped automatically.
 */
export interface TourStep {
  element?: string; // CSS selector, usually [data-tour="x"]
  title: string;
  description: string;
  side?: 'top' | 'right' | 'bottom' | 'left';
  align?: 'start' | 'center' | 'end';
}

/**
 * Used when a page registers no steps of its own, so "Tour this page" is never a dead button.
 * Targets live in the layout (and the page header), so they exist on every signed-in page.
 */
export const GENERAL_TOUR: TourStep[] = [
  { element: '.page-header', title: 'This page', description: 'The page title and summary. Actions for the page sit on the right of this header.' },
  { element: '[data-tour="sidebar"]', title: 'Navigation', description: 'Every module lives here. Red badges count items waiting for you. Hover to expand, or pin the menu open at the bottom.' },
  { element: '[data-testid="bell"]', title: 'Things that need you', description: 'Pending approvals, appeals and requests. Click to jump straight to them.' },
  { element: '[data-testid="theme-toggle"]', title: 'Light and dark theme', description: 'Switch themes any time; your choice is remembered on this device.' },
  { element: '[data-testid="user-menu"]', title: 'Your account', description: 'Your profile, password and sign out.' },
  { element: '[data-tour="tour-button"]', title: 'Tour any page', description: 'Pages with more to explore have their own step-by-step tour behind this button.' },
];

interface TourCtx {
  steps: TourStep[];
  pageName: string;
  register: (pageName: string, steps: TourStep[]) => void;
  start: () => void;
  running: boolean;
}
const Ctx = createContext<TourCtx>(null!);

export function TourProvider({ children }: { children: React.ReactNode }) {
  const [steps, setSteps] = useState<TourStep[]>([]);
  const [pageName, setPageName] = useState('');
  const [running, setRunning] = useState(false);
  const driverRef = useRef<Driver | null>(null);
  const location = useLocation();

  const register = useCallback((name: string, s: TourStep[]) => {
    setPageName(name);
    setSteps(s);
  }, []);

  const start = useCallback(() => {
    const available: DriveStep[] = (steps.length ? steps : GENERAL_TOUR)
      .filter((s) => !s.element || document.querySelector(s.element))
      .map((s) => ({
        element: s.element,
        popover: { title: s.title, description: s.description, side: s.side, align: s.align },
      }));
    if (!available.length) return;
    driverRef.current?.destroy();
    const d = driver({
      showProgress: true,
      animate: true,
      allowClose: true,
      overlayOpacity: 0.55,
      stagePadding: 6,
      stageRadius: 10,
      popoverClass: 'hrms-tour',
      nextBtnText: 'Next →',
      prevBtnText: '← Back',
      doneBtnText: 'Done',
      progressText: '{{current}} of {{total}}',
      steps: available,
      onDestroyed: () => {
        setRunning(false);
        try {
          localStorage.setItem(`hrms:tour-seen:${location.pathname}`, '1');
        } catch {
          /* ignore */
        }
      },
    });
    driverRef.current = d;
    setRunning(true);
    d.drive();
  }, [steps, location.pathname]);

  // Reset on navigation so a stale tour never shows for a new page. Skipped on the first render:
  // child pages register their steps before this effect runs, and clearing here would drop them.
  const lastPath = useRef<string | null>(null);
  useEffect(() => {
    if (lastPath.current !== null && lastPath.current !== location.pathname) {
      driverRef.current?.destroy();
      setSteps([]);
      setPageName('');
    }
    lastPath.current = location.pathname;
  }, [location.pathname]);

  const value = useMemo(() => ({ steps, pageName, register, start, running }), [steps, pageName, register, start, running]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useTour = () => useContext(Ctx);

/** Register this page's tour. Call once per page component. */
export function usePageTour(pageName: string, steps: TourStep[]) {
  const { register, start } = useTour();
  const location = useLocation();
  const key = JSON.stringify(steps.map((s) => s.element + s.title));
  useEffect(() => {
    register(pageName, steps);
    // Optional auto-start on first visit (user preference, off by default).
    let auto = false;
    try {
      auto = localStorage.getItem('hrms:auto-tour') === '1' && !localStorage.getItem(`hrms:tour-seen:${location.pathname}`);
    } catch {
      /* ignore */
    }
    if (auto) {
      const t = setTimeout(() => start(), 600);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageName, key, location.pathname]);
}
