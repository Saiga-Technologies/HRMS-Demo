import React from 'react';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { fmtDate } from '../../lib/format';
import { Modal, Spinner, useFetch } from '../ui';
import { ReviewEditor, ReviewSteps, type EditorMode } from './ReviewEditor';
import { ReviewStatusBadge, type Review } from './shared';

/** Which form a viewer gets for a review. */
export function editorModeFor(review: Review, isHr: boolean): EditorMode {
  if (review.cycle_status !== 'open') return 'view';
  if (review.is_own) return review.status === 'pending_self' ? 'self' : 'view';
  if (!review.can_review) return 'view';
  if (review.status === 'pending_manager') return 'manager';
  if (review.status === 'pending_self' && isHr) return 'manager';
  return 'view';
}

/** Loads one review (with its cycle's competencies) and shows the right form for the viewer. */
export function ReviewModal({ reviewId, onClose, onChanged }: { reviewId: number; onClose: () => void; onChanged: () => void }) {
  const { isHr } = useAuth();
  const detail = useFetch<Review>(() => api.get(`/api/performance/reviews/${reviewId}`), [reviewId]);
  const r = detail.data;
  const mode = r ? editorModeFor(r, isHr) : 'view';
  return (
    <Modal open wide onClose={onClose} testId="review-modal" title={r ? `${r.employee_name} · ${r.cycle_name}` : 'Review'}>
      {detail.error ? <div className="alert alert-error">{detail.error}</div> : null}
      {!r ? <Spinner /> : (
        <div className="stack">
          <div className="row between">
            <span className="muted">
              {r.position_title || '—'}{r.department_name ? ` · ${r.department_name}` : ''} · {fmtDate(r.period_start)} – {fmtDate(r.period_end)} · Reviewer: {r.reviewer_name || 'Not assigned'}
            </span>
            <ReviewStatusBadge status={r.status} />
          </div>
          <ReviewSteps review={r} />
          {mode === 'manager' && r.status === 'pending_self' ? (
            <div className="alert alert-warning">{r.employee_name} has not submitted a self-assessment yet. As HR you can still complete the review.</div>
          ) : null}
          <ReviewEditor
            key={`${r.id}-${r.status}-${mode}`}
            review={r}
            mode={mode}
            canAcknowledge={!!r.is_own}
            onSaved={() => { detail.reload(); onChanged(); }}
          />
        </div>
      )}
    </Modal>
  );
}
