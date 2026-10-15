import React, { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useCounts } from '../lib/notifications';
import { usePageTour, type TourStep } from '../lib/tour';
import { PageHeader, Tabs, useFetch } from '../components/ui';
import { MyReview } from '../components/performance/MyReview';
import { TeamReviews } from '../components/performance/TeamReviews';
import { CycleDetail, CyclesTab } from '../components/performance/Cycles';
import type { Cycle } from '../components/performance/shared';

// Opens the first cycle in the list; once the detail view shows, the selector matches it instead (clicking it does nothing).
const CYCLE_DETAIL = '[data-tour="perf-cycles"] tbody tr.clickable, [data-testid="cycle-detail"]';
const TOUR: TourStep[] = [
  { title: 'Performance', description: 'Review cycles from start to finish. The flow: 1) HR sets up a cycle and opens it, 2) every employee rates themselves, 3) their manager reviews and sets the final rating, 4) the employee acknowledges it, 5) HR follows progress, exports and closes the cycle.' },
  { element: '[data-tour="perf-tabs"]', title: 'Views', description: 'My review is your own assessment and history. Managers and HR get Team reviews; HR also runs Cycles. Red badges count reviews waiting for you.' },
  { element: '[data-tour="perf-my-stats"]', title: 'Where you stand', tab: 'me', description: 'The open cycle and its period, the status and due date of your review, your last final rating with its trend, and how many reviews you have completed. Managers also see how many team reviews are waiting.' },
  { element: '[data-tour="perf-my-review"]', title: 'Your review', description: 'Your review in the current open cycle and who your reviewer is. When no cycle is open, this says so.' },
  { element: '[data-tour="perf-review-steps"]', title: 'Four stages', description: 'Self-assessment, then manager review, then completed, then acknowledged. The current stage is highlighted; hover a finished one to see when it happened.' },
  { element: '[data-tour="perf-competencies"]', title: 'Rate each competency', description: 'Rate yourself on every competency from 1 (needs improvement) to the top of the cycle’s scale. Some competencies carry more weight. Once submitted, your manager’s ratings appear next to yours.' },
  { element: '[data-tour="perf-goals"]', title: 'Goals', description: 'Add or update your goals with progress, status and weight. Your manager can adjust them during the review.' },
  { element: '[data-tour="perf-comments"]', title: 'Comments', description: 'Your highlights, challenges and focus for next period, and later your manager’s feedback.' },
  { element: '[data-tour="perf-review-actions"]', title: 'Submit or acknowledge', description: 'Save a draft any time, then Submit self-assessment once every competency is rated — it goes to your reviewer and can no longer be edited. After the manager completes it, Acknowledge here to confirm you have read it.' },
  { element: '[data-tour="perf-history"]', title: 'Review history', description: 'Completed reviews from earlier cycles with the final rating, reviewer and feedback; the sparkline shows the trend. Click one to read it in full.' },
  { element: '[data-tour="perf-team-filters"]', title: 'Next: team reviews', tab: 'team', description: 'Managers see their reporting line, HR sees everyone. Filter by cycle (open cycles by default) and status, search by name or department, and use “Assigned to me” for the reviews you own.' },
  { element: '[data-tour="perf-team-chips"]', title: 'Status counts', description: 'How many reviews are at each stage. Click a chip to filter to it.' },
  { element: '[data-tour="perf-team-list"]', title: 'Reviews to do', description: 'Reviews awaiting the manager come first, with the reviewer, due date and final rating.' },
  { element: '[data-tour="perf-team-open"]', title: 'Review', description: 'Opens the review with the employee’s self-ratings next to yours. Rate every competency, adjust goals, add feedback, then Complete review. The final rating is the weighted average of your ratings unless you type an override; the employee is then asked to acknowledge it. HR can complete a review even before the self-assessment arrives.' },
  { element: '[data-tour="perf-cycle-add"]', title: 'Next: set up a cycle', tab: 'cycles', description: 'New cycle opens the set-up form: name, review period, due date, rating scale and the competencies with their weights. It is saved as a draft you can still change.' },
  { element: '[data-tour="perf-cycles"]', title: 'Cycles', description: 'Every cycle with its period, due date, status and how many reviews are completed. Click a cycle to see its summary.' },
  { element: '[data-tour="perf-cycle-actions"]', title: 'Open, close, export', description: 'Open a draft to create a review for every active employee, assigned to their reporting manager — competencies and scale then lock. Close an open cycle when it is done (it cannot be reopened). Export downloads every review as CSV; drafts can be edited or deleted.' },
  { element: '[data-tour="perf-cycle-summary"]', title: 'Cycle summary', tab: CYCLE_DETAIL, description: 'Inside a cycle: total reviews and how many still await the self-assessment, how many await the manager (click to filter), completion and the average rating.' },
  { element: '[data-tour="perf-cycle-charts"]', title: 'Results', description: 'Rating distribution, average self and manager rating per competency, completion and average by department, and the top-rated employees.' },
  { element: '[data-tour="perf-cycle-reviews"]', title: 'Every review', description: 'Each employee’s reviewer, status and final rating. Change the reviewer while a review is still open, or open any review to read or complete it.' },
  { element: '[data-tour="perf-cycle-export"]', title: 'Export', description: 'Downloads the cycle as CSV: self and manager rating per competency, final rating and the submitted, completed and acknowledged dates.' },
  { title: 'What to do next', description: 'Run one cycle per review period: set up, open, chase self-assessments, then manager reviews, wait for acknowledgements and close. Final ratings stay in each employee’s history for the next cycle.' },
];

