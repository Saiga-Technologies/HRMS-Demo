import React, { useState } from 'react';
import { api, apiUrl } from '../../lib/api';
import { fmtDate, fmtDateTime } from '../../lib/format';
import { Badge, Button, Field, Input, KeyValue, Modal, Spinner, Textarea, downloadUrl, useFetch, useToast } from '../ui';
import { Icon } from '../Icons';

/* ---------- Types mirrored from server/src/routes/letters.ts ---------- */
export type LetterStatus = 'requested' | 'approved' | 'generated' | 'rejected';
export interface LetterTemplate {
  id: number; code: string; name: string; category: string; subject: string; body: string;
  self_service: number; requires_approval: number; active: number; created_at: string; updated_at: string; variables: string[];
}
export interface Letter {
  id: number; employee_id: number; template_id: number | null; title: string; body_rendered: string | null; variables: Record<string, string> | null;
  pdf_stored_name: string | null; document_id: number | null; status: LetterStatus; reason: string | null; note: string | null;
  requested_by: number | null; approved_by: number | null; approved_at: string | null; generated_at: string | null; created_at: string;
  employee_name: string; employee_code: string; department_name: string | null; template_name: string | null; template_code: string | null; template_category: string | null;
  requested_by_name: string | null; approved_by_name: string | null; missing?: string[];
}
export interface Placeholder { key: string; description: string }
export interface DirectoryEmployee { id: number; employee_code: string; first_name: string; last_name: string; department_name?: string | null; position_title?: string | null }
export interface LetterPreview { title: string; body_rendered: string; missing: string[]; ref: string; variables: string[] }

export const CATEGORIES = ['general', 'offer', 'appointment', 'experience', 'relieving', 'salary', 'address'];
export const STATUS_META: Record<LetterStatus, { label: string; tone: 'warning' | 'success' | 'info' | 'danger' }> = {
  requested: { label: 'Awaiting approval', tone: 'warning' },
  approved: { label: 'Approved, not generated', tone: 'success' },
  generated: { label: 'Ready', tone: 'info' },
  rejected: { label: 'Rejected', tone: 'danger' },
};

export function LetterStatusBadge({ status }: { status: LetterStatus }) {
  const m = STATUS_META[status] || { label: status, tone: 'neutral' as const };
  return <span data-testid="letter-status"><Badge tone={m.tone as any}>{m.label}</Badge></span>;
}

/** Mirrors the server's letterRef(): HR/LET/<year>/<id padded to 4>. */
export function letterRef(l: { id: number; created_at?: string | null }) {
  return `HR/LET/${(l.created_at || new Date().toISOString()).slice(0, 4)}/${String(l.id).padStart(4, '0')}`;
}
export function employeeLabel(e: { first_name?: string; last_name?: string; employee_code?: string }) {
  return `${[e.first_name, e.last_name].filter(Boolean).join(' ')}${e.employee_code ? ` (${e.employee_code})` : ''}`;
}
export function humanize(name: string) {
  const s = name.replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}
export function pdfFileName(l: Letter) {
  return `${(l.title || 'letter').replace(/[^a-zA-Z0-9 _-]/g, '').trim() || 'letter'}.pdf`;
}

/** Inputs for a template's {{var.*}} placeholders. */
export function VariableFields({ names, values, onChange }: { names: string[]; values: Record<string, string>; onChange: (v: Record<string, string>) => void }) {
  if (!names.length) return null;
  return (
    <>
      <div className="form-section">Letter details</div>
      {names.map((n) => (
        <Field key={n} label={humanize(n)} hint={`Fills {{var.${n}}}`}>
          <Input value={values[n] || ''} onChange={(e) => onChange({ ...values, [n]: e.target.value })} data-testid={`letter-var-${n}`} placeholder={n === 'purpose' ? 'e.g. visa application' : undefined} />
        </Field>
      ))}
    </>
  );
}

/** Rendered letter text (subject + body) in a paper-like block. */
export function LetterPaper({ title, body, refNo, missing }: { title: string; body: string; refNo?: string; missing?: string[] }) {
  return (
    <div data-testid="letter-preview">
      {missing && missing.length ? (
        <div className="row" style={{ marginBottom: 10, padding: '8px 10px', borderRadius: 8, background: 'var(--warning-bg)', color: 'var(--warning-ink)', border: '1px solid var(--warning-border)', fontSize: 13 }} data-testid="letter-missing">
          <Icon name="alert" size={15} /> Blank in the letter: {missing.map((m) => <code key={m} className="mono">{m}</code>)}
        </div>
      ) : null}
      <div style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 10, padding: '18px 20px', maxHeight: '50vh', overflow: 'auto' }}>
        {refNo ? <div className="muted mono" style={{ marginBottom: 8 }}>Ref: {refNo}</div> : null}
        <div style={{ fontWeight: 650, textAlign: 'center', textDecoration: 'underline', marginBottom: 12 }}>{title}</div>
        <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6, color: 'var(--text)', fontSize: 13.5 }}>{body}</div>
      </div>
    </div>
  );
}

