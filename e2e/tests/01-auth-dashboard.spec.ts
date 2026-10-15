import { test, expect } from '@playwright/test';
import { login, logout, runTour, USERS, PASSWORD, expectToast } from './helpers';

test.describe('authentication', () => {
  test('rejects a wrong password and signs in HR', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill(USERS.hr);
    await page.getByLabel('Password').fill('wrong');
    await page.getByTestId('login-submit').click();
    await expect(page.getByRole('alert')).toContainText(/Invalid email or password/);
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByTestId('login-submit').click();
    await expect(page.getByText(/Good (morning|afternoon|evening)/)).toBeVisible();
    await logout(page);
    await page.goto('/employees');
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe('dashboard', () => {
  test('shows default cards, supports unlimited cards, reorder and tour', async ({ page }) => {
    await login(page, USERS.hr);
    const cards = page.getByTestId('dash-card');
    const initial = await cards.count();
    expect(initial).toBeGreaterThan(5);
    // Add 6 cards of different kinds — no cap.
    for (let i = 0; i < 6; i++) {
      await page.getByTestId('dash-add-card').click();
      const modal = page.getByTestId('add-card-modal');
      await expect(modal).toBeVisible();
      if (i % 2 === 0) await modal.getByTestId('add-card-key').selectOption({ index: i % 5 });
      else await modal.getByRole('button', { name: 'Note' }).click();
      await modal.getByTestId('add-card-submit').click();
      await expect(modal).toBeHidden();
    }
    await expect(cards).toHaveCount(initial + 6);
    // Remove one
    await cards.last().getByTestId('card-menu').click();
    await cards.last().getByTestId('card-remove').click();
    await expect(cards).toHaveCount(initial + 5);
    // Persisted after reload
    await page.reload();
    await expect(page.getByTestId('dash-card')).toHaveCount(initial + 5);
    // Stat click navigates
    await page.getByText('Headcount', { exact: true }).first().click();
    await expect(page).toHaveURL(/\/employees/);
    await page.goto('/');
    await runTour(page, { minSteps: 20 });
    await page.getByRole('button', { name: 'Reset layout' }).click();
    await expectToast(page, 'success');
    await expect(page.getByTestId('dash-card')).toHaveCount(initial);
  });

  test('employee sees a self-service dashboard', async ({ page }) => {
    await login(page, USERS.employee);
    await expect(page.getByText('My leave balance')).toBeVisible();
    await expect(page.locator('[data-nav="/settings"]')).toHaveCount(0);
  });
});
