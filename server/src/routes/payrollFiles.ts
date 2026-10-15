import { Router } from 'express';
import { getSetting, setSetting } from '../db.js';
import { requireHr } from '../auth.js';
import { audit, toInt, wrap, badRequest } from '../util.js';
import { buildOutput, companyCountry, FILE_SETTING_FIELDS, fileSettings, listOutputs, loadRun, validateFileSettings } from '../ops/payrollFiles.js';

/** Payroll output files per run (bank / WPS / ACH, PF ECR, ESI, register). Mounted at /api/payroll-files. */
const r = Router();

/** Employer ids and routing codes used in the files (fields for this company's country). */
function settingsView() {
  const country = companyCountry();
  const { values, placeholders } = fileSettings();
  return {
    country,
    fields: FILE_SETTING_FIELDS[country].map((f) => ({ key: f.key, label: f.label, hint: f.hint, value: values[f.key], placeholder: placeholders.includes(f.key) })),
  };
}
r.get('/settings', requireHr, (_req, res) => res.json(settingsView()));
r.put('/settings', requireHr, wrap(async (req, res) => {
  const patch = validateFileSettings(req.body);
  const saved = { ...getSetting<any>('payroll_files', {}), ...patch };
  for (const k of Object.keys(saved)) if (saved[k] === '') delete saved[k];
  setSetting('payroll_files', saved);
  audit(req, 'update', 'settings', 'payroll_files', patch);
  res.json(settingsView());
}));

r.get('/runs/:runId', requireHr, wrap(async (req, res) => {
  const id = toInt(req.params.runId);
  if (!id) throw badRequest('Invalid run id');
  const ctx = loadRun(id);
  res.json({ run: ctx.run, country: ctx.country, currency: ctx.currency, pay_date: ctx.payDate, files: listOutputs(ctx) });
}));

r.get('/runs/:runId/:kind', requireHr, wrap(async (req, res) => {
  const id = toInt(req.params.runId);
  if (!id) throw badRequest('Invalid run id');
  const preview = ['1', 'true', 'yes'].includes(String(req.query.preview || '').toLowerCase());
  const ctx = loadRun(id);
  const out = await buildOutput(ctx, String(req.params.kind), preview);
  audit(req, 'download', 'payroll_file', id, { kind: req.params.kind, period: ctx.period, filename: out.filename, records: out.records, excluded: out.excluded.length, preview: out.preview, agency_user: req.agencyUser?.email });
  const ascii = out.filename.replace(/[^A-Za-z0-9._-]/g, '_');
  res.setHeader('Content-Type', out.contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(out.filename)}`);
  res.setHeader('X-Records', String(out.records));
  res.setHeader('X-Excluded', String(out.excluded.length));
  res.setHeader('Cache-Control', 'no-store');
  res.send(out.body);
}));

export default r;
