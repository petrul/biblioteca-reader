import { test, expect } from '@playwright/test';

/**
 * Covers the navbar's quick search (tap the search icon, type, Enter ->
 * navigates to SearchView with that query). Two real bugs found and
 * fixed here:
 *
 * 1. App.tsx's default searchMode was 'lucene' (full-text body search),
 *    which can come back completely empty for a query that matches a
 *    work's TITLE but never happens to appear verbatim inside any
 *    paragraph's own text - e.g. "Biblia" against the real Bible works,
 *    whose body text obviously never repeats the literal word "Biblia".
 *    Changed the default to 'title'.
 * 2. That default was ALSO briefly set to a value ('divHeads') that
 *    isn't a real SearchMode at all - the correct value backing the
 *    title-search backend endpoint (GET /api/search/divHeads) is
 *    'title' (see serversideApi.ts's fetchSearchHits switch). The
 *    wrong value silently crashed realSearch with a TypeError, caught
 *    and logged as "live title search unavailable" rather than thrown -
 *    this test guards the actual runtime behavior, not just types.
 *
 * Also covers realSearch's title-mode ranking: when multiple results'
 * titles all start with the query, the backend's own relevance order
 * doesn't distinguish "the real, complete work" from a much shorter
 * one sharing the same opening word - realSearch now breaks that tie
 * by preferring the larger (by word count) work. This was originally
 * found and verified against a real Romanian Bible pair in the actual
 * corpus ("Biblia ortodoxă" vs. the much shorter "Biblia necunoscută"),
 * but the test itself mocks the search endpoint with synthetic
 * fixtures instead of asserting on that specific real content - a CI
 * environment's corpus may be much smaller than dev's and might not
 * contain those particular works at all, so this stays deterministic
 * and environment-independent while still exercising the exact same
 * code path (fetch -> realSearch's ranking -> SearchView's rendering).
 *
 * A quick search is now COMBINED by default (all 5 modes at once, see
 * readerService.searchCombined) - the other 4 endpoints are mocked
 * empty below so this stays hermetic (title is tier-1, so these
 * fixtures still rank first even mixed in with whatever - nothing here -
 * the other 4 modes return).
 *
 * Requires the dev server already running (see playwright.config.ts).
 */

test('a search that never ends: one hung mode does not block the other 4 from showing results', async ({ page }) => {
  // Simulates exactly the reported bug - vector search stuck behind a
  // GPU-contended Ollama on the server - by never resolving the milvus
  // route at all. searchCombined's PER_MODE_TIMEOUT_MS bounds it, and
  // the other 4 modes (mocked to answer fast) must show up well before
  // that bound is reached, not wait on it.
  await page.route('**/api/search/vector**', () => new Promise(() => {})); // never resolves
  await page.route('**/api/search/divHeads**', route => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify([{
      type: 'div', url: 'test-fixture/never-ends',
      data: { head: 'Never Ends Test Fixture', path: 'test-fixture/never-ends', wordSize: 500, opus: true, author: { strId: 'test-fixture', displayName: 'Fixture Author' } }
    }])
  }));
  await page.route('**/api/search/authors**', route => route.fulfill({ contentType: 'application/json', body: '[]' }));
  await page.route('**/api/search/grep**', route => route.fulfill({ contentType: 'application/json', body: '[]' }));
  await page.route('**/api/search/lucene**', route => route.fulfill({ contentType: 'application/json', body: '[]' }));

  await page.goto('/app/');
  await page.locator('#nav-expand-search-btn').click();
  await page.locator('input[placeholder*="Search classical"]').fill('NeverEnds');

  // The fast modes must populate the dropdown well within the 10s
  // per-mode timeout - this is the actual regression: before the fix,
  // the dropdown stayed on "Searching..." until the hung mode's promise
  // settled, which for a genuinely stuck backend call meant forever.
  await expect(page.getByText('Never Ends Test Fixture')).toBeVisible({ timeout: 4_000 });

  // And the search overall still finishes (the "still searching" note
  // clears) once the hung mode's bounded timeout elapses, instead of
  // staying stuck indefinitely.
  await expect(page.getByText('Still searching more modes…')).toHaveCount(0, { timeout: 12_000 });
});

test('the navbar quick search remembers the last query and results across a reload', async ({ page }) => {
  await page.route('**/api/search/divHeads**', route => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify([{
      type: 'div', url: 'test-fixture/remembered',
      data: { head: 'Remembered Search Fixture', path: 'test-fixture/remembered', wordSize: 500, opus: true, author: { strId: 'test-fixture', displayName: 'Fixture Author' } }
    }])
  }));
  await page.route('**/api/search/authors**', route => route.fulfill({ contentType: 'application/json', body: '[]' }));
  await page.route('**/api/search/grep**', route => route.fulfill({ contentType: 'application/json', body: '[]' }));
  await page.route('**/api/search/lucene**', route => route.fulfill({ contentType: 'application/json', body: '[]' }));
  await page.route('**/api/search/vector**', route => route.fulfill({ contentType: 'application/json', body: '[]' }));

  await page.goto('/app/');
  await page.evaluate(() => localStorage.removeItem('textbase.reader.lastSearch.v1'));
  await page.locator('#nav-expand-search-btn').click();
  await page.locator('input[placeholder*="Search classical"]').fill('Remembered');
  await expect(page.getByText('Remembered Search Fixture')).toBeVisible({ timeout: 4_000 });

  // A real reload, not a same-document nav - the cache must survive a
  // fresh module load, not just persist in still-mounted component state.
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('#nav-expand-search-btn').click();

  await expect(page.locator('input[placeholder*="Search classical"]')).toHaveValue('Remembered');
  await expect(page.getByText('Remembered Search Fixture')).toBeVisible();
});

