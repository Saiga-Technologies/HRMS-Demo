import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { login, runTour, USERS } from './helpers';

const fixtures = path.join(__dirname, '..', 'fixtures');

test.describe('bulk employee import', () => {
  test('HR downloads the template, uploads a file with one bad row, skips it and imports four', async ({ page }) => {
    await login(page, USERS.hr);
    await page.goto('/employees');

    // The page tour covers the import workflow.
    const titles = await runTour(page, { minSteps: 18 });
    expect(titles).toEqual(expect.arrayContaining(['1. Download the template', '3. Fix errors', '5. Share temporary passwords']));

    await page.getByTestId('employee-import').click();
    const modal = page.getByTestId('import-modal');
    await expect(modal).toBeVisible();

    // 1) Template for the company's country (India: PAN / IFSC / UAN).
    const [download] = await Promise.all([page.waitForEvent('download'), modal.getByTestId('import-template').click()]);
    expect(download.suggestedFilename()).toBe('employee-import-in.csv');
    const template = fs.readFileSync((await download.path())!, 'utf8');
    expect(template.split(/\r?\n/)[0]).toContain('first_name,last_name,email');
    expect(template).toContain('pf_number');
    await modal.getByText(/Column guide/).click();
    await expect(modal.getByTestId('import-help')).toContainText('PAN');

    // 2) Upload and check: one row has a bad PAN.
    await modal.getByTestId('import-file').setInputFiles(path.join(fixtures, 'import-acme.csv'));
    await modal.getByTestId('import-validate').click();
    await expect(modal.getByTestId('import-valid-count')).toContainText('4');
    await expect(modal.getByTestId('import-error-count')).toContainText('1');
    await expect(modal.getByTestId('import-row-6-issues')).toContainText('PAN "BADPAN123" is invalid');
    await modal.getByTestId('import-only-problems').check();
    await expect(modal.getByTestId('import-rows').locator('tbody tr')).toHaveCount(1);

    // All-or-nothing until errors are skipped.
    await expect(modal.getByTestId('import-commit')).toBeDisabled();
    await modal.getByTestId('import-skip-invalid').locator('label').click();
    await expect(modal.getByTestId('import-commit')).toBeEnabled();
    await expect(modal.getByTestId('import-commit')).toHaveText(/Import 4 employees/);
    await modal.getByTestId('import-commit').click();

    // 3) Result: four created with codes and one-time temporary passwords.
    await expect(modal.getByTestId('import-result')).toBeVisible();
    await expect(modal.getByTestId('import-created-count')).toHaveText('4 employees imported');
    await expect(modal.getByTestId('import-temp-password')).toHaveCount(4);
    await expect(modal.getByTestId('import-temp-password').first()).toHaveText(/^Welcome-/);
    await expect(modal.getByTestId('import-result')).toContainText(/EMP\d{4}/);
    await expect(modal.getByTestId('import-result')).toContainText('rows 6');
    await modal.getByTestId('import-done').click();
    await expect(modal).toBeHidden();

    // The new people are in the list; the broken row is not.
    const table = page.locator('[data-tour="employees-table"]');
    for (const name of ['Lakshmi Varma', 'Nikhil Raghavan', 'Fathima Basheer', 'Arun Kumar']) await expect(table.getByText(name).first()).toBeVisible();
    await expect(table.getByText('Broken Pan')).toHaveCount(0);

    // Manager links to a row of the same file.
    await table.getByText('Nikhil Raghavan').click();
    await expect(page.getByText('Lakshmi Varma').first()).toBeVisible();
  });

  test('?import=1 opens the import wizard (used by the agency onboarding success screen)', async ({ page }) => {
    await login(page, USERS.hr);
    await page.goto('/employees?import=1');
    await expect(page.getByTestId('import-modal')).toBeVisible();
    await page.getByTestId('import-modal').getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByTestId('import-modal')).toBeHidden();
    await expect(page).not.toHaveURL(/import=1/);
  });
});
