import { test, expect, type Page } from '@playwright/test';
import { login, logout, runTour, USERS, expectToast } from './helpers';

const TITLE = `Quarterly town hall ${Date.now().toString(36)}`;
const BODY = 'Join us in the main hall on Friday at 4 pm for the quarterly town hall.\n\nWe will cover results, the roadmap and an open Q&A. <b>No HTML</b> is rendered.';

/** Current value of the red unread badge on the Feed tab (0 when hidden). */
async function feedBadge(page: Page): Promise<number> {
  const badge = page.getByTestId('tab-feed').locator('.tab-badge');
  if (!(await badge.count())) return 0;
  return Number((await badge.textContent())?.trim() || 0);
}

test.describe('announcements', () => {
  test('HR posts a pinned announcement, the employee reads it and HR sees the reader', async ({ page }) => {
    // HR: tour, then post a pinned announcement.
    await login(page, USERS.hr);
    await page.goto('/announcements');
    await expect(page.getByTestId('announcement-item').first()).toBeVisible();
    await runTour(page);

    await page.getByTestId('announcement-new').click();
    const modal = page.getByTestId('announcement-modal');
    await expect(modal).toBeVisible();
    await modal.getByTestId('announcement-title-input').fill(TITLE);
    await modal.getByTestId('announcement-body-input').fill(BODY);
    await modal.getByTestId('announcement-audience').selectOption('all');
    const pin = modal.getByTestId('announcement-pinned');
    await pin.locator('.switch').click();
    await expect(pin.locator('input[type="checkbox"]')).toBeChecked();
    await modal.getByTestId('announcement-submit').click();
    await expectToast(page, 'success', 'Announcement posted');
    await expect(modal).toBeHidden();

    // Pinned and newest, so it leads the feed.
    const first = page.getByTestId('announcement-item').first();
    await expect(first.getByTestId('announcement-title')).toHaveText(TITLE);
    await expect(first).toContainText('Pinned');

    // Manage tab lists it as live.
    await page.getByTestId('tab-manage').click();
    const row = page.getByRole('row').filter({ has: page.getByTestId('manage-title').filter({ hasText: TITLE }) });
    await expect(row).toBeVisible();
    await expect(row).toContainText('live');
    await logout(page);

    // Employee: sees it unread with the tab badge.
    await login(page, USERS.employee);
    await page.goto('/announcements');
    const item = page.getByTestId('announcement-item').filter({ has: page.getByTestId('announcement-title').filter({ hasText: TITLE }) });
    await expect(item).toBeVisible();
    await expect(item).toHaveAttribute('data-unread', '1');
    await expect(page.getByTestId('tab-feed').locator('.tab-badge')).toBeVisible();
    const before = await feedBadge(page);
    expect(before).toBeGreaterThan(0);

    // Opening it marks it read and the badge drops.
    await item.getByTestId('announcement-toggle').click();
    const detail = item.getByTestId('announcement-detail');
    await expect(detail).toBeVisible();
    await expect(detail.getByTestId('announcement-body').locator('p')).toHaveCount(2);
    await expect(detail).toContainText('<b>No HTML</b>');
    await expect(item).toHaveAttribute('data-unread', '0');
    await expect.poll(() => feedBadge(page)).toBe(before - 1);

    // Mark unread puts it back, opening again reads it.
    await detail.getByTestId('announcement-mark-unread').click();
    await expectToast(page, 'success', 'Marked as unread');
    await expect(item).toHaveAttribute('data-unread', '1');
    await expect.poll(() => feedBadge(page)).toBe(before);
    await item.getByTestId('announcement-toggle').click();
    await expect(item).toHaveAttribute('data-unread', '0');
    await expect.poll(() => feedBadge(page)).toBe(before - 1);

    // Employees have no management tools.
    await expect(page.getByTestId('announcement-new')).toHaveCount(0);
    await expect(page.getByTestId('tab-manage')).toHaveCount(0);
    await logout(page);

    // HR: the employee shows up in the Readers modal.
    await login(page, USERS.hr);
    await page.goto('/announcements?tab=manage');
    const hrRow = page.getByRole('row').filter({ has: page.getByTestId('manage-title').filter({ hasText: TITLE }) });
    await expect(hrRow).toBeVisible();
    await hrRow.getByTestId('announcement-readers-btn').click();
    const readers = page.getByTestId('announcement-readers');
    await expect(readers).toBeVisible();
    await expect(readers.getByTestId('reader-name').filter({ hasText: 'Karthik Raj' })).toBeVisible();
    await expect(readers.getByTestId('readers-pct')).toHaveText(/\d+% read/);
    await page.keyboard.press('Escape');
    await expect(readers).toBeHidden();

    // Edit and delete with confirmation.
    await hrRow.getByTestId('announcement-edit').click();
    await expect(modal.getByTestId('announcement-title-input')).toHaveValue(TITLE);
    await modal.getByTestId('announcement-title-input').fill(`${TITLE} (updated)`);
    await modal.getByTestId('announcement-submit').click();
    await expectToast(page, 'success', 'Announcement updated');
    const updated = page.getByRole('row').filter({ has: page.getByTestId('manage-title').filter({ hasText: `${TITLE} (updated)` }) });
    await expect(updated).toBeVisible();
    await updated.getByTestId('announcement-delete').click();
    await page.getByTestId('confirm-yes').click();
    await expectToast(page, 'success', 'Announcement deleted');
    await expect(page.getByTestId('manage-title').filter({ hasText: TITLE })).toHaveCount(0);
  });
});
