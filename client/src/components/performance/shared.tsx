import React from 'react';
import { Badge, Field, Input, Select, Button } from '../ui';
import { Icon } from '../Icons';

export interface Competency { key: string; label: string; description?: string; weight: number }
export interface Goal { title: string; weight: number; progress: number; status: 'on_track' | 'at_risk' | 'done'; notes?: string }
export type ReviewStatus = 'pending_self' | 'pending_manager' | 'completed' | 'acknowledged';
export type CycleStatus = 'draft' | 'open' | 'closed';

export interface Cycle {
  id: number;
  name: string;
  period_start: string;
  period_end: string;
  due_date?: string | null;
  status: CycleStatus;
  competencies: Competency[];
  rating_scale: number;
  review_count: number;
  completed_count: number;
  created_at?: string;
}

export interface Review {
  id: number;
  cycle_id: number;
  employee_id: number;
  reviewer_employee_id: number | null;
  self_ratings: Record<string, number>;
  manager_ratings: Record<string, number>;
  goals: Goal[];
  self_comments?: string | null;
  manager_comments?: string | null;
  final_rating?: number | null;
  status: ReviewStatus;
  self_submitted_at?: string | null;
  completed_at?: string | null;
  acknowledged_at?: string | null;
  employee_name: string;
  employee_code?: string;
  department_name?: string | null;
  position_title?: string | null;
  reviewer_name?: string | null;
  cycle_name: string;
  cycle_status: CycleStatus;
  period_start: string;
  period_end: string;
  due_date?: string | null;
  rating_scale: number;
  can_review?: boolean;
  is_own?: boolean;
  competencies?: Competency[];
}

export interface HistoryItem {
  id: number;
  cycle_id: number;
  cycle_name: string;
  period_start: string;
  period_end: string;
  final_rating: number | null;
  status: ReviewStatus;
  completed_at?: string | null;
  reviewer_name?: string | null;
  manager_comments?: string | null;
}

export interface CycleSummary {
  cycle_id: number;
  name: string;
  status: CycleStatus;
  rating_scale: number;
  total: number;
  completed: number;
  completion_percent: number;
  by_status: Record<ReviewStatus, number>;
  average_rating: number | null;
  distribution: { rating: number; count: number }[];
  competency_averages: { key: string; label: string; weight: number; self_average: number | null; manager_average: number | null }[];
  department_averages: { department: string; total: number; completed: number; average: number | null }[];
  top_performers: { review_id: number; employee_id: number; employee_name: string; department_name?: string | null; final_rating: number }[];
}

/** Mirrors the server's defaults; used to pre-fill a new cycle when no earlier cycle exists. */
export const DEFAULT_COMPETENCIES: Competency[] = [
  { key: 'quality', label: 'Quality of work', description: 'Accuracy, thoroughness and attention to detail.', weight: 1 },
  { key: 'productivity', label: 'Productivity', description: 'Volume of work delivered and use of time.', weight: 1 },
  { key: 'communication', label: 'Communication', description: 'Clarity in writing and speaking; keeps people informed.', weight: 1 },
  { key: 'teamwork', label: 'Teamwork', description: 'Collaboration, support for colleagues and conflict handling.', weight: 1 },
  { key: 'initiative', label: 'Initiative', description: 'Proactively identifies and solves problems.', weight: 1 },
  { key: 'reliability', label: 'Reliability', description: 'Meets commitments and deadlines consistently.', weight: 1 },
];

export const REVIEW_STATUS_LABEL: Record<ReviewStatus, string> = {
  pending_self: 'Awaiting self-assessment',
  pending_manager: 'Awaiting manager',
  completed: 'Completed',
  acknowledged: 'Acknowledged',
};
const REVIEW_TONE: Record<ReviewStatus, 'neutral' | 'warning' | 'info' | 'success'> = {
  pending_self: 'neutral',
  pending_manager: 'warning',
  completed: 'info',
  acknowledged: 'success',
};
export function ReviewStatusBadge({ status }: { status: ReviewStatus }) {
  return <Badge tone={REVIEW_TONE[status] || 'neutral'}>{REVIEW_STATUS_LABEL[status] || status}</Badge>;
}
const CYCLE_TONE: Record<CycleStatus, 'neutral' | 'info' | 'success'> = { draft: 'neutral', open: 'info', closed: 'success' };
export function CycleStatusBadge({ status }: { status: CycleStatus }) {
  return <Badge tone={CYCLE_TONE[status] || 'neutral'}>{status}</Badge>;
}

export const GOAL_STATUS_LABEL: Record<Goal['status'], string> = { on_track: 'On track', at_risk: 'At risk', done: 'Done' };
const GOAL_TONE: Record<Goal['status'], 'info' | 'warning' | 'success'> = { on_track: 'info', at_risk: 'warning', done: 'success' };

/** 4.5 → "4.5", 4 → "4", 4.1666 → "4.17". */
export function fmtRating(v?: number | null): string {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return '—';
  return String(Math.round(Number(v) * 100) / 100);
}

