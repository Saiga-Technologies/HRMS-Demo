import React from 'react';
import { fmtDateTime, fmtMinutes, fmtTime, label } from '../../lib/format';
import { Icon } from '../Icons';
import { AttendanceRecord, PreviousValues } from './shared';

/** "Punch out 17:10 → 18:30" style diff between the snapshot taken before an appeal was applied and the record now. */
export function recordChanges(prev: PreviousValues | null | undefined, rec: Partial<AttendanceRecord>): { field: string; from: string; to: string }[] {
  if (!prev) return [];
  const out: { field: string; from: string; to: string }[] = [];
  const cmp = (field: string, a: any, b: any, fmt: (v: any) => string) => { if ((a ?? null) !== (b ?? null)) out.push({ field, from: a === null || a === undefined ? '—' : fmt(a), to: b === null || b === undefined ? '—' : fmt(b) }); };
  cmp('Punch in', prev.punch_in_at, rec.punch_in_at, fmtTime);
  cmp('Punch out', prev.punch_out_at, rec.punch_out_at, fmtTime);
  cmp('Status', prev.status, rec.status, label);
  cmp('Work', prev.work_minutes, rec.work_minutes, fmtMinutes);
  return out;
}

/**
 * Audit trail for a corrected attendance record: who changed it, when, through which appeal, approved by whom,
 * and what changed. Renders nothing for untouched records.
 */
export function AuditTrail({ record, compact }: { record: AttendanceRecord | null | undefined; compact?: boolean }) {
  if (!record || (!record.corrected_at && !record.correction)) return null;
  const c = record.correction;
  const changes = c ? recordChanges(c.previous_values, record) : [];
  const who = record.corrected_by_name || c?.reviewer_name || 'HR';
  const when = fmtDateTime(record.corrected_at || c?.reviewed_at);
  const changeText = changes.length ? changes.map((x) => `${x.field} ${x.from} → ${x.to}`).join(' · ') : c && !c.previous_values ? 'Record created' : null;
  if (compact) {
    return (
      <span className="audit-trail audit-compact" title={c ? `Appeal #${c.id}: ${c.reason}` : 'Edited directly by HR'}>
        <Icon name="edit" size={12} />
        <span><span className="who">{who}</span> · {when}{c ? ` · appeal #${c.id}` : ' · direct edit'}</span>
        {changeText ? <span className="audit-change">{changeText}</span> : null}
      </span>
    );
  }
  return (
    <div className="audit-trail" data-testid="audit-trail">
      <span>
        <Icon name="edit" size={13} /> Changed by <span className="who">{who}</span> on {when}
        {c ? <> via appeal <strong>#{c.id}</strong>{c.reviewer_name ? <> approved by <span className="who">{c.reviewer_name}</span></> : null}</> : <> (direct edit by HR)</>}
      </span>
      {changeText ? <span className="audit-change">{changeText}</span> : null}
      {c ? <span className="muted">Raised by {c.requested_by_name || 'employee'} · {label(c.kind)} · “{c.reason}”{c.review_note ? ` · note: “${c.review_note}”` : ''}</span> : null}
    </div>
  );
}
