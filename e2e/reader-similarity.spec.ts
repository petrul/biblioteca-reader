import { test, expect, type Page } from '@playwright/test';
const path = '/sagarra/paulina/primera_part/i';
const chapters = ['i','ii','iii','iv','v','vi','vii','viii','ix','x','xi','xii','xiii','xiv','xv','xvi','xvii','xviii','xix','xx','xxi','xxii','xxiii','xxiv'];
const hits = chapters.map((chapter, index) => ({ score: 1 - index / 100, url: '/sagarra/paulina/primera_part/' + chapter, content: `Vector snippet ${index + 1}`, data: { path: 'sagarra/paulina/primera_part/' + chapter, head: `Similar section ${index + 1}`, language: 'CA' } }));
async function paragraph(page: Page) {
  await page.goto(path);
  const p = page.locator('.reader-text-container p').filter({ hasText: /\S.{12}/ }).first();
  await expect(p).toBeVisible({ timeout: 20000 });
  return p;
}

test('clicked paragraph similarity is paged and saved using the selected text and vector mode', async ({ page }) => {
  const queries: string[] = [];
  await page.route('**/api/search/vector?*', route => { queries.push(new URL(route.request().url()).searchParams.get('q')!); return route.fulfill({ json: hits }); });
  const p = await paragraph(page), text = (await p.textContent())!.trim();
  await p.click();
  await expect(page.locator('#selection-quote-toolbar')).toBeVisible();
  await expect(page.locator('#reader-block-marker')).toHaveCount(0);
  await page.locator('#btn-sel-similar').click();
  const dialog = page.getByRole('dialog', { name: 'Similar passages' });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('[data-similarity-result]')).toHaveCount(8);
  await expect(dialog).toContainText('Page 1 of 3');
  await expect(dialog).toContainText('Vector snippet 1');
  await dialog.getByRole('button', { name: 'Next similar results' }).click();
  await expect(dialog).toContainText('Page 2 of 3');
  await expect(dialog).toContainText('Vector snippet 9');
  await page.keyboard.press('ArrowLeft');
  await expect(dialog).toContainText('Page 1 of 3');
  await page.keyboard.press('ArrowRight');
  await expect(dialog).toContainText('Page 2 of 3');
  await expect(page).toHaveURL(new RegExp(path + '$'));
  await dialog.getByRole('button', { name: 'Save search', exact: true }).click();
  await expect(dialog).toContainText('Search saved');
  const searches = await page.evaluate(() => JSON.parse(localStorage.getItem('biblioteca_reader_saved_searches') || '[]'));
  expect(searches.at(-1).query).toBe(text);
  expect(searches.at(-1).mode).toBe('vector');
  expect(searches.at(-1).items).toHaveLength(16);
  expect(queries.every(query => query === text)).toBe(true);
  await dialog.locator('[data-similarity-result]').first().click();
  await expect(dialog).toHaveCount(0);
  await expect(page).toHaveURL(/\/sagarra\/paulina\/primera_part\/ix/);
});

test('mouse text selection uses the same toolbar and similarity searches exactly that fragment', async ({ page }) => {
  const queries: string[] = [];
  await page.route('**/api/search/vector?*', route => { queries.push(new URL(route.request().url()).searchParams.get('q')!); return route.fulfill({ json: [] }); });
  const p = await paragraph(page);
  const selected = await p.evaluate(element => {
    const text = element.firstChild!;
    const range = document.createRange(); range.setStart(text, 3); range.setEnd(text, 55);
    const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
    document.dispatchEvent(new Event('pointerup'));
    return selection.toString().trim();
  });
  await page.locator('#btn-sel-similar').click();
  const dialog = page.getByRole('dialog', { name: 'Similar passages' });
  await expect(dialog).toContainText('No similar passages found.');
  expect(queries).toEqual([selected]);
  await expect(dialog.getByRole('button', { name: 'Save search' })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
});

test('semantic failures are reported and can be retried', async ({ page }) => {
  let attempts = 0;
  await page.route('**/api/search/vector?*', route => ++attempts === 1 ? route.fulfill({ status: 503, json: { error: 'unavailable' } }) : route.fulfill({ json: hits }));
  const p = await paragraph(page); await p.click(); await page.locator('#btn-sel-similar').click();
  const dialog = page.getByRole('dialog', { name: 'Similar passages' });
  await expect(dialog.getByRole('alert')).toContainText('could not be completed');
  await dialog.getByRole('button', { name: 'Retry search' }).click();
  await expect(dialog.locator('[data-similarity-result]')).toHaveCount(8);
});

test('phone taps show the toolbar and a dialog contained within the viewport', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, baseURL: process.env.BASE_URL || 'http://localhost:3333' });
  try {
    const page = await context.newPage();
    await page.route('**/api/search/vector?*', route => route.fulfill({ json: hits }));
    const p = await paragraph(page); await p.tap();
    await page.locator('#btn-sel-similar').tap();
    const dialog = page.getByRole('dialog', { name: 'Similar passages' });
    await expect(dialog.locator('[data-similarity-result]')).toHaveCount(8);
    const box = (await dialog.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(391);
    expect(box.y).toBeGreaterThanOrEqual(0); expect(box.y + box.height).toBeLessThanOrEqual(845);
    await dialog.getByRole('button', { name: 'Close similar passages' }).tap();
    await expect(dialog).toHaveCount(0);
  } finally { await context.close(); }
});

test('semantic pagination discovers the next page beyond the initial fifty results', async ({ page }) => {
  const many = Array.from({ length: 72 }, (_, index) => ({ score: 1 - index / 100, content: `Boundary passage ${index + 1}`, data: { path: 'sagarra/paulina/primera_part/section_' + (index + 1), head: 'Section ' + (index + 1), language: 'CA' } }));
  await page.route('**/api/search/vector?*', route => {
    const limit = Number(new URL(route.request().url()).searchParams.get('limit'));
    return route.fulfill({ json: many.slice(0, limit) });
  });
  const p = await paragraph(page); await p.click(); await page.locator('#btn-sel-similar').click();
  const dialog = page.getByRole('dialog', { name: 'Similar passages' });
  for (let current = 1; current < 7; current++) {
    await expect(dialog).toContainText('Page ' + current + ' of');
    await dialog.getByRole('button', { name: 'Next similar results' }).click();
  }
  await expect(dialog).toContainText('Page 7 of 8');
  await expect(dialog.getByRole('button', { name: 'Next similar results' })).toBeEnabled();
  await dialog.getByRole('button', { name: 'Next similar results' }).click();
  await expect(dialog).toContainText('Boundary passage 57');
});

test("short clicked paragraphs also open the selection toolbar", async ({ page }) => {
  const original = await paragraph(page);
  await original.evaluate(element => { element.id = "short-paragraph"; element.textContent = "Hi"; });
  const p = page.locator("#short-paragraph");
  await p.click();
  await expect(p).toHaveClass(/block-active/);
  await expect(page.locator("#selection-quote-toolbar")).toBeVisible();
  await expect(page.locator("#btn-sel-similar")).toBeVisible();
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe("Hi");
});
