import React, { useMemo, useState } from 'react';
import { api } from '../../lib/api';
import { Badge, Button, Checkbox, FileInput, Modal, Spinner, Switch, Table, downloadUrl, useFetch, useToast } from '../ui';
import { Icon } from '../Icons';
import './import.css';

/** Bulk employee import: template → upload & validate → import (server: /api/imports/employees/*). */

interface Issue { field: string; message: string }
interface VRow { row: number; data: Record<string, string>; errors: Issue[]; warnings: Issue[] }
interface Validation {
  rows: VRow[];
  summary: { total: number; valid: number; with_errors: number; warnings: number; will_create: { departments: string[]; positions: { title: string; department: string | null }[] } };
  token: string;
  file_warnings: string[];
  country_code: string;
}
interface Created { row: number; id: number; employee_code: string; name: string; email: string; temporary_password?: string }
interface CommitResult { created: Created[]; skipped: { row: number; name: string; email: string; errors: Issue[] }[]; departments_created: string[]; positions_created: string[] }
interface TemplateInfo {
  country_code: string;
  currency: string;
  columns: { key: string; label: string; required?: boolean; description: string }[];
  formats: { field: string; label: string; format: string; example: string }[];
}

const COUNTRY: Record<string, string> = { IN: 'India', AE: 'UAE', SA: 'Saudi Arabia', QA: 'Qatar', US: 'United States' };
const STEPS = ['Template & upload', 'Check rows', 'Done'];

