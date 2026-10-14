import React, { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useCounts } from '../lib/notifications';
import { usePageTour } from '../lib/tour';
import { PageHeader, Tabs, useFetch } from '../components/ui';
import { MyReview } from '../components/performance/MyReview';
import { TeamReviews } from '../components/performance/TeamReviews';
import { CycleDetail, CyclesTab } from '../components/performance/Cycles';
import type { Cycle } from '../components/performance/shared';

const TOUR = [
  { element: '[data-tour="perf-tabs"]', title: 'Performance reviews', description: 'My review is your own assessment. Managers and HR review their team under Team reviews; HR runs review cycles. Red badges count reviews waiting for you.' },
  { element: '[data-tour="perf-my-stats"]', title: 'Where you stand', description: 'The open cycle and its due date, the status of your review, your last final rating with its trend, and how many reviews you have completed.' },
  { element: '[data-tour="perf-my-review"]', title: 'Your review', description: 'The stages run self-assessment, manager review, completed and acknowledged. Rate yourself on every competency, update goals and add comments; save a draft or submit to your manager.' },
  { element: '[data-tour="perf-competencies"]', title: 'Competencies and ratings', description: 'Each competency is rated on the cycle’s scale. The final rating is the weighted average of the manager’s ratings unless the manager overrides it.' },
  { element: '[data-tour="perf-history"]', title: 'Review history', description: 'Completed reviews from earlier cycles with the final rating and feedback. Open one to read it in full or acknowledge it.' },
  { element: '[data-tour="perf-team-list"]', title: 'Team reviews', description: 'Reviews from your reporting line. Awaiting manager rows come first; open one to rate each competency next to the self-assessment and complete it.' },
  { element: '[data-tour="perf-cycles"]', title: 'Review cycles', description: 'HR creates a draft cycle with its competencies and rating scale, opens it to create a review for every employee, follows progress, exports CSV and closes it.' },
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
