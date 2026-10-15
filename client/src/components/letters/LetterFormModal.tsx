import React, { useMemo, useState } from 'react';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { Button, Checkbox, Field, Modal, Select, Textarea, useToast } from '../ui';
import { Icon } from '../Icons';
import { DirectoryEmployee, Letter, LetterPaper, LetterTemplate, VariableFields, employeeLabel, usePreview } from './shared';

/**
 * mode "request": an employee asks for a self-service letter for themselves.
 * mode "issue": HR issues any active template to any employee (optionally generating the PDF straight away).
 */
export function LetterFormModal({ mode, templates, employees = [], onClose, onDone }: { mode: 'request' | 'issue'; templates: LetterTemplate[]; employees?: DirectoryEmployee[]; onClose: () => void; onDone: (l: Letter) => void }) {
  const toast = useToast();
  const { user } = useAuth();
  const options = useMemo(() => templates.filter((t) => t.active && (mode === 'issue' || t.self_service)), [templates, mode]);
  const [templateId, setTemplateId] = useState<string>('');
  const [employeeId, setEmployeeId] = useState<string>('');
  const [vars, setVars] = useState<Record<string, string>>({});
  const [reason, setReason] = useState('');
  const [generateNow, setGenerateNow] = useState(true);
  const [busy, setBusy] = useState(false);
  const pv = usePreview();
  const tpl = options.find((t) => String(t.id) === templateId);
  const targetEmployee = mode === 'issue' ? Number(employeeId) || null : user?.employee_id;

  const changeTemplate = (id: string) => { setTemplateId(id); setVars({}); pv.setPreview(null); };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tpl) return toast.error('Choose a letter type');
    if (mode === 'issue' && !targetEmployee) return toast.error('Choose an employee');
    setBusy(true);
    try {
      let letter = await api.post<Letter>('/api/letters', { template_id: tpl.id, employee_id: mode === 'issue' ? targetEmployee : undefined, variables: vars, reason: reason.trim() || null });
      if (mode === 'issue' && generateNow) {
        letter = await api.post<Letter>(`/api/letters/${letter.id}/generate`, {});
        toast.success(`${letter.title} generated for ${letter.employee_name}`);
        if (letter.missing?.length) toast.info(`Some fields were left blank: ${letter.missing.join(', ')}`);
      } else if (mode === 'issue') {
        toast.success(`${letter.title} issued to ${letter.employee_name}`);
      } else {
        toast.success(letter.status === 'requested' ? `Request sent to HR: ${tpl.name}` : `${tpl.name} approved, HR will generate it shortly`);
      }
      onDone(letter);
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open wide title={mode === 'issue' ? 'Issue a letter' : 'Request a letter'} onClose={onClose} testId="letter-modal"
      footer={
        <>
          <Button type="button" onClick={onClose}>Cancel</Button>
          <Button type="button" disabled={!tpl || (mode === 'issue' && !targetEmployee)} loading={pv.busy} data-testid="letter-preview-btn" onClick={() => tpl && pv.run(tpl.id, targetEmployee, vars)}>
            <Icon name="eye" size={15} /> Preview
          </Button>
          <Button type="submit" form="letter-form" variant="primary" loading={busy} data-testid="letter-submit">
            {mode === 'issue' ? (generateNow ? 'Issue and generate PDF' : 'Issue letter') : 'Send request'}
          </Button>
        </>
      }>
      <form id="letter-form" className="form-grid" onSubmit={submit}>
        {mode === 'issue' ? (
          <Field label="Employee" required className="span-2">
            <Select value={employeeId} onChange={(e) => { setEmployeeId(e.target.value); pv.setPreview(null); }} data-testid="letter-employee" required>
              <option value="">Choose an employee…</option>
              {employees.map((e) => <option key={e.id} value={e.id}>{employeeLabel(e)}</option>)}
            </Select>
          </Field>
        ) : null}
        <Field label="Letter type" required className="span-2" hint={tpl ? (mode === 'request' ? (tpl.requires_approval ? 'HR approves the request before the PDF is generated.' : 'No approval needed; HR generates the PDF.') : `Template ${tpl.code}`) : undefined}>
          <Select value={templateId} onChange={(e) => changeTemplate(e.target.value)} data-testid="letter-template" required>
            <option value="">Choose a letter…</option>
            {options.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </Select>
        </Field>
        {tpl ? <VariableFields names={tpl.variables} values={vars} onChange={(v) => { setVars(v); }} /> : null}
        <Field label={mode === 'issue' ? 'Internal note / reason' : 'Why do you need it?'} className="span-2">
          <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} data-testid="letter-reason" placeholder={mode === 'request' ? 'e.g. Bank loan application' : undefined} />
        </Field>
        {mode === 'issue' ? (
          <div className="span-2"><Checkbox label="Generate the PDF now" checked={generateNow} onChange={(e) => setGenerateNow(e.target.checked)} data-testid="letter-generate-now" /></div>
        ) : null}
        {options.length === 0 ? <p className="muted span-2">No letter templates are available{mode === 'request' ? ' for self-service' : ''}.</p> : null}
      </form>
      {pv.preview ? <div style={{ marginTop: 14 }}><div className="section-title">Preview</div><LetterPaper title={pv.preview.title} body={pv.preview.body_rendered} refNo={pv.preview.ref} missing={pv.preview.missing} /></div> : null}
    </Modal>
  );
}
