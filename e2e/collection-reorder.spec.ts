import { test, expect } from '@playwright/test';

test('collection items can be reordered, and the order survives a reload (anonymous: local preferences)', async ({ page }) => {
  await page.goto('/app/');
  await page.locator('[id^="btn-open-work-"]').first().click();
  await page.locator('#btn-read-first-chapter').click();
  await expect(page.locator('.reader-text-container')).toBeVisible();
  // Save two consecutive chapters into Favorites through the bookmark menu.
  const save = async () => {
    await page.locator('#btn-reader-save-chapter').click({ button: 'right' });
    await page.getByRole('menuitemcheckbox', { name: 'Favorites' }).click();
  };
  await save();
  await page.locator('#btn-reader-next-chapter').click();
  await expect(page.locator('.reader-text-container')).toBeVisible();
  await save();

  await page.locator('#nav-collections-btn').click();
  const rows = page.locator('[id^="col-item-"]');
  await expect(rows).toHaveCount(2);
  const before = await rows.allTextContents();
  await rows.nth(0).getByRole('button', { name: 'Move down' }).click();
  await expect.poll(() => rows.allTextContents()).toEqual([before[1], before[0]]);
  await expect(rows.nth(0).getByRole('button', { name: 'Move up' })).toBeDisabled();

  await page.reload();
  await expect(rows).toHaveCount(2);
  expect(await rows.allTextContents()).toEqual([before[1], before[0]]);
});
