import React, { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, qs } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useCounts } from '../lib/notifications';
import { usePageTour, type TourStep } from '../lib/tour';
import { fmtDate, fmtMinutes, fmtTime, monthIso, todayIso } from '../lib/format';
import { Icon } from '../components/Icons';
import { Button, Card, EmptyState, Input, PageHeader, StatusBadge, Table, Tabs, downloadUrl, useFetch, useToast } from '../components/ui';
import PunchWidget from '../components/attendance/PunchWidget';
import AppealModal, { AppealPrefill } from '../components/attendance/CorrectionModal';
import MissedPunches from '../components/attendance/MissedPunches';
import { AuditTrail } from '../components/attendance/AuditTrail';
import { DailyRoster, MonthlySummary, RecordsTab, FenceCells, RaiseAppeal } from '../components/attendance/AttendanceRecords';
import { AppealsTab } from '../components/attendance/AttendanceCorrections';
import { ReportsTab } from '../components/attendance/ReportsTab';
import { AttendanceSettingsTab, HolidaysTab, LocationsTab, ShiftsTab } from '../components/attendance/AttendanceAdmin';
import TravelTab from '../components/attendance/TravelTab';
import { AttendanceRecord, DirectoryEmployee, daysAgoIso } from '../components/attendance/shared';

