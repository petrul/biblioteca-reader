import { test, expect } from '@playwright/test';

/**
 * Covers the Browse page's hero section: the overwhelming majority of
 * visitors have never used textbase before and have no reading history
 * yet - they see the "Explore..." card, and clicking into a chapter alone
 * does NOT earn "My Books" (identity.ts's REAL_READER_THRESHOLD_SECONDS -
 * random clicking must not count). Only once a visitor has genuinely
 * spent real time (5+ minutes tab-visible on one work - see
 * hooks/useReadingAttention.ts) does the "My Books" carousel of touched
 * works replace the Explore card, sorted by most time spent first (ties -
 * most commonly two freshly-opened works both still at zero
 * attentionSeconds - fall back to most-recently-touched)
 * (identity.ts's getMyBooksShelf, backed by services/bookmarkStore.ts -
 * local storage when anonymous, textbase-server's ReadingProgress when
 * signed in - wired from BrowseView.tsx).
 *
 * The 5-minute wait itself is simulated by writing directly into the
 * local bookmark store's localStorage entry (same key/shape
 * LocalBookmarkStore itself uses) after a REAL chapter-open established a
 * real position for a real, resolvable work - this avoids an actually
 * slow test while still exercising the real gating logic on reload.
 *
 * Exercised here via the anonymous/local path only (no Google sign-in
 * available in this harness) - the shelf's data source is the same
 * BookmarkStore interface either way, so this covers the behavior that
 * matters without needing a real signed-in session.
 *
 * Requires the dev server already running (see playwright.config.ts).
 */

const BOOKMARKS_STORAGE_KEY = 'textbase.reader.bookmarks.v1';

test.beforeEach(async ({ page }) => {
  await page.goto('/app/');
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });
});

test('a first-time visitor with no reading history sees the Explore card, not My Books', async ({ page }) => {
  await expect(page.locator('#hero-explore-card')).toBeVisible();
  await expect(page.locator('#hero-workspace-carousel')).toHaveCount(0);
});

test('merely opening a chapter is not enough - Explore card still shows until real reading time accrues', async ({ page }) => {
  await page.locator('[id^="btn-open-work-"]').first().click();
  await page.locator('#btn-read-first-chapter').click();
  await page.locator('#btn-reader-back-work').click();
  await page.locator('#nav-browse-btn, #mobile-nav-browse').first().click({ force: true });

  await expect(page.locator('#hero-explore-card')).toBeVisible();
  await expect(page.locator('#hero-workspace-carousel')).toHaveCount(0);
});

test('after 5+ real minutes on one work, the returning visitor sees My Books instead of Explore', async ({ page }) => {
  await page.locator('[id^="btn-open-work-"]').first().click();
  await page.locator('#btn-read-first-chapter').click();

  // Simulate the 5-minute wait: bump the one saved work's attentionSeconds
  // past the threshold directly in the same storage LocalBookmarkStore
  // itself reads/writes.
  await page.evaluate((key) => {
    const all = JSON.parse(localStorage.getItem(key) || '{}');
    const [workId] = Object.keys(all);
    all[workId].attentionSeconds = 301;
    localStorage.setItem(key, JSON.stringify(all));
  }, BOOKMARKS_STORAGE_KEY);

  await page.locator('#btn-reader-back-work').click();
  await page.locator('#nav-browse-btn, #mobile-nav-browse').first().click({ force: true });

  await expect(page.locator('#hero-workspace-carousel')).toBeVisible();
  await expect(page.locator('#hero-explore-card')).toHaveCount(0);
  await expect(page.locator('#hero-workspace-carousel')).toContainText('My Books');

  // The small icon badge preceding the "My Books" title shares the same
  // orange-fill/black-content styling asserted below for the Works tab
  // and the hamburger badge - see 'on all orange items ... also assert
  // the black against orange' in the request that added this coverage.
  const carouselIcon = page.locator('#carousel-icon-badge-my-books');
  await expect(carouselIcon).toHaveCSS('background-color', 'rgb(245, 158, 11)');
  await expect(carouselIcon).toHaveCSS('color', 'rgb(0, 0, 0)');

  // Section title font: same display serif face/size as the rest of the
  // page's section titles (see the "section titles" test below).
  const carouselTitle = page.locator('#hero-workspace-carousel h2');
  await expect(carouselTitle).toHaveCSS('font-family', 'Cinzel, Newsreader, serif');
  await expect(carouselTitle).toHaveCSS('font-size', '18px');
});

