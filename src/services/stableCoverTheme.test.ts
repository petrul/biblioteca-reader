import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_COVER_LAYOUTS,
  DEFAULT_COVER_PALETTES,
  stableCoverTheme,
} from './stableCoverTheme';

test('default cover selection is stable for a canonical work', () => {
  const first = stableCoverTheme('shakespeare/hamlet');
  assert.deepEqual(stableCoverTheme('shakespeare/hamlet'), first);
  assert.ok(DEFAULT_COVER_LAYOUTS.includes(first.layout));
  assert.ok(DEFAULT_COVER_PALETTES.includes(first.paletteId));
});

test('different canonical works get a deterministic distribution of defaults', () => {
  const themes = new Set(
    Array.from({ length: 24 }, (_, index) => {
      const theme = stableCoverTheme(`author-${index}/opus-${index}`);
      return `${theme.layout}:${theme.paletteId}`;
    }),
  );
  assert.ok(themes.size > 1);
});
