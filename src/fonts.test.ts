import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// Regression (2026-10-28): dropping the Google Fonts <link> from index.html
// left every family index.css names declared but never loaded, and the
// reader silently fell back to system fonts. These checks fail if a family
// the CSS relies on is not self-hosted through src/fonts.ts.

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const read = (path: string) => readFileSync(path, 'utf8');

/** The first (intended) family of every font-family / --font-* declaration in index.css. */
function primaryFamilies(css: string): Set<string> {
  const families = new Set<string>();
  for (const [, value] of css.matchAll(/(?:font-family|--font-[a-z-]+)\s*:\s*([^;}]+)/g)) {
    const first = value.split(',')[0].trim().replace(/^["']|["']$/g, '');
    if (!first.startsWith('var(') && first !== 'inherit') families.add(first);
  }
  return families;
}

/** Families provided by the @font-face rules of the stylesheets fonts.ts imports. */
function selfHostedFamilies(): Set<string> {
  const families = new Set<string>();
  for (const [, specifier] of read(join(here, 'fonts.ts')).matchAll(/^import '([^']+\.css)';$/gm)) {
    for (const [, family] of read(require.resolve(specifier)).matchAll(/font-family:\s*'([^']+)'/g)) families.add(family);
  }
  return families;
}

test('every font family the reader CSS relies on is self-hosted', () => {
  const wanted = primaryFamilies(read(join(here, 'index.css')));
  const hosted = selfHostedFamilies();
  // Guard the parser itself: these are the reader's own faces.
  for (const family of ['Newsreader', 'Cinzel', 'Plus Jakarta Sans', 'JetBrains Mono', 'Alegreya', 'Fira Sans', 'Gentium Book Plus']) {
    assert.ok(wanted.has(family), `index.css no longer names ${family} - update this test`);
  }
  const missing = [...wanted].filter(family => !hosted.has(family));
  assert.deepEqual(missing, [], `named in index.css but not loaded by src/fonts.ts: ${missing.join(', ')}`);
});

test('the app entry loads the fonts, from its own origin only', () => {
  assert.match(read(join(here, 'main.tsx')), /^import '\.\/fonts\.ts';$/m, 'main.tsx must import ./fonts.ts');
  const indexHtml = read(join(here, '..', 'index.html'));
  assert.doesNotMatch(indexHtml, /fonts\.(googleapis|gstatic)\.com/, 'fonts are self-hosted - no third-party font host');
});
