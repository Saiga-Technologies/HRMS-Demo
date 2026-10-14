import React from 'react';
import { Icon } from '../Icons';
import { Badge } from '../ui';
import { ScoreRing, SkillChips } from './ScoreBits';
import { BOARD_STAGES, STAGE_LABEL, candidateName, type Candidate, type Stage } from './types';

/** Kanban card. Draggable (native DnD) with arrow buttons as a keyboard/touch fallback. */
export function CandidateCard({ c, onOpen, onMove, canMove }: { c: Candidate; onOpen: () => void; onMove: (stage: Stage) => void; canMove: boolean }) {
  const idx = BOARD_STAGES.indexOf(c.stage === 'withdrawn' ? 'rejected' : c.stage);
  const prev = idx > 0 ? BOARD_STAGES[idx - 1] : null;
  const next = idx >= 0 && idx < BOARD_STAGES.length - 1 ? BOARD_STAGES[idx + 1] : null;
  const locked = c.stage === 'hired';
  const skills = c.score_breakdown?.skills?.matched?.length ? c.score_breakdown.skills.matched : c.parsed?.skills || [];
  return (
    <div
      className={`cand-card ${locked ? 'locked' : ''}`}
      draggable={canMove && !locked}
      onDragStart={(e) => { e.dataTransfer.setData('text/candidate', String(c.id)); e.dataTransfer.effectAllowed = 'move'; }}
      onClick={onOpen}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); } }}
      data-testid="candidate-card"
      data-candidate-id={c.id}>
      <div className="cand-card-head">
        <div style={{ minWidth: 0 }}>
          <div className="cand-name">{candidateName(c)}</div>
          <div className="cand-sub">{c.parsed?.title || c.position_title || '—'}</div>
        </div>
        <ScoreRing score={c.score} size={40} />
      </div>
      <SkillChips skills={skills} max={4} tone={c.score_breakdown?.skills?.matched?.length ? 'success' : 'neutral'} empty="No skills parsed" />
      <div className="cand-meta">
        {c.parsed?.experience_years !== null && c.parsed?.experience_years !== undefined ? <span><Icon name="briefcase" size={13} /> {c.parsed.experience_years} yr{c.parsed.experience_years === 1 ? '' : 's'}</span> : <span className="muted">Experience n/a</span>}
        {c.source ? <span><Icon name="compass" size={13} /> {c.source}</span> : null}
        {c.vacancy_title ? <span title={c.vacancy_title} className="cand-vac"><Icon name="briefcase" size={13} /> {c.vacancy_title}</span> : <Badge tone="neutral">Unassigned</Badge>}
        {c.stage === 'withdrawn' ? <Badge tone="neutral">Withdrawn</Badge> : null}
      </div>
      {canMove && !locked ? (
        <div className="cand-actions" onClick={(e) => e.stopPropagation()}>
          <button type="button" className="btn btn-ghost btn-sm" disabled={!prev} title={prev ? `Move to ${STAGE_LABEL[prev]}` : undefined} aria-label={prev ? `Move to ${STAGE_LABEL[prev]}` : 'No earlier stage'} onClick={() => prev && onMove(prev)} data-testid="candidate-move-prev"><Icon name="chevronLeft" size={14} /></button>
          <span className="help">{STAGE_LABEL[c.stage]}</span>
          <button type="button" className="btn btn-ghost btn-sm" disabled={!next || next === 'hired'} title={next === 'hired' ? 'Use "Hire" in the candidate detail' : next ? `Move to ${STAGE_LABEL[next]}` : undefined} aria-label={next ? `Move to ${STAGE_LABEL[next]}` : 'No later stage'} onClick={() => next && next !== 'hired' && onMove(next)} data-testid="candidate-move-next"><Icon name="chevronRight" size={14} /></button>
        </div>
      ) : null}
    </div>
  );
}
