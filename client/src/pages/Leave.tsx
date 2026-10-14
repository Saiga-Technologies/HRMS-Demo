import React, { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { usePageTour } from '../lib/tour';
import { PageHeader, Tabs, useFetch } from '../components/ui';
import { MyLeave } from '../components/leave/MyLeave';
import { Approvals } from '../components/leave/Approvals';
import { TeamCalendar } from '../components/leave/TeamCalendar';
import { AllRequests } from '../components/leave/AllRequests';
import { BalancesMatrix, LeaveSettingsTab, LeaveTypesTab } from '../components/leave/LeaveAdmin';
import { DirectoryEmployee, Holiday, LeaveRequest, LeaveSettings, LeaveType } from '../components/leave/shared';

const TOUR = [
  { element: '[data-tour="leave-balances"]', title: 'Your balances', description: 'One card per leave type: days available, used, pending approval, and what was allocated or carried forward this year.' },
  { element: '[data-tour="leave-apply-btn"]', title: 'Apply for leave', description: 'Pick a type, dates and an optional half day. The form shows the type’s rules (notice, documents) and counts working days for you.' },
  { element: '[data-tour="leave-my-requests"]', title: 'Your requests', description: 'Track status and reviewer notes. Edit or cancel pending requests; corrections to approved leave go back to your approver. Click a row for the full history.' },
  { element: '[data-tour="leave-tabs"]', title: 'More views', description: 'Managers approve requests here; everyone sees the team calendar. HR also manages all requests, balances, leave types and settings.' },
  { element: '[data-tour="leave-approvals"]', title: 'Approvals', description: 'Each card shows the request, the proposed change for corrections, and Approve/Reject with an optional note.' },
  { element: '[data-tour="leave-calendar"]', title: 'Team calendar', description: 'Who is away when. Chips are coloured by leave type; striped chips are still pending; holidays and weekly offs are marked.' },
  { element: '[data-tour="leave-balances-matrix"]', title: 'Balances matrix', description: 'Employees by leave type. Click any cell to change allocation, carry forward or add an adjustment.' },
  { element: '[data-tour="leave-types"]', title: 'Leave types', description: 'Define quotas, paid/unpaid, carry forward, notice and half-day rules, and a colour used across the module.' },
];

const TAB_KEYS = ['me', 'approvals', 'calendar', 'all', 'balances', 'types', 'settings'] as const;
type TabKey = (typeof TAB_KEYS)[number];

export default function Leave() {
  usePageTour('Leave', TOUR);
  const { isHr, isManager } = useAuth();
  const [params, setParams] = useSearchParams();

  const types = useFetch<LeaveType[]>(() => api.get('/api/leave/types'), []);
  const settings = useFetch<LeaveSettings>(() => api.get('/api/settings/leave'), []);
  const attSettings = useFetch<{ weekly_offs?: number[] }>(() => api.get('/api/settings/attendance'), []);
  const holidays = useFetch<Holiday[]>(() => api.get('/api/attendance/holidays'), []);
  const employees = useFetch<DirectoryEmployee[]>(() => (isHr ? api.get('/api/employees/directory/all') : Promise.resolve([])), [isHr]);
  const pending = useFetch<LeaveRequest[]>(() => (isManager ? api.get('/api/leave/approvals/pending') : Promise.resolve([])), [isManager]);

  const managersCanApprove = settings.data?.managers_can_approve !== false;
  const tabs = useMemo(
    () => [
      { key: 'me', label: 'My leave', show: true },
      { key: 'approvals', label: 'Approvals', show: isHr || (isManager && managersCanApprove), count: pending.data?.length || undefined },
      { key: 'calendar', label: 'Team calendar', show: true },
      { key: 'all', label: 'All requests', show: isHr },
      { key: 'balances', label: 'Balances', show: isHr },
      { key: 'types', label: 'Leave types', show: isHr },
      { key: 'settings', label: 'Settings', show: isHr },
    ].filter((t) => t.show),
    [isHr, isManager, managersCanApprove, pending.data],
  );
  const requested = params.get('tab') as TabKey | null;
  const tab: TabKey = requested && TAB_KEYS.includes(requested) && tabs.some((t) => t.key === requested) ? requested : 'me';
  const setTab = (k: string) => setParams(k === 'me' ? {} : { tab: k }, { replace: true });

  const weeklyOffs = attSettings.data?.weekly_offs || [0, 6];
  const sandwich = !!settings.data?.sandwich_rule;
  const common = { types: types.data || [], holidays: holidays.data || [], weeklyOffs, sandwich };

  return (
    <>
      <PageHeader title="Leave" subtitle="Balances, requests and approvals, plus the team calendar." />
      <Tabs tour="leave-tabs" value={tab} onChange={setTab} tabs={tabs.map(({ key, label, count }) => ({ key, label, count }))} />

      {tab === 'me' ? <MyLeave {...common} /> : null}
      {tab === 'approvals' ? <Approvals onChanged={() => pending.reload()} /> : null}
      {tab === 'calendar' ? <TeamCalendar types={common.types} weeklyOffs={weeklyOffs} /> : null}
      {tab === 'all' ? <AllRequests {...common} employees={employees.data || []} /> : null}
      {tab === 'balances' ? <BalancesMatrix /> : null}
      {tab === 'types' ? <LeaveTypesTab types={common.types} loading={types.loading} reload={types.reload} /> : null}
      {tab === 'settings' ? <LeaveSettingsTab onSaved={(s) => settings.setData(s)} /> : null}
    </>
  );
}
