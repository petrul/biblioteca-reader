import { test, expect, type Page } from '@playwright/test';

const source = '/strabo/the_geography_of_strabo/book_xiv/chapter_ii/20';
const selector = '/_2:93..2:403';
const poem = '/moore_thomas/the_complete/poems_relating_to_america/she_sung_of_love';
const card = (page: Page) => page.getByRole('dialog', { name: 'Source fragment' });
async function fragment(page: Page) {
  await page.goto(source + selector);
  await expect(card(page)).toBeVisible({ timeout: 30000 });
  await expect(page).toHaveURL(/\/_2:93\.\.2:403\?rev=[a-f0-9]{64}$/);
  await expect(page.locator('.reader-text-container [data-fragment-active]').first()).toBeVisible();
}

test('one canonical fragment serves curl and the contextual SPA, retaining selection on close and reload', async ({ page, request }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await fragment(page);
  const path = new URL(page.url()).pathname + new URL(page.url()).search;
  const json = await (await request.get(path, { headers: { Accept: 'application/json' } })).json();
  const plain = await request.get(path, { headers: { Accept: 'text/plain' } });
  expect(await plain.text()).toBe(json.text);
  await expect(card(page).locator('blockquote')).toContainText(json.text.split('\n')[0].trim());
  for (const name of ['Copy Link', 'Read in Full Chapter Context', 'Save to Collection', 'Copy Text', 'Copy Citation', 'Similar', 'Share Quote'])
    await expect(card(page).getByRole('button', { name, exact: true })).toBeVisible();
  await expect(card(page).getByRole('link', { name: 'Open fragment in a new tab' })).toHaveAttribute('href', page.url());
  await card(page).getByRole('button', { name: 'Close quotation' }).click();
  await expect(card(page)).toHaveCount(0);
  await expect(page).toHaveURL(/&display=context$/);
  expect(await page.evaluate(() => window.getSelection()?.toString().length)).toBeGreaterThan(200);
  await page.reload();
  await expect(page.locator('.reader-text-container [data-fragment-active]').first()).toBeVisible({ timeout: 30000 });
  await expect(card(page)).toHaveCount(0);
  expect(await page.evaluate(() => window.getSelection()?.toString().length)).toBeGreaterThan(200);
  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(source);
  expect(errors).toEqual([]);
});

test('Quote Link and legacy quote URLs open the same shared card', async ({ page }) => {
  await page.goto(source);
  const p = page.locator('.reader-text-container p[data-source-path="2"]');
  await expect(p).toBeVisible({ timeout: 30000 });
  await p.click();
  await page.locator('#btn-sel-create-quote').click();
  await expect(card(page)).toBeVisible();
  await expect(page).toHaveURL(/\/_2\?rev=[a-f0-9]{64}$/);
  await card(page).getByRole('button', { name: 'Read in Full Chapter Context' }).click();
  await expect(page.locator('#selection-quote-toolbar')).toBeVisible();
  await page.goto('/quote' + source + '?start=2.93&end=2.403');
  await expect(card(page)).toBeVisible();
  await expect(page).toHaveURL(/\/_2:93\.\.2:403\?rev=[a-f0-9]{64}$/);
});

test('rendered paragraph aliases use the source map; verses remain selectable inside stanza blocks', async ({ page }) => {
  await page.goto(source + '?p=1');
  await expect(card(page)).toBeVisible({ timeout: 30000 });
  await expect(page).toHaveURL(/\/_2\?rev=/);
  await page.goto(poem);
  const stanza = page.locator('.reader-text-container .lg').first();
  await expect(stanza).toBeVisible({ timeout: 30000 });
  await stanza.locator('.l').first().hover();
  await expect(stanza).toHaveClass(/block-hover/);
  await stanza.locator('.l').first().click();
  await page.locator('#btn-sel-create-quote').click();
  await expect(card(page)).toBeVisible();
  await expect(card(page).locator('.lg .l')).toHaveCount(await stanza.locator('.l').count());
  const whole = page.url();
  await card(page).getByRole('button', { name: 'Close quotation' }).click();
  const selected = await stanza.locator('.l [data-fragment-text]').first().evaluate(element => {
    const range = document.createRange(); range.setStart(element.firstChild!, 2); range.setEnd(element.firstChild!, 8);
    const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
    document.dispatchEvent(new Event('pointerup')); return selection.toString();
  });
  await page.locator('#btn-sel-create-quote').click();
  await expect(card(page)).toBeVisible();
  expect(page.url()).not.toBe(whole);
  await expect(card(page).locator('blockquote')).toHaveText(selected);
});

