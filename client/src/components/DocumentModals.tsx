import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fmtDate, fmtDateTime } from '../lib/format';
import { Badge, Button, ExpiryDot, Field, Input, KeyValue, Modal, Select, StatusBadge, Textarea, useConfirm, useFetch, useForm, useToast } from './ui';

/* ------------------------------------------------------------------ */
/* Shared document types & helpers                                     */
/* ------------------------------------------------------------------ */
export interface DocumentType {
  id: number;
  name: string;
  description?: string | null;
  allowed_formats: string[];
  requires_expiry: number;
  expiry_warning_days: number;
  expiry_critical_days: number;
  required_for_all: number;
  max_size_mb: number;
  category?: string | null;
  active: number;
}
export type ExpiryState = 'ok' | 'warning' | 'critical' | 'expired' | 'none';
export interface DocumentRow {
  id: number;
  employee_id: number;
  document_type_id: number | null;
  title: string;
  original_name: string;
  stored_name: string;
  mime: string;
  format: string;
  size_bytes: number;
  issued_date?: string | null;
  expiry_date?: string | null;
  document_number?: string | null;
  notes?: string | null;
  status: string;
  uploaded_by?: number | null;
  created_at: string;
  type_name?: string | null;
  category?: string | null;
  employee_name?: string | null;
  employee_code?: string | null;
  expiry_state: ExpiryState;
  days_to_expiry: number | null;
  expiry_color?: string;
}
export interface DirectoryEmployee { id: number; employee_code: string; first_name: string; last_name: string; department_name?: string | null; position_title?: string | null }

export const ALL_FORMATS = ['pdf', 'jpg', 'png'];
export const FORMAT_LABEL: Record<string, string> = { pdf: 'PDF', jpg: 'JPG', png: 'PNG' };

