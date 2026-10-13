import { test, expect } from '@playwright/test';

/**
 * Covers the actual chapter-reading view (ReaderView.tsx), as opposed to
 * the Browse page chrome covered elsewhere. Starts small: just the
 * default reading font, which must be Alegreya (ported from the old
 * Spring MVC reader's teidiv.css `p { font-family: Alegreya, ... }`,
 * scoped via .font-alegreya-reading/.reader-text-container - see
 * index.css and ReaderView.tsx's FONT_CLASSES['serif']). Add further
 * reader-view coverage here as it's identified.
 *
 * Requires the dev server already running (see playwright.config.ts).
 */

test('the chapter text renders in the Alegreya serif face by default', async ({ page }) => {
  await page.goto('/app/');
  await page.locator('[id^="btn-open-work-"]').first().click();
  await page.locator('#btn-read-first-chapter').click();

  const content = page.locator('.reader-text-container');
  await expect(content).toBeVisible();
  await expect(content).toHaveCSS('font-family', 'Alegreya, "Times New Roman", Times, serif');
});

test('the navbar wordmark becomes the work title while reading; the chapter title lives in the reader once', async ({ page }) => {
  await page.goto('/app/');
  const navTitle = page.locator('#nav-logo-title-btn');
  await expect(navTitle).toContainText('BIBLIOTECA');

  // The works list lives behind the browse page's Works tab, and the
  // title must come from the very card that gets opened (the featured
  // carousel also carries card-work- ids, in a different order).
  await page.locator('#tab-sub-works').click();
  const card = page.locator('[id^="card-work-"][id*="/"]').first();
  await card.waitFor({ timeout: 15_000 });
  const workTitle = (await card.locator('h3').first().textContent())?.trim();
  await card.click();
  await page.locator('#btn-read-first-chapter').click();

  // While reading, the wordmark carries the WORK title - not the chapter
  // (the chapter heading stays in the server-provided HTML),
  // and the author sits underneath it as the navbar subtitle.
  await expect(navTitle).not.toContainText('BIBLIOTECA');
  if (workTitle) await expect(navTitle).toContainText(workTitle);

  // Back to Browse: the generic wordmark returns.
  await navTitle.click();
  await expect(navTitle).toContainText('BIBLIOTECA');
});

test('the reader toolbar matches the page width and the title has no back arrow', async ({ page }) => {
  await page.goto('/app/reader/dulfu/ispravile_lui_pacala/fuga');
  await expect(page.locator('.reader-text-container')).toBeVisible();

  await expect(page.locator('#btn-reader-heading-back')).toHaveCount(0);
  await expect(page.locator('#nav-close-book-btn')).toBeVisible();
  await expect(page.locator('#btn-reader-back-work')).toBeVisible();

  const toolbar = await page.locator('#reader-chapter-toolbar').boundingBox();
  const pageColumn = await page.locator('main > div.relative').boundingBox();
  const topNavbar = await page.locator('header').first().boundingBox();
  expect(toolbar).toBeTruthy();
  expect(pageColumn).toBeTruthy();
  expect(topNavbar).toBeTruthy();
  expect(toolbar!.x).toBeCloseTo(pageColumn!.x, 0);
  expect(toolbar!.width).toBeCloseTo(pageColumn!.width, 0);
  expect(topNavbar!.width).toBe(page.viewportSize()!.width);
});

test('TOC search keeps matching chapters grouped under their book divisions', async ({ page }) => {
  await page.goto('/app/reader/cassiodorus/the_letters_of_cassiodorus/book_i/1_king');
  await page.locator('#btn-reader-toc-menu').waitFor();
  await page.click('#btn-reader-toc-menu');
  await page.locator('#reader-toc-search').fill('King Theodoric');

  const sidebar = page.locator('#reader-toc-sidebar');
  await expect(sidebar.getByText('BOOK I.')).toBeVisible();
  await expect(sidebar.getByText('BOOK II.')).toBeVisible();
  await expect(sidebar.getByText('BOOK III.')).toBeVisible();
  await expect(sidebar.getByText('1. King Theodoric to Emperor Anastasius.')).toBeVisible();
  await expect(sidebar.getByText('1. King Theodoric to Anastasius, Most Pious Emperor. a.d. 511.')).toBeVisible();
});

test('the header hides on scroll down and reappears on scroll up', async ({ page }) => {
  await page.goto('/app/');
  await page.locator('[id^="btn-open-work-"]').first().click();
  await page.locator('#btn-read-first-chapter').click();
  await expect(page.locator('.reader-text-container')).toBeVisible();

  const header = page.locator('header').first();
  await expect(header).toHaveClass(/translate-y-0/);

  await page.mouse.wheel(0, 400);
  await expect(header).toHaveClass(/-translate-y-full/);

  await page.mouse.wheel(0, -100);
  await expect(header).toHaveClass(/translate-y-0/);
});

