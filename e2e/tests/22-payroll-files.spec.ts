import fs from 'node:fs';
import { test, expect, type Page } from '@playwright/test';
import { login, logout, runTour } from './helpers';

/** Opens the latest paid run of the signed-in company and returns its period. */
async function openLatestPaidRun(page: Page) {
  const res = await page.request.get('/api/payroll/runs');
  expect(res.ok()).toBe(true);
  const run = (await res.json()).find((r: any) => r.status === 'paid');
  expect(run).toBeTruthy();
  await page.goto(`/payroll?tab=runs&run=${run.id}`);
  await expect(page.getByTestId('payroll-output-files')).toBeVisible();
  return run.period as string;
}
async function downloadFile(page: Page, testId: string) {
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId(testId).click()]);
  const path = await dl.path();
  return { name: dl.suggestedFilename(), body: fs.readFileSync(path!) };
}

test.describe('payroll output files', () => {
  test('India: HR downloads the payroll register and the PF ECR of a paid run', async ({ page }) => {
    await login(page, 'hr@tejas-infotech.example');
    const period = await openLatestPaidRun(page);
    for (const kind of ['register', 'bank_transfer', 'pf_ecr', 'esi']) await expect(page.getByTestId(`payroll-file-${kind}`)).toBeVisible();
    await expect(page.getByTestId('payroll-file-pf_ecr')).toContainText('EPFO');

    const register = await downloadFile(page, 'payroll-file-download-register');
    expect(register.name).toBe(`TEJAS-INFOTECH_Payroll_Register_${period}.xlsx`);
    expect(register.body.subarray(0, 2).toString()).toBe('PK'); // a zip container

    const ecr = await downloadFile(page, 'payroll-file-download-pf_ecr');
    expect(ecr.name).toBe(`TEJAS-INFOTECH_PF_ECR_${period}.txt`);
    const lines = ecr.body.toString('utf8').trim().split('\n');
    expect(lines.length).toBeGreaterThan(10);
    for (const l of lines) expect(l.split('#~#')).toHaveLength(11);
    await logout(page);
  });

  test('UAE: HR downloads the WPS SIF; the tour explains the files and their settings', async ({ page }) => {
    await login(page, 'hr@falcon-logistics.example');
    await openLatestPaidRun(page);
    await expect(page.getByTestId('payroll-file-wps_sif')).toContainText('WPS');
    const sif = await downloadFile(page, 'payroll-file-download-wps_sif');
    expect(sif.name).toMatch(/^\d{25}\.SIF$/);
    const lines = sif.body.toString('utf8').trim().split(/\r?\n/);
    expect(lines[0]).toMatch(/^EDR,\d{14},/);
    expect(lines[lines.length - 1].startsWith('SCR,')).toBe(true);
    expect(lines[lines.length - 1].split(',')[6]).toBe(String(lines.length - 1));

    // The page tour opens the latest run (paid here) and walks through the output files and file settings.
    await page.goto('/payroll');
    const titles = await runTour(page, { minSteps: 20 });
    for (const t of ['Output files', 'What each file is for', 'Bank files wait for approval', 'File settings']) expect(titles).toContain(t);
    expect(titles.indexOf('Output files')).toBeGreaterThan(titles.indexOf('Move the run forward'));

    // File settings show this country's employer ids.
    await page.goto('/payroll?tab=settings');
    await expect(page.getByTestId('payroll-file-setting-ae_employer_mol_id')).toBeVisible();
  });
});
