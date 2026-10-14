import React, { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useCounts } from '../lib/notifications';
import { usePageTour } from '../lib/tour';
import { PageHeader, Tabs, useFetch } from '../components/ui';
import { MyLeave } from '../components/leave/MyLeave';
import { Approvals } from '../components/leave/Approvals';
import { TeamCalendar } from '../components/leave/TeamCalendar';
import { AllRequests } from '../components/leave/AllRequests';
import { BalancesMatrix, LeaveSettingsTab, LeaveTypesTab } from '../components/leave/LeaveAdmin';
import CompOffTab from '../components/leave/CompOffTab';
import { DirectoryEmployee, Holiday, LeaveSettings, LeaveType } from '../components/leave/shared';

const TOUR = [
  { element: '[data-tour="leave-balances"]', title: 'Your balances', description: 'One card per leave type: days available, used, pending approval, and what was allocated or carried forward this year.' },
  { element: '[data-tour="leave-apply-btn"]', title: 'Apply for leave', description: 'Pick a type, dates and an optional half day. The form shows the type’s rules (notice, documents) and counts working days for you.' },
  { element: '[data-tour="leave-my-requests"]', title: 'Your requests', description: 'Track status and who it is pending with. Edit or cancel pending requests; corrections to approved leave go back to your approver. Click a row for the full history.' },
  { element: '[data-tour="leave-tabs"]', title: 'More views', description: 'Managers approve requests here; everyone sees the team calendar and their comp off. HR also manages all requests, balances, leave types and settings.' },
  { element: '[data-tour="leave-approvals"]', title: 'Approvals', description: 'Each card shows the request, the proposed change for corrections, and Approve/Reject with an optional note.' },
  { element: '[data-tour="leave-calendar"]', title: 'Team calendar', description: 'Who is away when. Chips are coloured by leave type; striped chips are still pending; holidays and weekly offs are marked.' },
  { element: '[data-tour="compoff-detected"]', title: 'Comp off: detected days', description: 'Days you worked on a weekly off or holiday are found automatically from attendance. Request the credit or dismiss it; credits expire if unclaimed.' },
  { element: '[data-tour="compoff-mine"]', title: 'Comp off balance', description: 'Approved credits are added to your Comp Off leave balance for that year, ready to be applied like any other leave.' },
  { element: '[data-tour="compoff-approvals"]', title: 'Comp off approvals', description: 'Managers approve or reject credits requested by their reports; the balance is updated the moment a credit is approved.' },
  { element: '[data-tour="compoff-criteria"]', title: 'Detection criteria', description: 'HR sees the rules in force (weekly offs, holidays, extra hours, expiry) and can run a detection scan on demand.' },
  { element: '[data-tour="leave-balances-matrix"]', title: 'Balances matrix', description: 'Employees by leave type. Click any cell to change allocation, carry forward or add an adjustment.' },
  { element: '[data-tour="leave-types"]', title: 'Leave types', description: 'Define quotas, paid/unpaid, carry forward, notice and half-day rules, and a colour used across the module.' },
  { element: '[data-tour="leave-compoff-settings"]', title: 'Comp off rules', description: 'Switch comp off on or off, choose what earns it, the minutes needed for a full or half day, the expiry and whether a manager must approve.' },
];

const TAB_KEYS = ['me', 'approvals', 'calendar', 'compoff', 'all', 'balances', 'types', 'settings'] as const;
type TabKey = (typeof TAB_KEYS)[number];

export default function Leave() {
  usePageTour('Leave', TOUR);
  const { isHr, isManager } = useAuth();
  const { counts } = useCounts();
  const [params, setParams] = useSearchParams();

  const types = useFetch<LeaveType[]>(() => api.get('/api/leave/types'), []);
  const settings = useFetch<LeaveSettings>(() => api.get('/api/settings/leave'), []);
  const attSettings = useFetch<{ weekly_offs?: number[] }>(() => api.get('/api/settings/attendance'), []);
  const holidays = useFetch<Holiday[]>(() => api.get('/api/attendance/holidays'), []);
  const employees = useFetch<DirectoryEmployee[]>(() => (isHr ? api.get('/api/employees/directory/all') : Promise.resolve([])), [isHr]);

  const managersCanApprove = settings.data?.managers_can_approve !== false;
  const canApprove = isHr || (isManager && managersCanApprove);
  const tabs = useMemo(
    () => [
      { key: 'me', label: 'My leave', show: true, icon: 'leaf' },
      { key: 'approvals', label: 'Approvals', show: canApprove, badge: counts.leave_approvals || undefined, icon: 'check' },
      { key: 'calendar', label: 'Team calendar', show: true, icon: 'calendar' },
      { key: 'compoff', label: 'Comp off', show: true, badge: (isManager ? counts.comp_off_approvals : counts.my_comp_off_detected) || undefined, icon: 'award' },
      { key: 'all', label: 'All requests', show: isHr },
      { key: 'balances', label: 'Balances', show: isHr },
      { key: 'types', label: 'Leave types', show: isHr },
      { key: 'settings', label: 'Settings', show: isHr, icon: 'settings' },
    ].filter((t) => t.show),
    [isHr, isManager, canApprove, counts.leave_approvals, counts.comp_off_approvals, counts.my_comp_off_detected],
  );
  const requested = params.get('tab') as TabKey | null;
  const tab: TabKey = requested && TAB_KEYS.includes(requested) && tabs.some((t) => t.key === requested) ? requested : 'me';
  const setTab = (k: string) => setParams(k === 'me' ? {} : { tab: k }, { replace: true });

  const weeklyOffs = attSettings.data?.weekly_offs || [0, 6];
  const sandwich = !!settings.data?.sandwich_rule;
  const common = { types: types.data || [], holidays: holidays.data || [], weeklyOffs, sandwich };

  return (
    <>
      <PageHeader title="Leave" subtitle="Balances, requests and approvals, comp off for extra working days, plus the team calendar." />
      <Tabs tour="leave-tabs" value={tab} onChange={setTab} tabs={tabs.map(({ key, label, badge, icon }) => ({ key, label, badge, icon }))} />

      {tab === 'me' ? <MyLeave {...common} /> : null}
      {tab === 'approvals' ? <Approvals /> : null}
      {tab === 'calendar' ? <TeamCalendar types={common.types} weeklyOffs={weeklyOffs} /> : null}
      {tab === 'compoff' ? <CompOffTab /> : null}
      {tab === 'all' ? <AllRequests {...common} employees={employees.data || []} /> : null}
      {tab === 'balances' ? <BalancesMatrix /> : null}
      {tab === 'types' ? <LeaveTypesTab types={common.types} loading={types.loading} reload={types.reload} /> : null}
      {tab === 'settings' ? <LeaveSettingsTab onSaved={(s) => settings.setData(s)} /> : null}
    </>
  );
}
