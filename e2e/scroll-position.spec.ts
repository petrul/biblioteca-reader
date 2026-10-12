import { test, expect } from '@playwright/test';

/**
 * Covers in-chapter scroll position, on top of the chapter-level bookmark
 * covered by services/bookmarkStore.ts/App.tsx's handleSelectChapter:
 * hooks/useReaderScrollPosition.ts saves how far down the current chapter
 * a reader has scrolled (as a 0-1 fraction of its scrollable height) and
 * restores it the next time that same chapter is opened, so "resume
 * reading" lands on the exact paragraph, not just the top of the chapter.
 *
 * A small viewport forces real chapter content to be scrollable
 * regardless of exact prose length. Exercised via the anonymous/local
 * path only (see workspace-hero.spec.ts's own note on why that's enough
 * coverage - the shelf/position data source is the same BookmarkStore
 * interface either way).
 *
 * Requires the dev server already running (see playwright.config.ts).
 */

test.use({ viewport: { width: 600, height: 400 } });

test('scrolling into a chapter and reloading restores the same scroll position', async ({ page }) => {
  await page.goto('/app/');
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });

  await page.locator('[id^="btn-open-work-"]').first().click();
  await page.locator('#btn-read-first-chapter').click();
  await expect(page.locator('.reader-text-container')).toBeVisible();

  // Scroll well down into the chapter, then wait past the hook's save
  // debounce (1.5s) so the fraction actually lands in localStorage.
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight * 0.6));
  await page.waitForTimeout(2000);

  const savedUrl = page.url();
  const scrolledFraction = await page.evaluate(() => {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    return max > 0 ? window.scrollY / max : 0;
  });
  expect(scrolledFraction).toBeGreaterThan(0.3);

  // A full reload of the same chapter URL re-mounts everything from
  // scratch - the restore must come from persisted storage, not React state.
  await page.goto(savedUrl, { waitUntil: 'networkidle' });
  await expect(page.locator('.reader-text-container')).toBeVisible();
  // Let the restore's double-rAF settle.
  await page.waitForTimeout(300);

  const restoredFraction = await page.evaluate(() => {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    return max > 0 ? window.scrollY / max : 0;
  });
  expect(Math.abs(restoredFraction - scrolledFraction)).toBeLessThan(0.05);
});

test('a fresh chapter never seen before opens at the top, not some other chapter\'s position', async ({ page }) => {
  await page.goto('/app/');
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });

  await page.locator('[id^="btn-open-work-"]').first().click();
  await page.locator('#btn-read-first-chapter').click();
  await expect(page.locator('.reader-text-container')).toBeVisible();

  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight * 0.7));
  await page.waitForTimeout(2000);

  // Turn the page to chapter 2, if there is one.
  const nextButton = page.locator('#btn-reader-next-chapter, #btn-reader-next-chapter-top').first();
  if (await nextButton.count() === 0) test.skip();
  await nextButton.click();
  await expect(page.locator('.reader-text-container')).toBeVisible();
  await page.waitForTimeout(300);

  const fraction = await page.evaluate(() => {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    return max > 0 ? window.scrollY / max : 0;
  });
  expect(fraction).toBeLessThan(0.05);
});
