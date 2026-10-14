import React, { useState } from 'react';
import { api } from '../../lib/api';
import { useCounts } from '../../lib/notifications';
import { fmtDate, fmtDateTime } from '../../lib/format';
import { Button, Field, Input, Textarea, useConfirm, useToast } from '../ui';
import { Icon } from '../Icons';
import { DEFAULT_COMPETENCIES, GoalsEditor, RatingBar, RatingInput, ReadOnlyText, fmtRating, weightedAverage, type Goal, type Review } from './shared';

export type EditorMode = 'self' | 'manager' | 'view';

/** Progress through the four review stages. */
export function ReviewSteps({ review }: { review: Review }) {
  const order = ['pending_self', 'pending_manager', 'completed', 'acknowledged'];
  const idx = order.indexOf(review.status);
  const steps = [
    { label: 'Self-assessment', at: review.self_submitted_at },
    { label: 'Manager review', at: review.completed_at },
    { label: 'Completed', at: review.completed_at },
    { label: 'Acknowledged', at: review.acknowledged_at },
  ];
  return (
    <div className="row" style={{ gap: 6 }} data-testid="review-steps">
      {steps.map((s, i) => {
        // A step is done once the review has moved past it (completed counts as done when status is completed or later).
        const done = i < idx || (i === idx && (review.status === 'completed' || review.status === 'acknowledged') && i >= 2);
        const current = i === idx && !done;
        return (
          <React.Fragment key={s.label}>
            {i > 0 ? <span className="muted" aria-hidden><Icon name="chevronRight" size={14} /></span> : null}
            <span
              className={`badge ${done ? 'badge-success' : current ? 'badge-warning' : 'badge-neutral'}`}
              title={s.at ? fmtDateTime(s.at) : undefined}
              style={{ textTransform: 'none' }}
            >
              {done ? <Icon name="check" size={12} /> : null}
              {s.label}
            </span>
          </React.Fragment>
        );
      })}
    </div>
  );
}

/**
 * The review form. `self` lets the employee rate themselves and edit goals; `manager` shows the
 * self ratings read-only next to editable manager ratings and an optional final-rating override;
 * `view` is read-only (with Acknowledge for the employee once completed).
 */
