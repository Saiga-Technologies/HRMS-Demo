import React from 'react';
import { Icon } from '../Icons';
import type { ScoreBreakdown } from './types';

/** Score colouring: ≥70 green, 40–69 amber, <40 red (CSS variables so both themes work). */
export function scoreColor(score: number | null | undefined): string {
  if (score === null || score === undefined) return 'var(--muted)';
  return score >= 70 ? 'var(--success)' : score >= 40 ? 'var(--warning)' : 'var(--danger)';
}
export function scoreTone(score: number | null | undefined): 'success' | 'warning' | 'danger' | 'neutral' {
  if (score === null || score === undefined) return 'neutral';
  return score >= 70 ? 'success' : score >= 40 ? 'warning' : 'danger';
}

/** Circular score indicator used on cards and in the detail header. */
export function ScoreRing({ score, size = 44, testId }: { score: number | null | undefined; size?: number; testId?: string }) {
  const r = (size - 6) / 2;
  const c = 2 * Math.PI * r;
  const pct = score === null || score === undefined ? 0 : Math.max(0, Math.min(100, score)) / 100;
  const color = scoreColor(score);
  return (
    <span className="score-ring" style={{ width: size, height: size }} title={score === null || score === undefined ? 'Not scored' : `Match score ${score} / 100`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--border)" strokeWidth={4} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={4} strokeLinecap="round" strokeDasharray={`${pct * c} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      </svg>
      <span className="score-ring-value num" style={{ color, fontSize: size * 0.32 }} data-testid={testId}>{score === null || score === undefined ? '–' : score}</span>
    </span>
  );
}

/** Inline mini bar for tables. */
export function ScoreBar({ score }: { score: number | null | undefined }) {
  if (score === null || score === undefined) return <span className="muted">Not scored</span>;
  return (
    <span className="score-bar" title={`${score} / 100`}>
      <span className="score-bar-track"><span className="score-bar-fill" style={{ width: `${score}%`, background: scoreColor(score) }} /></span>
      <strong className="num" style={{ color: scoreColor(score) }}>{score}</strong>
    </span>
  );
}

export function SkillChips({ skills, tone = 'neutral', max, empty = '—' }: { skills: string[]; tone?: 'neutral' | 'success' | 'danger' | 'info'; max?: number; empty?: React.ReactNode }) {
  if (!skills?.length) return <span className="muted">{empty}</span>;
  const shown = max ? skills.slice(0, max) : skills;
  const more = skills.length - shown.length;
  return (
    <span className="chip-list">
      {shown.map((s) => <span key={s} className={`chip chip-${tone}`}>{tone === 'success' ? <Icon name="check" size={12} /> : tone === 'danger' ? <Icon name="x" size={12} /> : null}{s}</span>)}
      {more > 0 ? <span className="chip chip-muted">+{more}</span> : null}
    </span>
  );
}

/** Per-category breakdown bars (skills / requirements / experience / education / extras). */
export function BreakdownBars({ breakdown }: { breakdown: ScoreBreakdown }) {
  const cats: { key: keyof ScoreBreakdown; label: string }[] = [
    { key: 'skills', label: 'Skills match' }, { key: 'requirements', label: 'Requirements' }, { key: 'experience', label: 'Experience fit' }, { key: 'education', label: 'Education' }, { key: 'extras', label: 'Extras' },
  ];
  return (
    <div className="breakdown">
      {cats.map(({ key, label }) => {
        const c = breakdown[key] as any;
        if (!c) return null;
        const pct = c.weight ? (c.points / c.weight) * 100 : 0;
        return (
          <div key={key} className="breakdown-row" data-testid={`breakdown-${key}`}>
            <div className="breakdown-head"><span>{label}</span><span className="num"><strong>{c.points}</strong> / {c.weight}</span></div>
            <div className="breakdown-track"><span style={{ width: `${pct}%`, background: scoreColor(pct) }} /></div>
            <div className="help">{c.note}</div>
          </div>
        );
      })}
    </div>
  );
}

export function Stars({ value, onChange, size = 16 }: { value: number | null | undefined; onChange?: (v: number | null) => void; size?: number }) {
  return (
    <span className={`stars ${onChange ? 'editable' : ''}`} role={onChange ? 'radiogroup' : undefined} aria-label="Rating">
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} type="button" className={`star ${value && n <= value ? 'on' : ''}`} disabled={!onChange} aria-label={`${n} star${n > 1 ? 's' : ''}`} title={`${n} / 5`} onClick={() => onChange?.(value === n ? null : n)}>
          <Icon name="star" size={size} />
        </button>
      ))}
    </span>
  );
}
