import { test, expect, type Page } from '@playwright/test';

// Saves the first book's first chapter into Favorites (anonymous: local storage).
async function saveFirstChapter(page: Page) {
  await page.goto('/app/');
  await page.locator('[id^="btn-open-work-"]').first().click();
  await page.locator('#btn-read-first-chapter').click();
  await expect(page.locator('.reader-text-container')).toBeVisible();
  await page.locator('#btn-reader-save-chapter').click({ button: 'right' });
  await page.getByRole('menuitemcheckbox', { name: 'Favorites' }).click();
  await page.keyboard.press('Escape');
}

test('the collections modal filters every section and Enter opens the highlighted item', async ({ page }) => {
  await saveFirstChapter(page);
  // A bare letter pressed right after another reads as typing, not a shortcut.
  await page.waitForTimeout(900);
  await page.keyboard.press('s');

  const modal = page.locator('#collections-modal');
  await expect(modal.locator('#collections-search')).toBeFocused();
  const rows = modal.locator('[id^="col-item-"]');
  await expect(rows).toHaveCount(1);

  await modal.locator('#collections-search').fill('zzzz-no-such-thing');
  await expect(rows).toHaveCount(0);
  await expect(modal).toContainText('Nothing matches');

  // The first Escape clears the query, the second closes the modal.
  await page.keyboard.press('Escape');
  await expect(modal.locator('#collections-search')).toHaveValue('');
  await expect(rows).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(modal).toHaveCount(0);

  // The keyboard shortcut reopens quick-find; the navbar book icon now
  // navigates directly to the Collections page.
  await page.waitForTimeout(900);
  await page.keyboard.press('s');
  await modal.locator('#collections-search').fill('a');
  await page.keyboard.press('Enter');
  await expect(modal).toHaveCount(0);
  await expect(page.locator('.reader-text-container')).toBeVisible();
  await page.locator('#nav-collections-quick-btn').click();
  await expect(page.getByRole('heading', { name: 'Personal Collections', exact: true })).toBeVisible();
  await expect(modal).toHaveCount(0);
});

test('the collections page and the modal show the same panel', async ({ page }) => {
  await saveFirstChapter(page);
  await page.locator('#nav-collections-btn').click();
  const pageSearch = page.locator('#collections-search');
  await expect(pageSearch).toBeVisible();
  await expect(page.locator('[id^="col-item-"]')).toHaveCount(1);
  await expect(page.getByRole('heading', { name: /Saved searches/ })).toBeVisible();
  // On the page itself `s` just focuses its search box.
  await page.waitForTimeout(900);
  await page.keyboard.press('s');
  await expect(pageSearch).toBeFocused();
  await expect(page.locator('#collections-modal')).toHaveCount(0);
});
