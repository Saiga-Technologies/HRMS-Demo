import { expect, type Page } from '@playwright/test';

export const PASSWORD = 'Password123!';
export const USERS = {
  hr: 'hr@acme.example',
  manager: 'manager@acme.example',
  employee: 'employee@acme.example',
};

export async function login(page: Page, email: string, password = PASSWORD) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByTestId('login-submit').click();
  await expect(page).toHaveURL(/\/$|\/\?/);
  await expect(page.getByTestId('tour-button')).toBeVisible();
}

export async function logout(page: Page) {
  await page.getByTestId('user-menu').click();
  await page.getByTestId('logout').click();
  await expect(page).toHaveURL(/\/login/);
}

/** Runs the page tour and walks through every step. */
export async function runTour(page: Page) {
  const btn = page.getByTestId('tour-button');
  await expect(btn).toBeEnabled();
  await btn.click();
  const popover = page.locator('.driver-popover');
  await expect(popover).toBeVisible();
  for (let i = 0; i < 12; i++) {
    const next = popover.locator('.driver-popover-next-btn');
    const text = (await next.textContent())?.trim();
    await next.click();
    if (text === 'Done') break;
  }
  await expect(popover).toBeHidden();
}

export async function expectToast(page: Page, kind: 'success' | 'error' = 'success', text?: string | RegExp) {
  const t = page.getByTestId(`toast-${kind}`).last();
  await expect(t).toBeVisible();
  if (text) await expect(t).toHaveText(text);
}