const TOUR: TourStep[] = [
  { title: 'Attendance, step by step', description: 'This page follows a working day and then the review loops. You will go through: 1) punch in, breaks and punch out, 2) your history and missed punches, 3) travel, 4) appeals and their approval, 5) the team views and reports managers use, and 6) the locations, shifts, holidays and rules HR sets up.' },
  // ---- The working day
  { tab: 'me', element: '[data-tour="att-tabs"]', title: 'Attendance areas', description: 'Each tab is one part of the module. Everyone gets My attendance, Travel, Monthly summary, Appeals, Reports and Holidays; managers also see Daily roster and Records; HR also sees Locations, Shifts and Settings. Red badges count appeals waiting.' },
  { element: '[data-tour="att-punch"]', title: 'Today', description: 'Your day at a glance: a live clock, today’s date and your shift timings. The badge on the right shows where you are in the day: not punched in, working, on a break or day complete.' },
  { element: '[data-tour="att-geo"]', title: 'Where you are', description: 'Your device location is read and compared with the office geofences. Green means you are inside an office radius, amber means outside. If HR requires the geofence, punching outside it is refused; use the refresh button after you move.' },
  { element: '[data-tour="att-punch-actions"]', title: 'Punch in and out', description: 'Start the day with Punch in and end it with Punch out. Each punch stores the time and your location, and only the button that makes sense right now is enabled.' },
  { element: '[data-tour="att-breaks"]', title: 'Breaks', description: 'Pick a break type and press Start break; press End break when you are back. Breaks are subtracted from your work time and the timer keeps running on the button.' },
  { element: '[data-tour="att-summary"]', title: 'Today’s numbers', description: 'Punch times with their geofence result, work time so far, any late mark and the break bar against the daily allowance. The bar turns red if you go over the limit, and overtime is flagged once you pass it.' },
  { element: '[data-tour="att-missed"]', title: 'Missed punches', description: 'Days in the last couple of weeks with a missing punch in or out. Each one shows the appeal deadline and how many days are left; Raise appeal opens a pre-filled appeal. Once the window closes, only HR can raise it for you.' },
  { element: '[data-tour="att-history"]', title: 'Your last 30 days', description: 'Every day with status, punches, work and break time, late minutes and the geofence result. The Changes column shows who changed a record and when, after an approved appeal.' },
  { element: '[data-tour="att-export"]', title: 'Download your attendance', description: 'Pick a month and download your own attendance as CSV or PDF, for example to share with your manager or keep for your records.' },
  { element: '[data-tour="att-appeal-me"]', title: 'Raise an appeal', description: 'Something wrong with a day? Raise an appeal: choose the kind (missed punch, time correction or status change), give the right times and a reason. It goes to your reporting manager and you can follow it in the Appeals tab.' },
  // ---- Travel
  { tab: 'travel', element: '[data-tour="travel-start"]', title: 'Next, field travel', description: 'Going to a client or site? Start travel, enter the destination and purpose, and your device location is sampled along the way. HR can switch travel tracking off, in which case only past trips are listed.' },
  { element: '[data-tour="travel-active"]', title: 'Trip in progress', description: 'While a trip runs you see the elapsed time, distance so far and the last GPS fix. Stop travel to record the final distance, or Cancel to discard the trip.' },
  { element: '[data-tour="travel-trips"]', title: 'My trips', description: 'Your trips for the chosen month with duration, distance and status, plus month totals. Export CSV to attach them to a travel claim.' },
  { element: '[data-tour="travel-team-trips"]', title: 'Team travel', description: 'Managers and HR see the trips of everyone in their scope. Filter by employee and export the list as CSV.' },
  { element: '[data-tour="travel-distance"]', title: 'Distance per employee', description: 'Kilometres travelled per person this month. Click a bar to filter the team list to that employee.' },
  // ---- Appeals
  { tab: 'appeals', element: '[data-tour="att-appeal-filters"]', title: 'Next, appeals', description: 'Every appeal lives here: yours, and for managers those of their team. Filter by status (pending first), by kind, and managers can pick one employee.' },
  { element: '[data-tour="att-appeal-new"]', title: 'New appeal', description: 'Raise an appeal for any date within the appeal window. HR can raise one on behalf of an employee and override the deadline when needed.' },
  { element: '[data-tour="att-appeals"]', title: 'Track and approve', description: 'Each row shows the date and its deadline, the requested change, the reason and who it is pending with. Managers press Review to compare the current and requested record side by side and Approve or Reject with a note; approving updates the day and keeps the old values in the audit trail.' },
  // ---- Monthly summary
  { tab: 'summary', element: '[data-tour="att-summary-month"]', title: 'Monthly summary', description: 'Pick a month to see how many working days it has. Employees see their own line; managers and HR see their team.' },
  { element: '[data-tour="att-summary-table"]', title: 'Month at a glance', description: 'Present, half days, leave, absences, late marks, appeals applied and work, break and overtime hours per person. These totals are what payroll and reviews rely on.' },
  // ---- Manager: team views
  { tab: 'roster', element: '[data-tour="att-roster-date"]', title: 'Daily roster', description: 'For managers: who is in today. Step day by day or pick a date; holidays and weekly offs are labelled.' },
  { element: '[data-tour="att-roster-counts"]', title: 'Status counts', description: 'How many people are present, late, on leave, absent and so on. Click a chip to show only those people, click again to clear.' },
  { element: '[data-tour="att-roster"]', title: 'Everyone’s day', description: 'One row per employee with status, punches, work, breaks, late minutes and geofence result. HR can raise an appeal for a person straight from the row (or edit directly when edit-only-via-appeal is off).' },
  { tab: 'records', element: '[data-tour="att-records-filters"]', title: 'Records', description: 'Search all attendance records by employee, date range, status and department, or show only records changed by appeal. Totals for the filtered set are on the right.' },
  { element: '[data-tour="att-records"]', title: 'Record details', description: 'Click a record to see its breaks and full audit trail. From there HR raises an appeal, or edits punches directly if Settings allow it.' },
  // ---- Reports
  { tab: 'reports', element: '[data-tour="att-report-presets"]', title: 'Next, reports', description: 'One-click presets for the questions asked most: late comers this month, days under 9 hours, punches outside the geofence and corrected records. Reset clears everything.' },
  { element: '[data-tour="att-report-builder"]', title: 'Report builder', description: 'Choose a date range, departments, employees, statuses, thresholds, grouping and columns, then Run report. Export CSV or PDF downloads exactly the report you built. Employees can report on their own attendance.' },
  { element: '[data-tour="att-report-summary"]', title: 'Report summary', description: 'After a run: employees and days covered, present, absent, late, average work per day, overtime, geofence breaches and corrected records.' },
  { element: '[data-tour="att-report-table"]', title: 'Report rows', description: 'The rows behind the summary, with the columns you picked. The late comers report ranks people by how often and how late they were.' },
  // ---- HR set-up
  { tab: 'locations', element: '[data-tour="att-location-add"]', title: 'Next, HR set-up: locations', description: 'Add each office with its coordinates and a radius in metres. You can use your current location when you are on site.' },
  { element: '[data-tour="att-locations"]', title: 'Office geofences', description: 'Active locations are the geofences checked at every punch. Click a row to edit it; switch a location off instead of deleting it to keep history readable.' },
  { tab: 'shifts', element: '[data-tour="att-shift-add"]', title: 'Shifts', description: 'Create shifts with start and end times, a grace period, allowed break and the minutes needed for a half and a full day.' },
  { element: '[data-tour="att-shifts"]', title: 'Shift list', description: 'Shifts drive late marks, half/full-day status and working days (the dots). Assign a shift on the employee profile or week by week in the Shift roster.' },
  { tab: 'holidays', element: '[data-tour="att-holiday-year"]', title: 'Holidays', description: 'Everyone can see the holiday list for a year. Optional holidays still count as working days for leave.' },
  { element: '[data-tour="att-holiday-add"]', title: 'Add a holiday', description: 'HR adds public or optional holidays here. Holidays are skipped when leave days are counted, marked on the roster, and work done on them can earn comp off.' },
  { element: '[data-tour="att-holidays"]', title: 'Holiday list', description: 'All holidays for the selected year with their type. HR can delete a holiday that was added by mistake.' },
  { tab: 'settings', element: '[data-tour="att-settings"]', title: 'Attendance rules', description: 'HR sets the rules everything above follows: geofence required or remote punch allowed, break limit, auto punch-out, late, half-day and overtime thresholds, the standard work day, the appeal deadline, edit-only-via-appeal and weekly offs. Press Save to apply them.' },
  { tab: 'me', title: 'What to do next', description: 'The loop: punch every day, fix missed punches with an appeal before the deadline, and managers approve them. Approved leave shows up here automatically, the Shift roster plans who works when, and the monthly totals feed Payroll.' },
];

