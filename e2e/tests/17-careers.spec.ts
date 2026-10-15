import { test, expect } from '@playwright/test';
import path from 'node:path';
import { login, runTour, USERS } from './helpers';

const fixtures = path.join(__dirname, '..', 'fixtures');

test.describe('public careers page', () => {
  test('a visitor finds a job, applies with a CV, and HR sees the scored application in the pipeline', async ({ page }) => {
    await page.goto('/careers');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Join');
    const cards = page.getByTestId('job-card');
    await expect(cards.first()).toBeVisible();
    await runTour(page, { minSteps: 6 });

    // Earlier specs may fill a seeded vacancy, so search for whichever role is listed first.
    const title = (await cards.first().locator('.careers-card-title').textContent())!.trim();
    await page.getByPlaceholder('Search roles or skills…').fill(title);
    await expect(cards).toHaveCount(1);
    await page.getByPlaceholder('Search roles or skills…').fill('zzz-no-such-role');
    await expect(page.getByText('No roles match your search')).toBeVisible();
    await page.getByPlaceholder('Search roles or skills…').fill(title);
    await cards.first().click();
    await expect(page.getByTestId('job-title')).toHaveText(title);
    await runTour(page, { minSteps: 8 });

    // Missing CV is caught before sending.
    const form = page.getByTestId('apply-form');
    await form.getByTestId('apply-first-name').fill('Kiran');
    await form.getByTestId('apply-last-name').fill('Applicant');
    await form.getByTestId('apply-email').fill('kiran.applicant@example.com');
    await form.getByTestId('apply-submit').click();
    await expect(form.getByTestId('apply-error')).toHaveText(/attach your CV/);

    await form.getByTestId('apply-cv').setInputFiles(path.join(fixtures, 'cv-sample.txt'));
    await form.getByTestId('apply-submit').click();
    await expect(page.getByTestId('apply-success')).toBeVisible();
    await expect(page.getByTestId('apply-reference')).toHaveText(/^APP-\d{5}$/);

    // Applying twice for the same job is refused.
    await page.reload();
    await form.getByTestId('apply-first-name').fill('Kiran');
    await form.getByTestId('apply-email').fill('kiran.applicant@example.com');
    await form.getByTestId('apply-cv').setInputFiles(path.join(fixtures, 'cv-sample.txt'));
    await form.getByTestId('apply-submit').click();
    await expect(form.getByTestId('apply-error')).toHaveText(/already applied/);

    // Dark theme works on the public page too.
    const before = await page.locator('html').getAttribute('data-theme');
    await page.getByTestId('theme-toggle').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', before === 'dark' ? 'light' : 'dark');

    await login(page, USERS.hr);
    await page.goto('/recruitment');
    const card = page.getByTestId('column-new').getByTestId('candidate-card').filter({ hasText: 'Kiran Applicant' });
    await expect(card).toBeVisible();
    await card.click();
    await expect(page.getByTestId('candidate-detail')).toContainText('Careers page');
  });

  test('an unknown job shows a friendly message', async ({ page }) => {
    await page.goto('/careers/99999');
    await expect(page.getByText('This role is no longer open')).toBeVisible();
    await page.getByRole('link', { name: 'See open roles' }).click();
    await expect(page.getByTestId('job-card').first()).toBeVisible();
  });
});
