import { test, expect } from '@playwright/test';

/**
 * Covers Random Discovery - the navbar dice button and its drawer copy in
 * the Library section of the left side menu. Both are the same behavior in
 * two places: ask the server for a random location (/api/util/random),
 * then navigate there. The pick itself is server-side and random, so the
 * assertion is structural, not on any specific target: the icon tumbles,
 * the drawer copy closes the drawer first, and the app lands on a reader
 * deep link (the reader's getRandomDiscovery always resolves to a full
 * author/opus/chapter path).
 *
 * Requires the dev server already running (see playwright.config.ts).
 */

test('the navbar dice button tumbles its icon and navigates to a random chapter', async ({ page }) => {
  await page.goto('/app');
  await page.locator('#nav-random-btn').waitFor();

  await page.click('#nav-random-btn');
  // The Sparkles icon dice-tumbles mid-click.
  await expect.poll(() =>
    page.locator('#nav-random-btn svg').evaluate(el => el.classList.contains('shuffle-tumble'))
  ).toBe(true);
  // And the app lands on some reader deep link.
  await page.waitForURL(/\/app\/reader\/[^/]+\/[^/]+/, { timeout: 30_000 });
});

test('the Library drawer carries its own Random Discovery card: click closes the drawer and navigates', async ({ page }) => {
  await page.goto('/app');
  await page.locator('#nav-logo-hamburger-btn').waitFor();
  await page.click('#nav-logo-hamburger-btn');
  await page.locator('#sidebar-random-btn').waitFor();

  // The drawer's card is the first card in the Library section.
  const isFirstCard = await page.locator('#sidebar-random-btn').evaluate(el =>
    el.parentElement?.firstElementChild === el);
  expect(isFirstCard).toBe(true);

  await page.click('#sidebar-random-btn');
  // The drawer dismisses and the app navigates to a random reader page.
  await expect(page.locator('#sidebar-random-btn')).toHaveCount(0);
  await page.waitForURL(/\/app\/reader\/[^/]+\/[^/]+/, { timeout: 30_000 });
});
