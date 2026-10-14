import { test, expect, type Page } from '@playwright/test';
import { login, logout, runTour, USERS, expectToast } from './helpers';

const monthsAgo = (n: number) => {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

/** Create + process + approve a pay run for `period` through the API (shares the browser session cookie). */
async function approvedRun(page: Page, period: string) {
  let run = await page.request.post('/api/payroll/runs', { data: { period } });
  let body: any;
  if (run.ok()) body = await run.json();
  else {
    const list = await (await page.request.get('/api/payroll/runs')).json();
    body = list.find((r: any) => r.period === period);
  }
  expect(body?.id).toBeTruthy();
  if (body.status === 'draft') expect((await page.request.post(`/api/payroll/runs/${body.id}/process`)).ok()).toBeTruthy();
  if (body.status !== 'approved' && body.status !== 'paid') expect((await page.request.post(`/api/payroll/runs/${body.id}/status`, { data: { status: 'approved' } })).ok()).toBeTruthy();
}

test.describe('dashboard insights', () => {
  test('HR sees clickable chart cards with insights and can add more from the grouped catalog', async ({ page }) => {
    await login(page, USERS.hr);
    const charts = page.locator('[data-testid="dash-card"][data-card-type="chart"]');
    await expect(charts.first()).toBeVisible();
    expect(await charts.count()).toBeGreaterThanOrEqual(3);
    // insight captions are rendered under charts
    await expect(page.locator('.dash-insight').first()).toBeVisible();
    // today's attendance donut + attendance trend line are part of the default HR layout
    await expect(page.locator('[data-card-key="today_attendance"] .donut')).toBeVisible();
    await expect(page.locator('[data-card-key="attendance_trend"] .line-svg')).toBeVisible();
    // the tour mentions the clickable charts
    await page.goto('/');
    await runTour(page);

    // Add a "Late comers" chart from the grouped catalog (search narrows the list)
    const before = await page.locator('[data-card-key="late_comers"]').count();
    await page.getByTestId('dash-add-card').click();
    const modal = page.getByTestId('add-card-modal');
    await expect(modal).toBeVisible();
    await expect(modal.locator('optgroup')).not.toHaveCount(0);
    await modal.getByTestId('add-card-search').fill('late comers');
    await expect(modal.getByTestId('add-card-key').locator('option')).toHaveCount(1);
    await modal.getByTestId('add-card-search').fill('');
    await modal.getByTestId('add-card-key').selectOption({ label: 'Late comers (chart)' });
    await expect(modal.getByTestId('add-card-preview')).toContainText('Late comers');
    await modal.getByTestId('add-card-submit').click();
    await expect(modal).toBeHidden();
    await expectToast(page, 'success');
    await expect(page.locator('[data-card-key="late_comers"]')).toHaveCount(before + 1);
    await expect(page.locator('[data-card-key="late_comers"]').last()).toContainText('Late comers');
    await expect(page.locator('[data-card-key="late_comers"] .hbar-row').first()).toBeVisible();

    // Clicking a department bar drills into the employee list filtered by department
    await page.locator('[data-card-key="headcount_by_department"] .hbar-row').first().click();
    await expect(page).toHaveURL(/\/employees\?department_id=\d+/);
    await page.goto('/');
    // Clicking the approvals queue opens the leave approvals
    await page.getByTestId('queue-leave').click();
    await expect(page).toHaveURL(/\/leave\?tab=approvals/);
    await page.goto('/');
    await page.getByRole('button', { name: 'Reset layout' }).click();
    await expectToast(page, 'success');
  });

  test('manager and employee get their own graphical layouts', async ({ page }) => {
    await login(page, USERS.manager);
    await expect(page.locator('[data-card-key="approvals_queue"]')).toBeVisible();
    await expect(page.locator('[data-card-key="my_week"] .vbar-svg')).toBeVisible();
    await expect(page.locator('[data-card-key="leave_calendar_heat"] .heatmap')).toBeVisible();
    await logout(page);
    await login(page, USERS.employee);
    await expect(page.locator('[data-card-key="my_week"]')).toBeVisible();
    await expect(page.locator('[data-card-key="my_leave_balance_chart"] .donut')).toBeVisible();
    await expect(page.locator('[data-card-key="late_comers"]')).toHaveCount(0);
    // the payslip-request shortcut stat navigates to the requests tab
    await page.locator('[data-card-key="my_payslip_requests"] .stat').click();
    await expect(page).toHaveURL(/\/payroll\?tab=requests/);
  });
});

test.describe('payslip requests', () => {
  test('employee applies for a payslip, HR fulfils it from an approved run, employee opens it', async ({ page }) => {
    const period = monthsAgo(2);
    await login(page, USERS.employee);
    await page.goto('/payroll?tab=requests');
    await page.getByTestId('payslip-request-new').click();
    const m = page.getByTestId('payslip-request-modal');
    await m.getByTestId('payslip-request-period').fill(period);
    await m.getByTestId('payslip-request-reason').fill('Needed for a loan application');
    await m.getByTestId('payslip-request-submit').click();
    await expectToast(page, 'success');
    await expect(page.getByText('Pending with HR').first()).toBeVisible();
    // one pending request per month
    await page.getByTestId('payslip-request-new').click();
    await page.getByTestId('payslip-request-modal').getByTestId('payslip-request-period').fill(period);
    await page.getByTestId('payslip-request-modal').getByTestId('payslip-request-submit').click();
    await expectToast(page, 'error');
    await page.keyboard.press('Escape');
    await logout(page);

    await login(page, USERS.hr);
    await page.goto('/payroll?tab=requests');
    await expect(page.getByRole('cell', { name: /Karthik Raj/ }).first()).toBeVisible();
    // without an approved run the request cannot be fulfilled
    await page.getByTestId('payslip-request-fulfil').first().click();
    await expectToast(page, 'error');
    await approvedRun(page, period);
    await page.reload();
    await page.getByTestId('payslip-request-fulfil').first().click();
    await expectToast(page, 'success');
    await expect(page.getByTestId('payslip-request-fulfil')).toHaveCount(0);
    await page.getByRole('button', { name: /^Fulfilled$/ }).click();
    await expect(page.getByText(/Fulfilled by/).first()).toBeVisible();
    await logout(page);

    await login(page, USERS.employee);
    await page.goto('/payroll?tab=requests');
    await page.getByTestId('payslip-request-open').first().click();
    await expect(page.locator('.payslip')).toBeVisible();
    await expect(page.locator('.payslip')).toContainText('Karthik Raj');
    await expect(page.getByTestId('payslip-download')).toBeVisible();
  });
});