test('a hard refresh on a deep-linked chapter shows a loading state, not a wrong "not available" flash', async ({ page }) => {
  // Establish a real (server-backed) reader URL first, no delay yet -
  // this must be a genuinely live work (id has no "/"), since
  // only a real work's own catalog entry is subject to the loading race
  // this test exercises.
  await page.goto('/app/', { waitUntil: 'networkidle' });
  await page.locator('[id^="btn-open-work-"][id*="/"]').first().click();
  await page.locator('#btn-read-first-chapter').click();
  await expect(page.locator('.reader-text-container')).toBeVisible();

  // Delay the real catalog response so this fresh reload's very first
  // render(s) land before readerService.loadRealData() has settled -
  // work/chapter start out undefined either way, and without
  // isRealCatalogSettled the app can't tell "not loaded yet" apart from
  // "genuinely doesn't exist".
  await page.route('**/api/drest/teiDivs/search/findOpera**', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 800));
    await route.continue();
  });

  // A real hard refresh, not just a hash change on the same document -
  // page.goto() to a URL differing only in the hash fragment doesn't
  // force a full reload (same as a same-page anchor jump), so
  // readerService's module state would never actually reset.
  await page.reload({ waitUntil: 'domcontentloaded' });

  // Poll rather than asserting the loading text is visible at some exact
  // moment (how long the loading window lasts isn't the point, and is
  // too timing-sensitive to pin down reliably) - the actual regression
  // being guarded against is "Chapter not available." ever flashing at
  // all before the real content lands, however briefly.
  let sawNotAvailable = false;
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (await page.getByText('Chapter not available.').count() > 0) {
      sawNotAvailable = true;
      break;
    }
    if (await page.locator('.reader-text-container').count() > 0) break;
    await page.waitForTimeout(50);
  }
  expect(sawNotAvailable).toBe(false);

  // Once the delayed catalog response lands, the real chapter appears.
  await expect(page.locator('.reader-text-container')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('Chapter not available.')).toHaveCount(0);
});

test('the top bar bookmark button saves the current chapter to a collection, Favorites preselected', async ({ page }) => {
  await page.goto('/app/');
  await page.locator('[id^="btn-open-work-"]').first().click();
  await page.locator('#btn-read-first-chapter').click();
  await expect(page.locator('.reader-text-container')).toBeVisible();

  await page.locator('#btn-reader-save-chapter').click();

  await expect(page.getByText('Save to Personal Collection')).toBeVisible();
  await expect(page.getByText('CHAPTER ITEM')).toBeVisible();
  // The reader no longer renders a separate <main> h1 chapter title; the
  // dialog names the chapter on its own "— <title>" line.
  await expect(page.getByText(/^— \S/)).toBeVisible();
  await expect(page.locator('label:has-text("Favorites") input[type="radio"]')).toBeChecked();
});

test('ArrowRight/ArrowLeft navigate chapters and flash the corresponding buttons', async ({ page }) => {
  // Keyboard chapter navigation must both move to the neighbor chapter and
  // give the same visible "tapped" feedback as clicking the buttons - the
  // flash runs on BOTH the top and the bottom next button for ArrowRight,
  // and on the bottom prev button for ArrowLeft (there is no top prev).
  // The flash lasts 200ms and the buttons re-render on chapter change, so
  // a poll after the fact can miss it. Arm a MutationObserver BEFORE the
  // keypress - in a RETURNING evaluate (a pending page.evaluate would hold
  // the protocol and delay the keypress until after the flash) - and read
  // its verdict afterwards. Awaiting the arming matters: un-awaited
  // Playwright commands pipeline, and the press must not beat the
  // observer's installation.
  await page.goto('/app/reader/smollett/the_history_of_england/chapter_i/the_convention_recognize');
  await page.locator('#btn-reader-next-chapter').waitFor({ timeout: 15_000 });
  const originalUrl = page.url();

  const armFlashWatch = (ids: string[]) => page.evaluate((buttonIds) => {
    (window as any).__flashResult = new Promise<boolean>(resolve => {
      const buttons = buttonIds.map(id => document.getElementById(id)).filter(Boolean) as HTMLElement[];
      if (buttons.length === 0) { resolve(false); return; }
      const observer = new MutationObserver(() => {
        if (buttons.some(b => b.classList.contains('key-tapped'))) {
          observer.disconnect();
          resolve(true);
        }
      });
      buttons.forEach(b => observer.observe(b, { attributes: true, attributeFilter: ['class'] }));
      setTimeout(() => { observer.disconnect(); resolve(false); }, 10_000);
    });
  }, ids);
  const readFlash = () => page.evaluate(() => (window as any).__flashResult as Promise<boolean>);

  await armFlashWatch(['btn-reader-next-chapter-top', 'btn-reader-next-chapter']);
  await page.keyboard.press('ArrowRight');
  expect(await readFlash()).toBe(true);
  await expect(page).not.toHaveURL(originalUrl);

  await armFlashWatch(['btn-reader-prev-chapter']);
  await page.keyboard.press('ArrowLeft');
  expect(await readFlash()).toBe(true);
  await expect(page).toHaveURL(originalUrl);
});