export function ImportEmployeesModal({ onClose, onImported }: { onClose: () => void; onImported: () => void }) {
  const toast = useToast();
  const [step, setStep] = useState(0);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [v, setV] = useState<Validation | null>(null);
  const [createMissing, setCreateMissing] = useState(true);
  const [skipInvalid, setSkipInvalid] = useState(false);
  const [createLogins, setCreateLogins] = useState(true);
  const [onlyProblems, setOnlyProblems] = useState(false);
  const [result, setResult] = useState<CommitResult | null>(null);
  const info = useFetch<TemplateInfo>(() => api.get('/api/imports/employees/template-info'), []);

  const downloadTemplate = async () => {
    try {
      await downloadUrl('/api/imports/employees/template.csv', `employee-import-${(info.data?.country_code || 'in').toLowerCase()}.csv`);
    } catch (e) { toast.error(e); }
  };

  const validate = async () => {
    if (!file) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('create_missing', createMissing ? '1' : '0');
      setV(await api.upload<Validation>('/api/imports/employees/validate', fd));
      setStep(1);
    } catch (e) { toast.error(e); } finally { setBusy(false); }
  };

  // Re-check the same upload (no re-upload) when "Create missing" changes.
  const revalidate = async (cm: boolean) => {
    setCreateMissing(cm);
    if (!v) return;
    setBusy(true);
    try {
      setV(await api.post<Validation>('/api/imports/employees/validate', { token: v.token, rows: v.rows.map((r) => r.data), create_missing: cm }));
    } catch (e) { toast.error(e); } finally { setBusy(false); }
  };

  const commit = async () => {
    if (!v) return;
    setBusy(true);
    try {
      const res = await api.post<CommitResult>('/api/imports/employees/commit', {
        token: v.token, rows: v.rows.map((r) => r.data), skip_invalid: skipInvalid, create_missing: createMissing, send_logins: createLogins,
      });
      setResult(res);
      setStep(2);
      toast.success(`${res.created.length} employee${res.created.length === 1 ? '' : 's'} imported`);
      onImported();
    } catch (e) { toast.error(e); } finally { setBusy(false); }
  };

  const copyAll = async () => {
    if (!result) return;
    const lines = ['Name\tEmail (user ID)\tEmployee code\tTemporary password', ...result.created.map((c) => [c.name, c.email, c.employee_code, c.temporary_password || '(no login)'].join('\t'))];
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      toast.success('Copied to the clipboard');
    } catch {
      toast.error('Copy failed. Select the table and copy it manually.');
    }
  };

  const rows = useMemo(() => (v ? (onlyProblems ? v.rows.filter((r) => r.errors.length || r.warnings.length) : v.rows) : []), [v, onlyProblems]);
  const willCreate = v ? v.summary.will_create.departments.length + v.summary.will_create.positions.length : 0;
  const importable = v ? (skipInvalid ? v.summary.valid : v.summary.with_errors ? 0 : v.summary.valid) : 0;

  const footer = step === 0 ? (
    <>
      <Button onClick={onClose}>Cancel</Button>
      <Button variant="primary" onClick={validate} disabled={!file} loading={busy} data-testid="import-validate">Check file <Icon name="chevronRight" size={15} /></Button>
    </>
  ) : step === 1 && v ? (
    <>
      <Button onClick={() => { setStep(0); setV(null); }}>Back</Button>
      <Button variant="primary" onClick={commit} disabled={!importable || busy} loading={busy} data-testid="import-commit">
        Import {importable} employee{importable === 1 ? '' : 's'}
      </Button>
    </>
  ) : (
    <Button variant="primary" onClick={onClose} data-testid="import-done">Go to the employee list</Button>
  );

  return (
    <Modal open wide title="Import employees" onClose={onClose} footer={footer} testId="import-modal">
      <ol className="imp-steps" aria-label="Import steps">
        {STEPS.map((s, i) => <li key={s} className={i === step ? 'active' : i < step ? 'done' : ''}><span>{i < step ? <Icon name="check" size={12} /> : i + 1}</span>{s}</li>)}
      </ol>

      {step === 0 ? (
        <div className="imp-stack">
          <div className="imp-template">
            <div>
              <strong>1. Download the template</strong>
              <p className="muted">
                {info.data ? <>Columns and examples for <b>{COUNTRY[info.data.country_code] || info.data.country_code}</b>; salaries in {info.data.currency}. </> : null}
                Keep the header row, replace the two example rows and save as CSV (Excel .xlsx also works).
              </p>
            </div>
            <Button onClick={downloadTemplate} data-testid="import-template"><Icon name="download" size={15} /> Download template</Button>
          </div>
          {info.loading ? <Spinner /> : info.data ? (
            <details className="imp-help" data-testid="import-help">
              <summary>Column guide and {COUNTRY[info.data.country_code] || info.data.country_code} formats</summary>
              <div className="imp-formats">
                {info.data.formats.map((f) => (
                  <div key={f.field + f.label}><b>{f.label}</b> <span className="muted">({f.field})</span><div>{f.format}</div><code>{f.example}</code></div>
                ))}
              </div>
              <ul className="imp-cols">
                {info.data.columns.map((c) => (
                  <li key={c.key}><code>{c.key}</code>{c.required ? <span className="req"> *</span> : null} <span className="muted">{c.label}.</span> {c.description}</li>
                ))}
              </ul>
            </details>
          ) : null}
          <div>
            <strong>2. Upload the filled file</strong>
            <FileInput accept=".csv,.xlsx,text/csv" file={file} onChange={(f) => setFile(f[0] || null)} hint="CSV or Excel (.xlsx), up to 2,000 rows. Nothing is saved until you confirm the import." testId="import-file" />
          </div>
          <Switch label="Create missing departments and positions" checked={createMissing} onChange={setCreateMissing} />
        </div>
      ) : null}

      {step === 1 && v ? (
        <div className="imp-stack">
          <div className="imp-chips" data-testid="import-summary">
            <span className="imp-chip ok" data-testid="import-valid-count"><b>{v.summary.valid}</b> valid</span>
            <span className={`imp-chip ${v.summary.with_errors ? 'err' : ''}`} data-testid="import-error-count"><b>{v.summary.with_errors}</b> with errors</span>
            <span className={`imp-chip ${v.summary.warnings ? 'warn' : ''}`}><b>{v.summary.warnings}</b> with warnings</span>
            <span className="imp-chip info" title={[...v.summary.will_create.departments.map((d) => `Department: ${d}`), ...v.summary.will_create.positions.map((p) => `Position: ${p.title}${p.department ? ` (${p.department})` : ''}`)].join('\n')}><b>{willCreate}</b> to create</span>
          </div>
          {v.file_warnings.map((w) => <div key={w} className="alert alert-warning">{w}</div>)}
          {willCreate ? (
            <div className="alert alert-info">
              Will create {v.summary.will_create.departments.length ? <>departments <b>{v.summary.will_create.departments.join(', ')}</b></> : null}
              {v.summary.will_create.departments.length && v.summary.will_create.positions.length ? ' and ' : ''}
              {v.summary.will_create.positions.length ? <>positions <b>{v.summary.will_create.positions.map((p) => p.title).join(', ')}</b></> : null}.
            </div>
          ) : null}
          <div className="imp-toggles">
            <span data-testid="import-skip-invalid"><Switch label="Skip rows with errors" checked={skipInvalid} onChange={setSkipInvalid} /></span>
            <span data-testid="import-create-missing"><Switch label="Create missing departments/positions" checked={createMissing} onChange={revalidate} disabled={busy} /></span>
            <span data-testid="import-create-logins"><Switch label="Create logins (temporary passwords)" checked={createLogins} onChange={setCreateLogins} /></span>
            <Checkbox label="Only problems" checked={onlyProblems} onChange={(e) => setOnlyProblems(e.target.checked)} data-testid="import-only-problems" />
          </div>
          {v.summary.with_errors && !skipInvalid ? (
            <div className="alert alert-error">Fix the rows in red and upload again, or turn on "Skip rows with errors" to import only the valid rows.</div>
          ) : null}
          <div className="imp-table" data-testid="import-rows">
            <Table<VRow>
              dense
              keyField="row"
              rows={rows}
              empty={onlyProblems ? 'No problems found.' : 'No rows.'}
              columns={[
                { key: 'row', header: 'Row', width: '52px', render: (r) => <span className="mono">{r.row}</span> },
                { key: 'who', header: 'Employee', render: (r) => <span><strong>{[r.data.first_name, r.data.last_name].filter(Boolean).join(' ') || '—'}</strong><div className="muted imp-email">{r.data.email || '—'}</div></span> },
                { key: 'org', header: 'Department / position', render: (r) => <span>{r.data.department || '—'}<div className="muted">{r.data.position || ''}</div></span> },
                { key: 'state', header: 'Status', render: (r) => r.errors.length ? <Badge tone="danger">{r.errors.length} error{r.errors.length > 1 ? 's' : ''}</Badge> : r.warnings.length ? <Badge tone="warning">Warning</Badge> : <Badge tone="success">OK</Badge> },
                {
                  key: 'issues', header: 'Messages', render: (r) => r.errors.length || r.warnings.length ? (
                    <ul className="imp-issues" data-testid={`import-row-${r.row}-issues`}>
                      {r.errors.map((e, i) => <li key={`e${i}`} className="err"><code>{e.field}</code> {e.message}</li>)}
                      {r.warnings.map((w, i) => <li key={`w${i}`} className="warn"><code>{w.field}</code> {w.message}</li>)}
                    </ul>
                  ) : <span className="muted">Ready</span>,
                },
              ]}
            />
          </div>
        </div>
      ) : null}

      {step === 2 && result ? (
        <div className="imp-stack" data-testid="import-result">
          <div className="imp-done">
            <div className="imp-done-icon"><Icon name="check" size={22} /></div>
            <div>
              <strong data-testid="import-created-count">{result.created.length} employee{result.created.length === 1 ? '' : 's'} imported</strong>
              <div className="muted">
                {result.skipped.length ? `${result.skipped.length} row${result.skipped.length === 1 ? '' : 's'} skipped (rows ${result.skipped.map((s) => s.row).join(', ')}). ` : ''}
                {result.departments_created.length ? `New departments: ${result.departments_created.join(', ')}. ` : ''}
                {result.positions_created.length ? `New positions: ${result.positions_created.join(', ')}.` : ''}
              </div>
            </div>
          </div>
          {result.created.some((c) => c.temporary_password) ? (
            <div className="alert alert-warning">Temporary passwords are shown <b>only once</b>. Copy them now and share each over a secure channel; everyone must change it at first sign-in.</div>
          ) : null}
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <Button size="sm" onClick={copyAll} data-testid="import-copy-all"><Icon name="clipboard" size={14} /> Copy all</Button>
          </div>
          <div className="imp-table">
            <Table<Created>
              dense
              rows={result.created}
              columns={[
                { key: 'employee_code', header: 'Code', render: (c) => <span className="mono">{c.employee_code}</span> },
                { key: 'name', header: 'Name', render: (c) => <strong>{c.name}</strong> },
                { key: 'email', header: 'Email (user ID)', render: (c) => <span className="imp-email">{c.email}</span> },
                { key: 'pw', header: 'Temporary password', render: (c) => c.temporary_password ? <code data-testid="import-temp-password">{c.temporary_password}</code> : <span className="muted">No login</span> },
              ]}
            />
          </div>
        </div>
      ) : null}
    </Modal>
  );
}

export default ImportEmployeesModal;
