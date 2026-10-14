import React, { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useCounts } from '../lib/notifications';
import { usePageTour } from '../lib/tour';
import { Button, PageHeader, Tabs, useFetch } from '../components/ui';
import { Icon } from '../components/Icons';
import { DirectoryEmployee, Letter, LetterTemplate } from '../components/letters/shared';
import { LetterFormModal } from '../components/letters/LetterFormModal';
import { MyLetters } from '../components/letters/MyLetters';
import { LetterRequests } from '../components/letters/LetterRequests';
import { AllLetters } from '../components/letters/AllLetters';
import { LetterTemplates } from '../components/letters/LetterTemplates';

const TOUR = [
  { element: '[data-tour="letters-request-btn"]', title: 'Request a letter', description: 'Ask for an experience, salary, address proof or no objection letter. Fill in the purpose, preview the wording with your own details, and send it to HR.' },
  { element: '[data-tour="letters-issue-btn"]', title: 'Issue a letter', description: 'HR can issue any template (offer, appointment, relieving and more) to any employee, fill in extra details and generate the PDF in one step.' },
  { element: '[data-tour="letters-tabs"]', title: 'Views', description: 'My letters lists your own letters. HR also sees the request queue (the red badge counts requests waiting for approval), every letter issued, and the templates.' },
  { element: '[data-tour="letters-mine"]', title: 'Your letters', description: 'Track each request from approval to PDF. Ready letters can be downloaded here and are also filed in your documents. Click a row for details and HR notes.' },
  { element: '[data-tour="letters-requests"]', title: 'Request queue', description: 'Approve, reject with a note, or approve and generate the PDF straight away. Approved letters waiting for their PDF stay here until generated.' },
  { element: '[data-tour="letters-all"]', title: 'All letters', description: 'Every letter with its reference number. Filter by status or type, regenerate a PDF after fixing employee data, or delete a letter.' },
  { element: '[data-tour="letters-templates"]', title: 'Templates', description: 'Write templates with placeholders like {{employee.full_name}} or {{var.purpose}}, choose whether employees can request them and whether HR must approve, and preview with real employee data.' },
];

type TabKey = 'mine' | 'requests' | 'all' | 'templates';

export default function Letters() {
  usePageTour('HR letters', TOUR);
  const { isHr, user } = useAuth();
  const { counts, refreshCounts } = useCounts();
  const [params, setParams] = useSearchParams();
  const [modal, setModal] = useState<null | 'request' | 'issue'>(null);
  const hasEmployee = !!user?.employee_id;

  const letters = useFetch<Letter[]>(() => api.get('/api/letters'), []);
  const templates = useFetch<LetterTemplate[]>(() => api.get('/api/letters/templates'), []);
  const employees = useFetch<DirectoryEmployee[]>(() => (isHr ? api.get('/api/employees/directory/all') : Promise.resolve([])), [isHr]);

  const all = letters.data || [];
  const mine = useMemo(() => all.filter((l) => l.employee_id === user?.employee_id), [all, user?.employee_id]);
  const queueSize = all.filter((l) => l.status === 'requested' || l.status === 'approved').length;

  const tabs = [
    { key: 'mine', label: 'My letters', show: hasEmployee, icon: 'mail', count: letters.data ? mine.length : undefined },
    { key: 'requests', label: 'Requests', show: isHr, icon: 'check', badge: counts.letter_requests || undefined },
    { key: 'all', label: 'All letters', show: isHr, icon: 'folder', count: letters.data ? all.length : undefined },
    { key: 'templates', label: 'Templates', show: isHr, icon: 'file', count: templates.data ? templates.data.length : undefined },
  ].filter((t) => t.show);
  const requested = params.get('tab') as TabKey | null;
  const fallback = (tabs[0]?.key || 'mine') as TabKey;
  const tab: TabKey = requested && tabs.some((t) => t.key === requested) ? requested : fallback;
  const setTab = (k: string) => setParams(k === fallback ? {} : { tab: k }, { replace: true });

  const changed = () => { letters.reload(); refreshCounts(); };

  return (
    <>
      <PageHeader
        title="HR letters"
        subtitle={isHr ? `Issue letters from templates, approve self-service requests and generate PDFs.${queueSize ? ` ${queueSize} waiting in the queue.` : ''}` : 'Request experience, salary and address proof letters and download them once HR has generated them.'}
        actions={
          <>
            {hasEmployee ? (
              <span data-tour="letters-request-btn"><Button variant={isHr ? 'secondary' : 'primary'} onClick={() => setModal('request')} data-testid="letter-request"><Icon name="send" size={15} /> Request a letter</Button></span>
            ) : null}
            {isHr ? (
              <span data-tour="letters-issue-btn"><Button variant="primary" onClick={() => setModal('issue')} data-testid="letter-issue"><Icon name="plus" size={15} /> Issue a letter</Button></span>
            ) : null}
          </>
        }
      />
      {tabs.length > 1 ? <Tabs tour="letters-tabs" value={tab} onChange={setTab} tabs={tabs.map(({ key, label, badge, count, icon }) => ({ key, label, badge, count, icon }))} /> : null}

      {tab === 'mine' ? <MyLetters letters={mine} loading={letters.loading} onRequest={() => setModal('request')} /> : null}
      {tab === 'requests' && isHr ? <LetterRequests letters={all} loading={letters.loading} onChanged={changed} /> : null}
      {tab === 'all' && isHr ? <AllLetters letters={all} loading={letters.loading} templates={templates.data || []} onChanged={changed} onIssue={() => setModal('issue')} /> : null}
      {tab === 'templates' && isHr ? <LetterTemplates templates={templates.data || []} loading={templates.loading} employees={employees.data || []} onChanged={templates.reload} /> : null}

      {modal ? (
        <LetterFormModal
          mode={modal}
          templates={templates.data || []}
          employees={employees.data || []}
          onClose={() => setModal(null)}
          onDone={(l) => {
            setModal(null);
            changed();
            if (modal === 'issue' && tab !== 'all') setTab('all');
            if (modal === 'request' && tab !== 'mine' && l.employee_id === user?.employee_id) setTab('mine');
          }}
        />
      ) : null}
    </>
  );
}
