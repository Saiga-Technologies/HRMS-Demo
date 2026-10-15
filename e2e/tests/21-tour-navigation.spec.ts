import { test, expect, type Page } from '@playwright/test';
import { login, USERS, PASSWORD } from './helpers';

/** First step title of the tour currently offered by "Tour this page". */
async function firstTourTitle(page: Page) {
  await page.getByTestId('tour-button').click();
  const popover = page.locator('.driver-popover');
  await expect(popover).toBeVisible();
  const title = (await popover.locator('.driver-popover-title').textContent())?.trim();
  await page.keyboard.press('Escape');
  await expect(popover).toBeHidden();
  return title;
}

// Regression: navigating inside the app used to wipe the new page's tour, so every page reached
// through the sidebar fell back to the generic 6-card tour ("This page").
test('the page-specific tour survives in-app navigation', async ({ page }) => {
  await login(page, USERS.hr);
  const seen = new Set<string>();
  for (const to of ['/leave', '/attendance', '/payroll', '/employees', '/documents', '/']) {
    await page.locator(`.sidebar a[data-nav="${to}"]`).click();
    await expect(page).toHaveURL(new RegExp(`${to === '/' ? '/$' : to}`));
    await expect(page.locator('.page-header')).toBeVisible();
    const title = await firstTourTitle(page);
    expect(title, `tour on ${to}`).not.toBe('This page');
    seen.add(title || '');
  }
  expect(seen.size).toBeGreaterThan(3); // each page has its own tour
});

test('agency portal pages keep their own tours when navigating', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('admin@saigahr.example');
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByTestId('login-submit').click();
  await expect(page).toHaveURL(/\/agency$/);
  for (const to of ['/agency/calendar', '/agency/requests', '/agency/billing', '/agency/team', '/agency']) {
    await page.locator(`.sidebar a[data-nav="${to}"]`).click();
    await expect(page).toHaveURL(new RegExp(`${to}$`));
    expect(await firstTourTitle(page), `tour on ${to}`).not.toBe('This page');
  }
});
