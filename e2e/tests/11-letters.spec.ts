import { test, expect } from '@playwright/test';
import { login, logout, runTour, USERS, expectToast } from './helpers';

test.describe('HR letters', () => {
  test('employee requests a salary certificate, HR approves and generates it, the employee downloads the PDF', async ({ page }) => {
    // Employee: only "My letters", no HR tabs or actions.
    await login(page, USERS.employee);
    await page.goto('/letters');
    await expect(page.getByRole('heading', { name: 'HR letters' })).toBeVisible();
    await expect(page.getByTestId('letter-issue')).toHaveCount(0);
    await expect(page.getByTestId('tab-requests')).toHaveCount(0);
    await runTour(page, { minSteps: 4 });

    await page.getByTestId('letter-request').click();
    const modal = page.getByTestId('letter-modal');
    await expect(modal).toBeVisible();
    // Self-service templates only (no offer / relieving letters).
    await expect(modal.getByTestId('letter-template').locator('option', { hasText: 'Offer letter' })).toHaveCount(0);
    await modal.getByTestId('letter-template').selectOption({ label: 'Salary certificate' });
    await modal.getByTestId('letter-var-purpose').fill('a home loan application');
    await modal.getByTestId('letter-reason').fill('Bank needs it for the loan');
    await modal.getByTestId('letter-preview-btn').click();
    await expect(modal.getByTestId('letter-preview')).toContainText('Karthik Raj');
    await expect(modal.getByTestId('letter-preview')).toContainText('for the purpose of a home loan application');
    await modal.getByTestId('letter-submit').click();
    await expectToast(page, 'success', /Request sent to HR: Salary certificate/);
    await expect(modal).toBeHidden();
    const myRow = page.getByRole('row').filter({ hasText: 'Salary certificate' });
    await expect(myRow).toContainText('Awaiting approval');
    await logout(page);

    // HR: tour, queue badge, approve and generate.
    await login(page, USERS.hr);
    await page.goto('/letters');
    await runTour(page, { minSteps: 12 });
    await expect(page.getByTestId('tab-requests').locator('.tab-badge')).toHaveText('1');
    await page.getByTestId('tab-requests').click();
    await expect(page).toHaveURL(/tab=requests/);
    const card = page.getByTestId('letter-request-card').filter({ hasText: 'Karthik Raj' });
    await expect(card).toContainText('Salary certificate');
    await expect(card).toContainText('a home loan application');
    await card.getByTestId('letter-review-note').fill('Signed copy available at the front desk too');
    await card.getByTestId('letter-approve-generate').click();
    await expectToast(page, 'success', /Approved and generated Salary certificate for Karthik Raj/);
    await expect(page.getByTestId('letter-request-card')).toHaveCount(0);
    await expect(page.getByTestId('tab-requests').locator('.tab-badge')).toHaveCount(0);

    await page.getByTestId('tab-all').click();
    const hrRow = page.getByRole('row').filter({ hasText: 'Karthik Raj' }).filter({ hasText: 'Salary certificate' });
    await expect(hrRow).toContainText('Ready');
    await expect(hrRow).toContainText(/HR\/LET\/\d{4}\/\d{4}/);
    await logout(page);

    // Employee: the letter is ready with HR's note, and the PDF downloads.
    await login(page, USERS.employee);
    await page.goto('/letters');
    const ready = page.getByRole('row').filter({ hasText: 'Salary certificate' });
    await expect(ready).toContainText('Ready');
    await expect(ready).toContainText('Signed copy available at the front desk too');
    const downloadPromise = page.waitForEvent('download');
    await ready.getByTestId('my-letter-download').click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/Salary certificate\.pdf$/);
    await ready.click();
    const detail = page.getByTestId('letter-detail');
    await expect(detail).toBeVisible();
    await expect(detail.getByTestId('letter-pdf')).toBeVisible();
    await expect(detail).toContainText('Bank needs it for the loan');
  });

  test('employee request is rejected with a note', async ({ page }) => {
    await login(page, USERS.employee);
    await page.goto('/letters');
    await page.getByTestId('letter-request').click();
    const modal = page.getByTestId('letter-modal');
    await modal.getByTestId('letter-template').selectOption({ label: 'No objection certificate' });
    await modal.getByTestId('letter-var-purpose').fill('travelling abroad for a conference');
    await modal.getByTestId('letter-submit').click();
    await expectToast(page, 'success', /Request sent to HR/);
    await logout(page);

    await login(page, USERS.hr);
    await page.goto('/letters?tab=requests');
    const card = page.getByTestId('letter-request-card').filter({ hasText: 'No objection certificate' });
    await card.getByTestId('letter-review-note').fill('Please ask your manager to email HR first');
    await card.getByTestId('letter-reject').click();
    await expectToast(page, 'success', /Rejected Karthik Raj's No objection certificate request/);
    await logout(page);

    await login(page, USERS.employee);
    await page.goto('/letters');
    const row = page.getByRole('row').filter({ hasText: 'No objection certificate' });
    await expect(row).toContainText('Rejected');
    await expect(row).toContainText('Please ask your manager to email HR first');
    await expect(row.getByTestId('my-letter-download')).toHaveCount(0);
  });

  test('HR creates a template, previews it, issues it to an employee and deletes the letter', async ({ page }) => {
    await login(page, USERS.hr);
    await page.goto('/letters?tab=templates');
    await expect(page.getByTestId('template-row').filter({ hasText: 'Experience certificate' })).toBeVisible();

    await page.getByTestId('template-add').click();
    const tm = page.getByTestId('template-modal');
    await tm.getByTestId('template-name').fill('Visa support letter');
    await tm.getByTestId('template-subject').fill('Visa support - {{employee.full_name}}');
    await tm.getByTestId('template-body').fill('This is to confirm that ');
    await tm.getByTestId('placeholder-list').getByText('{{employee.full_name}}').click();
    await tm.getByTestId('template-body').press('End');
    await tm.getByTestId('template-body').pressSequentially(' travels to {{var.destination}} on company business.');
    await expect(tm.getByTestId('template-body')).toHaveValue('This is to confirm that {{employee.full_name}} travels to {{var.destination}} on company business.');
    await tm.getByTestId('template-self-service').check();
    await tm.getByTestId('template-submit').click();
    await expectToast(page, 'success', /Created template Visa support letter/);
    const tplRow = page.getByRole('row').filter({ hasText: 'Visa support letter' });
    await expect(tplRow).toContainText('VISA_SUPPORT_LETTER');
    await expect(tplRow).toContainText('Self-service');
    await expect(tplRow).toContainText('destination');

    // Preview with a sample employee.
    await tplRow.getByTestId('template-preview').click();
    const pm = page.getByTestId('template-preview-modal');
    await pm.getByTestId('template-preview-employee').selectOption({ label: 'Anita Desai (EMP0007)' });
    await pm.getByTestId('letter-var-destination').fill('Singapore');
    await pm.getByTestId('template-preview-run').click();
    await expect(pm.getByTestId('letter-preview')).toContainText('This is to confirm that Anita Desai travels to Singapore on company business.');
    await page.keyboard.press('Escape');
    await expect(pm).toBeHidden();

    // Issue the letter and generate the PDF in one go.
    await page.getByTestId('letter-issue').click();
    const im = page.getByTestId('letter-modal');
    await im.getByTestId('letter-employee').selectOption({ label: 'Anita Desai (EMP0007)' });
    await im.getByTestId('letter-template').selectOption({ label: 'Visa support letter' });
    await im.getByTestId('letter-var-destination').fill('Singapore');
    await expect(im.getByTestId('letter-generate-now')).toBeChecked();
    await im.getByTestId('letter-submit').click();
    await expectToast(page, 'success', /Visa support - Anita Desai generated for Anita Desai/);
    await expect(page).toHaveURL(/tab=all/);
    const row = page.getByRole('row').filter({ hasText: 'Visa support - Anita Desai' });
    await expect(row).toContainText('Ready');

    // Delete it.
    await row.getByTestId('letter-delete').click();
    await page.getByTestId('confirm-yes').click();
    await expectToast(page, 'success', /Letter deleted/);
    await expect(page.getByRole('row').filter({ hasText: 'Visa support - Anita Desai' })).toHaveCount(0);
  });
});
