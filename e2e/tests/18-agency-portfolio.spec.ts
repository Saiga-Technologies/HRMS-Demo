import { test, expect, type Page } from '@playwright/test';
import { PASSWORD, runTour, expectToast, logout } from './helpers';

const OWNER = 'admin@saigahr.example';
const AM_US = 'am.us@saigahr.example';

/** Agency staff sign in through the same page and land on the portfolio. */
async function agencyLogin(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByTestId('login-submit').click();
  await expect(page).toHaveURL(/\/agency\/?$/);
  await expect(page.getByTestId('tour-button')).toBeVisible();
}

test.describe('agency portfolio', () => {
  test('owner tours the portfolio, opens Acme and comes back', async ({ page }) => {
    await agencyLogin(page, OWNER);
    await expect(page.locator('.page-title')).toContainText('Lakshmi');
    await expect(page.getByTestId('pf-scope')).toContainText('across India, the GCC and the US');
    await runTour(page);

    const acme = page.getByTestId('company-card-acme');
    await expect(acme).toBeVisible();
    await expect(acme.getByTestId('pf-card-name')).toHaveText('Acme Corp');
    await expect(acme.getByTestId('payroll-countdown')).toBeVisible();
    await expect(acme.getByTestId('payroll-countdown')).toContainText(/to go|due today|overdue|late|complete/i);
    await expect(acme.getByTestId('health-pill')).toBeVisible();

    // Market filter: GCC hides Acme, India shows it.
    await page.getByTestId('pf-market-GCC').click();
    await expect(acme).toHaveCount(0);
    await page.getByTestId('pf-market-IN').click();
    await expect(page.getByTestId('company-card-acme')).toBeVisible();
    await page.getByTestId('pf-market-all').click();

    // Table view lists the same companies.
    await page.getByTestId('pf-view-table').click();
    await expect(page.getByTestId('pf-row-name').filter({ hasText: 'Acme Corp' })).toBeVisible();
    await page.getByTestId('pf-view-cards').click();

    // Card body opens the detail drawer with milestones and the client HR user.
    await page.getByTestId('company-card-acme').getByTestId('pf-card-name').click();
    const drawer = page.getByTestId('company-drawer');
    await expect(drawer).toBeVisible();
    await expect(drawer).toContainText('Client approval');
    await expect(drawer).toContainText('hr@acme.example');
    await drawer.getByTestId('drawer-close').click();
    await expect(drawer).toHaveCount(0);

    // Open the company: full navigation into /c/acme/ with the agency bar.
    await page.getByTestId('pf-open-acme').click();
    await expect(page).toHaveURL(/\/c\/acme\/?/);
    await expect(page.getByTestId('company-switcher')).toContainText('Acme Corp');
    await page.getByTestId('company-switcher').click();
    await expect(page.getByTestId('switch-acme')).toBeVisible();
    await page.getByTestId('company-switcher').click();

    await page.getByTestId('agency-portfolio').click();
    await expect(page).toHaveURL(/\/agency\/?$/);
    await expect(page.getByTestId('company-card-acme')).toBeVisible();
  });

  test('owner onboards an Indian company and its HR admin signs in', async ({ page }) => {
    await agencyLogin(page, OWNER);
    await page.getByTestId('pf-add-company').click();
    await expect(page).toHaveURL(/\/agency\/companies\/new/);
    await runTour(page);

    // Step 1: company
    await page.getByTestId('nc-next').click();
    await expect(page.locator('.field-error')).toContainText('Company name is required');
    await page.getByTestId('nc-name').fill('Kaveri Textiles');
    await page.getByTestId('nc-industry').fill('Textile manufacturing');
    await page.getByTestId('nc-am').selectOption({ label: 'Arun Nambiar' });
    await page.getByTestId('nc-next').click();

    // Step 2: country & calendar. GCC weekends differ: Saudi Arabia defaults to Fri + Sat.
    await page.getByTestId('nc-country').selectOption('SA');
    await expect(page.getByTestId('nc-off-5')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('nc-off-0')).toHaveAttribute('aria-pressed', 'false');
    await page.getByTestId('nc-country').selectOption('IN');
    await expect(page.getByTestId('nc-off-0')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('nc-off-6')).toHaveAttribute('aria-pressed', 'true');
    await page.getByTestId('nc-region').selectOption('Tamil Nadu');
    await page.getByTestId('nc-city').fill('Coimbatore');
    await page.getByTestId('nc-pay-last').check();
    await page.getByTestId('nc-next').click();

    // Step 3: client HR admin
    await page.getByTestId('nc-admin-first').fill('Meera');
    await page.getByTestId('nc-admin-last').fill('Iyer');
    await page.getByTestId('nc-admin-email').fill('meera.iyer@kaveri.example');
    await page.getByTestId('nc-next').click();

    // Step 4: billing
    await page.getByTestId('nc-pepm').fill('450');
    await page.getByTestId('nc-min').fill('15000');
    await page.getByTestId('nc-next').click();

    // Step 5: review and create
    const review = page.getByTestId('nc-review');
    await expect(review).toContainText('Kaveri Textiles');
    await expect(review).toContainText('Coimbatore, Tamil Nadu, India');
    await expect(review).toContainText('Last working day');
    await expect(review).toContainText('meera.iyer@kaveri.example');
    await page.getByTestId('nc-create').click();
    await expectToast(page, 'success', /Kaveri Textiles added/);
    const tempPassword = (await page.getByTestId('nc-temp-password').textContent())!.trim();
    expect(tempPassword).toMatch(/^Welcome-/);
    await expect(page.getByTestId('nc-admin-email-out')).toHaveText('meera.iyer@kaveri.example');

    await page.getByTestId('nc-back-portfolio').click();
    await expect(page).toHaveURL(/\/agency\/?$/);
    const card = page.getByTestId('company-card-kaveri-textiles');
    await expect(card).toBeVisible();
    await expect(card).toContainText('Onboarding');
    await expect(card).toContainText('Arun Nambiar');

    // The client's HR admin signs in with the temporary password.
    await logout(page);
    await page.getByLabel('Email').fill('meera.iyer@kaveri.example');
    await page.getByLabel('Password').fill(tempPassword);
    await page.getByTestId('login-submit').click();
    await expect(page).toHaveURL(/\/$|\/\?|\/account/);
    await expect(page.getByTestId('tour-button')).toBeVisible();
    await expect(page.getByTestId('company-switcher')).toHaveCount(0);
  });

  test('a US account manager only sees their own companies', async ({ page }) => {
    await agencyLogin(page, AM_US);
    await expect(page.getByTestId('pf-scope')).toContainText('You manage');
    await expect(page.getByTestId('company-card-redwood-health')).toBeVisible();
    await expect(page.getByTestId('company-card-acme')).toHaveCount(0);
    await expect(page.getByTestId('company-card-nimbus-retail')).toHaveCount(0);
    await expect(page.getByTestId('pf-add-company')).toBeVisible();
  });

  test('team page lists staff and the owner adds a member', async ({ page }) => {
    await agencyLogin(page, OWNER);
    await page.goto('/agency/team');
    await runTour(page);
    const names = page.getByTestId('team-row-name');
    await expect(names.filter({ hasText: 'Daniel Brooks' })).toBeVisible();
    await expect(names.filter({ hasText: 'Gopika Varma' })).toBeVisible();

    await page.getByTestId('team-add').click();
    const modal = page.getByTestId('team-modal');
    await modal.getByTestId('team-first').fill('Nikhil');
    await modal.getByTestId('team-last').fill('Rao');
    await modal.getByTestId('team-email').fill('nikhil.rao@saigahr.example');
    await modal.getByTestId('team-role').selectOption('payroll');
    await modal.getByTestId('team-company-acme').check();
    await modal.getByTestId('team-submit').click();
    await expectToast(page, 'success', /Nikhil added/);
    await expect(page.getByTestId('team-temp-password')).toContainText('Welcome-');
    await page.getByTestId('team-password-done').click();
    const row = page.locator('tr', { has: page.getByTestId('team-row-name').filter({ hasText: 'Nikhil Rao' }) });
    await expect(row).toBeVisible();
    await expect(row).toContainText('Payroll specialist');
    await expect(row).toContainText('Acme Corp');
  });

  test('payroll staff see the team read-only', async ({ page }) => {
    await agencyLogin(page, 'payroll@saigahr.example');
    await page.goto('/agency/team');
    await expect(page.getByTestId('team-row-name').filter({ hasText: 'Lakshmi Menon' })).toBeVisible();
    await expect(page.getByTestId('team-add')).toHaveCount(0);
    await expect(page.getByTestId('nav-new-company')).toHaveCount(0);
  });
});