test('My Books orders by time spent, not recency - the most-read work leads even if touched longer ago', async ({ page }) => {
  const openWorkAndGetId = async (nth: number): Promise<string> => {
    await page.locator('[id^="btn-open-work-"]').nth(nth).click();
    const workId = await page.evaluate(() =>
      location.pathname.replace(/^\/app\/work\//, '').split('/').map(decodeURIComponent).join('/')
    );
    await page.locator('#btn-read-first-chapter').click();
    await page.locator('#btn-reader-back-work').click();
    await page.locator('#nav-browse-btn, #mobile-nav-browse').first().click({ force: true });
    return workId;
  };

  // Opened first (so it's the "older" touch by updatedAt) but given far
  // more accumulated time - it must still win the #1 spot.
  const heavilyReadWorkId = await openWorkAndGetId(0);
  // Opened second (more recently touched) but with only a token amount
  // of time - recency alone would have put this one first.
  const brieflyOpenedWorkId = await openWorkAndGetId(1);

  await page.evaluate(
    ({ key, heavilyReadWorkId, brieflyOpenedWorkId }) => {
      const all = JSON.parse(localStorage.getItem(key) || '{}');
      all[heavilyReadWorkId].attentionSeconds = 1800;
      all[heavilyReadWorkId].updatedAt = Date.now() - 60_000; // touched a minute ago
      all[brieflyOpenedWorkId].attentionSeconds = 301; // still clears the "engaged reader" bar
      all[brieflyOpenedWorkId].updatedAt = Date.now(); // touched just now
      localStorage.setItem(key, JSON.stringify(all));
    },
    { key: BOOKMARKS_STORAGE_KEY, heavilyReadWorkId, brieflyOpenedWorkId }
  );
  await page.reload({ waitUntil: 'networkidle' });

  await expect(page.locator('#hero-workspace-carousel')).toBeVisible();
  const orderedIds = await page.evaluate(() =>
    Array.from(document.querySelectorAll('#hero-workspace-carousel [id^="carousel-book-my-books-"]')).map((el) => el.id)
  );
  const heavyIndex = orderedIds.indexOf(`carousel-book-my-books-${heavilyReadWorkId}`);
  const briefIndex = orderedIds.indexOf(`carousel-book-my-books-${brieflyOpenedWorkId}`);
  expect(heavyIndex).toBeGreaterThanOrEqual(0);
  expect(briefIndex).toBeGreaterThanOrEqual(0);
  expect(heavyIndex).toBeLessThan(briefIndex);
});

test('My Books recovers once the real catalog finishes loading, even if the shelf fetch raced ahead of it', async ({ page }) => {
  // Establish a real, resolvable engaged position first, no delay yet,
  // and land back on the Browse page's path before reloading below - a
  // reload while still on /app/reader/... never renders BrowseView at all.
  await page.locator('[id^="btn-open-work-"]').first().click();
  await page.locator('#btn-read-first-chapter').click();
  await page.evaluate((key) => {
    const all = JSON.parse(localStorage.getItem(key) || '{}');
    const [workId] = Object.keys(all);
    all[workId].attentionSeconds = 301;
    localStorage.setItem(key, JSON.stringify(all));
  }, BOOKMARKS_STORAGE_KEY);
  await page.locator('#btn-reader-back-work').click();
  await page.locator('#nav-browse-btn, #mobile-nav-browse').first().click({ force: true });

  // Artificially delay the real catalog response so the shelf's own
  // (fast, local) bookmark-store lookup resolves well before
  // readerService's real Work catalog is populated - this is the exact
  // race that used to leave My Books stuck on the Explore card forever,
  // since nothing re-ran the shelf fetch once the catalog eventually
  // arrived (see BrowseView.tsx's dataRevision prop/effect dependency,
  // fed by readerService.subscribe via App.tsx).
  await page.route('**/api/drest/teiDivs/search/findOpera**', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    await route.continue();
  });

  // Deliberately not networkidle - that would block until the delayed
  // request finishes, defeating the point of racing against it.
  await page.reload({ waitUntil: 'domcontentloaded' });

  // Once the delayed catalog response finally lands, the shelf must
  // recover on its own - no further navigation or reload from the test.
  await expect(page.locator('#hero-workspace-carousel')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('#hero-workspace-carousel')).toContainText('My Books');
});