type TabKey = 'me' | 'team' | 'cycles';

export default function Performance() {
  usePageTour('Performance', TOUR);
  const { isHr, isManager, user } = useAuth();
  const { counts, refreshCounts } = useCounts();
  const [params, setParams] = useSearchParams();
  const cycles = useFetch<Cycle[]>(() => api.get('/api/performance/cycles'), []);
  const canTeam = isHr || isManager;

  const tabs = useMemo(() => [
    { key: 'me', label: 'My review', icon: 'user', badge: counts.reviews_pending_self || undefined, show: true },
    { key: 'team', label: 'Team reviews', icon: 'users', badge: counts.reviews_pending_manager || undefined, show: canTeam },
    { key: 'cycles', label: 'Cycles', icon: 'calendar', count: cycles.data ? cycles.data.length : undefined, show: isHr },
  ].filter((t) => t.show), [counts.reviews_pending_self, counts.reviews_pending_manager, canTeam, isHr, cycles.data]);

  const requested = params.get('tab') as TabKey | null;
  const tab: TabKey = requested && tabs.some((t) => t.key === requested) ? requested : 'me';
  const cycleParam = params.get('cycle');
  const setTab = (k: string) => setParams(k === 'me' ? {} : { tab: k }, { replace: true });
  const viewCycle = (id: number | null) => setParams(id ? { tab: 'cycles', cycle: String(id) } : { tab: 'cycles' });
  const onChanged = () => { cycles.reload(); refreshCounts(); };

  return (
    <>
      <PageHeader
        tour="perf-header"
        title="Performance"
        subtitle={isHr ? 'Review cycles, self-assessments, manager reviews and ratings across the company.' : canTeam ? 'Your own review and the reviews of your team.' : 'Your self-assessment, goals, feedback and review history.'}
      />
      <Tabs tour="perf-tabs" value={tab} onChange={setTab} tabs={tabs.map(({ key, label, icon, badge, count }) => ({ key, label, icon, badge, count }))} />

      {tab === 'me' ? <MyReview hasEmployee={!!user?.employee_id} onOpenTeam={canTeam ? () => setTab('team') : undefined} /> : null}
      {tab === 'team' ? <TeamReviews cycles={cycles.data || []} onChanged={onChanged} /> : null}
      {tab === 'cycles' ? (
        cycleParam ? (
          <CycleDetail cycleId={Number(cycleParam)} onBack={() => viewCycle(null)} onChanged={onChanged} />
        ) : (
          <CyclesTab cycles={cycles.data || []} loading={cycles.loading && !cycles.data} reload={onChanged} onView={(id) => viewCycle(id)} />
        )
      ) : null}
    </>
  );
}
