import { test, expect } from '@playwright/test';
import { login, logout, runTour, USERS, expectToast } from './helpers';

// Playwright's context starts at the seeded Bengaluru HQ (12.9716, 77.5946); ~0.009° latitude ≈ 1 km.
const HQ = { latitude: 12.9716, longitude: 77.5946 };
const KM_NORTH = { latitude: 12.9806, longitude: 77.5946 };

test.describe('travel tracking', () => {
  test('employee starts a trip with a destination, moves, stops it and sees the distance', async ({ page, context }) => {
    await context.setGeolocation(HQ);
    await login(page, USERS.employee);
    await page.goto('/attendance?tab=travel');
    await page.getByTestId('travel-start').click();
    const m = page.getByRole('dialog');
    await m.getByTestId('travel-destination').fill('Client office, Whitefield');
    await m.getByTestId('travel-purpose').fill('Quarterly review');
    await m.getByTestId('travel-confirm').click();
    await expectToast(page, 'success', /started/);
    const active = page.getByTestId('travel-active');
    await expect(active).toBeVisible();
    await expect(active).toContainText('Client office, Whitefield');
    // Move ~1 km north: watchPosition fires and a sample is posted.
    await context.setGeolocation(KM_NORTH);
    await expect(page.getByTestId('travel-distance')).toContainText(/0\.9\d|1\.0\d/, { timeout: 15_000 });
    await page.getByTestId('travel-stop').click();
    await expectToast(page, 'success', /completed/);
    await expect(page.getByTestId('travel-active')).toHaveCount(0);
    const row = page.getByRole('row', { name: /Client office, Whitefield/ });
    await expect(row).toBeVisible();
    await expect(row.getByTestId('trip-distance')).toContainText(/0\.9\d|1\.0\d/);
    await expect(row.locator('.badge', { hasText: /completed/i })).toBeVisible();
    await expect(page.getByTestId('travel-start')).toBeEnabled();
  });
});

test.describe('comp off', () => {
  test('employee requests a detected comp off, the manager approves it, and the CO balance increases', async ({ page }) => {
    await login(page, USERS.employee);
    await page.goto('/leave?tab=compoff');
    await runTour(page);
    const balance = page.getByTestId('compoff-balance');
    await expect(balance).toBeVisible();
    const before = Number((await balance.locator('.stat-value').textContent())?.trim() || '0');
    const card = page.getByTestId('compoff-detected-card').first();
    await expect(card).toBeVisible();
    await expect(card).toContainText('Weekend');
    await card.getByTestId('compoff-request').click();
    await expectToast(page, 'success', /Meera Iyer/);
    await expect(page.getByText('Pending with Meera Iyer').first()).toBeVisible();
    await logout(page);

    await login(page, USERS.manager);
    await page.goto('/leave?tab=compoff');
    const approval = page.getByTestId('compoff-approval-card').filter({ hasText: 'Karthik Raj' });
    await expect(approval).toBeVisible();
    await approval.getByTestId('compoff-review-note').fill('Thanks for the release weekend');
    await approval.getByTestId('compoff-approve').click();
    await expectToast(page, 'success', /Approved/);
    await expect(page.getByTestId('compoff-approval-card').filter({ hasText: 'Karthik Raj' })).toHaveCount(0);
    await logout(page);

    await login(page, USERS.employee);
    await page.goto('/leave?tab=compoff');
    await expect(page.getByTestId('compoff-balance').locator('.stat-value')).toHaveText(String(before + 1));
    await expect(page.locator('.badge', { hasText: /^approved$/i }).first()).toBeVisible();
    await expect(page.getByText('Thanks for the release weekend').first()).toBeVisible();
  });

  test('HR sees the criteria, runs detection and edits comp-off rules in settings', async ({ page }) => {
    await login(page, USERS.hr);
    await page.goto('/leave?tab=compoff');
    await expect(page.getByText('Detection criteria')).toBeVisible();
    await runTour(page);
    await page.getByTestId('compoff-detect').click();
    await expectToast(page, 'success', /Scanned/);
    await page.goto('/leave?tab=settings');
    await page.getByTestId('compoff-expiry').fill('45');
    await page.getByTestId('leave-settings-save').click();
    await expectToast(page, 'success');
    await page.goto('/leave?tab=compoff');
    await expect(page.getByText('45 days after the worked date')).toBeVisible();
  });
});