export function ReviewEditor({ review, mode, onSaved, canAcknowledge }: { review: Review; mode: EditorMode; onSaved: (r: Review) => void; canAcknowledge?: boolean }) {
  const toast = useToast();
  const { refreshCounts } = useCounts();
  const { confirm, dialog } = useConfirm();
  const competencies = review.competencies?.length ? review.competencies : DEFAULT_COMPETENCIES;
  const scale = review.rating_scale || 5;
  const [selfRatings, setSelfRatings] = useState<Record<string, number>>(review.self_ratings || {});
  const [mgrRatings, setMgrRatings] = useState<Record<string, number>>(review.manager_ratings || {});
  const [goals, setGoals] = useState<Goal[]>(review.goals || []);
  const [selfComments, setSelfComments] = useState(review.self_comments || '');
  const [mgrComments, setMgrComments] = useState(review.manager_comments || '');
  const [finalOverride, setFinalOverride] = useState(review.final_rating !== null && review.final_rating !== undefined && mode === 'manager' && review.status !== 'pending_self' && review.status !== 'pending_manager' ? String(review.final_rating) : '');
  const [busy, setBusy] = useState<string | null>(null);

  const showManager = mode !== 'self';
  const computed = weightedAverage(mgrRatings, competencies);
  const missing = (ratings: Record<string, number>) => competencies.filter((c) => ratings[c.key] === undefined);
  const cleanGoals = () => goals.filter((g) => g.title.trim()).map((g) => ({ ...g, title: g.title.trim() }));

  const save = async (submit: boolean) => {
    const ratings = mode === 'self' ? selfRatings : mgrRatings;
    if (submit) {
      const m = missing(ratings);
      if (m.length) return toast.error(`Rate every competency first: ${m.map((c) => c.label).join(', ')}`);
      const ok = await confirm(
        mode === 'self' ? 'Submit your self-assessment?' : `Complete ${review.employee_name}'s review?`,
        mode === 'self'
          ? `It goes to ${review.reviewer_name || 'your manager'} and can no longer be edited.`
          : `The final rating will be ${finalOverride || fmtRating(computed)} / ${scale}. ${review.employee_name} is asked to acknowledge it.`,
        false,
      );
      if (!ok) return;
    }
    setBusy(submit ? 'submit' : 'save');
    try {
      const updated = mode === 'self'
        ? await api.put<Review>(`/api/performance/reviews/${review.id}/self`, { self_ratings: selfRatings, self_comments: selfComments, goals: cleanGoals(), submit })
        : await api.put<Review>(`/api/performance/reviews/${review.id}/manager`, { manager_ratings: mgrRatings, manager_comments: mgrComments, goals: cleanGoals(), final_rating: finalOverride === '' ? null : Number(finalOverride), submit });
      toast.success(submit ? (mode === 'self' ? 'Self-assessment submitted' : `Review completed for ${review.employee_name}`) : 'Draft saved');
      if (submit) refreshCounts();
      onSaved({ ...updated, competencies });
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(null);
    }
  };

  const acknowledge = async () => {
    setBusy('ack');
    try {
      const updated = await api.post<Review>(`/api/performance/reviews/${review.id}/acknowledge`);
      toast.success('Review acknowledged');
      refreshCounts();
      onSaved({ ...updated, competencies });
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="stack" data-testid={`review-editor-${mode}`}>
      <div className="table-wrap" data-tour="perf-competencies">
        <table className="table">
          <thead>
            <tr>
              <th>Competency</th>
              <th style={{ width: mode === 'self' ? undefined : '18%' }}>{mode === 'self' ? `Your rating (1–${scale})` : 'Self'}</th>
              {showManager ? <th>{mode === 'manager' ? `Manager rating (1–${scale})` : 'Manager'}</th> : null}
            </tr>
          </thead>
          <tbody>
            {competencies.map((c) => (
              <tr key={c.key} data-testid={`competency-${c.key}`}>
                <td>
                  <strong>{c.label}</strong>
                  {c.weight !== 1 ? <span className="muted"> · weight {c.weight}</span> : null}
                  {c.description ? <div className="muted">{c.description}</div> : null}
                </td>
                <td>
                  {mode === 'self'
                    ? <RatingInput value={selfRatings[c.key]} scale={scale} onChange={(v) => setSelfRatings((s) => ({ ...s, [c.key]: v }))} testPrefix={`rating-${c.key}`} label={`Your rating for ${c.label}`} />
                    : <RatingBar value={review.self_ratings?.[c.key]} scale={scale} />}
                </td>
                {showManager ? (
                  <td>
                    {mode === 'manager'
                      ? <RatingInput value={mgrRatings[c.key]} scale={scale} onChange={(v) => setMgrRatings((s) => ({ ...s, [c.key]: v }))} testPrefix={`rating-${c.key}`} label={`Manager rating for ${c.label}`} />
                      : <RatingBar value={review.manager_ratings?.[c.key]} scale={scale} />}
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {mode === 'manager' ? (
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <div>
            <div className="section-title">Weighted average</div>
            <RatingBar value={computed} scale={scale} />
          </div>
          <Field label="Final rating (optional override)" hint={`Leave blank to use the weighted average. 1–${scale}.`}>
            <Input type="number" min={1} max={scale} step={0.1} value={finalOverride} onChange={(e) => setFinalOverride(e.target.value)} placeholder={fmtRating(computed)} style={{ width: 160 }} data-testid="review-final" />
          </Field>
        </div>
      ) : null}
      {mode === 'view' && (review.status === 'completed' || review.status === 'acknowledged') ? (
        <div data-testid="review-final-rating">
          <div className="section-title">Final rating</div>
          <RatingBar value={review.final_rating} scale={scale} />
        </div>
      ) : null}

      <div>
        <div className="section-title">Goals</div>
        <GoalsEditor goals={goals} onChange={setGoals} readOnly={mode === 'view'} />
      </div>

      <div className="grid grid-2">
        <div>
          <div className="section-title">Self-assessment comments</div>
          {mode === 'self'
            ? <Textarea rows={4} value={selfComments} onChange={(e) => setSelfComments(e.target.value)} placeholder="Highlights, challenges and what you want to focus on next." data-testid="review-comments" aria-label="Self-assessment comments" />
            : <ReadOnlyText text={review.self_comments} />}
        </div>
        {showManager ? (
          <div>
            <div className="section-title">Manager comments</div>
            {mode === 'manager'
              ? <Textarea rows={4} value={mgrComments} onChange={(e) => setMgrComments(e.target.value)} placeholder="Strengths, areas to develop and the overall assessment." data-testid="review-comments" aria-label="Manager comments" />
              : <ReadOnlyText text={review.manager_comments} empty={review.status === 'pending_manager' ? 'Waiting for the manager review.' : 'No comments.'} />}
          </div>
        ) : null}
      </div>

      <div className="row between">
        <div className="audit-trail">
          {review.self_submitted_at ? <span>Self-assessment submitted {fmtDateTime(review.self_submitted_at)}</span> : review.due_date ? <span>Due {fmtDate(review.due_date)}</span> : null}
          {review.completed_at ? <span>Completed by <span className="who">{review.reviewer_name || 'HR'}</span> {fmtDateTime(review.completed_at)}</span> : null}
          {review.acknowledged_at ? <span>Acknowledged {fmtDateTime(review.acknowledged_at)}</span> : null}
        </div>
        <div className="row">
          {mode === 'self' || mode === 'manager' ? (
            <>
              <Button onClick={() => save(false)} loading={busy === 'save'} disabled={!!busy} data-testid="review-save">Save draft</Button>
              <Button variant="primary" onClick={() => save(true)} loading={busy === 'submit'} disabled={!!busy} data-testid="review-submit">
                <Icon name="send" size={15} /> {mode === 'self' ? 'Submit self-assessment' : 'Complete review'}
              </Button>
            </>
          ) : null}
          {mode === 'view' && canAcknowledge && review.status === 'completed' ? (
            <Button variant="primary" onClick={acknowledge} loading={busy === 'ack'} data-testid="review-acknowledge"><Icon name="check" size={15} /> Acknowledge</Button>
          ) : null}
        </div>
      </div>
      {dialog}
    </div>
  );
}
