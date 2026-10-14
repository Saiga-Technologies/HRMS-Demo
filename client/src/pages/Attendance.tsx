import React, { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, qs } from '../lib/api';
import { useAuth } from '../lib/auth';
import { usePageTour } from '../lib/tour';
import { fmtDate, fmtMinutes, fmtTime, todayIso } from '../lib/format';
import { Button, Card, EmptyState, PageHeader, StatusBadge, Table, Tabs, useFetch } from '../components/ui';
import PunchWidget from '../components/attendance/PunchWidget';
import CorrectionModal from '../components/attendance/CorrectionModal';
import { DailyRoster, MonthlySummary, RecordsTab, FenceCells } from '../components/attendance/AttendanceRecords';
import { CorrectionsTab } from '../components/attendance/AttendanceCorrections';
import { AttendanceSettingsTab, HolidaysTab, LocationsTab, ShiftsTab } from '../components/attendance/AttendanceAdmin';
import { AttendanceRecord, DirectoryEmployee, daysAgoIso } from '../components/attendance/shared';

const TOUR = [
  { element: '[data-tour="att-punch"]', title: 'Punch in and out', description: 'Your live clock and today’s record. Punch in when you arrive and punch out when you leave; the buttons enable themselves based on where you are in the day.' },
  { element: '[data-tour="att-geo"]', title: 'Geofence status', description: 'We read your device location and show the nearest office and whether you are inside its geofence. If location is denied, HR can allow remote punching in Settings.' },
  { element: '[data-tour="att-breaks"]', title: 'Breaks', description: 'Start a break (lunch, personal, or regular) and end it when you are back. A running timer and a progress bar track your break time against the daily limit.' },
  { element: '[data-tour="att-summary"]', title: 'Today at a glance', description: 'Punch times, geofence badges, work time, late minutes and the list of breaks for today.' },
  { element: '[data-tour="att-history"]', title: 'Your last 30 days', description: 'Every record for the past month. Use “Request correction” on a row if a punch was missed or wrong.' },
  { element: '[data-tour="att-tabs"]', title: 'More views', description: 'Managers get the daily roster and records; HR also manages locations, shifts, holidays and settings. Everyone can see the monthly summary and their corrections.' },
  { element: '[data-tour="att-corrections"]', title: 'Corrections', description: 'Correction requests go to your manager or HR; once approved the attendance record is updated automatically.' },
  { element: '[data-tour="att-locations"]', title: 'Locations & geofences', description: 'Each office has coordinates and a radius. Punches are checked against the nearest office; use “Use my current location” to capture coordinates on site.' },
];

const TAB_KEYS = ['me', 'roster', 'records', 'summary', 'corrections', 'locations', 'shifts', 'holidays', 'settings'] as const;
type TabKey = (typeof TAB_KEYS)[number];

export default function Attendance() {
  usePageTour('Attendance', TOUR);
  const { isHr, isManager } = useAuth();
  const [params, setParams] = useSearchParams();
  const tabs = useMemo(
    () => [
      { key: 'me', label: 'My attendance', show: true },
      { key: 'roster', label: 'Daily roster', show: isManager },
      { key: 'records', label: 'Records', show: isManager },
      { key: 'summary', label: 'Monthly summary', show: true },
      { key: 'corrections', label: 'Corrections', show: true },
      { key: 'locations', label: 'Locations & geofences', show: isHr },
      { key: 'shifts', label: 'Shifts', show: isHr },
      { key: 'holidays', label: 'Holidays', show: true },
      { key: 'settings', label: 'Settings', show: isHr },
    ].filter((t) => t.show),
    [isHr, isManager],
  );
  const requested = params.get('tab') as TabKey | null;
  const tab: TabKey = requested && TAB_KEYS.includes(requested) && tabs.some((t) => t.key === requested) ? requested : 'me';
  const setTab = (k: string) => setParams(k === 'me' ? {} : { tab: k }, { replace: true });

  const employees = useFetch<DirectoryEmployee[]>(() => (isManager ? api.get('/api/employees/directory/all') : Promise.resolve([])), [isManager]);
  const [correction, setCorrection] = useState<{ date?: string; record?: AttendanceRecord | null } | null>(null);

  return (
    <>
      <PageHeader title="Attendance" subtitle="Punch in and out, track breaks, and review attendance across the team." />
      <Tabs tour="att-tabs" value={tab} onChange={setTab} tabs={tabs.map(({ key, label }) => ({ key, label }))} />

      {tab === 'me' ? <MyAttendance onRequestCorrection={(date, record) => setCorrection({ date, record })} /> : null}
      {tab === 'roster' ? <DailyRoster /> : null}
      {tab === 'records' ? <RecordsTab employees={employees.data || []} /> : null}
      {tab === 'summary' ? <MonthlySummary /> : null}
      {tab === 'corrections' ? <CorrectionsTab employees={employees.data || []} openRequest={correction} onRequestClosed={() => setCorrection(null)} /> : null}
      {tab === 'locations' ? <LocationsTab /> : null}
      {tab === 'shifts' ? <ShiftsTab /> : null}
      {tab === 'holidays' ? <HolidaysTab /> : null}
      {tab === 'settings' ? <AttendanceSettingsTab /> : null}

      {/* Correction modal opened from "My attendance" rows (the Corrections tab renders its own). */}
      {correction && tab !== 'corrections' ? (
        <CorrectionModal date={correction.date} record={correction.record} onClose={() => setCorrection(null)} onSaved={() => { setCorrection(null); setTab('corrections'); }} />
      ) : null}
    </>
  );
}

function MyAttendance({ onRequestCorrection }: { onRequestCorrection: (date: string, record: AttendanceRecord | null) => void }) {
  const { user } = useAuth();
  const eid = user?.employee_id;
  const from = daysAgoIso(30), to = todayIso();
  const history = useFetch<{ items: AttendanceRecord[] }>(() => (eid ? api.get(`/api/attendance/records${qs({ employee_id: eid, from, to, with_breaks: 1 })}`) : Promise.resolve({ items: [] })), [eid]);
  if (!eid) {
    return (
      <Card>
        <EmptyState icon="⏱" title="No employee record linked to your login" description="Punching and attendance history need an employee profile. Ask HR to link your user account to your employee record under Settings → Users." />
      </Card>
    );
  }
  const rows = history.data?.items || [];
  const stats = rows.reduce((s, r) => ({ days: s.days + (r.status === 'present' || r.status === 'half_day' || r.status === 'wfh' ? 1 : 0), work: s.work + r.work_minutes, late: s.late + (r.late_minutes > 0 ? 1 : 0) }), { days: 0, work: 0, late: 0 });
  return (
    <>
      <PunchWidget onRecordChange={() => history.reload()} />
      <Card
        padded={false}
        tour="att-history"
        title="My last 30 days"
        actions={<span className="row"><span className="muted">{stats.days} days worked · {fmtMinutes(stats.work)} · {stats.late} late</span><Button size="sm" variant="primary" onClick={() => onRequestCorrection(todayIso(), null)} data-testid="correction-new">Request correction</Button></span>}
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
            { key: 'actions', header: '', align: 'right', render: (r) => <Button size="sm" onClick={() => onRequestCorrection(r.date, r)} data-testid="row-request-correction">Request correction</Button> },
          ]}
        />
      </Card>
    </>
  );
}
