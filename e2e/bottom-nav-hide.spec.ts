import { test, expect } from '@playwright/test';

/**
 * The mobile bottom nav auto-hides on scroll down and returns on scroll up
 * in lockstep with the chapter toolbar above it (and the navbar): all three
 * read useHideHeaderOnScroll with the same thresholds, so no scroll input
 * can show one bar without the others. The second test pins the reader
 * page's bottom edge: with the bar hidden, no App-gradient stripe may show
 * below the reader's own background (App's pb-16 is reader-exempt).
 *
 * Requires the dev server already running (see playwright.config.ts).
 */

test.use({ viewport: { width: 600, height: 400 } });

async function openLongChapter(page: import('@playwright/test').Page) {
  await page.goto('/app/');
  await page.locator('[id^="btn-open-work-"]').first().click();
  await page.locator('#btn-read-first-chapter').click();
  await expect(page.locator('.reader-text-container')).toBeVisible();
  // Title pages can be too short to leave the hook's top zone; continue to
  // a real chapter for a genuinely scrollable page.
  const next = page.locator('#btn-reader-next-chapter');
  if (await next.count()) {
    await next.click();
    await expect(page.locator('#btn-reader-next-chapter')).toBeVisible();
  }
}

test('the bottom nav hides and returns in lockstep with the chapter toolbar', async ({ page }) => {
  await openLongChapter(page);
  const top = page.locator('#reader-chapter-toolbar');
  const bottom = page.locator('#mobile-bottom-nav');

  await expect(top).toHaveClass(/translate-y-0/);
  await expect(bottom).toHaveClass(/translate-y-0/);

  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight * 0.6));
  await expect(top).toHaveClass(/-translate-y-full/);
  await expect(bottom).toHaveClass(/translate-y-full/);

  await page.evaluate(() => window.scrollTo(0, window.scrollY - 250));
  await expect(top).toHaveClass(/translate-y-0/);
  await expect(bottom).toHaveClass(/translate-y-0/);
});

test('no app-gradient stripe below the reader page at scroll end', async ({ page }) => {
  await openLongChapter(page);

  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect(page.locator('#mobile-bottom-nav')).toHaveClass(/translate-y-full/);

  // The element under the bottom edge of the viewport must belong to the
  // reader page itself, never to App's (transparent, gradient-backed)
  // flex-1 wrapper padding.
  const atBottom = await page.evaluate(() => {
    const el = document.elementFromPoint(window.innerWidth / 2, window.innerHeight - 4);
    return el instanceof HTMLElement ? el.className : '';
  });
  expect(atBottom).not.toContain('flex-1');
});