/** Build the `accept` attribute for a file input from a type's allowed formats. */
export function acceptFor(formats?: string[] | null): string {
  const list = formats && formats.length ? formats : ALL_FORMATS;
  return list.flatMap((f) => (f === 'jpg' ? ['.jpg', '.jpeg'] : [`.${f}`])).join(',');
}
export function formatOfFile(name: string): string | null {
  const ext = (name.split('.').pop() || '').toLowerCase();
  if (ext === 'jpeg') return 'jpg';
  return ALL_FORMATS.includes(ext) ? ext : null;
}
export function fmtBytes(n?: number | null): string {
  if (n === undefined || n === null) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
export const documentFileUrl = (id: number, download = false) => `/api/documents/${id}/file${download ? '?download=1' : ''}`;

export function FormatBadge({ format }: { format?: string | null }) {
  const f = (format || '').toLowerCase();
  const tone = f === 'pdf' ? 'danger' : f === 'png' ? 'info' : f === 'jpg' ? 'warning' : 'neutral';
  return <Badge tone={tone}>{FORMAT_LABEL[f] || (f ? f.toUpperCase() : '—')}</Badge>;
}

export const EXPIRY_COLORS: Record<string, string> = { ok: '#16a34a', warning: '#ca8a04', critical: '#ea580c', expired: '#dc2626', none: '#9ca3af', missing: '#9ca3af' };

/** Legend explaining the expiry colour indication. */
export function ExpiryLegend({ withMissing }: { withMissing?: boolean }) {
  const items = [
    { k: 'ok', label: 'OK — valid, outside the warning window' },
    { k: 'warning', label: "Warning — within the type's warning days" },
    { k: 'critical', label: "Critical — within the type's critical days" },
    { k: 'expired', label: 'Expired' },
    { k: 'none', label: withMissing ? 'Missing — no document uploaded' : 'No expiry date' },
  ];
  return (
    <div className="legend" data-tour="documents-legend">
      {items.map((i) => (
        <span key={i.k}><span className="dot" style={{ background: EXPIRY_COLORS[i.k] }} />{i.label}</span>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Preview / edit / delete modal                                       */
/* ------------------------------------------------------------------ */
export function DocumentPreviewModal({ doc, onClose, onChanged, onDeleted }: { doc: DocumentRow; onClose: () => void; onChanged?: (d: DocumentRow) => void; onDeleted?: (id: number) => void }) {
  const { isHr } = useAuth();
  const toast = useToast();
  const { confirm, dialog } = useConfirm();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const f = useForm({ title: doc.title, issued_date: doc.issued_date || '', expiry_date: doc.expiry_date || '', document_number: doc.document_number || '', notes: doc.notes || '' });
  useEffect(() => {
    f.reset({ title: doc.title, issued_date: doc.issued_date || '', expiry_date: doc.expiry_date || '', document_number: doc.document_number || '', notes: doc.notes || '' });
    setEditing(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.id]);

  const save = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!f.values.title.trim()) return toast.error('Title is required');
    setBusy(true);
    try {
      const updated = await api.put<DocumentRow>(`/api/documents/${doc.id}`, {
        title: f.values.title.trim(),
        issued_date: f.values.issued_date || null,
        expiry_date: f.values.expiry_date || null,
        document_number: f.values.document_number || null,
        notes: f.values.notes || null,
      });
      toast.success('Document updated');
      setEditing(false);
      onChanged?.(updated);
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!(await confirm('Delete document?', `"${doc.title}" will be permanently removed.`))) return;
    try {
      await api.delete(`/api/documents/${doc.id}`);
      toast.success('Document deleted');
      onDeleted?.(doc.id);
      onClose();
    } catch (err) {
      toast.error(err);
    }
  };

  const isPdf = doc.format === 'pdf' || doc.mime === 'application/pdf';
  const src = documentFileUrl(doc.id);
  return (
    <Modal open wide title={<span className="row">{doc.title} <FormatBadge format={doc.format} /></span>} onClose={onClose} testId="document-preview"
      footer={<>
        {isHr ? <Button variant="danger" onClick={remove} style={{ marginRight: 'auto' }} data-testid="document-delete">Delete</Button> : null}
        <a className="btn btn-secondary btn-md" href={documentFileUrl(doc.id, true)} download={doc.original_name} data-testid="document-download">Download</a>
        {editing ? (
          <>
            <Button onClick={() => setEditing(false)}>Cancel</Button>
            <Button variant="primary" loading={busy} onClick={() => save()} data-testid="document-save">Save</Button>
          </>
        ) : (
          <>
            <Button onClick={() => setEditing(true)} data-testid="document-edit">Edit details</Button>
            <Button variant="primary" onClick={onClose}>Close</Button>
          </>
        )}
      </>}>
      {dialog}
      <div className="doc-layout">
        <div>
          {isPdf ? <iframe className="doc-preview" src={src} title={doc.title} /> : <img className="doc-preview doc-preview-img" src={src} alt={doc.title} />}
        </div>
        <div className="stack">
          {editing ? (
            <form onSubmit={save} className="stack">
              <Field label="Title" required><Input {...f.bind('title')} required autoFocus /></Field>
              <Field label="Document number"><Input {...f.bind('document_number')} /></Field>
              <Field label="Issued date"><Input type="date" {...f.bind('issued_date')} /></Field>
              <Field label="Expiry date"><Input type="date" {...f.bind('expiry_date')} /></Field>
              <Field label="Notes"><Textarea {...f.bind('notes')} rows={3} /></Field>
            </form>
          ) : (
            <KeyValue items={[
              { k: 'Employee', v: doc.employee_name ? <span>{doc.employee_name} {doc.employee_code ? <span className="muted mono">{doc.employee_code}</span> : null}</span> : '—' },
              { k: 'Type', v: doc.type_name || '—' },
              { k: 'Number', v: doc.document_number || '—' },
              { k: 'Issued', v: fmtDate(doc.issued_date) },
              { k: 'Expiry', v: <span className="stack" style={{ gap: 2 }}>{fmtDate(doc.expiry_date)} <ExpiryDot state={doc.expiry_state} days={doc.days_to_expiry} /></span> },
              { k: 'Status', v: <StatusBadge status={doc.status} /> },
              { k: 'File', v: <span className="mono">{doc.original_name}</span> },
              { k: 'Size', v: fmtBytes(doc.size_bytes) },
              { k: 'Uploaded', v: fmtDateTime(doc.created_at) },
              { k: 'Notes', v: doc.notes || '—' },
            ]} />
          )}
        </div>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Upload modal                                                        */
/* ------------------------------------------------------------------ */
export function DocumentUploadModal({ open, employeeId, employees, onClose, onUploaded }: { open: boolean; employeeId?: number | null; employees?: DirectoryEmployee[]; onClose: () => void; onUploaded: (d: DocumentRow) => void }) {
  const toast = useToast();
  const types = useFetch<DocumentType[]>(() => api.get('/api/documents/types'), []);
  const [file, setFile] = useState<File | null>(null);
  const [fileKey, setFileKey] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const blank = () => ({ employee_id: employeeId ? String(employeeId) : '', document_type_id: '', title: '', issued_date: '', expiry_date: '', document_number: '', notes: '' });
  const f = useForm(blank());
  useEffect(() => {
    if (open) {
      f.reset(blank());
      setFile(null);
      setFileKey((k) => k + 1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, employeeId]);

  const activeTypes = useMemo(() => (types.data || []).filter((t) => t.active), [types.data]);
  const type = useMemo(() => activeTypes.find((t) => String(t.id) === String(f.values.document_type_id)) || null, [activeTypes, f.values.document_type_id]);
  const allowed = type?.allowed_formats?.length ? type.allowed_formats : ALL_FORMATS;
  const accept = acceptFor(allowed);
  const fileFormat = file ? formatOfFile(file.name) : null;
  const fileError = !file ? '' : !fileFormat || !allowed.includes(fileFormat) ? `This type accepts ${allowed.map((x) => FORMAT_LABEL[x]).join(', ')} only` : type && file.size > type.max_size_mb * 1024 * 1024 ? `File exceeds the ${type.max_size_mb} MB limit` : '';

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!f.values.employee_id) return toast.error('Choose an employee');
    if (!file) return toast.error('Choose a file to upload');
    if (fileError) return toast.error(fileError);
    if (type?.requires_expiry && !f.values.expiry_date) return toast.error(`${type.name} requires an expiry date`);
    const fd = new FormData();
    fd.append('file', file);
    fd.append('employee_id', String(f.values.employee_id));
    if (f.values.document_type_id) fd.append('document_type_id', String(f.values.document_type_id));
    const title = f.values.title.trim() || type?.name || '';
    if (title) fd.append('title', title);
    if (f.values.issued_date) fd.append('issued_date', f.values.issued_date);
    if (f.values.expiry_date) fd.append('expiry_date', f.values.expiry_date);
    if (f.values.document_number) fd.append('document_number', f.values.document_number);
    if (f.values.notes) fd.append('notes', f.values.notes);
    setBusy(true);
    try {
      const d = await api.upload<DocumentRow>('/api/documents', fd);
      toast.success('Document uploaded');
      onUploaded(d);
      onClose();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} title="Upload document" onClose={onClose} testId="document-upload-modal"
      footer={<>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" loading={busy} onClick={() => submit()} data-testid="document-submit">Upload</Button>
      </>}>
      <form onSubmit={submit} className="form-grid">
        {employees ? (
          <Field label="Employee" required className="span-2">
            <Select {...f.bind('employee_id')} required data-testid="document-employee">
              <option value="">— Select employee —</option>
              {employees.map((e) => <option key={e.id} value={e.id}>{e.first_name} {e.last_name} ({e.employee_code})</option>)}
            </Select>
          </Field>
        ) : null}
        <Field label="Document type" required hint={type ? `Accepts: ${allowed.map((x) => FORMAT_LABEL[x]).join(', ')} · max ${type.max_size_mb} MB${type.requires_expiry ? ' · expiry required' : ''}` : 'Pick a type to see which formats are accepted'} className="span-2">
          <Select {...f.bind('document_type_id')} required data-testid="document-type">
            <option value="">— Select type —</option>
            {activeTypes.map((t) => <option key={t.id} value={t.id}>{t.name}{t.category ? ` (${t.category})` : ''}</option>)}
          </Select>
        </Field>
        <div className="span-2">
          <label
            className={`dropzone ${dragging || file ? 'active' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => { e.preventDefault(); setDragging(false); const dropped = e.dataTransfer.files?.[0]; if (dropped) setFile(dropped); }}>
            <div>{file ? <strong>{file.name}</strong> : 'Drag a file here or click to choose'}</div>
            <div className="help">{file ? `${fmtBytes(file.size)} · ${FORMAT_LABEL[fileFormat || ''] || 'Unsupported format'}` : `Accepted: ${allowed.map((x) => FORMAT_LABEL[x]).join(', ')}`}</div>
            <input key={fileKey} type="file" accept={accept} data-testid="document-file" style={{ marginTop: 8 }} onChange={(e) => setFile(e.target.files?.[0] || null)} />
            {fileError ? <div className="field-error" style={{ marginTop: 6 }}>{fileError}</div> : null}
          </label>
        </div>
        <Field label="Title" hint="Defaults to the document type name" className="span-2"><Input {...f.bind('title')} placeholder={type?.name || 'e.g. Passport'} data-testid="document-title" /></Field>
        <Field label="Issued date"><Input type="date" {...f.bind('issued_date')} /></Field>
        <Field label="Expiry date" required={!!type?.requires_expiry}><Input type="date" {...f.bind('expiry_date')} required={!!type?.requires_expiry} data-testid="document-expiry" /></Field>
        <Field label="Document number" className="span-2"><Input {...f.bind('document_number')} placeholder="Passport / licence / policy number" /></Field>
        <Field label="Notes" className="span-2"><Textarea {...f.bind('notes')} rows={2} /></Field>
      </form>
    </Modal>
  );
}
