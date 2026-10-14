import React from 'react';
import { api } from '../../lib/api';
import { fmtDate, fmtTime } from '../../lib/format';
import { Icon } from '../Icons';
import { Badge, Button, Card, Spinner, useFetch } from '../ui';
import { KindBadge } from './AttendanceCorrections';
import { AppealKind, MissedPunch } from './shared';

/** "You missed a punch on Tue, raise an appeal before Fri" panel for the signed-in employee. */
export default function MissedPunches({ onRaise, refreshKey }: { onRaise: (m: { date: string; kind: AppealKind; record_id: number | null }) => void; refreshKey?: any }) {
  const data = useFetch<{ today: string; deadline_days: number; items: MissedPunch[] }>(() => api.get('/api/attendance/me/missed'), [refreshKey]);
  const items = data.data?.items || [];
  const open = items.filter((m) => m.can_appeal).length;
  return (
    <Card tour="att-missed" title={<span className="row"><Icon name="alert" size={16} /> Missed punches {items.length ? <Badge tone={open ? 'warning' : 'neutral'}>{items.length}</Badge> : null}</span>} actions={data.data ? <span className="muted">Last {data.data.deadline_days + 7} days · {data.data.deadline_days}-day appeal window</span> : null}>
      {data.loading && !data.data ? <Spinner /> : items.length === 0 ? (
        <p className="muted" data-testid="missed-none">No missed punches in the last {(data.data?.deadline_days ?? 3) + 7} days. Nice.</p>
      ) : (
        <ul className="missed-list" data-testid="missed-list">
          {items.map((m) => (
            <li key={m.date} className={`missed-item ${m.deadline_passed ? 'passed' : ''}`} data-testid="missed-item">
              <div className="missed-main">
                <strong>{fmtDate(m.date, { weekday: 'short', day: '2-digit', month: 'short' })}</strong>
                <KindBadge kind={m.kind} />
                <span className="muted">{m.punch_in_at ? `in ${fmtTime(m.punch_in_at)}` : 'no punch in'}{m.punch_out_at ? ` · out ${fmtTime(m.punch_out_at)}` : ' · no punch out'}</span>
              </div>
              <div className="missed-deadline">
                {m.appeal_id ? (
                  <Badge tone={m.appeal_status === 'approved' ? 'success' : 'info'}>Appeal #{m.appeal_id} {m.appeal_status}</Badge>
                ) : m.deadline_passed ? (
                  <span className="deadline-passed"><Icon name="lock" size={13} /> Appeal window closed on {fmtDate(m.deadline_date, { weekday: 'short', day: '2-digit', month: 'short' })}</span>
                ) : (
                  <span className="deadline-open"><Icon name="clock" size={13} /> Raise an appeal before {fmtDate(m.deadline_date, { weekday: 'short', day: '2-digit', month: 'short' })} · {m.days_left === 0 ? 'last day today' : `${m.days_left} day${m.days_left === 1 ? '' : 's'} left`}</span>
                )}
              </div>
              <Button size="sm" variant={m.can_appeal ? 'primary' : 'secondary'} disabled={!m.can_appeal} title={m.appeal_id ? `Appeal #${m.appeal_id} already ${m.appeal_status}` : m.deadline_passed ? 'Deadline passed – ask HR to raise it on your behalf' : undefined} onClick={() => onRaise({ date: m.date, kind: m.kind, record_id: m.record_id })} data-testid="missed-raise-appeal">
                {m.appeal_id ? 'Appeal raised' : m.deadline_passed ? 'Closed' : 'Raise appeal'}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