/**
 * Visual-chrome assertions for the Browse page: section title typography,
 * the blue/green Scriptorium gradient theme, the translucent glass
 * toolbars, and the handful of orange (#f59e0b) accents with their
 * required black-on-orange content. These are style regressions the app
 * has no other automated coverage for - a Tailwind class typo here
 * wouldn't fail any existing test.
 */
test.describe('main page visual chrome', () => {
  test("section titles use the display serif face (Cinzel) at their designed size", async ({ page }) => {
    const heroTitle = page.locator('#hero-explore-card h1');
    await expect(heroTitle).toHaveCSS('font-family', 'Cinzel, Newsreader, serif');
    await expect(heroTitle).toHaveCSS('font-size', '30px');
    await expect(heroTitle).toHaveCSS('font-weight', '700');

    const cardTitle = page.locator('[id^="card-work-"] h3').first();
    await expect(cardTitle).toHaveCSS('font-family', 'Cinzel, Newsreader, serif');
    await expect(cardTitle).toHaveCSS('font-size', '18px');
    await expect(cardTitle).toHaveCSS('font-weight', '700');
  });

  test('the page uses the blue-to-green Scriptorium gradient background theme', async ({ page }) => {
    await expect(page.locator('body')).toHaveCSS(
      'background-image',
      'linear-gradient(90deg, rgb(2, 64, 99) 0%, rgb(60, 168, 63) 22%, rgb(4, 74, 111) 100%)',
    );
  });

  test('the search toolbar and the Works/Authors/Lists toolbar share the same translucent glass styling', async ({ page }) => {
    for (const toolbar of [
      page.locator('#works-search-toolbar'),
      page.locator('#subnav-tab-toolbar'),
    ]) {
      // bg-white/[0.12] and border-white/30 - Tailwind v4 renders these as
      // an oklab(...) white with the requested alpha rather than rgba(),
      // so match on the trailing alpha rather than the color-space prefix.
      await expect(toolbar).toHaveCSS('background-color', /0\.12\)$/);
      await expect(toolbar).toHaveCSS('border-color', /0\.3\)$/);
      // backdrop-blur-xl
      await expect(toolbar).toHaveCSS('backdrop-filter', 'blur(24px)');
    }
  });

  test('the selected Works tab and the hamburger badge use the same precise orange with black content on top', async ({ page }) => {
    const worksTab = page.locator('#tab-sub-works');
    await expect(worksTab).toHaveCSS('background-color', 'rgb(245, 158, 11)');
    await expect(worksTab).toHaveCSS('color', 'rgb(0, 0, 0)');

    const hamburgerBadge = page.locator('#nav-logo-hamburger-badge');
    await expect(hamburgerBadge).toHaveCSS('background-color', 'rgb(245, 158, 11)');
    await expect(hamburgerBadge).toHaveCSS('color', 'rgb(0, 0, 0)');
  });
});
