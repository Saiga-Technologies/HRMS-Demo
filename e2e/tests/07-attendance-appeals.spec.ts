import { test, expect } from '@playwright/test';
import { login, USERS, expectToast } from './helpers';

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const REASON = 'Left at 18:30 after the client call';

test.describe('attendance appeals and reports', () => {
  test('employee raises a missed-punch-out appeal, the manager approves it, the record shows the audit trail', async ({ page }) => {
    await login(page, USERS.employee);
    await page.goto('/attendance');
    await expect(page.getByTestId('tab-appeals')).toBeVisible();
    await page.getByTestId('appeal-new-me').click();
    const m = page.getByRole('dialog');
    const date = iso(new Date(Date.now() - 2 * 86400000));
    await m.getByTestId('appeal-kind').selectOption('missed_punch_out');
    await m.getByTestId('appeal-date').fill(date);
    await expect(m.getByText(/Can be appealed until/)).toBeVisible();
    await m.getByTestId('appeal-punch-out').fill(`${date}T18:30`);
    await m.getByTestId('appeal-reason').fill(REASON);
    await m.getByTestId('appeal-submit').click();
    await expectToast(page, 'success', /pending with Meera Iyer/);
    await expect(page).toHaveURL(/tab=appeals/);
    const mine = page.locator('tr', { hasText: REASON });
    await expect(mine).toBeVisible();
    await expect(mine.locator('.pending-with')).toHaveText(/Meera Iyer/);
    await expect(mine.getByTestId('appeal-review')).toHaveCount(0);
    // the deadline blocks old dates for employees
    await page.getByTestId('appeal-new').click();
    await page.getByRole('dialog').getByTestId('appeal-date').fill(iso(new Date(Date.now() - 10 * 86400000)));
    await expect(page.getByTestId('appeal-deadline-passed')).toBeVisible();
    await expect(page.getByTestId('appeal-submit')).toBeDisabled();
    await page.keyboard.press('Escape');
    await page.getByTestId('user-menu').click();
    await page.getByTestId('logout').click();

    await login(page, USERS.manager);
    await expect(page.getByTestId('bell')).toBeVisible();
    await page.goto('/attendance?tab=appeals');
    await expect(page.getByTestId('tab-appeals').locator('.tab-badge')).toBeVisible();
    const row = page.locator('tr', { hasText: REASON });
    await expect(row).toBeVisible();
    await row.getByTestId('appeal-review').click();
    const review = page.getByTestId('appeal-review-modal');
    await expect(review.getByTestId('appeal-compare')).toBeVisible();
    await expect(review.getByText(/Within deadline/)).toBeVisible();
    await review.getByTestId('appeal-note').fill('Approved, thanks for flagging');
    await review.getByTestId('appeal-approve').click();
    await expectToast(page, 'success', /approved/);
    await expect(page.locator('tr', { hasText: REASON })).toHaveCount(0); // pending filter no longer lists it
    await page.getByTestId('user-menu').click();
    await page.getByTestId('logout').click();

    await login(page, USERS.employee);
    await page.goto('/attendance');
    const trail = page.locator('[data-tour="att-history"] .audit-trail', { hasText: 'Meera Iyer' }).first();
    await expect(trail).toBeVisible();
    await expect(trail).toContainText(/appeal #\d+/);
    await expect(trail.locator('.audit-change')).toContainText(/→/);
    await page.goto('/attendance?tab=appeals');
    await page.locator('.pill', { hasText: 'Approved' }).click();
    const done = page.locator('tr', { hasText: REASON });
    await expect(done.locator('.audit-trail .who')).toHaveText('Meera Iyer');
    await done.getByTestId('appeal-view').click();
    await expect(page.getByTestId('appeal-audit')).toContainText(/Applied by Meera Iyer/);
  });

  test('HR runs a late-only report and exports CSV / PDF with the same filters', async ({ page }) => {
    await login(page, USERS.hr);
    await page.goto('/attendance?tab=reports');
    await page.getByTestId('report-late-only').check();
    await page.getByTestId('report-run').click();
    await expect(page.getByTestId('report-summary')).toBeVisible();
    await expect(page.locator('[data-tour="att-report-table"] tbody tr').first()).toBeVisible();
    const lateCells = page.locator('[data-tour="att-report-table"] tbody td .late');
    expect(await lateCells.count()).toBeGreaterThan(0);
    const now = new Date();
    const from = `${iso(now).slice(0, 7)}-01`, to = iso(now);
    const csv = page.waitForEvent('download');
    await page.getByTestId('report-export-csv').click();
    expect((await csv).suggestedFilename()).toBe(`attendance_${from}_to_${to}.csv`);
    await expectToast(page, 'success', /CSV downloaded/);
    const pdf = page.waitForEvent('download');
    await page.getByTestId('report-export-pdf').click();
    expect((await pdf).suggestedFilename()).toBe(`attendance_${from}_to_${to}.pdf`);
    // presets switch the builder, e.g. late comers ranking
    await page.locator('.pill', { hasText: 'Late comers this month' }).click();
    await page.getByTestId('report-run').click();
    await expect(page.getByText(/Late comers · \d+ employee/)).toBeVisible();
    await expect(page.getByRole('cell', { name: /Karthik Raj/ }).first()).toBeVisible();
    // employees can download their own statement from My attendance
    await page.getByTestId('user-menu').click();
    await page.getByTestId('logout').click();
    await login(page, USERS.employee);
    await page.goto('/attendance');
    const mine = page.waitForEvent('download');
    await page.getByTestId('my-export-pdf').click();
    expect((await mine).suggestedFilename()).toMatch(/^attendance_EMP0006_\d{4}-\d{2}-01_to_\d{4}-\d{2}-\d{2}\.pdf$/);
  });
});
