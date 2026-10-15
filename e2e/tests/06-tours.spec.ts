import { test, expect } from '@playwright/test';
import { login, runTour, USERS } from './helpers';

const PAGES = ['/', '/employees', '/employees/6', '/org', '/org-tree', '/recruitment', '/jobs', '/journey', '/documents', '/attendance', '/leave', '/payroll', '/assets', '/settings', '/account', '/letters', '/performance', '/roster', '/clients', '/announcements', '/integrations'];

test('every page offers a working "Tour this page" walkthrough (HR)', async ({ page }) => {
  // Every page now has a full workflow tour (often 15-30 steps, switching tabs), so walking all of them takes a while.
  test.setTimeout(PAGES.length * 30_000);
  await login(page, USERS.hr);
  for (const p of PAGES) {
    await page.goto(p);
    await expect(page.getByTestId('tour-button'), `tour on ${p}`).toBeEnabled();
    await runTour(page);
  }
});

test('every page offers a tour for an employee too', async ({ page }) => {
  await login(page, USERS.employee);
  for (const p of PAGES.filter((x) => x !== '/settings' && x !== '/recruitment')) {
    await page.goto(p);
    await expect(page.getByTestId('tour-button'), `tour on ${p}`).toBeEnabled();
  }
});

test('theme toggle switches to dark and persists across reloads', async ({ page }) => {
  await login(page, USERS.hr);
  await page.getByTestId('theme-toggle').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByTestId('theme-toggle').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});

test('sidebar expands on hover, can be pinned, and shows pending badges', async ({ page }) => {
  await login(page, USERS.hr);
  const sidebar = page.locator('.sidebar');
  const narrow = await sidebar.evaluate((el) => el.getBoundingClientRect().width);
  await sidebar.hover();
  await expect.poll(async () => sidebar.evaluate((el) => el.getBoundingClientRect().width)).toBeGreaterThan(narrow + 100);
  await page.getByTestId('sidebar-pin').click();
  await page.mouse.move(900, 500);
  await expect.poll(async () => sidebar.evaluate((el) => el.getBoundingClientRect().width)).toBeGreaterThan(narrow + 100);
  await expect(page.getByTestId('nav-badge-leave')).toBeVisible();
  await page.getByTestId('sidebar-pin').click();
});