test('phone fragment card fits the viewport and closes to the retained source range', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, baseURL: process.env.BASE_URL || 'http://localhost:3333' });
  try {
    const page = await context.newPage(); await fragment(page);
    const box = await card(page).boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width).toBeLessThanOrEqual(390);
    expect(box!.height).toBeLessThanOrEqual(844);
    await card(page).getByRole('button', { name: 'Close quotation' }).tap();
    await expect(card(page)).toHaveCount(0);
    await expect(page.locator('.reader-text-container [data-fragment-active]').first()).toBeVisible();
  } finally { await context.close(); }
});

test('Similar searches exact source text and a legacy vector result opens a fragment with real chapter neighbors', async ({ page, request }) => {
  const queries: string[] = [];
  await page.route('**/api/search/vector?*', route => {
    queries.push(new URL(route.request().url()).searchParams.get('q')!);
    return route.fulfill({ json: [{ score: 0.99, url: source + '/_2', content: 'A source paragraph.', data: { path: source.slice(1) + '/_2', head: '20', language: 'EN' } }] });
  });
  await fragment(page);
  const data = await (await request.get(new URL(page.url()).pathname + new URL(page.url()).search, { headers: { Accept: 'application/json' } })).json();
  await card(page).getByRole('button', { name: 'Similar', exact: true }).click();
  const similar = page.getByRole('dialog', { name: 'Similar passages' });
  await expect(similar).toBeVisible();
  await expect(similar.locator('[data-similarity-result]')).toHaveCount(1);
  expect(queries).toEqual([data.text]);
  await similar.locator('[data-similarity-result]').click();
  await expect(similar).toHaveCount(0);
  await expect(card(page)).toBeVisible();
  await expect(page).toHaveURL(/\/20\/_2\?rev=/);
  await card(page).getByRole('button', { name: 'Close quotation' }).click();
  await page.keyboard.press('ArrowRight');
  await expect(page).not.toHaveURL(/\/20(?:\/_2)?(?:\?|$)/);
  expect(new URL(page.url()).pathname).not.toContain('/_2');
  await expect(page.locator('.reader-text-container')).toBeVisible();
});

test('Back and Forward preserve card versus selected-context state, and hash paragraph aliases migrate', async ({ page }) => {
  await page.goto(source);
  const p = page.locator('.reader-text-container p[data-source-path="2"]');
  await expect(p).toBeVisible({ timeout: 30000 });
  await p.click(); await page.locator('#btn-sel-create-quote').click();
  await expect(card(page)).toBeVisible();
  await page.goBack(); await expect(card(page)).toHaveCount(0); await expect(page).toHaveURL(source);
  await page.goForward(); await expect(card(page)).toBeVisible();
  await card(page).getByRole('button', { name: 'Close quotation' }).click();
  await page.goBack(); await expect(page).toHaveURL(source);
  await page.goForward(); await expect(card(page)).toHaveCount(0); await expect(page).toHaveURL(/display=context/);
  await page.goto(source + '#p1');
  await expect(card(page)).toBeVisible(); await expect(page).toHaveURL(/\/_2\?rev=[a-f0-9]{64}$/);
});

test('a fragment crossing two child chapters expands its containing source and retains both exact endpoints', async ({ page, request }) => {
  const path = '/strabo/the_geography_of_strabo/book_xiv/chapter_ii/_2.2:3..3.2:10';
  await page.goto(path);
  await expect(card(page)).toBeVisible({ timeout: 30000 });
  const data = await (await request.get(new URL(page.url()).pathname + new URL(page.url()).search, { headers: { Accept: 'application/json' } })).json();
  expect(data.readingPages).toEqual(['strabo/the_geography_of_strabo/book_xiv/chapter_ii/1', 'strabo/the_geography_of_strabo/book_xiv/chapter_ii/2']);
  await expect(page.locator('.reader-text-container [data-fragment-active]')).toHaveCount(5);
  await card(page).getByRole('button', { name: 'Close quotation' }).click();
  expect((await page.evaluate(() => window.getSelection()?.toString()))?.endsWith(data.text.slice(-10))).toBe(true);
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('a modern browser with JavaScript disabled can read the same fragment and its selected context', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, baseURL: process.env.BASE_URL || 'http://localhost:3333' });
  try {
    const page = await context.newPage(); await page.goto(source + selector);
    await expect(page.locator('noscript article')).toContainText('Caryanda', { timeout: 30000 });
    await page.getByRole('link', { name: 'Read in full chapter context' }).click();
    await expect(page.locator('mark').first()).toBeVisible();
    await expect(page).toHaveURL(/display=context&view=text/);
  } finally { await context.close(); }
});
