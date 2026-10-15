import { test, expect } from '@playwright/test';
import { login, logout, runTour, USERS, expectToast } from './helpers';

const year = new Date().getFullYear();
// Starts after the seeded H2 cycle, so it becomes everyone's "current" open review.
const CYCLE = `Q4 ${year} check-in`;

test.describe.serial('performance reviews', () => {
  test('HR runs the tour, creates a cycle with an extra competency and opens it', async ({ page }) => {
    await login(page, USERS.hr);
    await page.goto('/performance');
    await expect(page.getByTestId('tab-me')).toBeVisible();
    await expect(page.getByTestId('tab-team')).toBeVisible();
    await expect(page.getByTestId('tab-cycles')).toBeVisible();
    await runTour(page, { minSteps: 15 });

    await page.getByTestId('tab-cycles').click();
    // Seeded cycles: a closed H1 and an open H2.
    await expect(page.getByTestId('cycle-name').filter({ hasText: `H1 ${year}` })).toBeVisible();
    await expect(page.getByTestId('cycle-name').filter({ hasText: `H2 ${year}` })).toBeVisible();

    await page.getByTestId('cycle-add').click();
    const modal = page.getByTestId('cycle-modal');
    await modal.getByTestId('cycle-name-input').fill(CYCLE);
    await modal.getByTestId('cycle-start').fill(`${year}-10-01`);
    await modal.getByTestId('cycle-end').fill(`${year}-12-31`);
    await modal.getByTestId('cycle-due').fill(`${year + 1}-01-10`);
    await expect(modal.getByTestId('competency-label-0')).toHaveValue('Quality of work');
    await modal.getByTestId('competency-add').click();
    await modal.getByTestId('competency-label-6').fill('Customer focus');
    await modal.getByTestId('cycle-submit').click();
    await expectToast(page, 'success', /Cycle created/);
    await expect(modal).toBeHidden();

    const row = page.getByRole('row').filter({ hasText: CYCLE });
    await expect(row).toContainText('draft');
    await expect(row).toContainText('7 competencies');
    await row.getByTestId('cycle-open').click();
    await page.getByTestId('confirm-yes').click();
    await expectToast(page, 'success', /is open: \d+ reviews created/);
    await expect(row).toContainText('open');
    await expect(row.getByTestId('cycle-progress')).toHaveText(/^0 \/ \d+$/);

    // Cycle detail: summary plus every review with its reviewer.
    await row.getByTestId('cycle-name').click();
    const detail = page.getByTestId('cycle-detail');
    await expect(detail).toBeVisible();
    await expect(detail.getByTestId('cycle-summary')).toContainText('0%');
    const karthik = detail.getByRole('row').filter({ hasText: 'Karthik Raj' });
    await expect(karthik).toContainText('Meera Iyer');
    await expect(karthik).toContainText('Awaiting self-assessment');
  });

  test('employee fills in and submits the self-assessment', async ({ page }) => {
    await login(page, USERS.employee);
    await page.goto('/performance');
    await expect(page.getByTestId('tab-team')).toHaveCount(0);
    await expect(page.getByTestId('tab-cycles')).toHaveCount(0);
    await expect(page.getByTestId('tab-me').locator('.tab-badge')).toBeVisible();

    const card = page.locator('[data-tour="perf-my-review"]');
    await expect(card).toContainText(CYCLE);
    await expect(page.getByTestId('my-review-status')).toHaveText('Awaiting self-assessment');
    // Seeded history (H1) is listed.
    await expect(page.locator('[data-tour="perf-history"]')).toContainText(`H1 ${year}`);

    const fours = card.locator('[data-testid^="rating-"][data-testid$="-4"]');
    await expect(fours).toHaveCount(7);
    for (let i = 0; i < 7; i++) await fours.nth(i).click();
    await card.getByTestId('goal-add').click();
    await card.getByTestId('goal-title-0').fill('Ship the payments migration');
    await card.getByTestId('goal-progress-0').fill('60');
    await card.getByTestId('review-comments').fill('Led the migration work and onboarded a new teammate.');
    await card.getByTestId('review-save').click();
    await expectToast(page, 'success', 'Draft saved');

    await card.getByTestId('review-submit').click();
    await expect(page.getByTestId('confirm-dialog')).toContainText('Meera Iyer');
    await page.getByTestId('confirm-yes').click();
    await expectToast(page, 'success', 'Self-assessment submitted');
    await expect(page.getByTestId('my-review-status')).toHaveText('Awaiting manager');
    await expect(card.getByTestId('goals-list')).toContainText('Ship the payments migration');
  });

  test('manager completes the review and the employee acknowledges it', async ({ page }) => {
    await login(page, USERS.manager);
    await page.goto('/performance?tab=team');
    await expect(page.getByTestId('tab-team').locator('.tab-badge')).toBeVisible();
    await expect(page.getByTestId('tab-cycles')).toHaveCount(0);

    await page.getByTestId('team-status').selectOption('pending_manager');
    const row = page.getByRole('row').filter({ hasText: 'Karthik Raj' }).filter({ hasText: CYCLE });
    await expect(row).toContainText('Awaiting manager');
    await row.getByTestId('review-open').click();

    const modal = page.getByTestId('review-modal');
    await expect(modal).toContainText('Led the migration work');
    await expect(modal.getByTestId('competency-customer_focus')).toContainText('Customer focus');
    const fives = modal.locator('[data-testid^="rating-"][data-testid$="-5"]');
    await expect(fives).toHaveCount(7);
    for (let i = 0; i < 7; i++) await fives.nth(i).click();
    await expect(modal.getByTestId('review-final')).toHaveAttribute('placeholder', '5');
    await modal.getByTestId('review-comments').fill('Excellent half: owned the migration end to end.');
    await modal.getByTestId('review-submit').click();
    await page.getByTestId('confirm-yes').click();
    await expectToast(page, 'success', 'Review completed for Karthik Raj');
    await expect(modal.getByTestId('review-final-rating')).toContainText('5');
    await page.keyboard.press('Escape');
    await expect(modal).toBeHidden();

    await page.getByTestId('team-status').selectOption('completed');
    await expect(page.getByRole('row').filter({ hasText: 'Karthik Raj' }).filter({ hasText: CYCLE })).toContainText('Completed');

    await logout(page);
    await login(page, USERS.employee);
    await page.goto('/performance');
    await expect(page.getByTestId('my-review-status')).toHaveText('Completed');
    const card = page.locator('[data-tour="perf-my-review"]');
    await expect(card).toContainText('Excellent half');
    await card.getByTestId('review-acknowledge').click();
    await expectToast(page, 'success', 'Review acknowledged');
    await expect(page.getByTestId('my-review-status')).toHaveText('Acknowledged');
  });
});
