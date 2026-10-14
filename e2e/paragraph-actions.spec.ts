import { test, expect, type Page } from '@playwright/test';

async function openChapter(page: Page) {
  await page.goto('/app/reader/sagarra/paulina/primera_part/i');
  const paragraph = page.locator('.reader-text-container p').filter({ hasText: /\S.{12}/ }).first();
  await expect(paragraph).toBeVisible({ timeout: 20000 });
  await paragraph.scrollIntoViewIfNeeded();
  return paragraph;
}

test('hover highlights immediately; clicking reveals transparent paragraph actions', async ({ page }) => {
  const paragraph = await openChapter(page);
  const text = (await paragraph.textContent())!.trim();
  const initialBox = (await paragraph.boundingBox())!;
  const immediate = await paragraph.evaluate(element => {
    element.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerType: 'mouse' }));
    return element.classList.contains('block-hover');
  });
  expect(immediate).toBe(true);
  await expect(paragraph).not.toHaveClass(/block-active/);
  expect(await paragraph.evaluate(element => getComputedStyle(element, '::before').content)).toBe('none');
  await expect(page.locator('#reader-block-marker')).toHaveCount(0);
  await paragraph.click();
  const marker = page.getByRole('button', { name: 'Paragraph actions' });
  await expect(marker).toBeVisible();
  await expect(marker).toHaveCSS('color', 'rgb(156, 163, 175)');
  await expect(marker).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(marker).toHaveCSS('box-shadow', 'none');
  await expect(marker).toHaveCSS('backdrop-filter', 'none');
  await expect(paragraph).toHaveClass(/block-active/);
  await expect(paragraph).toHaveCSS('outline-style', 'none');
  await expect(paragraph).toHaveCSS('box-shadow', 'none');
  expect(await paragraph.evaluate(element => {
    const bar = getComputedStyle(element, '::before');
    return { right: bar.right, width: bar.width, color: bar.backgroundColor };
  })).toEqual({ right: '-8px', width: '3px', color: 'rgb(156, 163, 175)' });
  await expect(paragraph).toHaveCSS('background-color', 'rgba(229, 231, 235, 0.35)');
  const blockBox = (await paragraph.boundingBox())!;
  const markerBox = (await marker.boundingBox())!;
  expect(blockBox).toEqual(initialBox);
  expect(markerBox.x).toBeCloseTo(Math.max(4, Math.min(blockBox.x + blockBox.width - 28, page.viewportSize()!.width - 28)), 0);
  expect(markerBox.y).toBeCloseTo(blockBox.y, 0);
  expect(markerBox.x).toBeLessThan(blockBox.x + blockBox.width);
  expect(markerBox.x + markerBox.width).toBeLessThanOrEqual(blockBox.x + blockBox.width - 4);
  expect(markerBox.y + markerBox.height).toBeLessThanOrEqual(blockBox.y + blockBox.height);
  await marker.click();
  await expect(page.locator('#selection-quote-toolbar')).toBeVisible();
  expect(await page.evaluate(() => window.getSelection()?.toString().trim())).toBe(text);
  await page.keyboard.press('Escape');
  await expect(marker).toBeVisible();
  await expect(page.locator('#selection-quote-toolbar')).toHaveCount(0);
  await expect(paragraph).toHaveClass(/block-active/);
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


test('selection survives hover, clears on outside click and moves to the next clicked block', async ({ page }) => {
  const paragraph = await openChapter(page);
  await paragraph.hover();
  await paragraph.click();
  const marker = page.locator('#reader-block-marker');
  await expect(marker).toBeVisible();
  await marker.hover();
  await page.mouse.move(0, 0);
  await expect(marker).toBeVisible();
  await expect(paragraph).toHaveClass(/block-active/);
  await page.mouse.click(0, 0);
  await expect(marker).toHaveCount(0);
  await expect(paragraph).not.toHaveClass(/block-active/);
  await paragraph.click();
  await expect(marker).toBeVisible();
  const other = page.locator('.reader-text-container p').filter({ hasText: /\S.{12}/ }).nth(1);
  await other.hover();
  await expect(paragraph).toHaveClass(/block-active/);
  await expect(other).not.toHaveClass(/block-active/);
  await other.click();
  await expect(other).toHaveClass(/block-active/);
  await expect(paragraph).not.toHaveClass(/block-active/);
  await expect(page.locator('.reader-text-container .block-active')).toHaveCount(1);
  const box = (await other.boundingBox())!;
  expect((await marker.boundingBox())!.y).toBeCloseTo(box.y, 0);
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
    const marker = page.locator('#reader-block-marker');
    await expect(marker).toBeVisible();
    await expect(paragraph).toHaveClass(/block-active/);
    const selectedBox = (await paragraph.boundingBox())!;
    const markerBox = (await marker.boundingBox())!;
    expect(markerBox.x + markerBox.width).toBeLessThanOrEqual(selectedBox.x + selectedBox.width - 4);
    expect(markerBox.y).toBeCloseTo(selectedBox.y, 0);
    await page.touchscreen.tap(4, 400);
    await expect(marker).toHaveCount(0);
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