const TAB_KEYS = ['me', 'travel', 'roster', 'records', 'summary', 'appeals', 'reports', 'locations', 'shifts', 'holidays', 'settings'] as const;
type TabKey = (typeof TAB_KEYS)[number];

export default function Attendance() {
  usePageTour('Attendance', TOUR);
  const { isHr, isManager, user } = useAuth();
  const { counts } = useCounts();
  const [params, setParams] = useSearchParams();
  const hasEmployee = !!user?.employee_id;
  const tabs = useMemo(
    () => [
      { key: 'me', label: 'My attendance', icon: 'clock', show: true },
      { key: 'travel', label: 'Travel', icon: 'route', show: hasEmployee },
      { key: 'roster', label: 'Daily roster', icon: 'users', show: isManager },
      { key: 'records', label: 'Records', icon: 'grid', show: isManager },
      { key: 'summary', label: 'Monthly summary', icon: 'calendar', show: true },
      { key: 'appeals', label: 'Appeals', icon: 'check', show: true, badge: isManager ? counts.attendance_appeals : counts.my_appeals_pending },
      { key: 'reports', label: 'Reports', icon: 'file', show: true },
      { key: 'locations', label: 'Locations & geofences', icon: 'mapPin', show: isHr },
      { key: 'shifts', label: 'Shifts', icon: 'sun', show: isHr },
      { key: 'holidays', label: 'Holidays', icon: 'star', show: true },
      { key: 'settings', label: 'Settings', icon: 'settings', show: isHr },
    ].filter((t) => t.show),
    [isHr, isManager, hasEmployee, counts.attendance_appeals, counts.my_appeals_pending],
  );
  const ALIASES: Record<string, string> = { corrections: 'appeals', daily: 'roster', report: 'reports', monthly: 'summary' };
  const rawTab = params.get('tab');
  const requested = (rawTab && ALIASES[rawTab] ? ALIASES[rawTab] : rawTab) as TabKey | null;
  const tab: TabKey = requested && TAB_KEYS.includes(requested) && tabs.some((t) => t.key === requested) ? requested : 'me';
  const setTab = (k: string) => setParams(k === 'me' ? {} : { tab: k }, { replace: true });

  const employees = useFetch<DirectoryEmployee[]>(() => (isManager ? api.get('/api/employees/directory/all') : Promise.resolve([])), [isManager]);
  const [appeal, setAppeal] = useState<AppealPrefill | null>(null);
  const [version, setVersion] = useState(0);
  const raise: RaiseAppeal = ({ employee_id, date, record }) => setAppeal({ employee_id, date, record: record ?? null });

  return (
    <>
      <PageHeader title="Attendance" subtitle="Punch in and out, track breaks, appeal missed punches, and report on attendance across the team." />
      <Tabs tour="att-tabs" value={tab} onChange={setTab} tabs={tabs.map(({ key, label, icon, badge }) => ({ key, label, icon, badge }))} />

      {tab === 'me' ? <MyAttendance version={version} onRaiseAppeal={(p) => setAppeal(p)} /> : null}
      {tab === 'travel' ? <TravelTab /> : null}
      {tab === 'roster' ? <DailyRoster onRaiseAppeal={raise} /> : null}
      {tab === 'records' ? <RecordsTab employees={employees.data || []} onRaiseAppeal={raise} /> : null}
      {tab === 'summary' ? <MonthlySummary /> : null}
      {tab === 'appeals' ? <AppealsTab employees={employees.data || []} openRequest={appeal} onRequestClosed={() => setAppeal(null)} /> : null}
      {tab === 'reports' ? <ReportsTab employees={employees.data || []} /> : null}
      {tab === 'locations' ? <LocationsTab /> : null}
      {tab === 'shifts' ? <ShiftsTab /> : null}
      {tab === 'holidays' ? <HolidaysTab /> : null}
      {tab === 'settings' ? <AttendanceSettingsTab /> : null}

      {/* Appeal modal opened from other tabs (the Appeals tab renders its own). */}
      {appeal && tab !== 'appeals' ? (
        <AppealModal {...appeal} employees={employees.data || []} onClose={() => setAppeal(null)} onSaved={() => { setAppeal(null); setVersion((v) => v + 1); setTab('appeals'); }} />
      ) : null}
    </>
  );
}

