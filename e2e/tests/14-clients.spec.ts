import { test, expect } from '@playwright/test';
import { login, runTour, USERS, expectToast } from './helpers';

test.describe('clients & placements', () => {
  test('HR runs the tour, adds a client, places an employee and activates the placement', async ({ page }) => {
    await login(page, USERS.hr);
    await page.goto('/clients');
    await runTour(page);

    // Demo clients are created on first listing.
    await expect(page.getByTestId('client-row-name').filter({ hasText: 'Nimbus Retail' })).toBeVisible();

    // Create a client; the detail opens straight away.
    await page.getByTestId('client-add').click();
    const form = page.getByTestId('client-modal');
    await form.getByTestId('client-name').fill('Zenith Logistics');
    await form.getByTestId('client-industry').fill('Logistics');
    await form.getByTestId('client-contact-name').fill('Asha Menon');
    await form.getByTestId('client-contact-email').fill('asha.menon@zenith.example');
    await form.getByTestId('client-terms').fill('45');
    await form.getByTestId('client-submit').click();
    await expectToast(page, 'success', /Client Zenith Logistics added/);
    const detail = page.getByTestId('client-detail');
    await expect(detail).toBeVisible();
    await expect(detail).toContainText('Zenith Logistics');
    await expect(detail).toContainText(/CL-\d{4}/);
    await expect(detail).toContainText('net 45 days');

    // Add a placement for an employee.
    await detail.getByTestId('client-add-placement').click();
    const pf = page.getByTestId('placement-modal');
    await expect(pf.getByTestId('placement-client')).toBeDisabled();
    await pf.getByTestId('placement-role').fill('Logistics Analyst');
    const employee = pf.getByTestId('placement-employee');
    await expect(employee.locator('option').nth(1)).toBeAttached();
    await employee.selectOption({ index: 1 });
    await pf.getByTestId('placement-unit').selectOption('month');
    await pf.getByTestId('placement-bill').fill('100000');
    await pf.getByTestId('placement-pay').fill('70000');
    await expect(pf.getByTestId('placement-margin-preview')).toContainText('30.0%');
    await pf.getByTestId('placement-submit').click();
    await expectToast(page, 'success', /Placement added/);

    // Back on the client: the placement is proposed; activate it.
    await expect(detail).toBeVisible();
    await expect(detail.getByTestId('placement-role-cell')).toHaveText('Logistics Analyst');
    await expect(detail.getByTestId('placement-status')).toHaveText('Proposed');
    await detail.getByTestId('placement-active').click();
    await expectToast(page, 'success', 'Placement active');
    await expect(detail.getByTestId('placement-status')).toHaveText('Active');
    await expect(detail).toContainText('30%');
    await expect(detail.getByTestId('placement-completed')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(detail).toBeHidden();

    // The client list and the placements tab reflect it.
    const row = page.getByRole('row').filter({ hasText: 'Zenith Logistics' });
    await expect(row).toContainText('1 active / 1');
    await page.getByTestId('tab-placements').click();
    await expect(page).toHaveURL(/tab=placements/);
    await page.getByTestId('placement-filter-client').selectOption({ label: 'Zenith Logistics' });
    await expect(page.getByTestId('placement-role-cell')).toHaveText(['Logistics Analyst']);
    await expect(page.getByTestId('placement-status')).toHaveText(['Active']);
  });

  test('a manager sees clients and placements read-only; an employee is redirected', async ({ page }) => {
    await login(page, USERS.manager);
    await page.goto('/clients');
    await expect(page.getByTestId('client-row-name').first()).toBeVisible();
    await expect(page.getByTestId('client-add')).toHaveCount(0);
    await expect(page.getByTestId('placement-add')).toHaveCount(0);

    await page.getByTestId('client-row-name').filter({ hasText: 'Orion Fintech' }).click();
    const detail = page.getByTestId('client-detail');
    await expect(detail).toBeVisible();
    await expect(detail.getByTestId('placement-role-cell').first()).toBeVisible();
    await expect(detail.getByTestId('client-edit')).toHaveCount(0);
    await expect(detail.getByTestId('client-add-placement')).toHaveCount(0);
    await expect(detail.getByTestId('placement-edit')).toHaveCount(0);
    await page.keyboard.press('Escape');

    await page.getByTestId('tab-placements').click();
    await expect(page.getByTestId('placement-role-cell').first()).toBeVisible();
    await expect(page.getByTestId('placement-active')).toHaveCount(0);
    await expect(page.getByTestId('placement-delete')).toHaveCount(0);
    await expect(page.getByText('You have read-only access.')).toBeVisible();

    await page.getByTestId('user-menu').click();
    await page.getByTestId('logout').click();
    await login(page, USERS.employee);
    await page.goto('/clients');
    await expect(page).toHaveURL(/\/$|\/\?/);
  });
});
