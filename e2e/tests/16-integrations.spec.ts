import { test, expect } from '@playwright/test';
import { login, runTour, USERS, expectToast } from './helpers';

test.describe('integrations & API', () => {
  test('HR creates an API key that is shown once, uses it, revokes it, and manages a webhook', async ({ page, request, baseURL }) => {
    await login(page, USERS.hr);
    await page.goto('/integrations');
    await runTour(page);
    await expect(page.getByTestId('careers-url')).toContainText('/careers');

    // Create a key; the full value is shown once.
    await page.getByTestId('key-add').click();
    const modal = page.getByTestId('key-modal');
    await modal.getByTestId('key-name').fill('E2E job board');
    await expect(modal.getByTestId('key-scope-candidates:write')).toBeChecked();
    await modal.getByTestId('key-submit').click();
    await expectToast(page, 'success', 'API key created');
    const shown = page.getByTestId('key-created');
    const key = await shown.getByTestId('key-value').inputValue();
    expect(key).toMatch(/^hrms_/);
    await shown.getByTestId('key-done').click();
    const row = page.getByRole('row', { name: /E2E job board/ });
    await expect(row).toContainText(key.slice(0, 12));
    await expect(row).not.toContainText(key);

    // The key works against the public API…
    const ok = await request.post(`${baseURL}/api/public/v1/candidates`, { headers: { 'X-API-Key': key }, data: { first_name: 'Board', last_name: 'Candidate', email: 'board.candidate@example.com' } });
    expect(ok.status()).toBe(201);
    await page.reload();
    await expect(page.getByRole('row', { name: /E2E job board/ })).not.toContainText('Never');

    // …until it is revoked.
    await page.getByRole('row', { name: /E2E job board/ }).getByRole('button', { name: 'Revoke' }).click();
    await page.getByTestId('confirm-yes').click();
    await expectToast(page, 'success', 'Key revoked');
    await expect(page.getByRole('row', { name: /E2E job board/ })).toContainText('Revoked');
    const denied = await request.post(`${baseURL}/api/public/v1/candidates`, { headers: { 'X-API-Key': key }, data: { first_name: 'Nope' } });
    expect(denied.status()).toBe(401);

    // Webhook: add one pointing at an endpoint that answers 404, send a test, read the log.
    await page.getByTestId('tab-webhooks').click();
    await page.getByTestId('webhook-add').click();
    const hook = page.getByTestId('webhook-modal');
    await hook.getByTestId('webhook-url').fill(`${baseURL}/api/no-such-hook`);
    await hook.getByTestId('webhook-secret').fill('topsecret');
    await hook.getByTestId('webhook-submit').click();
    await expectToast(page, 'success', 'Webhook added');
    const hookRow = page.getByRole('row', { name: /no-such-hook/ });
    await expect(hookRow).toContainText('Signed');
    await hookRow.getByRole('button', { name: 'Send test' }).click();
    await expectToast(page, 'error', /Ping failed: HTTP 404/);
    await expect(hookRow).toContainText('Failed');
    await expect(page.getByTestId('tab-webhooks').locator('.tab-badge')).toHaveText('1');
    await hookRow.getByRole('button', { name: /Log/ }).click();
    const log = page.getByTestId('webhook-log');
    await expect(log).toContainText('ping');
    await expect(log).toContainText('HTTP 404');
    await log.getByRole('button', { name: 'Close' }).click();

    await page.getByTestId('tab-docs').click();
    await expect(page.locator('[data-tour="int-docs"]')).toContainText('/api/public/v1/candidates');
  });

  test('employees cannot open integrations', async ({ page }) => {
    await login(page, USERS.employee);
    await expect(page.locator('a[href="/integrations"]')).toHaveCount(0);
    await page.goto('/integrations');
    await expect(page).toHaveURL(/\/$/);
  });
});
