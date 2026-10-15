import { test, expect } from '@playwright/test';
import path from 'node:path';
import { login, runTour, USERS, expectToast } from './helpers';

const fixtures = path.join(__dirname, '..', 'fixtures');

test.describe('recruitment', () => {
  test('HR uploads a CV, sees the score, moves the candidate to interview, hires them and lands on the new employee profile', async ({ page }) => {
    await login(page, USERS.hr);
    await page.goto('/recruitment');
    await runTour(page, { minSteps: 15 });

    // Seeded pipeline is visible with scored cards.
    await expect(page.getByTestId('pipeline-board')).toBeVisible();
    await expect(page.getByTestId('candidate-card').first()).toBeVisible();

    // Upload the sample CV against the seeded vacancy.
    await page.getByTestId('candidate-add').click();
    const modal = page.getByTestId('candidate-modal');
    await modal.getByTestId('candidate-vacancy').selectOption({ label: 'Software Engineer (Platform)' });
    await modal.getByTestId('candidate-source').selectOption('Job board');
    await modal.getByTestId('cv-file').setInputFiles(path.join(fixtures, 'cv-sample.txt'));
    await modal.getByTestId('candidate-submit').click();
    await expectToast(page, 'success', /Parsed and scored/);
    await expect(modal.getByTestId('candidate-result')).toBeVisible();
    await expect(modal).toContainText('Riya Banerjee');
    const score = Number(await modal.getByTestId('score-value').textContent());
    expect(score).toBeGreaterThanOrEqual(60);
    await expect(modal.getByText('TypeScript').first()).toBeVisible();
    await modal.getByTestId('candidate-done').click();

    // The new card is in the "New" column; open it.
    const column = page.getByTestId('column-new');
    const card = column.getByTestId('candidate-card').filter({ hasText: 'Riya Banerjee' });
    await expect(card).toBeVisible();
    await card.click();
    const detail = page.getByTestId('candidate-detail');
    await expect(detail).toBeVisible();
    await expect(detail.getByTestId('score-value')).toHaveText(String(score));
    await expect(detail.getByTestId('breakdown-skills')).toBeVisible();
    await expect(detail.getByTestId('candidate-hire')).toBeDisabled();

    // Move to Interview, add a note, then hire.
    await detail.getByTestId('candidate-stage').selectOption('interview');
    await expectToast(page, 'success', /Moved to Interview/);
    await expect(detail.getByTestId('event-stage_change').first()).toBeVisible();
    await detail.getByTestId('note-input').fill('Strong platform background');
    await detail.getByTestId('note-submit').click();
    await expectToast(page, 'success', /Note added/);
    await expect(detail.getByTestId('candidate-hire')).toBeEnabled();
    await detail.getByTestId('candidate-hire').click();

    const form = page.getByTestId('employee-modal');
    await expect(form).toBeVisible();
    await expect(form.getByTestId('employee-first-name')).toHaveValue('Riya');
    await expect(form.getByTestId('employee-email')).toHaveValue('riya.banerjee@example.com');
    await expect(form.getByTestId('employee-code')).toHaveValue(/^EMP\d{4}$/);
    await expect(form.getByTestId('employee-create-login')).toBeChecked();
    await form.getByTestId('employee-manager').selectOption({ label: 'Meera Iyer (EMP0005)' });
    await form.getByTestId('hire-submit').click();
    await expectToast(page, 'success', /hired/i);

    // Lands on the new employee profile with the temporary password and recruitment links.
    await expect(page).toHaveURL(/\/employees\/\d+/);
    await expect(page.getByText('Riya Banerjee').first()).toBeVisible();
    await expect(page.getByTestId('temp-password')).toHaveText(/^Welcome-[0-9a-f]{4}!$/);
    await expect(page.getByTestId('employee-recruitment-link')).toBeVisible();
    await page.getByRole('tab', { name: /Journey/ }).click();
    await expect(page.getByTestId('journey-hired-via')).toContainText('Software Engineer (Platform)');
    await expect(page.getByText(/^8 \/ 1[45] stages$/)).toBeVisible(); // 15 when the journey spec added a stage template earlier in the run
    await page.getByRole('tab', { name: /Documents/ }).click();
    await expect(page.getByRole('cell', { name: /CV \(from recruitment\)/ })).toHaveCount(0); // txt CVs are not copied (PDF only)

    // Back in recruitment the candidate sits in Hired and the vacancy counts the hire.
    await page.goto('/recruitment?tab=vacancies');
    await expect(page.getByText('Hired 1').first()).toBeVisible();
    await page.goto('/recruitment?tab=pool');
    await expect(page.getByTestId('pool-candidate-name').filter({ hasText: 'Riya Banerjee' })).toBeVisible();
  });

  test('Employees → "From recruitment" picks an offer-stage candidate and the kanban supports keyboard moves', async ({ page }) => {
    await login(page, USERS.hr);
    await page.goto('/employees');
    await page.getByTestId('employee-from-recruitment').click();
    const picker = page.getByTestId('candidate-picker');
    await expect(picker).toBeVisible();
    await expect(picker.getByText('Nikhil Rao')).toBeVisible();
    await picker.getByRole('row', { name: /Nikhil Rao/ }).getByRole('button', { name: 'Hire' }).click();
    const form = page.getByTestId('employee-modal');
    await expect(form.getByTestId('employee-first-name')).toHaveValue('Nikhil');
    await form.getByTestId('employee-create-login').uncheck();
    await form.getByTestId('hire-submit').click();
    await expectToast(page, 'success', /hired/i);
    await expect(page).toHaveURL(/\/employees\/\d+/);
    await expect(page.getByText('Nikhil Rao').first()).toBeVisible();

    await page.goto('/recruitment?tab=pipeline');
    const dev = page.getByTestId('candidate-card').filter({ hasText: 'Dev Kulkarni' });
    await expect(dev).toBeVisible();
    await dev.getByTestId('candidate-move-next').click();
    await expectToast(page, 'success', /moved to Interview/);
    await expect(page.getByTestId('column-interview').getByTestId('candidate-card').filter({ hasText: 'Dev Kulkarni' })).toBeVisible();
  });

  test('a manager can view the pipeline but not hire; an employee is redirected', async ({ page }) => {
    await login(page, USERS.manager);
    await page.goto('/recruitment');
    await expect(page.getByTestId('pipeline-board')).toBeVisible();
    await page.getByTestId('candidate-card').first().click();
    await expect(page.getByTestId('candidate-detail')).toBeVisible();
    await expect(page.getByTestId('candidate-hire')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('candidate-detail')).toBeHidden();
    await page.getByTestId('user-menu').click();
    await page.getByTestId('logout').click();
    await login(page, USERS.employee);
    await page.goto('/recruitment');
    await expect(page).toHaveURL(/\/$|\/\?/);
  });
});
