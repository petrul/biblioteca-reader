import { test, expect, type Page } from '@playwright/test';

/**
 * Poem stanza centering (services/poemAlignment.ts, ported from the old
 * Spring MVC reader's teidiv.js): stanza lines stay left-aligned relative
 * to each other, but the stanza as a block reads as centered in the
 * reading column - alignPoemStanzas measures the stanza's AVERAGE line
 * width and centers it, capped so the longest fitting line still fits.
 *
 * The regression this guards against: React 19 compares the
 * dangerouslySetInnerHTML prop by object identity, so a fresh { __html }
 * literal per render re-assigned innerHTML with the SAME string on every
 * re-render - recreating all content DOM and wiping those inline margins.
 * The first scroll (sticky header show/hide = a ReaderView re-render) sent
 * the poem back to left-aligned, and the align effect never re-ran because
 * its dependency, the html string, had not changed. ReaderView now
 * memoizes the prop object and realigns through a MutationObserver; this
 * spec pins the alignment contract through real scrolling.
 *
 * The chapter below has a stanza whose lines average well below the column
 * width, so centering is the expected alignment. Requires the dev server
 * already running (see playwright.config.ts).
 */

test.use({ viewport: { width: 1280, height: 800 } });

const CHAPTER = '/app/reader/dulfu/ispravile_lui_pacala/cuvant_inainte';

/**
 * The stanza's applied margin and the margin the alignment contract
 * demands, measured the same way alignPoemStanzas measures (max-content
 * probing of each line, restored immediately after).
 */
function stanzaAlignment(page: Page) {
  return page.evaluate(() => {
    const container = document.querySelector<HTMLElement>('.reader-text-container');
    const stanza = container?.querySelector<HTMLElement>('div.lg');
    if (!container || !stanza) return null;
    const columnWidth = container.getBoundingClientRect().width;
    const margin = parseFloat(getComputedStyle(stanza).marginLeft) || 0;
    stanza.style.width = 'max-content';
    const lines = Array.from(stanza.querySelectorAll<HTMLElement>('.l'));
    lines.forEach(line => { line.style.width = 'max-content'; });
    let total = 0;
    let maxWidth = 0;
    lines.forEach(line => { const width = Math.ceil(line.getBoundingClientRect().width); total += width; maxWidth = Math.max(maxWidth, width); line.style.width = 'auto'; });
    stanza.style.width = 'auto';
    const avgLineWidth = lines.length ? total / lines.length : 0;
    return {
      margin,
      expectedMargin: Math.max(0, Math.min((columnWidth - avgLineWidth) / 2, columnWidth - maxWidth)),
      avgLineWidth,
      columnWidth,
      lineCount: lines.length
    };
  });
}

async function expectStanzaCentered(page: Page) {
  const alignment = await stanzaAlignment(page);
  expect(alignment).not.toBeNull();
  expect(alignment!.lineCount).toBeGreaterThan(0);
  // Too wide to center meaningfully would mean the fixture chapter changed;
  // fail loudly instead of asserting a vacuous zero margin.
  expect(alignment!.avgLineWidth).toBeLessThan(alignment!.columnWidth);
  expect(Math.abs(alignment!.margin - alignment!.expectedMargin)).toBeLessThan(3);
  expect(alignment!.margin).toBeGreaterThan(0);
}