test('the clear (X) button empties the search input, on both the navbar and the Search page', async ({ page }) => {
  await page.goto('/app/');

  await page.locator('#nav-expand-search-btn').click();
  const navInput = page.locator('input[placeholder*="Search classical"]');
  await navInput.fill('to be cleared');
  await page.locator('[title="Clear input"]').click();
  await expect(navInput).toHaveValue('');

  await page.goto('/app/search');
  const searchViewInput = page.locator('#input-search-query');
  await searchViewInput.fill('to be cleared too');
  await page.locator('#btn-search-clear-query').click();
  await expect(searchViewInput).toHaveValue('');
});

test('typing a title into the quick search returns results, with the more complete work ranked first among title matches', async ({ page }) => {
  await page.route('**/api/search/authors**', route => route.fulfill({ contentType: 'application/json', body: '[]' }));
  await page.route('**/api/search/grep**', route => route.fulfill({ contentType: 'application/json', body: '[]' }));
  await page.route('**/api/search/lucene**', route => route.fulfill({ contentType: 'application/json', body: '[]' }));
  await page.route('**/api/search/vector**', route => route.fulfill({ contentType: 'application/json', body: '[]' }));
  await page.route('**/api/search/divHeads**', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify([
        {
          type: 'div',
          url: 'test-fixture/testonia-minor',
          data: {
            head: 'Testonia Minor',
            path: 'test-fixture/testonia-minor',
            wordSize: 100,
            opus: true,
            author: { strId: 'test-fixture', displayName: 'Fixture Author' }
          }
        },
        {
          type: 'div',
          url: 'test-fixture/testonia-maxima',
          data: {
            head: 'Testonia Maxima',
            path: 'test-fixture/testonia-maxima',
            wordSize: 9000,
            opus: true,
            author: { strId: 'test-fixture', displayName: 'Fixture Author' }
          }
        },
        {
          type: 'div',
          url: 'test-fixture/mentions-testonia',
          data: {
            head: 'A Study Mentioning Testonia',
            path: 'test-fixture/mentions-testonia',
            wordSize: 5000,
            opus: true,
            author: { strId: 'test-fixture', displayName: 'Fixture Author' }
          }
        }
      ])
    });
  });

  await page.goto('/app/');
  await page.locator('#nav-expand-search-btn').click();
  await page.locator('input[placeholder*="Search classical"]').fill('Testonia');
  await page.keyboard.press('Enter');

  // The "all modes resolve" semantics - tiered ordering, per-mode
  // timeouts, one hung mode never blocking the others - are pinned in
  // src/services/search-combined.test.ts as fast unit tests, so this e2e
  // only waits for the ranking fixtures themselves, not for the
  // combined summary line that appears only after every mode settles.

  // Combined mode also mixes in the demo/mock fallback's OWN generic
  // top-matches for vector mode (searchConnected always appends
  // mock.results, and the mock vector search doesn't filter as strictly
  // as a real one would), so the count isn't pinned to exactly 3 - only
  // that the 3 mocked title-tier fixtures rank first, in the right
  // order, ahead of whatever unrelated noise combined mode pulled in.
  const resultTitles = page.locator('[id^="search-result-"] h3');
  // Both "Testonia Minor" and "Testonia Maxima" start with the query -
  // the much larger one must rank first. "A Study Mentioning Testonia"
  // only contains the query, not as a prefix, and stays last among the
  // three real fixtures.
  await expect(resultTitles.nth(0)).toContainText('Testonia Maxima');
  await expect(resultTitles.nth(1)).toContainText('Testonia Minor');
  await expect(resultTitles.nth(2)).toContainText('A Study Mentioning Testonia');
});

