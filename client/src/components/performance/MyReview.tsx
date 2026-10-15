import React, { useState } from 'react';
import { api } from '../../lib/api';
import { fmtDate } from '../../lib/format';
import { Card, EmptyState, Spinner, Stat, Table, useFetch } from '../ui';
import { Sparkline } from '../charts';
import { ReviewEditor, ReviewSteps } from './ReviewEditor';
import { ReviewModal } from './ReviewModal';
import { RatingBar, ReviewStatusBadge, fmtRating, type Competency, type HistoryItem, type Review } from './shared';

interface MyData { current: Review | null; history: HistoryItem[]; competencies: Competency[]; pending_as_reviewer?: number }

export function MyReview({ hasEmployee, onOpenTeam }: { hasEmployee: boolean; onOpenTeam?: () => void }) {
  const my = useFetch<MyData>(() => api.get('/api/performance/my'), []);
  const [open, setOpen] = useState<number | null>(null);
  if (my.loading && !my.data) return <Spinner />;
  if (my.error) return <div className="alert alert-error">{my.error}</div>;
  const d = my.data!;
  const cur = d.current ? { ...d.current, competencies: d.competencies, is_own: true } : null;
  const history = d.history || [];
  const last = [...history].reverse().find((h) => h.final_rating !== null);
  const scale = cur?.rating_scale || 5;
  const ratings = history.map((h) => Number(h.final_rating)).filter((v) => Number.isFinite(v));

  if (!hasEmployee) {
    return <Card><EmptyState icon="◎" title="No employee record" description="Your login is not linked to an employee, so there is no personal review. Use the other tabs to manage reviews." /></Card>;
  }

  return (
    <>
      <div className="stat-strip" data-tour="perf-my-stats">
        <Stat label="Current cycle" value={cur ? cur.cycle_name : 'None open'} icon="calendar" hint={cur ? `${fmtDate(cur.period_start)} – ${fmtDate(cur.period_end)}` : 'No review cycle is open right now'} />
        <Stat label="Status" value={cur ? <span data-testid="my-review-status"><ReviewStatusBadge status={cur.status} /></span> : '—'} icon="clock" hint={cur?.due_date ? `Due ${fmtDate(cur.due_date)}` : undefined} color="var(--warning)" />
        <Stat label="Last rating" value={last ? `${fmtRating(last.final_rating)}` : '—'} icon="star" hint={last ? last.cycle_name : 'No completed reviews yet'} color="var(--accent)" trend={ratings.length > 1 ? <Sparkline values={ratings} /> : undefined} />
        <Stat label="Completed reviews" value={history.length} icon="award" color="var(--success)" onClick={onOpenTeam && d.pending_as_reviewer ? onOpenTeam : undefined} hint={d.pending_as_reviewer ? `${d.pending_as_reviewer} team review${d.pending_as_reviewer === 1 ? '' : 's'} waiting for you` : undefined} />
      </div>

      <Card
        tour="perf-my-review"
        title={cur ? <span>My review · {cur.cycle_name}</span> : 'My review'}
        actions={cur ? <span className="muted">Reviewer: <strong>{cur.reviewer_name || 'Not assigned'}</strong></span> : undefined}
      >
        {!cur ? (
          <EmptyState icon="◎" title="No open review cycle" description="When HR opens a review cycle your self-assessment appears here." />
        ) : (
          <div className="stack">
            <ReviewSteps review={cur} />
            {cur.status === 'pending_self' ? (
              <div className="callout">Rate yourself on each competency (1 = needs improvement, {scale} = outstanding), update your goals and add comments. Save a draft any time; once you submit, it goes to {cur.reviewer_name || 'your manager'}.</div>
            ) : cur.status === 'pending_manager' ? (
              <div className="callout">Submitted. {cur.reviewer_name || 'Your manager'} is now completing the review.</div>
            ) : cur.status === 'completed' ? (
              <div className="callout">Your review is complete. Read the feedback below and acknowledge it.</div>
            ) : null}
            <ReviewEditor
              key={`${cur.id}-${cur.status}`}
              review={cur}
              mode={cur.status === 'pending_self' && cur.cycle_status === 'open' ? 'self' : 'view'}
              canAcknowledge
              onSaved={() => my.reload()}
            />
          </div>
        )}
      </Card>

      <Card title="Review history" padded={false} tour="perf-history" actions={ratings.length > 1 ? <Sparkline values={ratings} width={120} /> : undefined}>
        <Table<HistoryItem>
          rows={[...history].reverse()}
          empty="No completed reviews yet."
          onRowClick={(h) => setOpen(h.id)}
          columns={[
            { key: 'cycle_name', header: 'Cycle', render: (h) => <span><strong>{h.cycle_name}</strong><div className="muted">{fmtDate(h.period_start)} – {fmtDate(h.period_end)}</div></span> },
            { key: 'final_rating', header: 'Final rating', render: (h) => <RatingBar value={h.final_rating} scale={scale} /> },
            { key: 'reviewer_name', header: 'Reviewer', render: (h) => h.reviewer_name || '—' },
            { key: 'manager_comments', header: 'Feedback', render: (h) => <span className="muted" style={{ display: 'block', maxWidth: 360, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{h.manager_comments || '—'}</span> },
            { key: 'status', header: 'Status', render: (h) => <ReviewStatusBadge status={h.status} /> },
            { key: 'completed_at', header: 'Completed', render: (h) => fmtDate(h.completed_at) },
          ]}
        />
      </Card>

      {open ? <ReviewModal reviewId={open} onClose={() => setOpen(null)} onChanged={() => my.reload()} /> : null}
    </>
  );
}
