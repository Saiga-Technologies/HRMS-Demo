import React, { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useCounts } from '../lib/notifications';
import { usePageTour, type TourStep } from '../lib/tour';
import { Button, PageHeader, Tabs, useFetch } from '../components/ui';
import { Icon } from '../components/Icons';
import { DirectoryEmployee, Letter, LetterTemplate } from '../components/letters/shared';
import { LetterFormModal } from '../components/letters/LetterFormModal';
import { MyLetters } from '../components/letters/MyLetters';
import { LetterRequests } from '../components/letters/LetterRequests';
import { AllLetters } from '../components/letters/AllLetters';
import { LetterTemplates } from '../components/letters/LetterTemplates';

// The employee view has no tab bar, so "My letters" steps also match the card itself (clicking it is harmless).
const MINE_TAB = '[data-tab="mine"], [data-tour="letters-mine"]';
const TOUR: TourStep[] = [
  { title: 'HR letters', description: 'Official letters as PDFs, generated from templates with each employee’s own data. The flow: 1) an employee requests a letter (or HR issues one), 2) HR approves it, 3) the PDF is generated, 4) the employee downloads it — it is also filed in their Documents.' },
  { element: '[data-tour="letters-request-btn"]', title: 'Request a letter', description: 'Opens the request form: pick a self-service letter (experience, salary, address proof, no objection…), fill in any extra details such as the purpose, preview the wording with your own data, and send it. Letters that need approval go to HR’s queue.' },
  { element: '[data-tour="letters-issue-btn"]', title: 'Issue a letter', description: 'HR can issue any active template — including offer, appointment and relieving letters — to any employee. Fill in the extra details, preview, and leave “Generate the PDF now” ticked to produce it in one step.' },
  { element: '[data-tour="letters-tabs"]', title: 'Views', description: 'My letters are your own. HR also gets the Requests queue (the red badge counts requests waiting), All letters and Templates.' },
  { element: '[data-tour="letters-mine"]', title: 'Your letters', tab: MINE_TAB, description: 'Every letter for you with its reference number, the date it was requested and any note from HR. The header counts how many are ready and how many are in progress. Click a row for the details.' },
  { element: '[data-tour="letters-my-status"]', title: 'Where it stands', description: 'Awaiting approval: HR has not decided yet. Approved, not generated: HR is preparing the PDF. Ready: download it. Rejected: see the note from HR.' },
  { element: '[data-tour="letters-my-download"]', title: 'Download the PDF', description: 'Ready letters download straight from here. The same PDF is filed in your documents.' },
  { element: '[data-tour="letters-requests"]', title: 'Next: the request queue', tab: 'requests', description: 'Self-service requests that need approval, plus approved letters still waiting for their PDF. Each card shows who asked, the letter, the details they filled in and their reason.' },
  { element: '[data-tour="letters-request-note"]', title: 'Note to the employee', description: 'Optional. It is saved on the letter and shown to the employee in their list — useful when rejecting or explaining a delay.' },
  { element: '[data-tour="letters-request-actions"]', title: 'Decide', description: 'Reject, Approve (generate later), or Approve and generate the PDF in one click. An approved letter stays here with a Generate PDF button until its PDF exists. If some employee fields are blank you will be told which.' },
  { element: '[data-tour="letters-filters"]', title: 'Next: all letters', tab: 'all', description: 'Every letter in the company. Search by employee, letter or reference number, and filter by status or letter type.' },
  { element: '[data-tour="letters-all"]', title: 'Letter register', description: 'Reference, employee, letter, status, who requested it and when. Click a row to read the rendered letter.' },
  { element: '[data-tour="letters-row-actions"]', title: 'Row actions', description: 'Download the PDF, generate it (or regenerate after fixing employee data), reject a pending one, or delete a letter — deleting also removes its PDF from the employee’s documents.' },
  { element: '[data-tour="letters-template-add"]', title: 'Next: templates', tab: 'templates', description: 'Templates are the wording behind every letter. New template opens the editor with a list of placeholders such as {{employee.full_name}} or {{employee.position}} that you click to insert; use {{var.name}} for details asked when the letter is requested.' },
  { element: '[data-tour="letters-templates"]', title: 'Template list', description: 'Each template with its code, category and subject. Click a row to edit it; switch Active off to stop it being used.' },
  { element: '[data-tour="letters-tpl-access"]', title: 'Who can request it', description: 'Self-service templates appear in employees’ Request form; HR only ones can just be issued by HR. For self-service ones, Approval says whether HR must approve before generating.' },
  { element: '[data-tour="letters-tpl-vars"]', title: 'Extra details', description: 'The {{var.…}} fields found in the template body. The request and issue forms ask for these, for example the purpose of a salary certificate.' },
  { element: '[data-tour="letters-tpl-actions"]', title: 'Preview, edit, delete', description: 'Preview renders the template with a real employee’s data so you can check the wording and spot blank fields before anyone uses it.' },
  { title: 'What to do next', description: 'Generated letters land in the employee’s Documents, so employees can download them there too. HR: issue offer and appointment letters right after hiring in Recruitment, and relieving or experience letters at exit. Keep employee data complete so placeholders never come out blank.' },
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
