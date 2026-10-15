import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { driver, type DriveStep, type Driver } from 'driver.js';
import 'driver.js/dist/driver.css';
import { useLocation } from 'react-router-dom';

/**
 * Every page registers its own guided tour with `usePageTour(name, steps)`. The layout's
 * "Tour this page" button runs it with driver.js.
 *
 * Tours follow the page's workflow, in order, and can span tabs: a step with `tab: 'approvals'`
 * switches to that tab (clicks `[data-tab="approvals"]`) before it is shown, and later steps stay on
 * that tab until another step names a different one. Steps whose element is not on screen (another
 * role, empty state, tab not available) are skipped at run time. When the tour ends, the tab the user
 * started on is restored.
 */
export interface TourStep {
  element?: string; // CSS selector, usually [data-tour="x"]; omit for a centred intro/summary card
  title: string;
  description: string;
  side?: 'top' | 'right' | 'bottom' | 'left';
  align?: 'start' | 'center' | 'end';
  /** Switch to this tab first (Tabs key, i.e. `[data-tab="key"]`, or any CSS selector of a button to click). Inherited by following steps. */
  tab?: string;
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
  register: (pageName: string, steps: TourStep[], path: string) => void;
  start: () => void;
  running: boolean;
}
const Ctx = createContext<TourCtx>(null!);

const tabSelector = (tab: string) => (/[[.#]/.test(tab) ? tab : `[data-tab="${tab}"]`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor(selector: string, ms = 1500): Promise<Element | null> {
  const end = Date.now() + ms;
  for (;;) {
    const el = document.querySelector(selector);
    if (el && (el as HTMLElement).offsetParent !== null) return el;
    if (Date.now() > end) return el;
    await sleep(50);
  }
}

export function TourProvider({ children }: { children: React.ReactNode }) {
  const [reg, setReg] = useState<{ steps: TourStep[]; pageName: string; path: string }>({ steps: [], pageName: '', path: '' });
  const [running, setRunning] = useState(false);
  const driverRef = useRef<Driver | null>(null);
  const location = useLocation();

  const register = useCallback((name: string, s: TourStep[], path: string) => setReg({ steps: s, pageName: name, path }), []);
  // Only the current page's registration counts (a page without a tour gets the general one).
  const current = reg.path === location.pathname && reg.steps.length ? reg : null;
  const steps = current ? current.steps : GENERAL_TOUR;

  const start = useCallback(() => {
    driverRef.current?.destroy();
    const list = steps;
    // Effective tab for every step (a step's tab carries forward until another one is named).
    const tabs: (string | undefined)[] = [];
    list.forEach((s, i) => tabs.push(s.tab ?? tabs[i - 1]));
    const startTab = document.querySelector('[role="tab"][aria-selected="true"]') as HTMLElement | null;
    // Put the user back on the tab they started from. Called from every way a tour can end:
    // driver.js skips onDestroyed when a step's animation has not finished yet.
    let restored = false;
    const restore = () => {
      if (restored) return;
      restored = true;
      setRunning(false);
      if (startTab && startTab.isConnected && startTab.getAttribute('aria-selected') !== 'true') startTab.click();
      try { localStorage.setItem(`hrms:tour-seen:${location.pathname}`, '1'); } catch { /* ignore */ }
    };
    const finish = () => { restore(); d.destroy(); };
    const switchTab = async (tab?: string) => {
      if (!tab) return;
      const btn = document.querySelector(tabSelector(tab)) as HTMLElement | null;
      if (!btn) return;
      if (btn.getAttribute('aria-selected') !== 'true') { btn.click(); await sleep(120); }
    };
    // A step can be shown when it has no element, or its element appears after switching tab.
    const available = async (i: number) => {
      const s = list[i];
      const tab = tabs[i];
      // Intro / summary cards (no element) always show; they only switch tab if the user has it.
      if (!s.element) { if (tab && document.querySelector(tabSelector(tab))) await switchTab(tab); return true; }
      if (tab && !document.querySelector(tabSelector(tab))) return false; // tab not offered to this user
      await switchTab(tab);
      const el = await waitFor(s.element, tab ? 1500 : 300);
      return !!el;
    };
    /** Is any later step plausibly available (used to label the last button "Done")? */
    const anyLater = (i: number) => list.slice(i + 1).some((s, k) => {
      const tab = tabs[i + 1 + k];
      if (!s.element) return true;
      if (tab && !document.querySelector(tabSelector(tab))) return false;
      if (tab && tab !== tabs[i]) return true; // will check after switching
      return !!document.querySelector(s.element);
    });
    let busy = false;
    const go = async (from: number, dir: 1 | -1) => {
      if (busy) return;
      busy = true;
      try {
        for (let i = from; i >= 0 && i < list.length; i += dir) {
          if (await available(i)) { d.moveTo(i); return; }
        }
        if (dir === 1) finish();
      } finally { busy = false; }
    };
    const driveSteps: DriveStep[] = list.map((s) => ({
      element: s.element ? () => (document.querySelector(s.element!) as Element) || document.body : undefined,
      popover: { title: s.title, description: s.description, side: s.side, align: s.align },
    }));
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
      steps: driveSteps,
      onNextClick: () => { void go((d.getActiveIndex() ?? -1) + 1, 1); },
      onPrevClick: () => { void go((d.getActiveIndex() ?? 1) - 1, -1); },
      onPopoverRender: (popover, { state }) => {
        const i = state.activeIndex ?? 0;
        if (!anyLater(i)) popover.nextButton.textContent = 'Done';
        // Back is pointless when nothing earlier can be shown.
        if (i === 0) popover.previousButton.style.display = 'none';
      },
      onDestroyStarted: () => finish(), // close button, overlay click, Escape
      onDestroyed: restore,
    });
    driverRef.current = d;
    setRunning(true);
    // Start at the first step that can be shown.
    void (async () => {
      for (let i = 0; i < list.length; i++) {
        if (await available(i)) { d.drive(i); return; }
      }
      setRunning(false);
    })();
  }, [steps, location.pathname]);

  // Never leave a tour open over a different page.
  useEffect(() => () => driverRef.current?.destroy(), [location.pathname]);

  const value = useMemo(() => ({ steps, pageName: current?.pageName || '', register, start, running }), [steps, current?.pageName, register, start, running]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useTour = () => useContext(Ctx);

/**
 * Register this page's tour. Call once per page component (the last registration on a page wins, so
 * pages with tabs should register ONE tour that walks through the tabs in workflow order).
 */
export function usePageTour(pageName: string, steps: TourStep[]) {
  const { register, start } = useTour();
  const location = useLocation();
  const key = JSON.stringify(steps.map((s) => `${s.element}|${s.title}|${s.tab || ''}`));
  useEffect(() => {
    register(pageName, steps, location.pathname);
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
