import { test, expect } from '@playwright/test';
import { login, runTour, USERS, expectToast } from './helpers';

test.describe('attendance', () => {
  test('employee punches in inside the geofence, takes a timed break, punches out; outside geofence is rejected', async ({ page, context }) => {
    await login(page, USERS.employee);
    await page.goto('/attendance');
    await runTour(page);
    await expect(page.getByText(/Inside .*geofence/i)).toBeVisible();
    await page.getByTestId('punch-in').click();
    await expectToast(page, 'success');
    await expect(page.getByTestId('punch-out')).toBeEnabled();
    await page.getByTestId('break-start').click();
    await expectToast(page, 'success');
    await expect(page.getByTestId('break-end')).toBeEnabled();
    await page.getByTestId('break-end').click();
    await expectToast(page, 'success');
    // Move far away: punch out must be rejected with a distance message
    await context.setGeolocation({ latitude: 13.2, longitude: 77.7 });
    await page.getByTestId('punch-out').click();
    await expectToast(page, 'error', /m from Bengaluru HQ/);
    await context.setGeolocation({ latitude: 12.9717, longitude: 77.5947 });
    await page.getByTestId('punch-out').click();
    await expectToast(page, 'success');
    await expect(page.getByTestId('punch-out')).toBeDisabled();
  });

  test('employee requests a correction and the manager approves it; HR manages locations', async ({ page }) => {
    await login(page, USERS.employee);
    await page.goto('/attendance?tab=corrections');
    await page.getByRole('button', { name: /Request correction/i }).first().click();
    const m = page.getByRole('dialog');
    const d = new Date(Date.now() - 4 * 86400000);
    const date = d.toISOString().slice(0, 10);
    await m.getByLabel(/^Date/).fill(date);
    await m.getByLabel(/punch out/i).fill(`${date}T18:30`);
    await m.getByLabel(/Reason/).fill('Forgot to punch out');
    await m.getByTestId('correction-submit').click();
    await expectToast(page, 'success');
    await page.getByTestId('user-menu').click();
    await page.getByTestId('logout').click();

    await login(page, USERS.manager);
    await page.goto('/attendance?tab=corrections');
    await expect(page.getByText('Forgot to punch out').first()).toBeVisible();
    await page.getByTestId('correction-review').first().click();
    await page.getByTestId('correction-approve').click();
    await expectToast(page, 'success');
    await page.getByTestId('user-menu').click();
    await page.getByTestId('logout').click();

    await login(page, USERS.hr);
    await page.goto('/attendance?tab=locations');
    await page.getByTestId('location-add').click();
    const lm = page.getByRole('dialog');
    await lm.getByLabel(/^Name/).fill('Chennai Office');
    await lm.getByLabel(/Latitude/).fill('13.0827');
    await lm.getByLabel(/Longitude/).fill('80.2707');
    await lm.getByTestId('location-save').click();
    await expectToast(page, 'success');
    await expect(page.getByRole('cell', { name: 'Chennai Office' })).toBeVisible();
  });
});

test.describe('leave', () => {
  test('employee applies, manager approves, balance updates, employee corrects and cancels', async ({ page }) => {
    await login(page, USERS.employee);
    await page.goto('/leave');
    await runTour(page);
    await page.getByTestId('leave-apply').click();
    const m = page.getByRole('dialog');
    await m.getByLabel(/Leave type/).selectOption({ label: 'Casual Leave (CL)' });
    // next Monday + 10 days
    const base = new Date(Date.now() + 10 * 86400000);
    while (base.getDay() !== 1) base.setDate(base.getDate() + 1);
    const start = base.toISOString().slice(0, 10);
    const end = new Date(base.getTime() + 86400000).toISOString().slice(0, 10);
    await m.getByLabel(/Start date/).fill(start);
    await m.getByLabel(/End date/).fill(end);
    await m.getByLabel(/Reason/).fill('Family trip');
    await m.getByTestId('leave-submit').click();
    await expectToast(page, 'success');
    await expect(page.getByText('Family trip').first()).toBeVisible();
    await page.getByTestId('user-menu').click();
    await page.getByTestId('logout').click();

    await login(page, USERS.manager);
    await page.goto('/leave?tab=approvals');
    const row = page.locator('[data-testid="leave-approve"]').first();
    await expect(row).toBeVisible();
    await row.click();
    await expectToast(page, 'success');
    await page.getByTestId('user-menu').click();
    await page.getByTestId('logout').click();

    await login(page, USERS.employee);
    await page.goto('/leave');
    await expect(page.getByText('Family trip').first()).toBeVisible();
    await expect(page.locator('.badge', { hasText: /approved/i }).first()).toBeVisible();
  });

  test('HR manages leave types', async ({ page }) => {
    await login(page, USERS.hr);
    await page.goto('/leave?tab=types');
    await page.getByTestId('leavetype-add').click();
    const m = page.getByRole('dialog');
    await m.getByLabel(/^Name/).fill('Bereavement Leave');
    await m.getByLabel(/^Code/).fill('BL');
    await m.getByLabel(/quota/i).fill('5');
    await m.getByTestId('leavetype-save').click();
    await expectToast(page, 'success');
    await expect(page.getByRole('cell', { name: 'Bereavement Leave' })).toBeVisible();
  });
});
