import { test, expect, type Page } from '@playwright/test';
import { login, logout, runTour, expectToast, PASSWORD, USERS } from './helpers';

const AGENCY_OWNER = 'admin@saigahr.example';

async function loginAgency(page: Page, email = AGENCY_OWNER) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByTestId('login-submit').click();
  await expect(page).toHaveURL(/\/agency/);
  await expect(page.getByTestId('tour-button')).toBeVisible();
}

test.describe('agency operations: calendar, service desk and company services', () => {
  test('agency and client HR work the payroll calendar, filings and a service request together', async ({ page }) => {
    const subject = `E2E payroll query ${Date.now()}`;
    const reference = `ACK-E2E-${Date.now() % 100000}`;
    const reply = 'Thanks, we have added this to the current run.';

    // --- Agency owner: cross-company calendar --------------------------------------------------
    await loginAgency(page);
    await page.goto('/agency/calendar');
    await expect(page.getByRole('heading', { name: 'Payroll & compliance calendar' })).toBeVisible();
    await expect(page.getByTestId('cal-grid')).toBeVisible();
    await expect(page.getByTestId('cal-today-cell')).toBeVisible();
    await expect(page.locator('[data-testid="cal-event"][data-company="acme"][data-kind="payroll"]').first()).toBeVisible();
    await runTour(page);

    // Filter to Acme payroll in the agenda view.
    await page.getByTestId('cal-view-agenda').click();
    await expect(page.getByTestId('cal-agenda')).toBeVisible();
    await page.getByTestId('cal-filter-company').click();
    await page.locator('.cal-pick-opt', { hasText: 'Acme' }).locator('input').check();
    await page.getByTestId('cal-filter-company').click();
    await page.getByTestId('cal-filter-kind').click();
    await page.locator('.cal-pick-opt', { hasText: 'Payroll' }).locator('input').check();
    await page.getByTestId('cal-filter-kind').click();
    const agendaEvents = page.getByTestId('cal-agenda').getByTestId('cal-event');
    await expect(agendaEvents.first()).toBeVisible();
    expect(await page.locator('[data-testid="cal-agenda"] [data-testid="cal-event"]:not([data-company="acme"])').count()).toBe(0);
    await page.getByTestId('cal-next').click();
    await page.getByTestId('cal-prev').click();
    await page.getByTestId('cal-view-month').click();
    await expect(page.getByTestId('cal-grid')).toBeVisible();

    // --- Service desk --------------------------------------------------------------------------
    await page.locator('[data-nav="/agency/requests"]').click();
    await expect(page.getByRole('heading', { name: 'Service desk' })).toBeVisible();
    await expect(page.getByTestId('desk-row').first()).toBeVisible();
    await runTour(page);

    // --- Inside Acme as the agency: file a return and lock attendance ---------------------------
    await page.goto('/c/acme/services?tab=compliance');
    await expect(page.getByRole('heading', { name: 'Agency services' })).toBeVisible();
    await page.getByTestId('filing-file').first().click();
    const modal = page.getByTestId('filing-modal');
    await modal.getByTestId('filing-save').click();
    await expectToast(page, 'error', /reference/);
    await modal.getByTestId('filing-reference').fill(reference);
    await modal.getByTestId('filing-amount').fill('12500');
    await modal.getByTestId('filing-save').click();
    await expectToast(page, 'success', /marked as filed/);
    await page.locator('.pill', { hasText: /^Filed/ }).click();
    await expect(page.getByTestId('filing-ref').filter({ hasText: reference })).toBeVisible();

    await page.getByTestId('tab-calendar').click();
    await expect(page.getByTestId('svc-timeline')).toBeVisible();
    const lock = page.getByTestId('cp-attendance');
    if (await lock.count()) {
      await lock.click();
      await page.getByTestId('confirm-yes').click();
      await expectToast(page, 'success', /Attendance locked/);
    }
    await expect(page.getByTestId('ms-attendance_lock')).toHaveAttribute('data-status', 'done');
    await expect(page.getByTestId('cp-attendance')).toHaveCount(0);
    await runTour(page);

    await page.goto('/agency');
    await logout(page);

    // --- Client HR: sees the calendar, raises a request, cannot file returns --------------------
    await login(page, USERS.hr);
    await page.goto('/services');
    await expect(page.getByRole('heading', { name: 'Agency services' })).toBeVisible();
    await expect(page.getByTestId('svc-countdown')).toBeVisible();
    await expect(page.getByTestId('ms-inputs')).toBeVisible();
    await expect(page.getByTestId('ms-payment')).toBeVisible();
    await expect(page.getByTestId('ms-attendance_lock')).toHaveAttribute('data-status', 'done');
    await expect(page.getByTestId('cp-attendance')).toHaveCount(0);
    await runTour(page);

    await page.getByTestId('tab-compliance').click();
    await expect(page.getByTestId('svc-compliance-readonly')).toBeVisible();
    await expect(page.getByTestId('filing-row').first()).toBeVisible();
    await expect(page.getByTestId('filing-file')).toHaveCount(0);

    await page.getByTestId('tab-requests').click();
    await page.getByTestId('sr-new').click();
    const nm = page.getByTestId('sr-new-modal');
    await nm.getByTestId('sr-category').selectOption('payroll');
    await nm.getByTestId('sr-new-priority').selectOption('high');
    await nm.getByTestId('sr-subject').fill(subject);
    await nm.getByTestId('sr-description').fill('Please add a one-time bonus for two engineers to this month\'s payroll.');
    await nm.getByTestId('sr-submit').click();
    await expectToast(page, 'success', /raised/);
    await expect(page.getByTestId('sr-row').filter({ hasText: subject })).toBeVisible();
    await logout(page);

    // --- Agency replies from the service desk ---------------------------------------------------
    await loginAgency(page);
    await page.goto('/agency/requests');
    await page.getByPlaceholder('Search number, subject, company…').fill(subject);
    await page.getByTestId('desk-row').filter({ hasText: subject }).click();
    const drawer = page.getByTestId('request-drawer');
    await expect(drawer).toContainText(subject);
    await drawer.getByTestId('sr-assign-me').click();
    await expectToast(page, 'success', /Assigned to you/);
    await drawer.getByTestId('sr-reply-input').fill(reply);
    await drawer.getByTestId('sr-reply-send').click();
    await expectToast(page, 'success', /Reply sent/);
    await expect(drawer.getByTestId('sr-message').filter({ hasText: reply })).toBeVisible();
    await drawer.getByTestId('drawer-close').click();
    await logout(page);

    // --- Client sees the reply ------------------------------------------------------------------
    await login(page, USERS.hr);
    await page.goto('/services?tab=requests');
    await page.getByTestId('sr-row').filter({ hasText: subject }).click();
    const cd = page.getByTestId('request-drawer');
    await expect(cd.getByTestId('sr-message').filter({ hasText: reply })).toBeVisible();
    await expect(cd.getByTestId('sr-status')).toHaveCount(0);
    await expect(cd.getByTestId('sr-close')).toBeVisible();
  });
});
