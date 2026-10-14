import { test, expect, type Page } from '@playwright/test';

async function openChapter(page: Page) {
  await page.goto('/app/reader/sagarra/paulina/primera_part/i');
  const paragraph = page.locator('.reader-text-container p').filter({ hasText: /\S.{12}/ }).first();
  await expect(paragraph).toBeVisible({ timeout: 20000 });
  await paragraph.scrollIntoViewIfNeeded();
  return paragraph;
}

test('sustained hover exposes paragraph actions and clicking selects the whole block', async ({ page }) => {
  const paragraph = await openChapter(page);
  const text = (await paragraph.textContent())!.trim();
  await paragraph.hover();
  const marker = page.getByRole('button', { name: 'Paragraph actions' });
  await expect(marker).toBeVisible();
  await expect(marker).toHaveCSS('color', 'rgb(156, 163, 175)');
  await expect(marker).toHaveCSS('background-color', /0\.6/);
  await expect(marker).toHaveCSS('border-top-style', 'solid');
  await expect(paragraph).toHaveClass(/block-active/);
  await expect(paragraph).toHaveCSS('outline-color', 'rgb(156, 163, 175)');
  await expect(paragraph).toHaveCSS('background-color', 'rgba(229, 231, 235, 0.35)');
  const blockBox = (await paragraph.boundingBox())!;
  const markerBox = (await marker.boundingBox())!;
  expect(markerBox.x).toBeCloseTo(blockBox.x + 4, 0);
  expect(markerBox.y).toBeCloseTo(blockBox.y + 2, 0);
  expect(markerBox.x + markerBox.width).toBeLessThanOrEqual(blockBox.x + blockBox.width);
  expect(markerBox.y + markerBox.height).toBeLessThanOrEqual(blockBox.y + blockBox.height);
  await marker.click();
  await expect(page.locator('#selection-quote-toolbar')).toBeVisible();
  expect(await page.evaluate(() => window.getSelection()?.toString().trim())).toBe(text);
  await page.keyboard.press('Escape');
  await expect(marker).toHaveCount(0);
  await expect(page.locator('#selection-quote-toolbar')).toHaveCount(0);
  await expect(paragraph).not.toHaveClass(/block-active/);
});

test('leaving a paragraph before the hover delay shows no marker', async ({ page }) => {
  const paragraph = await openChapter(page);
  await paragraph.hover();
  await page.mouse.move(0, 0);
  await page.waitForTimeout(550);
  await expect(page.locator('#reader-block-marker')).toHaveCount(0);
});

test('a stationary long touch highlights the block and opens its actions', async ({ page }) => {
  const paragraph = await openChapter(page);
  await paragraph.dispatchEvent('pointerdown', { pointerType: 'touch', pointerId: 11, clientX: 80, clientY: 200 });
  await expect(page.locator('#reader-block-marker')).toBeVisible();
  await expect(page.locator('#selection-quote-toolbar')).toBeVisible();
  await paragraph.dispatchEvent('pointerup', { pointerType: 'touch', pointerId: 11 });
  await expect(paragraph).toHaveClass(/block-active/);
});

test('a scrolling gesture cancels a pending long touch', async ({ page }) => {
  const paragraph = await openChapter(page);
  await paragraph.dispatchEvent('pointerdown', { pointerType: 'touch', pointerId: 12, clientX: 80, clientY: 200 });
  await paragraph.dispatchEvent('pointermove', { pointerType: 'touch', pointerId: 12, clientX: 80, clientY: 225 });
  await page.waitForTimeout(650);
  await expect(page.locator('#reader-block-marker')).toHaveCount(0);
  await expect(paragraph).not.toHaveClass(/block-active/);
});

test('a quick tap or canceled touch does not trigger paragraph actions', async ({ page }) => {
  const paragraph = await openChapter(page);
  await paragraph.dispatchEvent('pointerdown', { pointerType: 'touch', pointerId: 13, clientX: 80, clientY: 200 });
  await paragraph.dispatchEvent('pointerup', { pointerType: 'touch', pointerId: 13 });
  await page.waitForTimeout(600);
  await expect(page.locator('#reader-block-marker')).toHaveCount(0);
  await paragraph.dispatchEvent('pointerdown', { pointerType: 'touch', pointerId: 14, clientX: 80, clientY: 200 });
  await paragraph.dispatchEvent('pointercancel', { pointerType: 'touch', pointerId: 14 });
  await page.waitForTimeout(600);
  await expect(page.locator('#reader-block-marker')).toHaveCount(0);
});


test('moving away from the marker clears the highlight', async ({ page }) => {
  const paragraph = await openChapter(page);
  await paragraph.hover();
  const marker = page.locator('#reader-block-marker');
  await expect(marker).toBeVisible();
  await marker.hover();
  await page.mouse.move(0, 0);
  await expect(marker).toHaveCount(0);
  await expect(paragraph).not.toHaveClass(/block-active/);
});

test('q opens the hovered paragraph actions', async ({ page }) => {
  const paragraph = await openChapter(page);
  await paragraph.hover();
  await expect(page.locator('#reader-block-marker')).toBeVisible();
  await page.keyboard.press('q');
  await expect(page.locator('#selection-quote-toolbar')).toBeVisible();
});


test('phone-sized native touch input opens paragraph actions', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, baseURL: process.env.BASE_URL || 'http://localhost:3333' });
  try {
    const page = await context.newPage();
    const paragraph = await openChapter(page);
    const box = (await paragraph.boundingBox())!;
    const client = await context.newCDPSession(page);
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + 50, y: Math.max(100, box.y + 16) }] });
    await expect(page.locator('#reader-block-marker')).toBeVisible();
    await expect(page.locator('#selection-quote-toolbar')).toBeVisible();
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    const markerBox = (await page.locator('#reader-block-marker').boundingBox())!;
    expect(markerBox.y).toBeCloseTo(box.y + 2, 0);
  } finally { await context.close(); }
});
