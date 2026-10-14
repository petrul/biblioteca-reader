import { coverThumbnailUrl } from '../src/services/coverThumbnail';
import { test, expect } from '@playwright/test';

/**
 * Covers the work detail page (WorkView.tsx):
 * - the header card's flip-to-technical-data toggle: TEI/storage metadata
 *   (word count, payload size, license, etc.) is deliberately kept off
 *   the front face - reached only by tapping the small Info icon, which
 *   flips the card to reveal it on the back, same rotate-y-180 mechanism
 *   ReaderView already uses for its own chapter-stats flip. Playwright's
 *   toBeVisible() doesn't account for backface-visibility, so assertions
 *   here check the flip state (aria-label, rotate-y-180 class) rather
 *   than element visibility.
 * - the Table of Contents, which is a modal (btn-open-toc-modal, styled
 *   identically to and placed directly under Continue Reading/Read First
 *   Chapter) rather than shown inline on the page.
 *
 * Requires the dev server already running (see playwright.config.ts).
 */

test('the header card flips to reveal TEI/technical metadata, hidden from the front', async ({ page }) => {
  await page.goto('/app/');
  await page.locator('[id^="btn-open-work-"]').first().click();
  await expect(page.locator('h1')).toBeVisible();

  const flipBtn = page.locator('#btn-work-flip-technical');
  await expect(flipBtn).toBeVisible();
  await expect(flipBtn).toHaveAttribute('aria-label', 'Show technical metadata');

  const flipContainer = page.locator('.transform-3d');
  await expect(flipContainer).not.toHaveClass(/rotate-y-180/);

  await flipBtn.click();
  await expect(flipBtn).toHaveAttribute('aria-label', 'Back to overview');
  await expect(flipContainer).toHaveClass(/rotate-y-180/);

  await flipBtn.click();
  await expect(flipBtn).toHaveAttribute('aria-label', 'Show technical metadata');
  await expect(flipContainer).not.toHaveClass(/rotate-y-180/);
});

test('Table of Contents opens as a modal, not shown inline on the page', async ({ page }) => {
  await page.goto('/app/');
  await page.locator('[id^="btn-open-work-"]').first().click();
  await expect(page.locator('h1')).toBeVisible();

  // Not present until opened.
  await expect(page.getByText(/Table of Contents \(\d+ Divisions\)/)).toHaveCount(0);

  const openBtn = page.locator('#btn-open-toc-modal');
  await expect(openBtn).toBeVisible();
  await expect(openBtn).toContainText('Table of Contents');

  await openBtn.click();
  await expect(page.getByText(/Table of Contents \(\d+ Divisions\)/)).toBeVisible();
  await expect(page.locator('[id^="toc-chapter-"]').first()).toBeVisible();

  await page.locator('#btn-close-toc-modal').click();
  await expect(page.getByText(/Table of Contents \(\d+ Divisions\)/)).toHaveCount(0);
});

/**
 * A work whose enrichment stored a cover in the MinIO cover cache (the
 * coverUrl biblioteca-nestjs's CoverEnrichmentService persists after
 * putObject - see its cover-enrichment.service.spec.ts) must render
 * that image everywhere a cover slot exists, never DefaultWorkCover,
 * the brush-paper placeholder shown while/until enrichment produces
 * one. The catalog API is mocked (Playwright routes - no real server
 * data, so the test does not depend on what today's corpus happens to
 * have enriched), with one covered and one genuinely coverless work so
 * both sides of the branch are proven: MinIO object used, fallback used
 * only when there is nothing in MinIO.
 */
test('a work with a MinIO cover uses it instead of the default fallback', async ({ page }) => {
  const minioCover = 'https://minio.example.com/biblioteca/covers/opera-alecsandri-lume-d91a5027a5a9.png';
  let originalDownloads = 0;
  await page.route(/^https:\/\/minio\.example\.com\//, route => {
    originalDownloads++;
    return route.abort();
  });
  await page.route('**/api/cover-thumbnails?**', async route => {
    const request = new URL(route.request().url());
    expect(request.searchParams.get('url')).toBe(minioCover);
    expect(['320', '640']).toContain(request.searchParams.get('width'));
    await route.fulfill({ contentType: 'image/webp', body: Buffer.from('UklGRjgAAABXRUJQVlA4ICwAAADwAQCdASoBAAEAAUAmJaACdLoB+AAETAAA/vn7A/8btxhvwXf770BvAwAAAA==', 'base64') });
  });
  await page.route('**/api/users/me', (route) => route.fulfill({ json: { authenticated: false } }));
  await page.route('**/api/authors/page?**', (route) => route.fulfill({ json: { items: [], totalItems: 0, totalPages: 0 } }));
  await page.route('**/api/authors/', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/collections/system/repos', (route) => route.fulfill({ json: ['textbase-live'] }));
  await page.route('**/api/collections/system/featured', (route) => route.fulfill({
    json: [
      {
        id: 101, head: 'Lume Ridicată', completePath: 'opera/alecsandri/lume-ridicata.xml', opus: true, wordSize: 42,
        coverUrl: minioCover, author: { strId: 'vasile-alecsandri', displayName: 'Vasile Alecsandri' },
      },
    ],
  }));
  await page.route('**/api/works?**', (route) => route.fulfill({
    json: {
      totalItems: 2,
      totalPages: 1,
      items: [
        {
          id: 101, head: 'Lume Ridicată', completePath: 'opera/alecsandri/lume-ridicata.xml', opus: true, wordSize: 42,
          coverUrl: minioCover, author: { strId: 'vasile-alecsandri', displayName: 'Vasile Alecsandri' },
        },
        {
          id: 102, head: 'Coverless Poem', completePath: 'opera/other/coverless.xml', opus: true, wordSize: 7,
          author: { strId: 'alt-autor', displayName: 'Alt Autor' },
        },
      ],
    },
  }));

  await page.goto('/app/');

  // featured carousel (the third cover slot, BrowseView): the MinIO
  // object there too
  await expect(page.locator('img[alt="Lume Ridicată"]')).toHaveAttribute('src', coverThumbnailUrl(minioCover)!);

  // catalog card: the MinIO object for the covered work, the fallback
  // only for the genuinely coverless one - exactly one DefaultWorkCover
  await expect(page.locator('img[alt="Cover of Lume Ridicată"]')).toHaveAttribute('src', coverThumbnailUrl(minioCover)!);
  await expect(page.locator('[aria-label="Default cover for Coverless Poem by Alt Autor"]')).toBeVisible();
  await expect(page.locator('[aria-label^="Default cover for"]')).toHaveCount(1);

  // work detail page: the header card uses the MinIO cover too
  // (scoped to the catalog card - the featured carousel has its own h3)
  await page.locator('[id^="card-work-"] h3', { hasText: 'Lume Ridicată' }).click();
  await expect(page.locator('h1')).toBeVisible();
  await expect(page.locator('img[alt="Cover for Lume Ridicată"]')).toHaveAttribute('src', coverThumbnailUrl(minioCover, 640)!);
  await expect(page.locator('[aria-label^="Default cover for"]')).toHaveCount(0);
  expect(originalDownloads).toBe(0);
});