test('Escape closes the reader dropdowns and flips the stats card back to reading', async ({ page }) => {
  // Escape is the universal close on the reading surface: overlays
  // (settings, ToC, share) all close - but when the card is flipped to its
  // back face, Escape's owner is the flip itself.
  await page.goto('/app/reader/dulfu/ispravile_lui_pacala/fuga');
  await page.locator('#nav-reader-settings-btn').waitFor();

  // The settings panel closes on Escape.
  await page.click('#nav-reader-settings-btn');
  await page.locator('#font-btn-serif').waitFor();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  await expect(page.locator('#font-btn-serif')).toHaveCount(0);

  // Escape closes the ToC even when its chapter search field has focus.
  await page.click('#btn-reader-toc-menu');
  await page.locator('#reader-toc-search').fill('King');
  const tocSidebar = page.locator('#reader-toc-sidebar');
  const sidebarBox = await tocSidebar.boundingBox();
  expect(sidebarBox).toBeTruthy();
  expect(sidebarBox!.height).toBeLessThan(page.viewportSize()!.height);
  await page.keyboard.press('Escape');
  await expect(page.locator('#reader-toc-search')).toHaveCount(0);

  // Flipped card first: Escape returns to the reading face, not to a menu
  // - even with the back face's download dropdown open, which closes with
  // the flip.
  await page.click('#btn-reader-flip-stats-front');
  await page.waitForTimeout(900); // let the 700ms flip animation settle
  await expect(page.locator('#btn-reader-flip-stats-back')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await page.click('#btn-reader-download-toggle');
  await expect(page.locator('#download-inline-checkbox')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(900);
  const stillFlipped = await page.evaluate(() =>
    !!document.querySelector('.rotate-y-180.relative'));
  expect(stillFlipped).toBe(false);
  await expect(page.locator('#download-inline-checkbox')).toHaveCount(0);
});

test('Shift+S toggles the reader settings dropdown', async ({ page }) => {
  // Same single-letter family as the stats flip (i) and the ToC sidebar
  // (t): Shift+S opens the display-preferences panel (the navbar gear
  // button's dropdown) and, pressed again, closes it (a bare s belongs to
  // the collections quick-jump). The second press must outwait the
  // typing-burst guard (two letters within 800ms read as typing a word, not
  // two deliberate shortcuts).
  await page.goto('/app/reader/dulfu/ispravile_lui_pacala/fuga');
  await page.locator('#nav-reader-settings-btn').waitFor();

  await page.keyboard.press('Shift+S');
  await expect(page.locator('#settings-dropdown')).toBeVisible();
  await page.waitForTimeout(900);
  await page.keyboard.press('Shift+S');
  await expect(page.locator('#settings-dropdown')).toHaveCount(0);
});

test('s opens the collections quick-jump over the text, Escape closes it', async ({ page }) => {
  await page.goto('/app/reader/dulfu/ispravile_lui_pacala/fuga');
  await page.locator('#nav-reader-settings-btn').waitFor();

  await page.keyboard.press('s');
  const modal = page.locator('#collections-modal');
  await expect(modal).toBeVisible();
  await expect(modal.locator('#collections-search')).toBeFocused();
  await expect(modal.getByRole('heading', { name: /Favorites/ })).toBeVisible();
  await expect(modal.getByRole('heading', { name: /Collections/ })).toBeVisible();
  await expect(modal.getByRole('heading', { name: /Saved searches/ })).toBeVisible();
  // The reader's own settings panel must not have opened.
  await expect(page.locator('#settings-dropdown')).toHaveCount(0);

  await page.keyboard.press('Escape');
  await expect(modal).toHaveCount(0);
});

test('the incoming chapter heading stays in the content without a separate reader title', async ({ page }) => {
  // Calvin's letters: the heading is "CXXXII.—To Viret. [490]" (space
  // before the footnote ref) while the TOC title is "CXXXII.—To
  // Viret.[490]". The reader displays the HTML heading directly.
  await page.goto('/app/reader/calvin/letters_of_john_calvin/volume_i/cxxxii_to_viret_490');
  await page.locator('.reader-text-container').waitFor();
  const heading = page.locator('.reader-text-container :is(h1, h2, h3, h4, h5, h6)').first();
  await expect(heading).toContainText('CXXXII');
  await expect(page.locator('#btn-reader-title-to-work')).toHaveCount(0);
  expect(await heading.evaluate(element => getComputedStyle(element).borderBottomWidth)).toBe('1px');
});

test('footnote markers render as visible numbered emerald chips, not invisible blobs', async ({ page }) => {
  // teidiv.css's old `.note { background-color: yellow; padding: 3px; }`
  // landed here on a button whose <sup> is EMPTY - a 6x6px blob with the
  // note text only in the title tooltip. The chip must be visible: the
  // site emerald, a synthesized counter mark, help cursor.
  await page.goto('/app/reader/budai_deleanu/tiganiada/cantecul_a_v/2');
  const note = page.locator('.reader-text-container .note');
  await note.first().waitFor({ timeout: 15_000 });
  await expect(note).toHaveCount(1);
  await expect(note).toHaveCSS('background-color', 'rgb(5, 150, 105)');
  await expect(note).toHaveCSS('cursor', 'help');
  await expect(note).toHaveCSS('color', 'rgb(255, 255, 255)');
  const mark = await note.evaluate(el => getComputedStyle(el, '::before').content);
  expect(mark).toBe('counter(note-mark)');
  const box = await note.boundingBox();
  expect(box).toBeTruthy();
  expect(box!.width).toBeGreaterThan(10);
});

test('a long press on the bookmark button opens the collections menu and saves into the picked one', async ({ page }) => {
  await page.goto('/app/');
  await page.locator('[id^="btn-open-work-"]').first().click();
  await page.locator('#btn-read-first-chapter').click();
  await expect(page.locator('.reader-text-container')).toBeVisible();

  const button = page.locator('#btn-reader-save-chapter');
  const box = (await button.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(700);
  await page.mouse.up();

  const menu = page.getByRole('menu', { name: 'Bookmark into a collection' });
  await expect(menu).toBeVisible();
  await expect(page.getByText('Save to Personal Collection')).toHaveCount(0); // no dialog after a long press
  await expect(menu.getByRole('textbox', { name: 'New collection' })).toHaveAttribute('placeholder', 'New collection…');

  const name = `Long-press ${Date.now()}`;
  await menu.getByRole('textbox', { name: 'New collection' }).fill(name);
  await page.keyboard.press('Enter');
  await expect(menu).toHaveCount(0);
  await expect(button.locator('svg')).toHaveAttribute('fill', 'currentColor');

  // Right-click opens the same menu; the new collection is checked, and
  // picking it again removes the chapter from it.
  await button.click({ button: 'right' });
  const row = menu.getByRole('menuitemcheckbox', { name });
  await expect(row).toHaveAttribute('aria-checked', 'true');
  await row.click();
  await expect(menu).toHaveCount(0);
  await button.click({ button: 'right' });
  await expect(menu.getByRole('menuitemcheckbox', { name })).toHaveAttribute('aria-checked', 'false');
});

test('opening a book flips the page; next/previous within it slides, in the right direction', async ({ page }) => {
  // The rule itself is unit-tested (chapterTransition.test.ts); this pins
  // that ReaderView applies it.
  await page.goto('/app/');
  await page.locator('[id^="btn-open-work-"]').first().click();
  await page.locator('#btn-read-first-chapter').click();
  await page.locator('#btn-reader-next-chapter').waitFor({ timeout: 15_000 });
  const column = page.locator('main > div').first();
  const startUrl = page.url();

  // Arriving on the work: the page flip.
  await expect(column).toHaveClass(/chapter-turn-next/);
  await expect(column).not.toHaveClass(/chapter-turn-/, { timeout: 3_000 }); // cleared on animationend

  await page.locator('#btn-reader-next-chapter').click();
  await expect.poll(() => page.url()).not.toBe(startUrl);
  await expect(column).toHaveClass(/chapter-slide-next/);
  await expect(column).not.toHaveClass(/chapter-(turn|slide)-/, { timeout: 3_000 });

  await page.keyboard.press('ArrowLeft');
  await expect.poll(() => page.url()).toBe(startUrl);
  await expect(column).toHaveClass(/chapter-slide-prev/);
  await expect(column).not.toHaveClass(/chapter-(turn|slide)-/, { timeout: 3_000 });

  // The toolbar's Back (a history back) slides back to the previous chapter too.
  await page.locator('#btn-reader-next-chapter').click();
  await expect.poll(() => page.url()).not.toBe(startUrl);
  await expect(column).not.toHaveClass(/chapter-(turn|slide)-/, { timeout: 3_000 });
  await page.locator('#btn-reader-back-work').click();
  await expect.poll(() => page.url()).toBe(startUrl);
  await expect(column).toHaveClass(/chapter-slide-prev/);
});
