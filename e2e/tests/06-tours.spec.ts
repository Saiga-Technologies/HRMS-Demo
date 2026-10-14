import { test, expect } from '@playwright/test';
import { login, runTour, USERS } from './helpers';

const PAGES = ['/', '/employees', '/employees/6', '/org', '/org-tree', '/jobs', '/journey', '/documents', '/attendance', '/leave', '/payroll', '/assets', '/settings', '/account'];

test('every page offers a working "Tour this page" walkthrough (HR)', async ({ page }) => {
  await login(page, USERS.hr);
  for (const p of PAGES) {
    await page.goto(p);
    await expect(page.getByTestId('tour-button'), `tour on ${p}`).toBeEnabled();
    await runTour(page);
  }
});

test('every page offers a tour for an employee too', async ({ page }) => {
  await login(page, USERS.employee);
  for (const p of PAGES.filter((x) => x !== '/settings')) {
    await page.goto(p);
    await expect(page.getByTestId('tour-button'), `tour on ${p}`).toBeEnabled();
  }
});
