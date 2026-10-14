import React, { useMemo, useState } from 'react';
import { api } from '../../lib/api';
import { fmtDate } from '../../lib/format';
import { Button, Card, EmptyState, SearchInput, Select, Table, useConfirm, useToast } from '../ui';
import { Icon } from '../Icons';
import { Letter, LetterDetailModal, LetterStatusBadge, LetterStatus, LetterTemplate, NoteModal, STATUS_META, downloadLetter, letterRef } from './shared';

/** HR: every letter in the company with filters, generation, rejection and deletion. */
export function AllLetters({ letters, loading, templates, onChanged, onIssue }: { letters: Letter[]; loading: boolean; templates: LetterTemplate[]; onChanged: () => void; onIssue: () => void }) {
  const toast = useToast();
  const { confirm, dialog } = useConfirm();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [open, setOpen] = useState<number | null>(null);
  const [rejecting, setRejecting] = useState<Letter | null>(null);
  const [busy, setBusy] = useState<number | null>(null);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return letters.filter((l) =>
      (!status || l.status === status) &&
      (!templateId || String(l.template_id) === templateId) &&
      (!needle || `${l.employee_name} ${l.employee_code} ${l.title} ${letterRef(l)}`.toLowerCase().includes(needle)));
  }, [letters, q, status, templateId]);

  const generate = async (l: Letter) => {
    setBusy(l.id);
    try {
      const out = await api.post<Letter>(`/api/letters/${l.id}/generate`, {});
      toast.success(l.status === 'generated' ? `Regenerated ${out.title}` : `Generated ${out.title} for ${l.employee_name}`);
      if (out.missing?.length) toast.info(`Some fields were left blank: ${out.missing.join(', ')}`);
      onChanged();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(null);
    }
  };
  const remove = async (l: Letter) => {
    if (!(await confirm('Delete letter?', `${l.title} for ${l.employee_name} will be deleted, together with its PDF in the employee's documents.`))) return;
    try {
      await api.delete(`/api/letters/${l.id}`);
      toast.success('Letter deleted');
      setOpen(null);
      onChanged();
    } catch (err) {
      toast.error(err);
    }
  };
  const reject = async (l: Letter, note: string) => {
    try {
      await api.post(`/api/letters/${l.id}/reject`, { note: note || undefined });
      toast.success(`Rejected ${l.title} for ${l.employee_name}`);
      setRejecting(null);
      onChanged();
    } catch (err) {
      toast.error(err);
    }
  };

  return (
    <>
      <div className="toolbar" data-tour="letters-filters">
        <SearchInput value={q} onChange={setQ} placeholder="Search employee, letter or reference…" />
        <Select value={status} onChange={(e) => setStatus(e.target.value)} data-testid="letters-filter-status" aria-label="Status">
          <option value="">All statuses</option>
          {(Object.keys(STATUS_META) as LetterStatus[]).map((s) => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
        </Select>
        <Select value={templateId} onChange={(e) => setTemplateId(e.target.value)} aria-label="Template">
          <option value="">All letter types</option>
          {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </Select>
        <span className="muted">{rows.length} of {letters.length}</span>
      </div>
      <Card padded={false} tour="letters-all">
        <Table<Letter>
          loading={loading && !letters.length}
          rows={rows}
          onRowClick={(l) => setOpen(l.id)}
          empty={<EmptyState title="No letters" description={letters.length ? 'No letters match these filters.' : 'Issue a letter to an employee or wait for self-service requests.'} action={!letters.length ? <Button variant="primary" onClick={onIssue}>Issue a letter</Button> : undefined} />}
          columns={[
            { key: 'ref', header: 'Reference', render: (l) => <span className="mono">{letterRef(l)}</span> },
            { key: 'employee_name', header: 'Employee', render: (l) => <span><strong>{l.employee_name}</strong> <span className="muted mono">{l.employee_code}</span>{l.department_name ? <div className="muted">{l.department_name}</div> : null}</span> },
            { key: 'title', header: 'Letter', render: (l) => <span data-testid="all-letter-title">{l.title}</span> },
            { key: 'status', header: 'Status', render: (l) => <LetterStatusBadge status={l.status} /> },
            { key: 'requested_by_name', header: 'Requested by', render: (l) => <span className="muted">{l.requested_by_name || '—'}</span> },
            { key: 'created_at', header: 'Created', render: (l) => fmtDate(l.created_at) },
            {
              key: 'actions', header: '', align: 'right', render: (l) => (
                <div className="row end" style={{ gap: 4, flexWrap: 'nowrap' }} onClick={(e) => e.stopPropagation()}>
                  {l.status === 'generated' ? (
                    <Button size="sm" variant="ghost" title="Download PDF" aria-label="Download PDF" data-testid="letter-download" onClick={() => downloadLetter(l).catch((err) => toast.error(err))}><Icon name="download" size={15} /></Button>
                  ) : null}
                  {l.status !== 'rejected' ? (
                    <Button size="sm" variant="ghost" loading={busy === l.id} title={l.status === 'generated' ? 'Regenerate PDF' : 'Generate PDF'} aria-label={l.status === 'generated' ? 'Regenerate PDF' : 'Generate PDF'} data-testid="letter-row-generate" onClick={() => generate(l)}><Icon name="file" size={15} /></Button>
                  ) : null}
                  {l.status === 'requested' || l.status === 'approved' ? (
                    <Button size="sm" variant="ghost" title="Reject" aria-label="Reject" onClick={() => setRejecting(l)}><Icon name="x" size={15} /></Button>
                  ) : null}
                  <Button size="sm" variant="ghost" title="Delete" aria-label="Delete" data-testid="letter-delete" onClick={() => remove(l)}><Icon name="trash" size={15} /></Button>
                </div>
              ),
            },
          ]}
        />
      </Card>
      {open ? <LetterDetailModal id={open} onClose={() => setOpen(null)} actions={(l) => <Button variant="danger" onClick={() => remove(l)}><Icon name="trash" size={15} /> Delete</Button>} /> : null}
      {rejecting ? <NoteModal title={`Reject ${rejecting.title}`} confirmLabel="Reject" danger onClose={() => setRejecting(null)} onSubmit={(note) => reject(rejecting, note)} /> : null}
      {dialog}
    </>
  );
}
