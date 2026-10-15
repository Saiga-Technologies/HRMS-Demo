import React, { useMemo, useState } from 'react';
import { api, qs } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { todayIso } from '../../lib/format';
import { Button, Card, Spinner, useFetch } from '../ui';
import { RequestDetailModal } from './RequestsTable';
import { Holiday, LeaveRequest, LeaveType, MONTHS } from './shared';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const pad = (n: number) => String(n).padStart(2, '0');

export function TeamCalendar({ types, weeklyOffs }: { types: LeaveType[]; weeklyOffs: number[] }) {
  const { company } = useAuth();
  const weekStart = Number(company.week_start ?? 0) % 7;
  const [cursor, setCursor] = useState(() => { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() }; });
  const from = `${cursor.y}-${pad(cursor.m + 1)}-01`;
  const lastDay = new Date(cursor.y, cursor.m + 1, 0).getDate();
  const to = `${cursor.y}-${pad(cursor.m + 1)}-${pad(lastDay)}`;
  const data = useFetch<{ from: string; to: string; items: LeaveRequest[]; holidays: Holiday[] }>(() => api.get(`/api/leave/calendar${qs({ from, to })}`), [from, to]);
  const [open, setOpen] = useState<number | null>(null);
  const [filterType, setFilterType] = useState('');

  const cells = useMemo(() => {
    const firstDow = new Date(cursor.y, cursor.m, 1).getDay();
    const lead = (firstDow - weekStart + 7) % 7;
    const out: (string | null)[] = Array.from({ length: lead }, () => null);
    for (let d = 1; d <= lastDay; d++) out.push(`${cursor.y}-${pad(cursor.m + 1)}-${pad(d)}`);
    while (out.length % 7) out.push(null);
    return out;
  }, [cursor, lastDay, weekStart]);
  const holidays = useMemo(() => new Map((data.data?.holidays || []).map((h) => [h.date, h])), [data.data]);
  const items = (data.data?.items || []).filter((i) => !filterType || String(i.leave_type_id) === filterType);
  const today = todayIso();
  const move = (delta: number) => setCursor(({ y, m }) => { const d = new Date(y, m + delta, 1); return { y: d.getFullYear(), m: d.getMonth() }; });

  return (
    <>
      <div className="toolbar" data-tour="leave-calendar-nav">
        <Button size="sm" onClick={() => move(-1)} aria-label="Previous month">‹</Button>
        <strong style={{ minWidth: 150, textAlign: 'center' }} data-testid="calendar-month">{MONTHS[cursor.m]} {cursor.y}</strong>
        <Button size="sm" onClick={() => move(1)} aria-label="Next month">›</Button>
        <Button size="sm" variant="ghost" onClick={() => { const d = new Date(); setCursor({ y: d.getFullYear(), m: d.getMonth() }); }}>Today</Button>
        <div className="chip-list calendar-legend" data-tour="leave-calendar-legend" style={{ marginLeft: 'auto' }}>
          <button type="button" className={`chip ${!filterType ? 'active' : ''}`} onClick={() => setFilterType('')}>All types</button>
          {types.filter((t) => t.active).map((t) => (
            <button key={t.id} type="button" className={`chip ${filterType === String(t.id) ? 'active' : ''}`} onClick={() => setFilterType(filterType === String(t.id) ? '' : String(t.id))}>
              <span className="color-swatch" style={{ background: t.color, marginRight: 0 }} /> {t.name}
            </button>
          ))}
          <span className="chip"><span className="leave-chip pending legend-sample" style={{ borderColor: '#64748b', color: '#64748b', margin: 0 }}>pending</span></span>
          <span className="chip"><span className="color-swatch holiday-swatch" style={{ marginRight: 0 }} /> holiday</span>
        </div>
      </div>
      <Card padded={false} tour="leave-calendar">
        <div className="card-body">
          {data.loading && !data.data ? <Spinner /> : null}
          <div className="calendar-grid calendar-head">
            {Array.from({ length: 7 }, (_, i) => DAY_NAMES[(weekStart + i) % 7]).map((d) => <div key={d} className="calendar-dow">{d}</div>)}
          </div>
          <div className="calendar-grid">
            {cells.map((date, i) => {
              if (!date) return <div key={`b${i}`} className="calendar-cell blank" />;
              const dow = new Date(date + 'T00:00:00').getDay();
              const off = weeklyOffs.includes(dow);
              const hol = holidays.get(date);
              const dayItems = items.filter((it) => it.start_date <= date && it.end_date >= date);
              return (
                <div key={date} className={`calendar-cell ${off ? 'off' : ''} ${hol ? 'holiday' : ''} ${date === today ? 'today' : ''}`} data-date={date}>
                  <div className="row between"><span className="d">{Number(date.slice(8))}</span>{dayItems.length ? <span className="muted">{dayItems.length}</span> : null}</div>
                  {hol ? <span className="leave-chip holiday-chip" title={hol.name}>{hol.optional ? '(opt) ' : ''}{hol.name}</span> : null}
                  {dayItems.slice(0, 4).map((it) => {
                    const pending = it.status !== 'approved';
                    const first = it.employee_name.split(' ')[0];
                    const style = pending
                      ? { background: `repeating-linear-gradient(45deg, ${it.color}33 0 4px, transparent 4px 8px)`, color: it.color, border: `1px dashed ${it.color}` }
                      : { background: it.color };
                    return (
                      <button key={it.id} type="button" className={`leave-chip ${pending ? 'pending' : ''}`} style={style} title={`${it.employee_name} · ${it.leave_type_name} (${it.status.replace(/_/g, ' ')})${it.half_day ? ' · half day' : ''}`} onClick={() => setOpen(it.id)}>
                        {first} · {it.leave_type_code}{it.half_day ? ' ½' : ''}
                      </button>
                    );
                  })}
                  {dayItems.length > 4 ? <span className="muted" style={{ fontSize: 11 }}>+{dayItems.length - 4} more</span> : null}
                </div>
              );
            })}
          </div>
        </div>
      </Card>
      {open ? <RequestDetailModal id={open} onClose={() => setOpen(null)} /> : null}
    </>
  );
}
