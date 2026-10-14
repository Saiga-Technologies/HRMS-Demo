import { test, expect } from '@playwright/test';
import { login, runTour, USERS, expectToast } from './helpers';

test.describe('org structure', () => {
  test('HR adds a department and a position; both appear in the org tree', async ({ page }) => {
    await login(page, USERS.hr);
    await page.goto('/org');
    await runTour(page);
    await page.getByTestId('org-add').click();
    const dm = page.getByTestId('department-modal');
    await dm.getByLabel('Name').fill('Customer Success');
    await dm.getByLabel('Code').fill('CS');
    await dm.getByLabel('Parent department').selectOption({ label: 'Sales' });
    await dm.getByTestId('department-save').click();
    await expectToast(page, 'success', /Department created/);
    await expect(page.getByRole('cell', { name: /Customer Success/ })).toBeVisible();

    await page.getByRole('tab', { name: /Positions/ }).click();
    await page.getByTestId('org-add').click();
    const pm = page.getByTestId('position-modal');
    await pm.getByLabel('Title').fill('Customer Success Manager');
    await pm.getByLabel('Department').selectOption({ label: 'Customer Success' });
    await pm.getByLabel('Planned headcount').fill('2');
    await pm.getByTestId('position-save').click();
    await expectToast(page, 'success', /Position created/);
    await expect(page.getByRole('cell', { name: /Customer Success Manager/ })).toBeVisible();

    await page.goto('/org-tree');
    await expect(page.getByTestId('tour-button')).toBeEnabled();
  });
});

test.describe('settings', () => {
  test('HR updates branding, document formats, custom fields and users', async ({ page }) => {
    await login(page, USERS.hr);
    await page.goto('/settings');
    await runTour(page);
    await page.getByTestId('company-name').fill('Acme Corp Ltd');
    await page.getByTestId('company-save').click();
    await expectToast(page, 'success');
    await expect(page.locator('.brand-name').first()).toHaveText('Acme Corp Ltd');

    await page.getByRole('tab', { name: 'Document rules' }).click();
    await page.getByTestId('fmt-png').uncheck();
    await page.getByTestId('docrules-save').click();
    await expectToast(page, 'success');
    await page.reload();
    await page.getByRole('tab', { name: 'Document rules' }).click();
    await expect(page.getByTestId('fmt-png')).not.toBeChecked();
    await page.getByTestId('fmt-png').check();
    await page.getByTestId('docrules-save').click();

    await page.getByRole('tab', { name: 'Custom fields' }).click();
    await page.getByTestId('field-add').click();
    await page.getByTestId('field-label').fill('Shirt colour');
    await page.getByTestId('field-type').selectOption('select');
    await page.getByLabel('Options (one per line)').fill('Red\nBlue');
    await page.getByTestId('field-save').click();
    await expectToast(page, 'success');
    await expect(page.getByRole('cell', { name: 'Shirt colour' })).toBeVisible();

    await page.getByRole('tab', { name: 'Users & roles' }).click();
    await page.getByTestId('user-add').click();
    await page.getByTestId('user-email').fill('new.hire@acme.example');
    await page.getByTestId('user-role').selectOption('manager');
    await page.getByTestId('user-password').fill('Welcome123!');
    await page.getByTestId('user-save').click();
    await expectToast(page, 'success');
    await expect(page.getByRole('cell', { name: 'new.hire@acme.example' })).toBeVisible();
  });
});
