import { test, expect } from '@playwright/test';
import { login, runTour, USERS, expectToast } from './helpers';

test.describe('payroll', () => {
  test('HR creates and processes a pay run, approves it, and the employee can view the payslip', async ({ page }) => {
    await login(page, USERS.hr);
    await page.goto('/payroll');
    await runTour(page);
    await page.goto('/payroll?tab=runs');
    await page.getByTestId('payroll-new-run').click();
    const m = page.getByRole('dialog');
    const prev = new Date();
    prev.setMonth(prev.getMonth() - 1);
    const period = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`;
    await m.locator('input[type="month"]').fill(period);
    await m.getByTestId('payroll-create-run').click();
    await expectToast(page, 'success');
    await page.getByTestId('payroll-process').click();
    await expectToast(page, 'success');
    await expect(page.getByText(/processed/i).first()).toBeVisible();
    await expect(page.getByRole('cell', { name: /Karthik Raj/ })).toBeVisible();
    await page.getByRole('button', { name: /^Approve$/ }).click();
    await expectToast(page, 'success');
    await page.getByTestId('user-menu').click();
    await page.getByTestId('logout').click();

    await login(page, USERS.employee);
    await page.goto('/payroll');
    await expect(page.getByText(period).first()).toBeVisible();
    await page.getByRole('button', { name: /View/ }).first().click();
    await expect(page.locator('.payslip')).toBeVisible();
    await expect(page.locator('.payslip')).toContainText('Karthik Raj');
  });
});

test.describe('assets', () => {
  test('HR registers an asset and assigns it; the employee sees it', async ({ page }) => {
    await login(page, USERS.hr);
    await page.goto('/assets');
    await runTour(page);
    await page.getByTestId('asset-add').click();
    const m = page.getByRole('dialog');
    await m.getByLabel(/^Name/).fill('Logitech MX Keys');
    await m.getByTestId('asset-save').click();
    await expectToast(page, 'success');
    await page.getByRole('cell', { name: /Logitech MX Keys/ }).click();
    await page.getByRole('button', { name: /^Assign/ }).first().click();
    const am = page.getByRole('dialog').last();
    await am.getByLabel(/Employee/).selectOption({ label: 'Karthik Raj (EMP0006) · Platform' });
    await am.getByTestId('asset-assign-submit').click();
    await expectToast(page, 'success');
    await expect(page.getByRole('cell', { name: /Karthik Raj/ }).first()).toBeVisible();
    await page.goto('/'); // close the detail modal
    await page.getByTestId('user-menu').click();
    await page.getByTestId('logout').click();
    await login(page, USERS.employee);
    await page.goto('/assets');
    await expect(page.getByText('Logitech MX Keys').first()).toBeVisible();
  });
});

test.describe('employee journey', () => {
  test('HR customises stage templates and advances an employee journey', async ({ page }) => {
    await login(page, USERS.hr);
    await page.goto('/journey');
    await runTour(page);
    await page.goto('/journey?tab=templates');
    await page.getByTestId('template-add').click();
    const m = page.getByRole('dialog');
    await m.getByLabel(/^Name/).fill('Buddy assigned');
    await m.getByRole('button', { name: /Save/ }).click();
    await expectToast(page, 'success');
    await expect(page.getByText('Buddy assigned').first()).toBeVisible();
    await page.goto('/journey?employee=7');
    await expect(page.getByText('Anita Desai').first()).toBeVisible();
    await expect(page.locator('.journey-step')).toHaveCount(14);
    await page.getByTestId('stage-complete').first().click();
    await expectToast(page, 'success');
    await expect(page.locator('.journey-step.completed')).toHaveCount(10);
  });

  test('job descriptions and vacancies', async ({ page }) => {
    await login(page, USERS.hr);
    await page.goto('/jobs');
    await runTour(page);
    await page.getByTestId('jd-add').click();
    const m = page.getByRole('dialog');
    await m.getByLabel(/^Title/).fill('Data Analyst');
    await m.getByTestId('jd-save').click();
    await expectToast(page, 'success');
    await expect(page.getByText('Data Analyst').first()).toBeVisible();
    await page.goto('/jobs?tab=vacancies');
    await expect(page.getByText('Software Engineer (Platform)').first()).toBeVisible();
  });

  test('org tree renders both modes with the tour', async ({ page }) => {
    await login(page, USERS.hr);
    await page.goto('/org-tree');
    await runTour(page);
    await expect(page.locator('.tree-node').first()).toBeVisible();
    await expect(page.getByText('Priya Nair').first()).toBeVisible();
    await page.getByRole('button', { name: /Departments/ }).first().click();
    await expect(page.getByText('Engineering').first()).toBeVisible();
  });
});
