import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { Icon } from '../Icons';
import { Badge, Button, Card, EmptyState, Field, Input, Spinner, downloadUrl, useFetch, useToast } from '../ui';

/* ------------------------------------------------------------------ */
/* Output files for one pay run                                        */
/* ------------------------------------------------------------------ */
interface Excluded { employee_id: number; employee_code: string; name: string; reason: string }
export interface OutputFile {
  kind: string;
  name: string;
  description: string;
  portal: string;
  format: string;
  category: 'register' | 'statutory' | 'bank';
  available: boolean;
  preview_only: boolean;
  records: number;
  excluded: Excluded[];
  warnings: string[];
  notes: string[];
}
interface OutputList { run: { id: number; period: string; status: string }; country: string; currency: string; pay_date: string; files: OutputFile[] }

const CATEGORY: Record<OutputFile['category'], { label: string; tone: 'info' | 'success' | 'neutral' }> = {
  register: { label: 'Register', tone: 'neutral' },
  statutory: { label: 'Statutory filing', tone: 'info' },
  bank: { label: 'Salary payment', tone: 'success' },
};

/** "Output files" card on a processed / approved / paid run. */
export default function OutputFiles({ runId, status }: { runId: number; status: string }) {
  const toast = useToast();
  // Reload when the run moves (approval unlocks the bank files).
  const list = useFetch<OutputList>(() => api.get(`/api/payroll-files/runs/${runId}`), [runId, status]);
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const download = async (f: OutputFile, preview = false) => {
    const key = `${f.kind}${preview ? ':preview' : ''}`;
    setBusy(key);
    try {
      await downloadUrl(`/api/payroll-files/runs/${runId}/${f.kind}${preview ? '?preview=1' : ''}`);
      toast.success(preview ? `${f.name}: preview downloaded` : `${f.name} downloaded`);
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(null);
    }
  };

  const files = list.data?.files || [];
  const firstBank = files.find((f) => f.category === 'bank')?.kind;
  return (
    <Card
      title={<span className="row" style={{ gap: 8 }}><Icon name="download" size={16} /> Output files</span>}
      className="mb"
      tour="payroll-run-files"
      actions={<span className="muted" style={{ fontSize: 12.5 }}>Generated from this run’s payslips</span>}
    >
      {list.loading && !list.data ? <Spinner /> : null}
      {list.error ? <div className="alert alert-error">{list.error}</div> : null}
      {list.data && !files.length ? <EmptyState title="No output files" description="Nothing to generate for this run." /> : null}
      <ul className="output-files" data-testid="payroll-output-files">
        {files.map((f, i) => {
          const left = f.excluded.length;
          const expanded = open === f.kind;
          return (
            <li key={f.kind} className="output-file" data-testid={`payroll-file-${f.kind}`} data-tour={i === 0 ? 'payroll-run-file-first' : f.kind === firstBank ? 'payroll-run-file-bank' : undefined}>
              <div className="output-file-main">
                <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                  <strong>{f.name}</strong>
                  <Badge tone={CATEGORY[f.category].tone}>{CATEGORY[f.category].label}</Badge>
                  <span className="chip chip-muted">{f.format}</span>
                  {left ? (
                    <button type="button" className="chip chip-warning" title={f.excluded.map((e) => `${e.name} (${e.employee_code}): ${e.reason}`).join('\n')} aria-expanded={expanded} onClick={() => setOpen(expanded ? null : f.kind)} data-testid={`payroll-file-warnings-${f.kind}`}>
                      <Icon name="alert" size={12} /> {left} left out
                    </button>
                  ) : <span className="chip chip-success"><Icon name="check" size={12} /> {f.records} {f.records === 1 ? 'record' : 'records'}</span>}
                </div>
                <div className="output-file-desc">{f.description}</div>
                <div className="output-file-portal"><Icon name="upload" size={12} /> Upload to: {f.portal}</div>
                {expanded ? (
                  <div className="alert alert-warning output-file-excluded">
                    {f.warnings.map((w) => <div key={w}>{w}</div>)}
                    <ul className="list">
                      {f.excluded.map((e) => (
                        <li key={e.employee_id}><span><Link to={`/employees/${e.employee_id}`}>{e.name}</Link> <span className="mono muted">{e.employee_code}</span></span><span className="meta">{e.reason}</span></li>
                      ))}
                    </ul>
                    <div className="help">Fix the employee record (bank details, IBAN, UAN…) and download again; the file is rebuilt every time.</div>
                  </div>
                ) : null}
                {f.notes.map((n) => <div key={n} className="help">{n}</div>)}
              </div>
              <div className="output-file-actions">
                {f.available ? (
                  <Button size="sm" variant={f.category === 'register' ? 'primary' : 'secondary'} loading={busy === f.kind} onClick={() => download(f)} data-testid={`payroll-file-download-${f.kind}`}>
                    <Icon name="download" size={14} /> Download
                  </Button>
                ) : (
                  <div className="output-file-wait">
                    <span className="muted">Available after the client approves the register</span>
                    <button type="button" className="btn btn-link btn-sm" disabled={busy === `${f.kind}:preview`} onClick={() => download(f, true)} data-testid={`payroll-file-preview-${f.kind}`}>Download preview</button>
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* File settings (employer ids used in the files)                      */
/* ------------------------------------------------------------------ */
interface FileField { key: string; label: string; hint: string; value: string; placeholder: boolean }
interface FileSettingsView { country: string; fields: FileField[] }

export function FileSettingsCard() {
  const toast = useToast();
  const view = useFetch<FileSettingsView>(() => api.get('/api/payroll-files/settings'), []);
  const [form, setForm] = useState<Record<string, string> | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (view.data && !form) setForm(Object.fromEntries(view.data.fields.map((f) => [f.key, f.value])));
  }, [view.data, form]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form || !view.data) return;
    setBusy(true);
    try {
      const saved = await api.put<FileSettingsView>('/api/payroll-files/settings', form);
      view.setData(saved);
      setForm(Object.fromEntries(saved.fields.map((f) => [f.key, f.value])));
      toast.success('File settings saved');
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="File settings" tour="payroll-file-settings" className="mt">
      {view.loading && !view.data ? <Spinner /> : null}
      {view.data && form ? (
        <form onSubmit={save}>
          <p className="help" style={{ marginTop: 0 }}>Employer ids and bank codes printed in this company’s output files (bank, WPS, ACH and statutory uploads). Fields marked “demo placeholder” still hold a generated value: replace them with the real ids before uploading a file.</p>
          <div className="form-grid">
            {view.data.fields.map((f) => (
              <Field key={f.key} label={f.label} hint={f.placeholder ? `${f.hint} (demo placeholder)` : f.hint}>
                <Input value={form[f.key] ?? ''} onChange={(e) => setForm((s) => ({ ...(s || {}), [f.key]: e.target.value }))} data-testid={`payroll-file-setting-${f.key}`} />
              </Field>
            ))}
          </div>
          <div className="row mt" style={{ justifyContent: 'flex-end' }}>
            <Button type="button" onClick={() => setForm(Object.fromEntries(view.data!.fields.map((f) => [f.key, f.value])))}>Reset</Button>
            <Button type="submit" variant="primary" loading={busy} data-testid="payroll-file-settings-save">Save file settings</Button>
          </div>
        </form>
      ) : null}
    </Card>
  );
}
