import { test, expect } from '@playwright/test';
const path = '/sagarra/paulina/primera_part/i';

test('one root URL serves a hydrated reader or a complete script-free text edition', async ({ page, request }) => {
  const backendRequests: string[] = [];
  page.on('request', request => { if (/:8080|:3334|:3335/.test(request.url())) backendRequests.push(request.url()); });
  await page.goto(path);
  const content = page.locator('.reader-text-container');
  await expect(content.locator('p').first()).toBeVisible({ timeout: 20000 });
  await expect(page).toHaveURL(new RegExp(path + '$'));
  const response = await request.get(path, { headers: { 'User-Agent': 'facebookexternalhit', Accept: 'text/html' } });
  expect(response.status()).toBe(200);
  const html = await response.text();
  expect(html).not.toMatch(/<script\b/i);
  const textEdition = await page.evaluate(html => {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    doc.querySelectorAll('.footnote').forEach(note => note.remove());
    return Array.from(doc.querySelectorAll('.body-of-text p')).map(p => p.textContent?.replace(/\s+/g, ' ').trim());
  }, html);
  const browserEdition = await content.locator('p').evaluateAll(paragraphs => paragraphs.map(p => p.textContent?.replace(/\s+/g, ' ').trim()));
  expect(textEdition).toEqual(browserEdition);
  expect(backendRequests).toEqual([]);
  const shell = await request.get(path, { headers: { 'User-Agent': 'Mozilla/5.0 Chrome/130', Accept: 'text/html' } });
  expect(await shell.text()).toContain('title="Plain text version"');
  expect(shell.headers().vary).toContain('User-Agent');
});

test('paragraph range deep link selects the same text and produces a crawlable stable share link', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto(path + '?p=2-3#p2-3');
  await expect(page.locator('.block-linked')).toHaveCount(2, { timeout: 20000 });
  await expect(page.locator('[data-reader-paragraph="p2"]')).toHaveClass(/block-active/);
  await expect(page.locator('#selection-quote-toolbar')).toBeVisible();
  await expect(page.locator('#reader-block-marker')).toHaveCount(0);
  const response = await page.request.get(path + '?p=2-3', { headers: { 'User-Agent': 'Slackbot', Accept: 'text/html' } });
  const html = await response.text();
  expect(html).toContain('class="justify shared-passage"');
  expect(html).toContain('og:url');
});

test('legacy reader URLs redirect to the root and exported formats contain chapter text', async ({ request }) => {
  const old = await request.get('/app/reader' + path + '?p=2', { maxRedirects: 0 });
  expect(old.status()).toBe(301);
  expect(old.headers().location).toBe(path + '?p=2');
  for (const accept of ['text/plain', 'text/markdown', 'application/json']) {
    const response = await request.get(path, { headers: { Accept: accept } });
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain(accept);
    expect(await response.text()).toContain('Buxareu');
  }
});


test('the work root is a reading title page and application routes remain under app', async ({ page }) => {
  await page.goto('/sagarra/paulina');
  await expect(page.locator('.reader-text-container')).toBeVisible({ timeout: 20000 });
  await expect(page).toHaveURL(/\/sagarra\/paulina$/);
  await page.goto('/app/search?q=Buxareu');
  await expect(page).toHaveURL(/\/app\/search/);
});

test('server-addressed quotes share one root URL between reader, curl and social scrapers', async ({ page, request }) => {
  const quotePath = '/quote/sagarra/paulina/primera_part/i?start=2.0&end=2.25';
  const source = await request.get(quotePath, { headers: { 'User-Agent': 'facebookexternalhit', Accept: 'text/html' } });
  expect(source.status()).toBe(200);
  const html = await source.text();
  expect(html).not.toMatch(/<script\b/);
  await page.goto(quotePath);
  await expect(page).toHaveURL(new RegExp('/quote/sagarra/paulina/primera_part/i'));
  const plain = await request.get(quotePath, { headers: { Accept: 'text/plain' } });
  const words = await plain.text();
  expect(words.length).toBeGreaterThan(0);
  await expect(page.getByText('Source-addressed TEI fragment', { exact: true })).toBeVisible({ timeout: 20000 });
  await expect(page.locator('body')).toContainText(words);
  const document = await request.get(quotePath, { headers: { Accept: 'text/html', 'User-Agent': 'Mozilla/5.0 Chrome/130' } });
  expect(await document.text()).toMatch(/<script\b/);
});

test('a newly created quote is readable in a fresh browser and by the server renderer', async ({ page, browser, request }) => {
  await page.goto(path);
  const paragraph = page.locator('.reader-text-container p').filter({ hasText: /\S.{12}/ }).first();
  await expect(paragraph).toBeVisible({ timeout: 20000 });
  const words = (await paragraph.textContent())!.trim();
  await paragraph.click();
  await expect(page.locator('#selection-quote-toolbar')).toBeVisible();
  await page.locator('#btn-sel-create-quote').click();
  const modal = page.locator('#quote-created-modal');
  await expect(modal).toBeVisible({ timeout: 20000 });
  const url = await modal.locator('input').inputValue();
  expect(url).toMatch(/\/quote\/sagarra\/paulina\/primera_part\/i\?start=\d+\.\d+&end=\d+\.\d+/);
  const response = await request.get(url, { headers: { Accept: 'text/plain' } });
  expect(response.status()).toBe(200);
  expect((await response.text()).replace(/\s+/g, ' ').trim()).toBe(words.replace(/\s+/g, ' ').trim());
  const fresh = await browser.newContext();
  try {
    const other = await fresh.newPage();
    await other.goto(url);
    await expect(other.getByText('Source-addressed TEI fragment', { exact: true })).toBeVisible({ timeout: 20000 });
    await expect(other.locator('body')).toContainText(words);
  } finally { await fresh.close(); }
});
