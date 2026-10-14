import React, { useState } from 'react';
import { api } from '../../lib/api';
import { fmtDateTime } from '../../lib/format';
import { Button, Card, EmptyState, Input, Spinner, useToast } from '../ui';
import { Icon } from '../Icons';
import { Letter, LetterDetailModal, LetterStatusBadge, humanize } from './shared';

/** HR queue: self-service requests awaiting approval, and approved letters still waiting for their PDF. */
export function LetterRequests({ letters, loading, onChanged }: { letters: Letter[]; loading: boolean; onChanged: () => void }) {
  const toast = useToast();
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const queue = letters.filter((l) => l.status === 'requested' || l.status === 'approved');

  const act = async (l: Letter, action: 'approve' | 'approve_generate' | 'reject' | 'generate') => {
    setBusy(`${l.id}-${action}`);
    const note = notes[l.id]?.trim() || undefined;
    try {
      if (action === 'reject') {
        await api.post(`/api/letters/${l.id}/reject`, { note });
        toast.success(`Rejected ${l.employee_name}'s ${l.template_name || 'letter'} request`);
      } else if (action === 'generate') {
        const out = await api.post<Letter>(`/api/letters/${l.id}/generate`, {});
        toast.success(`Generated ${out.title} for ${l.employee_name}`);
        if (out.missing?.length) toast.info(`Some fields were left blank: ${out.missing.join(', ')}`);
      } else {
        const out = await api.post<Letter>(`/api/letters/${l.id}/approve`, { note, generate: action === 'approve_generate' });
        toast.success(action === 'approve_generate' ? `Approved and generated ${out.title} for ${l.employee_name}` : `Approved ${l.employee_name}'s ${l.template_name || 'letter'} request`);
        if (out.missing?.length) toast.info(`Some fields were left blank: ${out.missing.join(', ')}`);
      }
      setNotes((n) => { const c = { ...n }; delete c[l.id]; return c; });
      onChanged();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(null);
    }
  };

  if (loading && !letters.length) return <Spinner />;
  return (
    <div data-tour="letters-requests">
      {!queue.length ? (
        <Card><EmptyState icon="✓" title="No letter requests waiting" description="Self-service requests from employees appear here for approval and PDF generation." /></Card>
      ) : (
        <div className="grid grid-2">
          {queue.map((l) => {
            const vars = Object.entries(l.variables || {}).filter(([, v]) => v);
            return (
              <div key={l.id} className="card approval-card" data-testid="letter-request-card">
                <div className="card-body">
                  <div className="row between">
                    <span><strong>{l.employee_name}</strong> <span className="muted mono">{l.employee_code}</span>{l.department_name ? <span className="muted"> · {l.department_name}</span> : null}</span>
                    <LetterStatusBadge status={l.status} />
                  </div>
                  <div className="row" style={{ marginTop: 8 }}>
                    <Icon name="mail" size={15} /> <strong>{l.template_name || l.title}</strong>
                  </div>
                  {vars.length ? <div className="chip-list" style={{ marginTop: 8 }}>{vars.map(([k, v]) => <span key={k} className="chip"><strong>{humanize(k)}:</strong> {String(v)}</span>)}</div> : null}
                  <p className="muted" style={{ margin: '8px 0' }}>{l.reason || <em>No reason given</em>}</p>
                  <div className="row between" style={{ fontSize: 12 }}>
                    <span className="muted">Requested {fmtDateTime(l.created_at)}{l.requested_by_name ? ` by ${l.requested_by_name}` : ''} · <button type="button" className="btn btn-link" onClick={() => setOpen(l.id)}>details</button></span>
                    {l.status === 'approved' && l.approved_by_name ? <span className="audit-trail">Approved by {l.approved_by_name}</span> : <span className="pending-with"><Icon name="clock" size={13} /> Pending with HR</span>}
                  </div>
                  <div className="row" style={{ marginTop: 10 }}>
                    <Input placeholder="Note to employee (optional)" value={notes[l.id] || ''} onChange={(e) => setNotes({ ...notes, [l.id]: e.target.value })} style={{ flex: 1 }} data-testid="letter-review-note" />
                  </div>
                  <div className="row end" style={{ marginTop: 8 }}>
                    <Button variant="danger" size="sm" loading={busy === `${l.id}-reject`} disabled={!!busy} onClick={() => act(l, 'reject')} data-testid="letter-reject">Reject</Button>
                    {l.status === 'requested' ? (
                      <>
                        <Button size="sm" loading={busy === `${l.id}-approve`} disabled={!!busy} onClick={() => act(l, 'approve')} data-testid="letter-approve">Approve</Button>
                        <Button variant="primary" size="sm" loading={busy === `${l.id}-approve_generate`} disabled={!!busy} onClick={() => act(l, 'approve_generate')} data-testid="letter-approve-generate">Approve and generate PDF</Button>
                      </>
                    ) : (
                      <Button variant="primary" size="sm" loading={busy === `${l.id}-generate`} disabled={!!busy} onClick={() => act(l, 'generate')} data-testid="letter-generate">Generate PDF</Button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {open ? <LetterDetailModal id={open} onClose={() => setOpen(null)} /> : null}
    </div>
  );
}
