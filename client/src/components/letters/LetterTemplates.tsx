import React, { useLayoutEffect, useRef, useState } from 'react';
import { api } from '../../lib/api';
import { fmtDate } from '../../lib/format';
import { Badge, Button, Card, Checkbox, EmptyState, Field, Input, Modal, Select, Switch, Table, Textarea, useConfirm, useFetch, useForm, useToast } from '../ui';
import { Icon } from '../Icons';
import { CATEGORIES, DirectoryEmployee, LetterPaper, LetterTemplate, Placeholder, VariableFields, employeeLabel, humanize, usePreview } from './shared';

const EMPTY = { name: '', code: '', category: 'general', subject: '', body: '', self_service: false, requires_approval: true, active: true };
type FormValues = typeof EMPTY;

/** HR: letter templates with {{placeholders}}, self-service and approval switches, and a live preview. */
export function LetterTemplates({ templates, loading, employees, onChanged }: { templates: LetterTemplate[]; loading: boolean; employees: DirectoryEmployee[]; onChanged: () => void }) {
  const toast = useToast();
  const { confirm, dialog } = useConfirm();
  const [editing, setEditing] = useState<LetterTemplate | 'new' | null>(null);
  const [previewing, setPreviewing] = useState<LetterTemplate | null>(null);

  const toggleActive = async (t: LetterTemplate) => {
    try {
      await api.put(`/api/letters/templates/${t.id}`, { active: !t.active });
      toast.success(`${t.name} ${t.active ? 'deactivated' : 'activated'}`);
      onChanged();
    } catch (err) {
      toast.error(err);
    }
  };
  const remove = async (t: LetterTemplate) => {
    if (!(await confirm('Delete template?', `${t.name} (${t.code}) will be deleted. Letters already issued keep their PDF.`))) return;
    try {
      await api.delete(`/api/letters/templates/${t.id}`);
      toast.success('Template deleted');
      onChanged();
    } catch (err) {
      toast.error(err);
    }
  };

  return (
    <>
      <Card padded={false} tour="letters-templates" title="Letter templates" actions={<Button variant="primary" size="sm" onClick={() => setEditing('new')} data-testid="template-add"><Icon name="plus" size={14} /> New template</Button>}>
        <Table<LetterTemplate>
          loading={loading && !templates.length}
          rows={templates}
          onRowClick={(t) => setEditing(t)}
          empty={<EmptyState title="No templates" description="Create a template with placeholders such as {{employee.full_name}}." />}
          columns={[
            { key: 'name', header: 'Template', render: (t) => <span data-testid="template-row"><strong>{t.name}</strong> <span className="muted mono">{t.code}</span><div className="muted">{t.subject}</div></span> },
            { key: 'category', header: 'Category', render: (t) => humanize(t.category) },
            { key: 'self_service', header: 'Employees can request', render: (t) => t.self_service ? <Badge tone="success">Self-service</Badge> : <Badge>HR only</Badge> },
            { key: 'requires_approval', header: 'Approval', render: (t) => t.self_service ? (t.requires_approval ? 'Required' : 'Not required') : <span className="muted">—</span> },
            { key: 'variables', header: 'Extra details', render: (t) => t.variables.length ? <span className="chip-list">{t.variables.map((v) => <span key={v} className="chip mono">{v}</span>)}</span> : <span className="muted">None</span> },
            { key: 'active', header: 'Active', render: (t) => <span onClick={(e) => e.stopPropagation()}><Switch checked={!!t.active} onChange={() => toggleActive(t)} /></span> },
            { key: 'updated_at', header: 'Updated', render: (t) => fmtDate(t.updated_at) },
            {
              key: 'actions', header: '', align: 'right', render: (t) => (
                <div className="row end" style={{ gap: 4, flexWrap: 'nowrap' }} onClick={(e) => e.stopPropagation()}>
                  <Button size="sm" variant="ghost" title="Preview" aria-label="Preview" data-testid="template-preview" onClick={() => setPreviewing(t)}><Icon name="eye" size={15} /></Button>
                  <Button size="sm" variant="ghost" title="Edit" aria-label="Edit" onClick={() => setEditing(t)}><Icon name="edit" size={15} /></Button>
                  <Button size="sm" variant="ghost" title="Delete" aria-label="Delete" data-testid="template-delete" onClick={() => remove(t)}><Icon name="trash" size={15} /></Button>
                </div>
              ),
            },
          ]}
        />
      </Card>
      {editing ? <TemplateModal template={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); onChanged(); }} /> : null}
      {previewing ? <TemplatePreviewModal template={previewing} employees={employees} onClose={() => setPreviewing(null)} /> : null}
      {dialog}
    </>
  );
}

