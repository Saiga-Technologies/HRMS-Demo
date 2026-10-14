import React from 'react';
import { Icon } from '../Icons';
import { Spinner } from '../ui';
import { RosterDay, RosterEmployee, RosterResponse, Shift, dayHead, shiftColor, shiftTimes } from './shared';

const chipBase: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 1, padding: '4px 8px', borderRadius: 6, fontSize: 12, lineHeight: 1.3, border: '1px solid var(--border)', textAlign: 'left', minHeight: 38, justifyContent: 'center', overflow: 'hidden' };

/** One roster cell: the effective shift, a day off, a weekly off / holiday, or nothing. */
export function ShiftChip({ day, shifts }: { day: RosterDay; shifts: Shift[] }) {
  const shift = day.shift_id ? shifts.find((s) => s.id === day.shift_id) : undefined;
  const leave = day.on_leave ? <span className="badge badge-warning" style={{ fontSize: 10.5, padding: '0 6px', alignSelf: 'flex-start' }}>On leave</span> : null;
  if (day.day_off) {
    return (
      <span style={{ ...chipBase, borderStyle: 'dashed', color: 'var(--muted)', background: 'var(--surface-2)' }} data-kind="day-off">
        <strong style={{ fontWeight: 600 }}>Day off</strong>
        {day.note ? <span style={{ fontSize: 11 }} title={day.note}>{day.note}</span> : null}
        {leave}
      </span>
    );
  }
  if (!day.scheduled) {
    const text = day.holiday ? day.holiday : day.weekly_off ? 'Weekly off' : 'Not scheduled';
    return (
      <span style={{ ...chipBase, borderColor: 'transparent', color: 'var(--muted)', background: day.holiday ? 'var(--warning-bg)' : 'transparent' }} data-kind={day.holiday ? 'holiday' : 'off'} title={day.holiday ? `Holiday: ${day.holiday}` : text}>
        <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{text}</span>
        {leave}
      </span>
    );
  }
  const color = shiftColor(shifts, day.shift_id);
  const explicit = day.source === 'assignment';
  const style: React.CSSProperties = explicit
    ? { ...chipBase, borderColor: color, borderLeft: `4px solid ${color}`, background: `color-mix(in srgb, ${color} 14%, var(--surface))`, color: 'var(--text)' }
    : { ...chipBase, borderLeft: `4px solid color-mix(in srgb, ${color} 45%, transparent)`, background: 'transparent', color: 'var(--text-2)' };
  return (
    <span style={style} data-kind={explicit ? 'assigned' : 'default'} title={`${day.shift_name}${explicit ? '' : ' (default shift)'}${day.note ? ` · ${day.note}` : ''}`}>
      <strong style={{ fontWeight: explicit ? 600 : 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{day.shift_name}</strong>
      <span style={{ fontSize: 11, color: 'var(--muted)', display: 'flex', gap: 4, alignItems: 'center' }}>
        {shiftTimes(shift)}{!explicit ? ' · default' : ''}
        {day.note ? <Icon name="edit" size={11} /> : null}
      </span>
      {leave}
    </span>
  );
}

export function RosterLegend({ shifts }: { shifts: Shift[] }) {
  return (
    <div className="chip-list" data-tour="roster-legend" data-testid="roster-legend">
      {shifts.filter((s) => s.active).map((s) => (
        <span key={s.id} className="chip"><span className="color-swatch" style={{ background: shiftColor(shifts, s.id), marginRight: 0 }} />{s.name}</span>
      ))}
      <span className="chip chip-muted"><span className="color-swatch" style={{ background: 'transparent', border: '1px dashed var(--muted)', marginRight: 0 }} />Day off</span>
      <span className="chip chip-muted">Faded = default shift</span>
    </div>
  );
}

export function RosterGrid({ data, loading, today, canEdit, onCellClick, highlightId }: {
  data: RosterResponse | null; loading: boolean; today: string;
  canEdit: (e: RosterEmployee) => boolean; onCellClick: (e: RosterEmployee, day: RosterDay) => void; highlightId?: number | null;
}) {
  if (!data) return loading ? <Spinner /> : null;
  return (
    <div className="table-wrap" data-tour="roster-grid" data-testid="roster-grid" style={{ opacity: loading ? 0.6 : 1 }}>
      <table className="table dense" style={{ minWidth: 980, tableLayout: 'fixed' }}>
        <colgroup>
          <col style={{ width: 190 }} />
          {data.days.map((d) => <col key={d.date} />)}
          <col style={{ width: 70 }} />
        </colgroup>
        <thead>
          <tr>
            <th style={{ position: 'sticky', left: 0, zIndex: 1 }}>Employee</th>
            {data.days.map((d) => {
              const h = dayHead(d.date);
              return (
                <th key={d.date} style={{ textAlign: 'center', color: d.date === today ? 'var(--brand)' : undefined }} title={d.holiday ? `Holiday: ${d.holiday}` : undefined}>
                  <div>{h.dow}</div>
                  <div style={{ fontWeight: 500, textTransform: 'none', letterSpacing: 0 }}>{h.day}{d.holiday ? ' ·H' : ''}</div>
                </th>
              );
            })}
            <th style={{ textAlign: 'right' }}>Hours</th>
          </tr>
        </thead>
        <tbody>
          {data.employees.length === 0 ? (
            <tr><td colSpan={data.days.length + 2} className="table-empty">No employees match these filters.</td></tr>
          ) : data.employees.map((e) => {
            const editable = canEdit(e);
            const mine = highlightId === e.id;
            return (
              <tr key={e.id} data-testid={`roster-row-${e.employee_code}`}>
                <td style={{ position: 'sticky', left: 0, background: mine ? 'color-mix(in srgb, var(--brand) 8%, var(--surface))' : 'var(--surface)', zIndex: 1 }}>
                  <div style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.first_name} {e.last_name}{mine ? <span className="muted" style={{ fontWeight: 400 }}> (you)</span> : null}</div>
                  <div className="muted" style={{ fontSize: 11.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.employee_code}{e.department_name ? ` · ${e.department_name}` : ''}</div>
                </td>
                {e.days.map((d, i) => (
                  <td key={d.date} style={{ padding: 4, background: d.date === today ? 'color-mix(in srgb, var(--brand) 5%, transparent)' : undefined }}>
                    {editable ? (
                      <button type="button" data-testid={`roster-cell-${i}`} data-date={d.date} onClick={() => onCellClick(e, d)}
                        aria-label={`Assign shift for ${e.first_name} ${e.last_name} on ${d.date}`}
                        style={{ display: 'block', width: '100%', padding: 0, border: 0, background: 'none', cursor: 'pointer', font: 'inherit', color: 'inherit', borderRadius: 6 }}>
                        <ShiftChip day={d} shifts={data.shifts} />
                      </button>
                    ) : (
                      <div data-testid={`roster-cell-${i}`} data-date={d.date}><ShiftChip day={d} shifts={data.shifts} /></div>
                    )}
                  </td>
                ))}
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }} title={`${e.scheduled_days} scheduled day(s)`}>{e.scheduled_hours}h</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
