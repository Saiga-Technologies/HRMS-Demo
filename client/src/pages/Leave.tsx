import React, { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useCounts } from '../lib/notifications';
import { usePageTour, type TourStep } from '../lib/tour';
import { PageHeader, Tabs, useFetch } from '../components/ui';
import { MyLeave } from '../components/leave/MyLeave';
import { Approvals } from '../components/leave/Approvals';
import { TeamCalendar } from '../components/leave/TeamCalendar';
import { AllRequests } from '../components/leave/AllRequests';
import { BalancesMatrix, LeaveSettingsTab, LeaveTypesTab } from '../components/leave/LeaveAdmin';
import CompOffTab from '../components/leave/CompOffTab';
import { DirectoryEmployee, Holiday, LeaveSettings, LeaveType } from '../components/leave/shared';

const TOUR: TourStep[] = [
  { title: 'Leave, step by step', description: 'Leave follows one loop: 1) check your balance, 2) apply, 3) track the request, 4) your manager approves, 5) everyone sees it on the team calendar. Comp off turns extra working days into leave, and HR looks after all requests, balances, leave types and rules.' },
  { tab: 'me', element: '[data-tour="leave-tabs"]', title: 'Leave areas', description: 'My leave is yours. Approvers get an Approvals tab, everyone gets the Team calendar and Comp off, and HR also sees All requests, Balances, Leave types and Settings. Red badges count what is waiting for you.' },
  { element: '[data-tour="leave-balances"]', title: '1. Check your balance', description: 'One card per leave type for this year: the big number is what you can still take, the bar shows how much is used, and the line below splits it into used, pending approval and allocated (plus any carried forward or adjusted days).' },
  { element: '[data-tour="leave-apply-btn"]', title: '2. Apply for leave', description: 'Opens the request form: pick the type, the dates and a half day if you need one. The form shows the type’s rules (notice, documents, paid or unpaid) and counts the working days for you, skipping weekly offs and holidays.' },
  { element: '[data-tour="leave-my-requests"]', title: '3. Track your requests', description: 'Every request with its type, dates, days, status and who it is pending with. Edit or cancel while pending; changing an approved request sends a correction to your approver and the original dates stay until it is approved. Click a row for the full history.' },
  { tab: 'approvals', element: '[data-tour="leave-approvals"]', title: '4. Approve requests', description: 'For approvers: one card per pending request with the dates, days, type and reason. Corrections show the current and proposed dates side by side. Add a note and Approve or Reject; the employee’s balance updates straight away.' },
  { tab: 'calendar', element: '[data-tour="leave-calendar-nav"]', title: '5. Team calendar', description: 'Step month by month, or jump back to today, to see who is away and when, before you apply or approve.' },
  { element: '[data-tour="leave-calendar-legend"]', title: 'Filter by type', description: 'Click a leave type to show only that type; All types shows everything. The samples explain how pending requests and holidays are drawn.' },
  { element: '[data-tour="leave-calendar"]', title: 'Who is away', description: 'Each day lists the people on leave, coloured by leave type. Striped chips are still pending, and holidays and weekly offs are shaded.' },
  { tab: 'compoff', element: '[data-tour="compoff-detected"]', title: 'Next, comp off', description: 'Worked on a weekly off or a holiday? Attendance finds those days automatically after you punch out. Request credit to send it for approval, or dismiss it. Unclaimed credits expire.' },
  { element: '[data-tour="compoff-balance"]', title: 'Comp off balance', description: 'Approved credits land in your comp off leave balance. Use them like any other leave by applying with the comp off type.' },
  { element: '[data-tour="compoff-summary"]', title: 'Credit summary', description: 'How many of your credits are detected, pending, approved, rejected or expired.' },
  { element: '[data-tour="compoff-credits"]', title: 'My credits', description: 'Every credit with the worked date, why it was earned, the days credited, its status, expiry and who approved it.' },
  { element: '[data-tour="compoff-approvals"]', title: 'Approve comp off', description: 'Managers see the credits their reports requested. Add an optional note and Approve or Reject; approving adds the days to the employee’s balance.' },
  { element: '[data-tour="compoff-team"]', title: 'Team credits', description: 'Managers see their team’s credits and HR sees everyone’s. Filter by status to find what is pending or expiring.' },
  { element: '[data-tour="compoff-criteria"]', title: 'Detection rules', description: 'HR sees the rules in force: weekly offs, holidays, extra hours, how much work earns a full or half day, expiry and approval. Run detection now to scan attendance on demand.' },
  { tab: 'all', element: '[data-tour="leave-all-filters"]', title: 'HR: all requests', description: 'Every leave request in the company. Filter by status, employee and dates to answer “who was on leave last month?” quickly.' },
  { element: '[data-tour="leave-apply-behalf"]', title: 'Apply on behalf', description: 'HR can file leave for an employee, for example someone who is sick and cannot log in. It follows the same rules and balances.' },
  { element: '[data-tour="leave-all"]', title: 'Request list', description: 'Status, days and approval trail for each request. HR can edit or cancel requests here, and click a row for the history.' },
  { tab: 'balances', element: '[data-tour="leave-balances-toolbar"]', title: 'Balances', description: 'Pick a year and search for an employee.' },
  { element: '[data-tour="leave-balances-matrix"]', title: 'Balances matrix', description: 'Employees down the side, leave types across; each cell shows available and used days. Click a cell to change the allocation, carry forward or add an adjustment with a reason.' },
  { tab: 'types', element: '[data-tour="leave-type-add"]', title: 'Leave types', description: 'Add a leave type such as Casual, Sick or Comp off. Creating a type gives every active employee a balance for this year.' },
  { element: '[data-tour="leave-types"]', title: 'Type rules', description: 'Annual quota, paid or unpaid, carry forward and rules such as notice, documents and half days. Click a row to edit; the colour is used across the module.' },
  { tab: 'settings', element: '[data-tour="leave-settings"]', title: 'Leave settings', description: 'When the leave year starts, the longest single request, negative balances, the sandwich rule and whether managers can approve or only HR.' },
  { element: '[data-tour="leave-compoff-settings"]', title: 'Comp off rules', description: 'Switch comp off on or off, choose what earns it (weekly offs, holidays, extra hours), the minutes for a full or half day, the expiry and whether a manager must approve. Press Save at the top.' },
  { tab: 'me', title: 'What to do next', description: 'Approved leave shows on the Attendance roster and team calendar, and unpaid leave counts as loss of pay when Payroll is processed. Check your balance before you apply, and approvers should clear the Approvals tab regularly.' },
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