function MyAttendance({ version, onRaiseAppeal }: { version: number; onRaiseAppeal: (p: AppealPrefill) => void }) {
  const { user } = useAuth();
  const toast = useToast();
  const eid = user?.employee_id;
  const from = daysAgoIso(30), to = todayIso();
  const history = useFetch<{ items: AttendanceRecord[] }>(() => (eid ? api.get(`/api/attendance/records${qs({ employee_id: eid, from, to, with_breaks: 1 })}`) : Promise.resolve({ items: [] })), [eid, version]);
  const [month, setMonth] = useState(monthIso());
  const [busy, setBusy] = useState<string | null>(null);
  if (!eid) {
    return (
      <Card>
        <EmptyState icon="⏱" title="No employee record linked to your login" description="Punching and attendance history need an employee profile. Ask HR to link your user account to your employee record under Settings → Users." />
      </Card>
    );
  }
  const exportMine = async (format: 'csv' | 'pdf') => {
    const [y, m] = month.split('-').map(Number);
    const first = `${month}-01`, last = `${month}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`;
    setBusy(format);
    try {
      await downloadUrl(`/api/reports/attendance/employee/${eid}${qs({ from: first, to: last, format })}`, `attendance_${user?.employee_code || eid}_${first}_to_${last}.${format}`);
      toast.success(`Your attendance for ${fmtDate(first, { month: 'long', year: 'numeric' })} was downloaded`);
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(null);
    }
  };
  const rows = history.data?.items || [];
  const stats = rows.reduce((s, r) => ({ days: s.days + (r.status === 'present' || r.status === 'half_day' || r.status === 'wfh' ? 1 : 0), work: s.work + r.work_minutes, late: s.late + (r.late_minutes > 0 ? 1 : 0) }), { days: 0, work: 0, late: 0 });
  return (
    <>
      <PunchWidget onRecordChange={() => history.reload()} />
      <MissedPunches refreshKey={version} onRaise={(m) => onRaiseAppeal({ date: m.date, kind: m.kind, record: rows.find((r) => r.date === m.date) || null })} />
      <Card
        padded={false}
        tour="att-history"
        title="My last 30 days"
        actions={
          <span className="row">
            <span className="muted">{stats.days} days worked · {fmtMinutes(stats.work)} · {stats.late} late</span>
            <span className="export-row" data-tour="att-export">
              <Input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} aria-label="Month to download" data-testid="my-export-month" style={{ width: 'auto' }} />
              <Button size="sm" loading={busy === 'csv'} onClick={() => exportMine('csv')} data-testid="my-export-csv"><Icon name="download" size={14} /> CSV</Button>
              <Button size="sm" loading={busy === 'pdf'} onClick={() => exportMine('pdf')} data-testid="my-export-pdf"><Icon name="file" size={14} /> PDF</Button>
            </span>
            <Button size="sm" variant="primary" onClick={() => onRaiseAppeal({ date: todayIso(), record: rows.find((r) => r.date === todayIso()) || null })} data-testid="appeal-new-me" data-tour="att-appeal-me"><Icon name="plus" size={14} /> Raise appeal</Button>
          </span>
        }
      >
        <Table<AttendanceRecord>
          loading={history.loading}
          rows={rows}
          empty="No attendance in the last 30 days."
          columns={[
            { key: 'date', header: 'Date', render: (r) => fmtDate(r.date, { weekday: 'short', day: '2-digit', month: 'short' }) },
            { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
            { key: 'in', header: 'In', render: (r) => fmtTime(r.punch_in_at) },
            { key: 'out', header: 'Out', render: (r) => fmtTime(r.punch_out_at) },
            { key: 'work_minutes', header: 'Work', align: 'right', render: (r) => fmtMinutes(r.work_minutes) },
            { key: 'break_minutes', header: 'Break', align: 'right', render: (r) => <span>{fmtMinutes(r.break_minutes)}{r.breaks?.length ? <span className="muted"> ({r.breaks.length})</span> : null}</span> },
            { key: 'late_minutes', header: 'Late', align: 'right', render: (r) => (r.late_minutes ? <span className="late">{fmtMinutes(r.late_minutes)}</span> : '—') },
            { key: 'fence', header: 'Geofence', render: (r) => <FenceCells rec={r} /> },
            { key: 'audit', header: 'Changes', render: (r) => (r.corrected_at || r.correction ? <AuditTrail record={r} compact /> : <span className="muted">—</span>) },
            { key: 'actions', header: '', align: 'right', render: (r) => <Button size="sm" onClick={() => onRaiseAppeal({ date: r.date, record: r })} data-testid="row-raise-appeal">Raise appeal</Button> },
          ]}
        />
      </Card>
    </>
  );
}
