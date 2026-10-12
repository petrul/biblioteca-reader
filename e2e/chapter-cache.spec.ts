import { test, expect } from '@playwright/test';

/**
 * Covers chapterCache.ts - a localStorage-backed cache of chapter text,
 * LRU by BOOK (not chapter), capped at 3 books. Foundation for offline
 * reading later (a "download this book" action would populate the same
 * cache ahead of time); today it's purely a speed/resilience win - a
 * cached chapter's text never re-fetches from the network at all (see
 * readerService.ts's loadChapterContent).
 *
 * Requires the dev server already running (see playwright.config.ts).
 */

test('reading a chapter caches its content, and reopening it after a reload skips the network fetch', async ({ page }) => {
  // Cold SPA boot plus the works-catalog fetch can eat most of the
  // default timeout on a busy dev server - this test opens and reloads
  // full browse pages several times.
  test.slow();
  await page.goto('/app/');
  // The works list lives behind the browse page's Works tab.
  await page.locator('#tab-sub-works').click();
  await page.locator('[id^="card-work-"][id*="/"]').first().click();
  await page.locator('#btn-read-first-chapter').click();
  await expect(page.locator('.reader-text-container')).toBeVisible();

  const cacheRaw = await page.evaluate(() => localStorage.getItem('biblioteca.reader.chapterCache.v1'));
  expect(cacheRaw).toBeTruthy();
  const cache = JSON.parse(cacheRaw!);
  expect(cache.books.length).toBeGreaterThan(0);
  expect(Object.keys(cache.books[0].chapters).length).toBeGreaterThan(0);

  // A real reload (not a same-document nav) - the SPA's module state
  // resets entirely, so this is a genuine cold-start cache-hit path, not
  // just reusing in-memory Chapter objects from before.
  let contentRequestCount = 0;
  await page.route('**/*.txt', route => {
    contentRequestCount++;
    route.continue();
  });
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.locator('.reader-text-container')).toBeVisible();
  expect(contentRequestCount).toBe(0);
});

test('the chapter cache keeps at most 3 books, evicting the least recently touched', async ({ page }) => {
  // Four full browse-page boots in one test - see the slow() note above.
  test.slow();
  await page.goto('/app/');
  await page.evaluate(() => localStorage.removeItem('biblioteca.reader.chapterCache.v1'));

  const openWorkAndGetId = async (nth: number): Promise<string> => {
    await page.goto('/app/');
    // The works list lives behind the browse page's Works tab.
    await page.locator('#tab-sub-works').click();
    await page.locator('[id^="card-work-"][id*="/"]').nth(nth).click();
    const workId = await page.evaluate(() =>
      location.pathname.replace(/^\/app\/work\//, '').split('/').map(decodeURIComponent).join('/')
    );
    await page.locator('#btn-read-first-chapter').click();
    await expect(page.locator('.reader-text-container')).toBeVisible();
    return workId;
  };

  const first = await openWorkAndGetId(0);
  await openWorkAndGetId(1);
  await openWorkAndGetId(2);
  const fourth = await openWorkAndGetId(3);

  const cache = JSON.parse((await page.evaluate(() => localStorage.getItem('biblioteca.reader.chapterCache.v1')))!);
  const cachedWorkIds: string[] = cache.books.map((b: { workId: string }) => b.workId);
  expect(cachedWorkIds.length).toBe(3);
  expect(cachedWorkIds).not.toContain(first);
  expect(cachedWorkIds).toContain(fourth);
});

test('a chapter cached before the /_binary/ URL rewrite is healed when served from cache', async ({ page }) => {
  // Chapters fetched before the server-binary URL rewrite existed were
  // cached with biblioteca-server's root-absolute image links
  // (/author/opus/....html/_binary/{id}), which 404 as assets on the
  // reader's origin. chapterCache.get() heals such entries at read time:
  // the stale URLs are rewritten to the same-origin /api/server-content
  // proxy, so even a never-refetched cached chapter shows its images.
  await page.goto('/app');
  await page.evaluate(() => {
    localStorage.setItem('biblioteca.reader.chapterCache.v1', JSON.stringify({
      books: [{
        workId: 'pardo_bazan/la_dama_joven',
        lastAccessed: Date.now(),
        chapters: {
          'pardo_bazan/la_dama_joven/primer_amor': {
            teiXml: '<tei/>',
            htmlContent: '<div type="div4"><p class="justify">Stale cached text.</p>'
              + '<img class="illustration" src="/pardo_bazan/la_dama_joven/primer_amor.html/_binary/d3e6489"></div>',
            plainText: 'Stale cached text.',
            jsonAst: {}
          }
        }
      }]
    }));
  });

  await page.goto('/app/reader/pardo_bazan/la_dama_joven/primer_amor');
  const img = page.locator('.reader-text-container img').first();
  await img.waitFor();
  await expect(img).toHaveAttribute('src', /^\/api\/server-content\/pardo_bazan\/la_dama_joven\/primer_amor\.html\/_binary\/d3e6489$/);
  // And the healed URL actually loads the image (not the SPA fallback).
  await expect.poll(() => img.evaluate(el => (el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
});
