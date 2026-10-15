import React, { useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api';
import { fmtDateTime } from '../../lib/format';
import { Badge, Button, Field, Select, Spinner, Textarea, useFetch, useToast } from '../../components/ui';
import { Icon } from '../../components/Icons';
import { CompanyChip, Drawer, PRIORITIES, PriorityBadge, SR_STATUSES, SR_STATUS_LABEL, SlaChip, SrStatusBadge, cap, isActive, type ServiceRequest, type ThreadMessage } from './shared';

/**
 * Service request detail: thread, reply box and the controls each side may use.
 * `base` is the services API root: `/api/services` inside a company, or
 * `/api/c/<slug>/services` from the agency portal (api.ts leaves `/api/c/...` alone).
 */
export function RequestDrawer({ base, id, agencySide, myAgencyId, onClose, onChanged, company }: {
  base: string;
  id: number | null;
  agencySide: boolean;
  myAgencyId?: number | null;
  onClose: () => void;
  onChanged?: () => void;
  company?: { name: string; color?: string | null } | null;
}) {
  const toast = useToast();
  const req = useFetch<(ServiceRequest & { thread: ThreadMessage[] }) | null>(() => (id ? api.get(`${base}/requests/${id}`) : Promise.resolve(null)), [base, id]);
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const threadEnd = useRef<HTMLDivElement>(null);
  const r = req.data;
  useEffect(() => { setReply(''); }, [id]);
  useEffect(() => { threadEnd.current?.scrollIntoView({ block: 'end' }); }, [r?.thread?.length]);

  const mutate = async (key: string, fn: () => Promise<any>, ok: string) => {
    setBusy(key);
    try {
      await fn();
      toast.success(ok);
      await req.reload();
      onChanged?.();
      return true;
    } catch (e: any) {
      toast.error(e);
      return false;
    } finally {
      setBusy(null);
    }
  };
  const send = () => {
    const body = reply.trim();
    if (!body) return toast.error('Write a message first');
    mutate('reply', () => api.post(`${base}/requests/${id}/comments`, { body }), 'Reply sent').then((ok) => { if (ok) setReply(''); });
  };
  const put = (key: string, body: any, ok: string) => mutate(key, () => api.put(`${base}/requests/${id}`, body), ok);

  return (
    <Drawer
      open={id !== null}
      onClose={onClose}
      testId="request-drawer"
      title={r ? <><span className="ops-sr-number">{r.number}</span> {r.subject}</> : 'Service request'}
      subtitle={r ? (
        <div className="row" style={{ gap: 6 }}>
          {company ? <CompanyChip name={company.name} color={company.color} /> : null}
          <SrStatusBadge status={r.status} />
          <PriorityBadge priority={r.priority} />
          <Badge>{cap(r.category)}</Badge>
          <SlaChip r={r} />
        </div>
      ) : null}
      footer={r ? (
        <div className="ops-reply">
          <Textarea rows={3} value={reply} onChange={(e) => setReply(e.target.value)} placeholder={agencySide ? 'Reply to the client…' : 'Reply to the agency…'} data-testid="sr-reply-input"
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send(); }} />
          <div className="row between">
            <small className="muted">{agencySide ? 'Replying moves an open request to In progress.' : 'Your reply hands a waiting request back to the agency.'}</small>
            <Button variant="primary" size="sm" onClick={send} loading={busy === 'reply'} data-testid="sr-reply-send"><Icon name="send" size={14} /> Send</Button>
          </div>
        </div>
      ) : null}
    >
      {req.loading && !r ? <Spinner /> : req.error ? <div className="alert alert-error">{req.error}</div> : r ? (
        <>
          <div className="ops-sr-controls" data-tour="sr-controls">
            {agencySide ? (
              <>
                <Field label="Status">
                  <Select value={r.status} onChange={(e) => put('status', { status: e.target.value }, `Status: ${SR_STATUS_LABEL[e.target.value]}`)} data-testid="sr-status" disabled={!!busy}>
                    {SR_STATUSES.map((s) => <option key={s} value={s}>{SR_STATUS_LABEL[s]}</option>)}
                  </Select>
                </Field>
                <Field label="Priority">
                  <Select value={r.priority} onChange={(e) => put('priority', { priority: e.target.value }, `Priority: ${cap(e.target.value)} (SLA recalculated)`)} data-testid="sr-priority" disabled={!!busy}>
                    {PRIORITIES.map((p) => <option key={p} value={p}>{cap(p)}</option>)}
                  </Select>
                </Field>
                <div className="field">
                  <span className="field-label">Assignee</span>
                  <div className="row" style={{ gap: 6 }}>
                    <span className="ops-assignee">{r.assignee_name || <span className="muted">Unassigned</span>}</span>
                    {r.assignee_agency_user_id !== myAgencyId ? (
                      <Button size="sm" onClick={() => put('assign', { assign_to_me: true }, 'Assigned to you')} loading={busy === 'assign'} data-testid="sr-assign-me">Assign to me</Button>
                    ) : null}
                  </div>
                </div>
              </>
            ) : (
              <div className="row between" style={{ width: '100%' }}>
                <span className="muted">Handled by <strong className="ops-assignee">{r.assignee_name || 'the agency team'}</strong></span>
                {r.status === 'closed' || r.status === 'resolved' ? (
                  <Button size="sm" onClick={() => put('status', { status: 'open' }, 'Request reopened')} loading={busy === 'status'} data-testid="sr-reopen">Reopen</Button>
                ) : (
                  <Button size="sm" onClick={() => put('status', { status: 'closed' }, 'Request closed')} loading={busy === 'status'} data-testid="sr-close">Close request</Button>
                )}
              </div>
            )}
          </div>

          <div className="ops-thread" data-testid="sr-thread">
            <div className="ops-msg side-client ops-msg-origin">
              <div className="ops-msg-meta"><strong>{r.raised_by_name || 'Client HR'}</strong><span>{fmtDateTime(r.created_at)}</span></div>
              <div className="ops-msg-body">{r.description || <span className="muted">No description.</span>}</div>
            </div>
            {r.thread.map((m) => (
              <div key={m.id} className={`ops-msg side-${m.author_side}`} data-testid="sr-message">
                <div className="ops-msg-meta"><strong>{m.author_name}</strong><Badge tone={m.author_side === 'agency' ? 'info' : 'neutral'}>{m.author_side === 'agency' ? 'Agency' : 'Client'}</Badge><span>{fmtDateTime(m.created_at)}</span></div>
                <div className="ops-msg-body">{m.body}</div>
              </div>
            ))}
            {!r.thread.length ? <p className="muted ops-thread-empty">No replies yet.{isActive(r) && agencySide ? ' Acknowledge the request so the client knows it is being handled.' : ''}</p> : null}
            <div ref={threadEnd} />
          </div>
        </>
      ) : null}
    </Drawer>
  );
}