/** Calls the template preview endpoint and shows the rendered letter. */
export function usePreview() {
  const toast = useToast();
  const [preview, setPreview] = useState<LetterPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (templateId: number, employeeId: number | null | undefined, variables: Record<string, string>) => {
    setBusy(true);
    try {
      setPreview(await api.post<LetterPreview>(`/api/letters/templates/${templateId}/preview`, { employee_id: employeeId || undefined, variables }));
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };
  return { preview, setPreview, busy, run };
}

export async function downloadLetter(l: Letter) {
  await downloadUrl(`/api/letters/${l.id}/pdf?download=1`, pdfFileName(l));
}

/** Detail of one letter: metadata, rendered text and the PDF when generated. */
export function LetterDetailModal({ id, onClose, actions }: { id: number; onClose: () => void; actions?: (l: Letter) => React.ReactNode }) {
  const toast = useToast();
  const res = useFetch<Letter>(() => api.get(`/api/letters/${id}`), [id]);
  const l = res.data;
  const vars = Object.entries(l?.variables || {}).filter(([, v]) => v !== '' && v !== null && v !== undefined);
  return (
    <Modal open wide title={l ? l.title : 'Letter'} onClose={onClose} testId="letter-detail"
      footer={l ? (
        <>
          {actions ? actions(l) : null}
          {l.status === 'generated' ? (
            <Button variant="primary" data-testid="letter-detail-download" onClick={() => downloadLetter(l).catch((e) => toast.error(e))}><Icon name="download" size={15} /> Download PDF</Button>
          ) : null}
          <Button onClick={onClose}>Close</Button>
        </>
      ) : undefined}>
      {!l ? <Spinner /> : (
        <div className="stack">
          <KeyValue items={[
            { k: 'Reference', v: <span className="mono">{letterRef(l)}</span> },
            { k: 'Employee', v: `${l.employee_name} (${l.employee_code})` },
            { k: 'Template', v: l.template_name || 'Deleted template' },
            { k: 'Status', v: <LetterStatusBadge status={l.status} /> },
            { k: 'Requested', v: `${fmtDateTime(l.created_at)}${l.requested_by_name ? ` by ${l.requested_by_name}` : ''}` },
            ...(l.approved_at ? [{ k: l.status === 'rejected' ? 'Rejected' : 'Approved', v: `${fmtDateTime(l.approved_at)}${l.approved_by_name ? ` by ${l.approved_by_name}` : ''}` }] : []),
            ...(l.generated_at ? [{ k: 'Generated', v: fmtDate(l.generated_at) }] : []),
          ]} />
          {l.reason ? <div><div className="section-title">Reason</div><div>{l.reason}</div></div> : null}
          {l.note ? <div><div className="section-title">HR note</div><div data-testid="letter-note">{l.note}</div></div> : null}
          {vars.length ? (
            <div>
              <div className="section-title">Details supplied</div>
              <div className="chip-list">{vars.map(([k, v]) => <span key={k} className="chip"><strong>{humanize(k)}:</strong> {String(v)}</span>)}</div>
            </div>
          ) : null}
          {l.status === 'generated' && l.pdf_stored_name ? (
            <iframe className="doc-preview" src={apiUrl(`/api/letters/${l.id}/pdf`)} title={l.title} data-testid="letter-pdf" />
          ) : l.body_rendered ? (
            <LetterPaper title={l.title} body={l.body_rendered} refNo={letterRef(l)} />
          ) : (
            <p className="muted">The PDF will be available here once HR generates the letter.</p>
          )}
        </div>
      )}
    </Modal>
  );
}

/** Note box used when rejecting or approving with a note. */
export function NoteModal({ title, confirmLabel, danger, onSubmit, onClose }: { title: string; confirmLabel: string; danger?: boolean; onSubmit: (note: string) => Promise<void>; onClose: () => void }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Modal open title={title} onClose={onClose} testId="letter-note-modal"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant={danger ? 'danger' : 'primary'} loading={busy} data-testid="letter-note-submit"
            onClick={async () => { setBusy(true); try { await onSubmit(note.trim()); } finally { setBusy(false); } }}>{confirmLabel}</Button>
        </>
      }>
      <Field label="Note to the employee" hint="Shown on the letter request.">
        <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} data-testid="letter-note-input" autoFocus />
      </Field>
    </Modal>
  );
}
