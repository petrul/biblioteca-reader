import { test, expect, type Page } from '@playwright/test';

async function openChapter(page: Page) {
  await page.goto('/app/reader/sagarra/paulina/primera_part/i');
  const paragraph = page.locator('.reader-text-container p').filter({ hasText: /\S.{12}/ }).first();
  await expect(paragraph).toBeVisible({ timeout: 20000 });
  await paragraph.scrollIntoViewIfNeeded();
  return paragraph;
}

test('clicking selects the paragraph, opens the standard toolbar and never shows a PI button', async ({ page }) => {
  const paragraph = await openChapter(page);
  const text = (await paragraph.textContent())!.trim();
  await paragraph.hover();
  await expect(paragraph).toHaveClass(/block-hover/);
  await expect(paragraph).not.toHaveClass(/block-active/);
  await paragraph.click();
  await expect(page.locator('#selection-quote-toolbar')).toBeVisible();
  await expect(page.locator('#btn-sel-similar')).toBeVisible();
  await expect(page.locator('#reader-block-marker')).toHaveCount(0);
  await expect(paragraph).toHaveClass(/block-active/);
  expect(await page.evaluate(() => window.getSelection()?.toString().trim())).toBe(text);
  expect(await paragraph.evaluate(element => ({ right: getComputedStyle(element, '::before').right, color: getComputedStyle(element, '::before').backgroundColor }))).toEqual({ right: '-8px', color: 'rgb(156, 163, 175)' });
  await page.keyboard.press('Escape');
  await expect(page.locator('#selection-quote-toolbar')).toHaveCount(0);
});

test('hover alone never shows a marker and leaving clears the highlight', async ({ page }) => {
  const paragraph = await openChapter(page);
  await paragraph.hover();
  await expect(paragraph).toHaveClass(/block-hover/);
  await page.waitForTimeout(550);
  await expect(page.locator('#reader-block-marker')).toHaveCount(0);
  await page.mouse.move(0, 0);
  await expect(paragraph).not.toHaveClass(/block-hover|block-active/);
  await expect(page.locator('#reader-block-marker')).toHaveCount(0);
});

test('a stationary long touch opens actions without choosing a persistent block', async ({ page }) => {
  const paragraph = await openChapter(page);
  await paragraph.dispatchEvent('pointerdown', { pointerType: 'touch', pointerId: 11, clientX: 80, clientY: 200 });
  await expect(page.locator('#reader-block-marker')).toHaveCount(0);
  await expect(page.locator('#selection-quote-toolbar')).toBeVisible();
  await paragraph.dispatchEvent('pointerup', { pointerType: 'touch', pointerId: 11 });
  await expect(paragraph).not.toHaveClass(/block-active/);
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


test('selected gray bar survives hovering, clears outside and follows the next clicked block', async ({ page }) => {
  const paragraph = await openChapter(page);
  await paragraph.click();
  await expect(page.locator('#selection-quote-toolbar')).toBeVisible();
  await page.mouse.move(0, 0);
  await expect(paragraph).toHaveClass(/block-active/);
  await page.mouse.click(0, 0);
  await expect(paragraph).not.toHaveClass(/block-active/);
  await expect(page.locator('#selection-quote-toolbar')).toHaveCount(0);
  await paragraph.click();
  const other = page.locator('.reader-text-container p').filter({ hasText: /\S.{12}/ }).nth(1);
  await other.click();
  await expect(other).toHaveClass(/block-active/);
  await expect(paragraph).not.toHaveClass(/block-active/);
  expect(await page.evaluate(() => window.getSelection()?.toString().trim())).toBe((await other.textContent())!.trim());
});

test('q opens the hovered paragraph actions', async ({ page }) => {
  const paragraph = await openChapter(page);
  await paragraph.hover();
  await expect(paragraph).toHaveClass(/block-hover/);
  await expect(page.locator('#reader-block-marker')).toHaveCount(0);
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
    await expect(page.locator('#reader-block-marker')).toHaveCount(0);
    await expect(page.locator('#selection-quote-toolbar')).toBeVisible();
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect(paragraph).not.toHaveClass(/block-active/);
    await page.keyboard.press('Escape');
    await paragraph.tap();
    await expect(page.locator('#reader-block-marker')).toHaveCount(0);
    await expect(paragraph).toHaveClass(/block-active/);
    await expect(page.locator('#selection-quote-toolbar')).toBeVisible();
    await expect(page.locator('#btn-sel-similar')).toBeVisible();
    await page.touchscreen.tap(4, 400);
    await expect(paragraph).not.toHaveClass(/block-active/);

  } finally { await context.close(); }
});

test('dragging text does not reveal a paragraph button', async ({ page }) => {
  const paragraph = await openChapter(page);
  await paragraph.hover();
  await paragraph.evaluate(element => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = window.getSelection()!;
    selection.removeAllRanges(); selection.addRange(range);
  });
  await paragraph.dispatchEvent('click');
  await expect(page.locator('#reader-block-marker')).toHaveCount(0);
});
