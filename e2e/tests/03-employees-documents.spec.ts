import { test, expect } from '@playwright/test';
import path from 'node:path';
import { login, runTour, USERS, expectToast } from './helpers';

const fixtures = path.join(__dirname, '..', 'fixtures');

test.describe('employees & documents', () => {
  test('HR adds an employee with custom fields and a login, then uploads a document with expiry colouring', async ({ page }) => {
    await login(page, USERS.hr);
    await page.goto('/employees');
    await runTour(page, { minSteps: 12 });
    await page.getByTestId('employee-add').click();
    const modal = page.getByRole('dialog');
    await modal.getByLabel(/First name/).fill('Lina');
    await modal.getByLabel(/Last name/).fill('Fernandes');
    await modal.getByLabel(/^Email/).fill('lina.fernandes@acme.example');
    await modal.getByLabel(/Department/).first().selectOption({ label: 'Engineering' });
    await modal.getByLabel(/Blood group/).selectOption('A+');
    await modal.getByTestId('employee-save').click();
    await expect(page).toHaveURL(/\/employees\/\d+/);
    await expect(page.getByText('Lina Fernandes').first()).toBeVisible();
    await expect(page.getByText('A+').first()).toBeVisible();

    // Documents tab: upload a PDF against a type that requires expiry
    await page.getByRole('tab', { name: /Documents/ }).click();
    await page.getByTestId('document-upload').click();
    const up = page.getByRole('dialog');
    await up.getByLabel(/Document type/).selectOption({ label: 'Passport' });
    const soon = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
    await up.getByLabel(/Expiry date/).fill(soon);
    await up.locator('input[type="file"]').setInputFiles(path.join(fixtures, 'sample.pdf'));
    await up.getByTestId('document-submit').click();
    await expectToast(page, 'success');
    await expect(page.locator('.expiry-critical').first()).toBeVisible();

    // A wrong format is rejected by the type rules (Work Visa = PDF only)
    await page.getByTestId('document-upload').click();
    const up2 = page.getByRole('dialog');
    await up2.getByLabel(/Document type/).selectOption({ label: 'Work Visa / Permit' });
    await up2.getByLabel(/Expiry date/).fill(soon);
    await up2.locator('input[type="file"]').setInputFiles(path.join(fixtures, 'sample.png'));
    await up2.getByTestId('document-submit').click();
    await expectToast(page, 'error', /PDF/);
  });

  test('document centre shows expiring documents with colour indicators and lets HR customise formats', async ({ page }) => {
    await login(page, USERS.hr);
    await page.goto('/documents');
    await runTour(page, { minSteps: 15 });
    await page.getByRole('tab', { name: /Expiring/ }).click();
    await expect(page.locator('.expiry-expired').first()).toBeVisible();
    await expect(page.locator('.expiry-critical').first()).toBeVisible();
    await page.getByRole('tab', { name: /Document types/ }).click();
    await page.getByTestId('doctype-add').click();
    const m = page.getByRole('dialog');
    await m.getByLabel(/^Name/).fill('Offer letter');
    await m.getByLabel('JPG').uncheck();
    await m.getByTestId('doctype-save').click();
    await expectToast(page, 'success');
    await expect(page.getByRole('cell', { name: 'Offer letter' })).toBeVisible();
  });

  test('an employee sees only their own profile and documents', async ({ page }) => {
    await login(page, USERS.employee);
    await page.goto('/employees');
    await expect(page.getByRole('row')).toHaveCount(2); // header + self
    await page.goto('/documents');
    await expect(page.getByText('Karthik Raj').first()).toBeVisible();
    await expect(page.getByText('Meera Iyer')).toHaveCount(0);
  });
});
