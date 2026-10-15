import { test, expect, type Page } from '@playwright/test';
import { login, logout, runTour, expectToast, USERS, PASSWORD } from './helpers';

async function agencyLogin(page: Page, email = 'admin@saigahr.example') {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByTestId('login-submit').click();
  await expect(page).toHaveURL(/\/agency/);
  await expect(page.getByTestId('tour-button')).toBeVisible();
}
const thisMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

test.describe('agency billing', () => {
  test('owner generates, issues and collects an invoice; the client sees it', async ({ page }) => {
    await agencyLogin(page);
    await page.goto('/agency/billing');
    await expect(page.getByTestId('tab-overview')).toBeVisible();
    // Seeded history: overdue invoices are flagged on the overview tab.
    await expect(page.locator('[data-tab="overview"] .tab-badge')).toBeVisible();
    await runTour(page);

    // Generate drafts for the current month.
    const period = thisMonth();
    await page.getByTestId('billing-generate').click();
    const gen = page.getByTestId('generate-modal');
    await gen.getByTestId('generate-period').fill(period);
    await gen.getByTestId('generate-confirm').click();
    await expectToast(page, 'success', /drafts? created/);
    await expect(page.getByTestId('tab-invoices')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('[data-tab="invoices"] .tab-badge')).toBeVisible();

    // Acme's draft: 13 employees × PEPM; Karnataka client, Kerala entity → IGST 18%.
    await page.getByTestId(`invoice-row-acme-${period}`).click();
    const drawer = page.getByTestId('invoice-drawer');
    await expect(drawer).toBeVisible();
    await expect(drawer.getByTestId('invoice-number')).toHaveText(/Draft/);
    // Earlier specs hire / add Acme employees, so the billable count is at least the seeded 13.
    const lines = (await drawer.getByTestId('invoice-lines').textContent()) || '';
    expect(Number(lines.match(/(\d+) active employees/)?.[1])).toBeGreaterThanOrEqual(13);
    await expect(drawer.getByTestId('tax-IGST')).toContainText('18%');
    await expect(drawer.getByTestId('tax-CGST')).toHaveCount(0);

    // Issue: gets the next number of the Indian entity's series for this FY.
    await drawer.getByTestId('invoice-issue').click();
    await expectToast(page, 'success', 'Invoice issued');
    await expect(drawer.getByTestId('invoice-number')).toHaveText(/^SHS\/\d{4}-\d{2}\/\d{4}$/);
    const number = (await drawer.getByTestId('invoice-number').textContent())!.trim();

    // Partial payment, then the rest.
    await drawer.getByTestId('invoice-record-payment').click();
    let pay = page.getByTestId('payment-modal');
    await pay.getByTestId('payment-amount').fill('1000');
    await pay.getByTestId('payment-reference').fill('UTR-E2E-1');
    await pay.getByTestId('payment-save').click();
    await expectToast(page, 'success', 'Payment recorded');
    await expect(drawer.getByTestId('invoice-status')).toContainText('Part paid');
    await expect(drawer.getByTestId('invoice-payments').locator('li')).toHaveCount(1);

    await drawer.getByTestId('invoice-record-payment').click();
    pay = page.getByTestId('payment-modal');
    await pay.getByTestId('payment-reference').fill('UTR-E2E-2');
    await pay.getByTestId('payment-save').click();
    await expectToast(page, 'success', /invoice paid/);
    await expect(drawer.getByTestId('invoice-status')).toContainText('Paid');
    await expect(drawer.getByTestId('invoice-payments').locator('li')).toHaveCount(2);
    await expect(drawer.getByTestId('invoice-record-payment')).toHaveCount(0);

    // PDF download.
    const [download] = await Promise.all([page.waitForEvent('download'), drawer.getByTestId('invoice-pdf').click()]);
    expect(download.suggestedFilename()).toBe(`${number.replace(/\//g, '-')}.pdf`);

    // Pricing tab lists the client profiles.
    await page.keyboard.press('Escape');
    await page.getByTestId('tab-pricing').click();
    await expect(page.getByTestId('pricing-edit-acme')).toBeVisible();

    // The client's HR sees the invoice in their services area.
    await logout(page);
    await login(page, USERS.hr);
    await page.goto('/services?tab=invoices');
    await expect(page.getByTestId('invoice-row').filter({ hasText: number })).toBeVisible();
    const mine = await (await page.request.get('/api/services/invoices')).json();
    const inv = mine.find((i: any) => i.number === number);
    const pdf = await page.request.get(`/api/services/invoices/${inv.id}/pdf`);
    expect(pdf.headers()['content-type']).toContain('application/pdf');
  });
});
