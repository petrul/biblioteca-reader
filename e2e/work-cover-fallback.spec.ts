import { test, expect } from '@playwright/test';

// One fallback cover everywhere: DefaultWorkCover (the brush-paper picture
// with title and author) - both for works without a cover and for covers
// whose URL fails to load. No khaki default-work-cover.svg, no empty frame.
test('works whose stored cover fails to load show the default cover in the catalog and on the work page', async ({ page }) => {
  await page.route('**/api/cover-thumbnails?**', route => route.fulfill({ status: 404, body: '' }));
  await page.goto('/app/');

  const firstWork = page.locator('[id^="btn-open-work-"]').first();
  await expect(firstWork).toBeVisible({ timeout: 20000 });
  await expect(page.getByRole('img', { name: /^Default cover for / }).first()).toBeVisible({ timeout: 20000 });
  await expect(page.locator('img[src*="default-work-cover"]')).toHaveCount(0);

  await firstWork.click();
  const workCard = page.locator('.bg-scriptorium-blue').first();
  await expect(workCard.getByRole('img', { name: /^Default cover for / })).toBeVisible({ timeout: 20000 });
  await expect(page.locator('img[src*="default-work-cover"]')).toHaveCount(0);
});