test('the 5 search-mode explanation boxes live on the back of the header card, reached via the Info icon', async ({ page }) => {
  await page.goto('/app/');
  await page.locator('#nav-expand-search-btn').click();
  await page.locator('input[placeholder*="Search classical"]').fill('test');
  await page.keyboard.press('Enter');
  await expect(page.locator('#search-tab-title')).toBeVisible();

  const flipBtn = page.locator('#btn-search-flip-info');
  await expect(flipBtn).toHaveAttribute('aria-label', 'Show search mode explanations');
  const flipContainer = page.locator('.transform-3d');
  await expect(flipContainer).not.toHaveClass(/rotate-y-180/);

  await flipBtn.click();
  await expect(flipBtn).toHaveAttribute('aria-label', 'Back to search');
  await expect(flipContainer).toHaveClass(/rotate-y-180/);

  // Tapping an explanation box on the back selects that mode and flips
  // back to the front automatically.
  await page.locator('#search-mode-info-grep').click();
  await expect(flipContainer).not.toHaveClass(/rotate-y-180/);
  await expect(page.locator('#search-tab-grep')).toHaveClass(/bg-\[#f59e0b\]/);
});

/**
 * The author-hit pair of bugs, reported against the live corpus with
 * "papini": (1) the author (Giovanni Papini) ranked BELOW an incidental
 * title match in the combined dropdown - within the first tier, title
 * hits used to be merged before author hits, so typing an author's name
 * buried the author card under unrelated works; and (2) clicking the
 * author hit misrouted it through the WORK navigation: author results
 * were typed as works whose workId was a "first work of that author"
 * guess over the reader's paged catalog - a guess that regularly can't
 * resolve (the author's works aren't in the loaded pages), fell back to
 * the author id AS a work id, and landed on "Work not found in textbase
 * repository". Now author results are typed 'author' (see
 * serversideApi.realSearch), rank first in their tier (see
 * readerService.searchCombined), and every consumer (the navbar dropdown
 * and the Search page) routes them to the author page.
 */
test('an author hit ranks first in the combined dropdown, and clicking it opens the author page', async ({ page }) => {
  // One author fixture (Giovanni Papini) + one incidental title fixture -
  // with the old tier order the title fixture ranked first; with the old
  // result typing, clicking the author fixture opened a work route.
  await page.route('**/api/search/authors**', route => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify([{
      type: 'author', url: 'papini',
      data: { strId: 'papini', displayName: 'Giovanni Papini' }
    }])
  }));
  await page.route('**/api/search/divHeads**', route => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify([{
      type: 'div', url: 'someone/a_book_about_papini',
      data: { head: 'A Book About Papini', path: 'someone/a_book_about_papini', wordSize: 500, opus: true, author: { strId: 'someone', displayName: 'Someone Else' } }
    }])
  }));
  await page.route('**/api/search/grep**', route => route.fulfill({ contentType: 'application/json', body: '[]' }));
  await page.route('**/api/search/lucene**', route => route.fulfill({ contentType: 'application/json', body: '[]' }));
  await page.route('**/api/search/vector**', route => route.fulfill({ contentType: 'application/json', body: '[]' }));
  // The author page the click must land on - mocked so the test stays
  // environment-independent (CI corpora may not contain Papini).
  await page.route('**/api/authors/papini', route => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ strId: 'papini', firstName: 'Giovanni', lastName: 'Papini', opera: [] })
  }));

  await page.goto('/app/');
  await page.locator('#nav-expand-search-btn').click();
  await page.locator('input[placeholder*="Search classical"]').fill('papini');

  // Both results arrive - and the AUTHOR one is first, not second.
  const dropdown = page.locator('[id^="nav-search-dropdown-result-"]');
  await expect(dropdown).toHaveCount(2, { timeout: 4_000 });
  await expect(dropdown.first()).toContainText('Giovanni Papini');

  // Clicking it opens the author's page - the URL is the author route,
  // and the "Work not found" dead end never appears.
  await dropdown.first().click();
  await expect(page).toHaveURL(/\/app\/author\/papini/);
  await expect(page.getByText('Work not found in textbase repository')).toHaveCount(0);
  await expect(page.getByText('Giovanni Papini')).toBeVisible();
});

test('the featured carousel does not appear on the search page', async ({ page }) => {
  // The Search page is for search results - the featured-books carousel
  // belongs to the browse catalogue, not here.
  await page.goto('/app/search');
  await expect(page.getByText('Featured Classical Books')).toHaveCount(0);
  await expect(page.locator('[data-testid="featured-book-carousel"], [class*="featured"]')).toHaveCount(0);
});

test('the search page owns the flow: the navbar search icon disappears and the query input takes focus', async ({ page }) => {
  // Entering the search view is itself the "open the search box" gesture:
  // the toolbar's search icon is redundant there (and would sit next to a
  // page whose whole header is a search input), so it hides; the input
  // takes focus immediately so typing starts without a click.
  await page.goto('/app');
  await page.locator('#nav-expand-search-btn').waitFor();
  await expect(page.locator('#nav-expand-search-btn')).toBeVisible();

  await page.click('#nav-search-btn');
  await page.locator('#input-search-query').waitFor();
  await expect(page).toHaveURL(/\/app\/search/);
  await expect(page.locator('#nav-expand-search-btn')).toHaveCount(0);
  await expect(page.locator('#input-search-query')).toBeFocused();

  // Typing lands in the focused input without any click.
  await page.keyboard.type('virag');
  await expect(page.locator('#input-search-query')).toHaveValue('virag');

  // Leaving the search page restores the toolbar icon.
  await page.click('#nav-browse-btn');
  await page.locator('#nav-expand-search-btn').waitFor();
  await expect(page.locator('#nav-expand-search-btn')).toBeVisible();
});
