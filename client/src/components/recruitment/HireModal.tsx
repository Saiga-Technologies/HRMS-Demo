import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, qs } from '../../lib/api';
import { fmtDate } from '../../lib/format';
import { Button, EmptyState, Modal, SearchInput, Spinner, StatusBadge, Table, useFetch, useToast } from '../ui';
import { EmployeeFormModal, type Employee } from '../EmployeeForm';
import { ScoreBar } from './ScoreBits';
import { STAGE_LABEL, candidateName, type Candidate, type HireDefaults } from './types';

/**
 * Hire flow: loads /hire-defaults for the candidate and opens the Add-employee form prefilled; the form
 * submits to /hire. On success the caller is told (and by default we navigate to the new profile with
 * the temporary password in the router state, like the plain Add-employee flow).
 */
export function HireModal({ candidate, onClose, onHired }: { candidate: Pick<Candidate, 'id' | 'first_name' | 'last_name'>; onClose: () => void; onHired?: (emp: Employee & { temporary_password?: string }) => void }) {
  const navigate = useNavigate();
  const toast = useToast();
  const defaults = useFetch<HireDefaults>(() => api.get(`/api/recruitment/candidates/${candidate.id}/hire-defaults`), [candidate.id]);
  if (defaults.error) {
    return <Modal open title="Hire candidate" onClose={onClose}><div className="alert alert-error">{defaults.error}</div></Modal>;
  }
  if (!defaults.data) return <Modal open title="Hire candidate" onClose={onClose}><Spinner label="Preparing the employee form…" /></Modal>;
  const d = defaults.data;
  return (
    <EmployeeFormModal
      mode="create"
      candidateId={candidate.id}
      candidateName={candidateName(candidate)}
      prefill={{ first_name: d.first_name, last_name: d.last_name, email: d.email, phone: d.phone, position_id: d.position_id, department_id: d.department_id, manager_id: d.manager_id, employment_type: d.employment_type, employee_code: d.employee_code, join_date: d.join_date, status: d.status, vacancy_id: d.vacancy_id, create_login: d.create_login, login_role: d.login_role }}
      onClose={onClose}
      onSaved={(saved) => {
        if (saved.temporary_password) toast.info(`Temporary password for ${saved.email}: ${saved.temporary_password}`);
        if (onHired) onHired(saved);
        else navigate(`/employees/${saved.id}`, { state: saved.temporary_password ? { temporary_password: saved.temporary_password, login_email: saved.email } : undefined });
      }}
    />
  );
}

/** Picker used by Employees → "From recruitment": candidates in the interview / offer stages. */
export function CandidatePicker({ onPick, onClose }: { onPick: (c: Candidate) => void; onClose: () => void }) {
  const [q, setQ] = useState('');
  const list = useFetch<{ items: Candidate[] }>(() => api.get(`/api/recruitment/candidates${qs({ stage: 'offer,interview', sort: 'score' })}`), []);
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (list.data?.items || []).filter((c) => !needle || candidateName(c).toLowerCase().includes(needle) || (c.vacancy_title || '').toLowerCase().includes(needle) || (c.email || '').toLowerCase().includes(needle));
  }, [list.data, q]);
  return (
    <Modal open wide title="Add employee from recruitment" onClose={onClose} testId="candidate-picker"
      footer={<Button onClick={onClose}>Cancel</Button>}>
      <p className="help" style={{ marginTop: 0 }}>Candidates in the <strong>Interview</strong> or <strong>Offer</strong> stage. Pick one to open the employee form prefilled from their CV; the hire completes their recruitment journey automatically.</p>
      <div className="toolbar"><SearchInput value={q} onChange={setQ} placeholder="Search candidates…" /></div>
      {list.loading && !list.data ? <Spinner /> : !rows.length ? (
        <EmptyState title="No candidates ready to hire" description="Move candidates to Interview or Offer in Recruitment first." action={<Button onClick={() => { onClose(); window.location.assign('/recruitment?tab=pipeline'); }}>Open recruitment</Button>} />
      ) : (
        <Table<Candidate>
          rows={rows}
          onRowClick={onPick}
          columns={[
            { key: 'name', header: 'Candidate', render: (c) => <span><strong>{candidateName(c)}</strong><div className="muted">{c.email || '—'}</div></span> },
            { key: 'vacancy_title', header: 'Vacancy', render: (c) => c.vacancy_title || <span className="muted">Unassigned</span> },
            { key: 'stage', header: 'Stage', render: (c) => <StatusBadge status={c.stage === 'offer' ? 'approved' : 'in_progress'} label={STAGE_LABEL[c.stage]} /> },
            { key: 'score', header: 'Score', render: (c) => <ScoreBar score={c.score} /> },
            { key: 'created_at', header: 'Added', render: (c) => fmtDate(c.created_at) },
            { key: 'pick', header: '', align: 'right', render: (c) => <Button size="sm" variant="primary" onClick={(e) => { e.stopPropagation(); onPick(c); }} data-testid={`pick-candidate-${c.id}`}>Hire</Button> },
          ]}
        />
      )}
    </Modal>
  );
}
