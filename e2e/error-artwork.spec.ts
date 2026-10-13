import { expect, test } from '@playwright/test';

test('unknown reader routes show the bundled 404 art', async ({ page }) => {
  const response = await page.goto('/app/not-a-reader-route');

  expect(response?.status()).toBe(404);
  await expect(page.getByRole('img', { name: 'A book gone astray, somewhere in the stacks' })).toBeVisible();
});

test('reader API 5xx responses show the bundled server-error art', async ({ page }) => {
  await page.route('**/api/works**', route => route.fulfill({
    status: 503,
    contentType: 'application/json',
    body: JSON.stringify({ error: 'unavailable' }),
  }));
  const serverErrorResponse = page.waitForResponse(response =>
    response.url().includes('/api/works') && response.status() === 503);

  await page.goto('/app');
  await serverErrorResponse;

  await expect(page.getByRole('img', { name: 'Server error (5xx)' })).toBeVisible();
});