function TemplateModal({ template, onClose, onSaved }: { template: LetterTemplate | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const placeholders = useFetch<Placeholder[]>(() => api.get('/api/letters/placeholders'), []);
  const f = useForm<FormValues>(template ? {
    name: template.name, code: template.code, category: template.category, subject: template.subject, body: template.body,
    self_service: !!template.self_service, requires_approval: !!template.requires_approval, active: !!template.active,
  } : EMPTY);
  const [busy, setBusy] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const pendingCaret = useRef<number | null>(null);
  const v = f.values;
  // Place the caret after an inserted placeholder once the new body has rendered.
  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (el && pendingCaret.current !== null) { el.focus(); el.selectionStart = el.selectionEnd = pendingCaret.current; pendingCaret.current = null; }
  }, [v.body]);

  const insert = (key: string) => {
    const token = `{{${key === 'var.<name>' ? 'var.purpose' : key}}}`;
    const el = bodyRef.current;
    const start = el?.selectionStart ?? v.body.length;
    const end = el?.selectionEnd ?? v.body.length;
    pendingCaret.current = start + token.length;
    f.set('body', v.body.slice(0, start) + token + v.body.slice(end));
  };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const body = { ...v, code: v.code || v.name.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '') };
      if (template) await api.put(`/api/letters/templates/${template.id}`, body);
      else await api.post('/api/letters/templates', body);
      toast.success(template ? `Saved ${v.name}` : `Created template ${v.name}`);
      onSaved();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open wide title={template ? `Edit ${template.name}` : 'New letter template'} onClose={onClose} testId="template-modal"
      footer={<><Button onClick={onClose}>Cancel</Button><Button type="submit" form="template-form" variant="primary" loading={busy} data-testid="template-submit">{template ? 'Save template' : 'Create template'}</Button></>}>
      <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 2fr) minmax(220px, 1fr)', alignItems: 'start' }}>
        <form id="template-form" className="form-grid" onSubmit={submit}>
          <Field label="Name" required><Input {...f.bind('name')} required data-testid="template-name" placeholder="e.g. Visa support letter" /></Field>
          <Field label="Code" hint="Upper case, unique. Generated from the name when blank."><Input {...f.bind('code')} data-testid="template-code" /></Field>
          <Field label="Category">
            <Select {...f.bind('category')} data-testid="template-category">
              {CATEGORIES.map((c) => <option key={c} value={c}>{humanize(c)}</option>)}
            </Select>
          </Field>
          <Field label="Subject" required hint="Becomes the letter title; placeholders allowed."><Input {...f.bind('subject')} required data-testid="template-subject" /></Field>
          <Field label="Body" required className="span-2" hint="Blank lines separate paragraphs. Use {{var.name}} for details asked when the letter is requested.">
            <Textarea ref={bodyRef} rows={12} {...f.bind('body')} required data-testid="template-body" className="mono" />
          </Field>
          <div className="span-2 row">
            <Checkbox label="Employees can request it (self-service)" checked={v.self_service} onChange={(e) => f.set('self_service', e.target.checked)} data-testid="template-self-service" />
            <Checkbox label="Requests need HR approval" checked={v.requires_approval} disabled={!v.self_service} onChange={(e) => f.set('requires_approval', e.target.checked)} data-testid="template-requires-approval" />
            <Checkbox label="Active" checked={v.active} onChange={(e) => f.set('active', e.target.checked)} />
          </div>
        </form>
        <aside data-tour="letters-placeholders" data-testid="placeholder-list">
          <div className="section-title">Placeholders</div>
          <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>Click to insert at the cursor.</p>
          <div className="stack" style={{ gap: 4, maxHeight: '55vh', overflow: 'auto' }}>
            {(placeholders.data || []).map((p) => (
              <button key={p.key} type="button" className="btn btn-ghost btn-sm" style={{ justifyContent: 'flex-start', textAlign: 'left', height: 'auto', padding: '4px 6px', display: 'block' }} onClick={() => insert(p.key)} title={p.description}>
                <span className="mono" style={{ color: 'var(--brand)' }}>{`{{${p.key}}}`}</span>
                <div className="muted" style={{ fontSize: 11.5 }}>{p.description}</div>
              </button>
            ))}
          </div>
        </aside>
      </div>
    </Modal>
  );
}

function TemplatePreviewModal({ template, employees, onClose }: { template: LetterTemplate; employees: DirectoryEmployee[]; onClose: () => void }) {
  const [employeeId, setEmployeeId] = useState<string>(employees[0] ? String(employees[0].id) : '');
  const [vars, setVars] = useState<Record<string, string>>({});
  const pv = usePreview();
  return (
    <Modal open wide title={`Preview: ${template.name}`} onClose={onClose} testId="template-preview-modal"
      footer={<><Button onClick={onClose}>Close</Button><Button variant="primary" loading={pv.busy} disabled={!employeeId} data-testid="template-preview-run" onClick={() => pv.run(template.id, Number(employeeId), vars)}><Icon name="eye" size={15} /> Render preview</Button></>}>
      <div className="form-grid">
        <Field label="Sample employee" className="span-2">
          <Select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} data-testid="template-preview-employee">
            {employees.map((e) => <option key={e.id} value={e.id}>{employeeLabel(e)}</option>)}
          </Select>
        </Field>
        <VariableFields names={template.variables} values={vars} onChange={setVars} />
      </div>
      {pv.preview ? <div style={{ marginTop: 14 }}><LetterPaper title={pv.preview.title} body={pv.preview.body_rendered} refNo={pv.preview.ref} missing={pv.preview.missing} /></div> : <p className="muted" style={{ marginTop: 14 }}>Pick an employee and render to see the letter with real data.</p>}
    </Modal>
  );
}
