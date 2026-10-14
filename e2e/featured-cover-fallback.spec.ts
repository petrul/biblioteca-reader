import { test, expect } from '@playwright/test';

test('a failed featured cover renders the default cover instead of a broken image', async ({ page }) => {
  await page.route('**/api/cover-thumbnails?**', route => route.fulfill({ status: 404, body: '' }));
  await page.goto('/app/');
  const carousel = page.locator('#hero-featured-carousel');
  const fallback = carousel.getByRole('img', { name: /^Default cover for / }).first();
  await expect(fallback).toBeVisible({ timeout: 20000 });
  await expect.poll(() => carousel.locator('img').evaluateAll(images =>
    images.every(image => image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0))).toBe(true);
});

test('even a missing default-cover texture leaves a readable card without a broken-image icon', async ({ page }) => {
  await page.route('**/api/cover-thumbnails?**', route => route.fulfill({ status: 404, body: '' }));
  await page.route('**/cover-blue.jpg', route => route.fulfill({ status: 404, body: '' }));
  await page.goto('/app/');
  const carousel = page.locator('#hero-featured-carousel');
  await expect(carousel.getByRole('img', { name: /^Default cover for / }).first()).toBeVisible({ timeout: 20000 });
  await expect.poll(() => carousel.locator('img').evaluateAll(images =>
    images.every(image => image instanceof HTMLImageElement && image.complete && image.naturalWidth === 0 &&
      getComputedStyle(image).visibility === 'hidden'))).toBe(true);
  await expect(carousel.locator('h3').first()).toBeVisible();
});
