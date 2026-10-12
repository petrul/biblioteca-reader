import { test, expect } from '@playwright/test';

/**
 * Covers the Browse page's Works/Authors/Lists toolbar (BrowseView.tsx's
 * subTab) staying on whichever tab a reader last picked, across a
 * navigation away and back - previously reset to "Works" every time,
 * since BrowseView unmounts entirely while viewing an author/work (see
 * App.tsx's `{currentView === 'browse' && <BrowseView ... />}`), losing
 * its own component state. Now backed by preferencesStore.ts
 * (localStorage), a small interface deliberately modeled after
 * BookmarkStore's local-vs-remote split - every preference today is
 * local-only, but the interface leaves room for a future one to be
 * synced server-side without callers changing.
 *
 * Requires the dev server already running (see playwright.config.ts).
 */

const ACTIVE_TAB_CLASS = /bg-\[#f59e0b\]/;

test('the Works/Authors/Lists toolbar restores its last tab after navigating to an author and back', async ({ page }) => {
  await page.goto('/app/');
  await expect(page.locator('#tab-sub-works')).toHaveClass(ACTIVE_TAB_CLASS);

  await page.locator('#tab-sub-authors').click();
  await expect(page.locator('#tab-sub-authors')).toHaveClass(ACTIVE_TAB_CLASS);

  await page.locator('[id^="card-author-"]').first().click();
  await page.locator('#btn-author-back').click();

  await expect(page.locator('#tab-sub-authors')).toHaveClass(ACTIVE_TAB_CLASS);
  await expect(page.locator('#tab-sub-works')).not.toHaveClass(ACTIVE_TAB_CLASS);
});

test('a first-time visitor with no stored preference still starts on the Works tab', async ({ page }) => {
  await page.goto('/app/');
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });

  await expect(page.locator('#tab-sub-works')).toHaveClass(ACTIVE_TAB_CLASS);
});