test('a poem chapter renders its stanza centered and stays centered through scrolling', async ({ page }) => {
  await page.goto(CHAPTER, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.reader-text-container div.lg', { timeout: 20000 });

  // The align effect lands one animation frame after the content mounts.
  await page.waitForFunction(() => {
    const stanza = document.querySelector('.reader-text-container div.lg');
    return stanza ? parseFloat(getComputedStyle(stanza).marginLeft) > 0 : false;
  }, null, { timeout: 10000 });
  await expectStanzaCentered(page);

  // Scroll through the chapter in both directions: every scroll-down hides
  // the sticky header, every scroll up brings it back - each is exactly the
  // ReaderView re-render that used to recreate the content DOM and wipe the
  // stanza margins.
  for (const fraction of [0.4, 0.8, 0.2, 1.0]) {
    await page.evaluate(
      f => window.scrollTo(0, document.documentElement.scrollHeight * f),
      fraction
    );
    await page.waitForTimeout(400);
  }
  await expectStanzaCentered(page);
});


const BROWNING = '/app/reader/browning/the_pied_piper_of_hamelin/vi';

test('Browning VI nested stanza separators do not accumulate offsets', async ({ page }) => {
  await page.goto(BROWNING, { waitUntil: 'domcontentloaded' });
  const finalLine = page.locator('.reader-text-container .l').filter({ hasText: 'poor Piper as I am' });
  await expect(finalLine).toBeVisible({ timeout: 20000 });
  await page.evaluate(() => document.fonts.ready);
  await page.setViewportSize({ width: 1200, height: 800 });
  const layout = await page.evaluate(() => {
    const root = document.querySelector<HTMLElement>('.reader-text-container')!;
    const lines = [...root.querySelectorAll<HTMLElement>('.l')];
    const first = lines[0].getBoundingClientRect();
    const final = lines.find(line => line.textContent?.includes('poor Piper as I am'))!.getBoundingClientRect();
    return {
      firstLeft: first.left,
      finalLeft: final.left,
      finalWidth: final.width,
      nestedMargins: [...root.querySelectorAll<HTMLElement>('div.lg div.lg')]
        .map(stanza => parseFloat(getComputedStyle(stanza).marginLeft)),
    };
  });
  expect(layout.nestedMargins.length).toBeGreaterThan(0);
  expect(layout.nestedMargins.every(margin => margin === 0)).toBe(true);
  expect(Math.abs(layout.firstLeft - layout.finalLeft)).toBeLessThan(2);
  expect(layout.finalWidth).toBeGreaterThan(300);
});

test('alignment clears stale offsets on narrow resize and preserves fitting lines', async ({ page }) => {
  await page.goto('/app/', { waitUntil: 'domcontentloaded' });
  await page.setContent(`
    <style>
      #poem { width: 800px; font: 20px/24px monospace; }
      .lg { width: max-content; margin-left: auto; margin-right: auto; }
      .l { margin: 0; width: max-content; }
    </style>
    <div id="poem"><div class="lg">
      <p class="l">A deliberately long line of verse</p><p class="l">Short</p>
    </div><div class="lg"/><div class="lg"/><div class="lg">
      <p class="l">Another line of verse</p>
    </div></div>`);
  const measurements = await page.evaluate(async () => {
    // Exercise the actual service through Vite in a real browser layout.
    const serviceUrl = '/src/services/poemAlignment.ts';
    const { alignPoemStanzas } = await import(/* @vite-ignore */ serviceUrl);
    const root = document.getElementById('poem')!;
    const first = root.querySelector<HTMLElement>('.lg')!;
    const line = root.querySelector<HTMLElement>('.l')!;
    alignPoemStanzas(root);
    const wideMargin = parseFloat(first.style.marginLeft);
    root.style.width = '180px';
    alignPoemStanzas(root);
    const narrowMargins = [...root.querySelectorAll<HTMLElement>('.lg')].map(el => el.style.marginLeft);
    root.style.width = '450px';
    alignPoemStanzas(root);
    const fittingHeight = line.getBoundingClientRect().height;
    const fittingLeft = first.style.marginLeft;
    alignPoemStanzas(root);
    return { wideMargin, narrowMargins, fittingHeight, fittingLeft, repeatedLeft: first.style.marginLeft };
  });
  expect(measurements.wideMargin).toBeGreaterThan(0);
  expect(measurements.narrowMargins.every(margin => margin === '0px')).toBe(true);
  expect(measurements.fittingHeight).toBe(24);
  expect(measurements.repeatedLeft).toBe(measurements.fittingLeft);
});
