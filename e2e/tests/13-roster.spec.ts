import { test, expect } from '@playwright/test';
import { login, runTour, USERS, expectToast } from './helpers';

// Karthik Raj (EMP0006) is employee@acme.example and reports to Meera (manager@acme.example).
const KARTHIK = 'EMP0006';

// Work six weeks ahead: clear of leave that earlier specs approve for Karthik in the coming weeks.
function targetWeek() {
  const d = new Date();
  d.setDate(d.getDate() + 42 - ((d.getDay() + 6) % 7)); // Monday, six weeks out
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

test.describe('shift roster', () => {
  test('HR tours the roster, assigns a shift and a day off in a future week, then copies the week forward', async ({ page }) => {
    await login(page, USERS.hr);
    await page.goto('/roster');
    await expect(page.getByTestId('roster-grid')).toBeVisible();
    await runTour(page, { minSteps: 10 });

    // Week navigation keeps the week in the URL.
    const label = await page.getByTestId('roster-week-label').textContent();
    await page.getByTestId('roster-next').click();
    await expect(page.getByTestId('roster-week-label')).not.toHaveText(label || '');
    await expect(page).toHaveURL(/week=\d{4}-\d{2}-\d{2}/);
    await page.goto(`/roster?week=${targetWeek()}`);

    const row = page.getByTestId(`roster-row-${KARTHIK}`);
    await expect(row).toBeVisible();
    // Tuesday has no override yet (default shift, weekly off or a seeded holiday).
    await expect(row.getByTestId('roster-cell-1').locator('[data-kind="assigned"]')).toHaveCount(0);

    // Assign the Early shift on Tuesday with a note.
    await row.getByTestId('roster-cell-1').click();
    const modal = page.getByTestId('roster-assign-modal');
    await expect(modal).toBeVisible();
    await modal.getByTestId('roster-shift').selectOption({ label: 'Early (7:00-16:00) (07:00–16:00)' });
    await modal.getByTestId('roster-note').fill('Release support');
    await modal.getByTestId('roster-save').click();
    await expectToast(page, 'success', 'Shift assigned');
    await expect(modal).toBeHidden();
    await expect(row.getByTestId('roster-cell-1')).toContainText('Early');
    await expect(row.getByTestId('roster-cell-1').locator('[data-kind="assigned"]')).toBeVisible();

    // Wednesday becomes a day off.
    await row.getByTestId('roster-cell-2').click();
    await modal.getByTestId('roster-shift').selectOption('off');
    await modal.getByTestId('roster-save').click();
    await expectToast(page, 'success', 'Day off set');
    await expect(row.getByTestId('roster-cell-2')).toContainText('Day off');

    // Thursday: assign then clear back to the default shift.
    await row.getByTestId('roster-cell-3').click();
    await modal.getByTestId('roster-shift').selectOption({ label: 'Early (7:00-16:00) (07:00–16:00)' });
    await modal.getByTestId('roster-save').click();
    await expectToast(page, 'success', 'Shift assigned');
    await row.getByTestId('roster-cell-3').click();
    await modal.getByTestId('roster-clear').click();
    await expectToast(page, 'success', 'Reverted to default shift');
    await expect(row.getByTestId('roster-cell-3').locator('[data-kind="assigned"]')).toHaveCount(0);

    // Copy into the week after.
    await page.getByTestId('roster-next').click();
    await expect(row.getByTestId('roster-cell-1').locator('[data-kind="assigned"]')).toHaveCount(0);
    await page.getByTestId('roster-copy-week').click();
    await page.getByTestId('confirm-yes').click();
    await expectToast(page, 'success', /Copied \d+ assignments/);
    await expect(row.getByTestId('roster-cell-1')).toContainText('Early');
    await expect(row.getByTestId('roster-cell-2')).toContainText('Day off');

    // HR filters by department.
    await page.getByTestId('roster-dept').selectOption({ label: 'Finance' });
    await expect(row).toHaveCount(0);
  });

  test('employee sees their roster read-only with a My week summary', async ({ page }) => {
    await login(page, USERS.employee);
    await page.goto('/roster');
    await expect(page.getByTestId('roster-grid')).toBeVisible();
    await expect(page.getByTestId('roster-copy-week')).toHaveCount(0);
    await expect(page.getByTestId('roster-export')).toBeVisible();

    await page.goto(`/roster?week=${targetWeek()}`);
    const myWeek = page.getByTestId('roster-my-week');
    await expect(myWeek).toBeVisible();
    await expect(myWeek.getByTestId('my-day-1')).toContainText('Early');
    await expect(myWeek.getByTestId('my-day-2')).toContainText('Day off');

    const row = page.getByTestId(`roster-row-${KARTHIK}`);
    await expect(row.getByTestId('roster-cell-1')).toContainText('Early');
    // Cells are not buttons for employees.
    await expect(row.locator('button')).toHaveCount(0);
    await row.getByTestId('roster-cell-1').click();
    await expect(page.getByTestId('roster-assign-modal')).toHaveCount(0);
    // Only their own row is visible.
    await expect(page.locator('[data-testid^="roster-row-"]')).toHaveCount(1);
  });
});
