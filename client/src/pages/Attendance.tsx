import React, { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, qs } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useCounts } from '../lib/notifications';
import { usePageTour } from '../lib/tour';
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

const TOUR = [
  { element: '[data-tour="att-punch"]', title: 'Punch in and out', description: 'Your live clock and today’s record. Punch in when you arrive and punch out when you leave; the buttons enable themselves based on where you are in the day.' },
  { element: '[data-tour="att-geo"]', title: 'Geofence status', description: 'We read your device location and show the nearest office and whether you are inside its geofence. If location is denied, HR can allow remote punching in Settings.' },
  { element: '[data-tour="att-missed"]', title: 'Missed punches', description: 'Days where a punch is missing. Each row shows the appeal deadline and a “Raise appeal” button; once the window closes only HR can raise it for you.' },
  { element: '[data-tour="att-history"]', title: 'Your last 30 days', description: 'Every record for the past month with the audit trail of any change. Use “Raise appeal” on a row if a punch was missed or wrong, and download your attendance as CSV or PDF.' },
  { element: '[data-tour="att-tabs"]', title: 'More views', description: 'Travel, monthly summary and appeals are for everyone. Managers get the daily roster, records and reports; HR also manages locations, shifts, holidays and settings.' },
  { element: '[data-tour="att-appeals"]', title: 'Appeals', description: 'Appeals go to your reporting manager (“Pending with …”) and HR. Approving applies the change, recomputes the day and keeps the previous values in the audit trail.' },
  { element: '[data-tour="att-report-builder"]', title: 'Reports', description: 'Build any attendance report: date presets, departments, employees, status, late/short/long days, geofence breaches, corrected records, grouping and columns. Export the same report as CSV or PDF.' },
  { element: '[data-tour="att-settings"]', title: 'Settings', description: 'Appeal deadline, edit-only-via-appeal, standard work day, geofencing and timing rules live here.' },
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
            <Button size="sm" variant="primary" onClick={() => onRaiseAppeal({ date: todayIso(), record: rows.find((r) => r.date === todayIso()) || null })} data-testid="appeal-new-me"><Icon name="plus" size={14} /> Raise appeal</Button>
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