/** Client copy of the server's weighted average (preview only; the server computes the stored value). */
export function weightedAverage(ratings: Record<string, number>, competencies: Competency[]): number | null {
  let sum = 0, w = 0;
  for (const c of competencies) {
    const v = ratings[c.key];
    if (v === undefined || v === null) continue;
    const weight = Number(c.weight) || 1;
    sum += Number(v) * weight;
    w += weight;
  }
  return w ? Math.round((sum / w) * 100) / 100 : null;
}

/** Rating on the cycle's scale as a short bar plus the number. */
export function RatingBar({ value, scale }: { value?: number | null; scale: number }) {
  if (value === null || value === undefined) return <span className="muted">—</span>;
  const pct = Math.max(0, Math.min(100, (Number(value) / scale) * 100));
  return (
    <span className="progress-wrap" style={{ minWidth: 120 }}>
      <span className="progress"><span style={{ width: `${pct}%` }} /></span>
      <strong data-testid="rating-value">{fmtRating(value)}</strong>
      <span className="muted">/ {scale}</span>
    </span>
  );
}

/** Row of 1..scale buttons. `testPrefix` gives each button `data-testid="{prefix}-{n}"`. */
export function RatingInput({ value, scale, onChange, disabled, testPrefix, label }: { value?: number; scale: number; onChange: (v: number) => void; disabled?: boolean; testPrefix: string; label: string }) {
  return (
    <div className="row" style={{ gap: 4 }} role="radiogroup" aria-label={label}>
      {Array.from({ length: scale }, (_, i) => i + 1).map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          className={`pill ${value === n ? 'active' : ''}`}
          style={{ minWidth: 34, padding: '4px 8px', fontWeight: 600 }}
          disabled={disabled}
          onClick={() => onChange(n)}
          data-testid={`${testPrefix}-${n}`}
        >
          {n}
        </button>
      ))}
    </div>
  );
}

/** Goals editor (or read-only list when `readOnly`). */
export function GoalsEditor({ goals, onChange, readOnly }: { goals: Goal[]; onChange: (g: Goal[]) => void; readOnly?: boolean }) {
  const set = (i: number, patch: Partial<Goal>) => onChange(goals.map((g, j) => (j === i ? { ...g, ...patch } : g)));
  if (readOnly) {
    if (!goals.length) return <p className="muted" style={{ margin: 0 }}>No goals recorded.</p>;
    return (
      <div className="stack" data-testid="goals-list">
        {goals.map((g, i) => (
          <div key={i} className="row between" style={{ borderBottom: '1px solid var(--border)', paddingBottom: 8 }}>
            <span><strong>{g.title}</strong>{g.notes ? <div className="muted">{g.notes}</div> : null}</span>
            <span className="row">
              <span className="progress-wrap" style={{ minWidth: 140 }}><span className="progress"><span style={{ width: `${g.progress}%` }} /></span><span className="muted">{g.progress}%</span></span>
              <Badge tone={GOAL_TONE[g.status]}>{GOAL_STATUS_LABEL[g.status]}</Badge>
              <span className="muted">weight {g.weight}</span>
            </span>
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="stack" data-testid="goals-editor">
      {goals.map((g, i) => (
        <div key={i} className="form-grid" style={{ gridTemplateColumns: 'minmax(0, 3fr) 90px 90px 130px auto', alignItems: 'end', borderBottom: '1px solid var(--border)', paddingBottom: 10 }}>
          <Field label={i === 0 ? 'Goal' : undefined}>
            <Input value={g.title} onChange={(e) => set(i, { title: e.target.value })} placeholder="What will you achieve?" data-testid={`goal-title-${i}`} />
          </Field>
          <Field label={i === 0 ? 'Weight' : undefined}>
            <Input type="number" min={0} step={0.5} value={g.weight} onChange={(e) => set(i, { weight: Number(e.target.value) })} aria-label="Goal weight" />
          </Field>
          <Field label={i === 0 ? 'Progress %' : undefined}>
            <Input type="number" min={0} max={100} value={g.progress} onChange={(e) => set(i, { progress: Number(e.target.value) })} aria-label="Goal progress" data-testid={`goal-progress-${i}`} />
          </Field>
          <Field label={i === 0 ? 'Status' : undefined}>
            <Select value={g.status} onChange={(e) => set(i, { status: e.target.value as Goal['status'] })} aria-label="Goal status" data-testid={`goal-status-${i}`}>
              {Object.entries(GOAL_STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          </Field>
          <Button type="button" variant="ghost" size="sm" aria-label="Remove goal" onClick={() => onChange(goals.filter((_, j) => j !== i))} data-testid={`goal-remove-${i}`}><Icon name="trash" size={15} /></Button>
        </div>
      ))}
      {goals.length < 20 ? (
        <div><Button type="button" size="sm" onClick={() => onChange([...goals, { title: '', weight: 1, progress: 0, status: 'on_track', notes: '' }])} data-testid="goal-add"><Icon name="plus" size={14} /> Add goal</Button></div>
      ) : null}
    </div>
  );
}

export function ReadOnlyText({ text, empty = 'No comments.' }: { text?: string | null; empty?: string }) {
  return text ? <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{text}</p> : <p className="muted" style={{ margin: 0 }}>{empty}</p>;
}
