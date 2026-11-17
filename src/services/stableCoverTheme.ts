import { createHash } from 'node:crypto';

/**
 * The layouts and palettes used when a work has no remotely generated cover.
 * Selection is pseudo-random per canonical work id, but repeatable: the same
 * book gets the same visual treatment on every request and across processes.
 */
export const DEFAULT_COVER_LAYOUTS = [
  'folio_bauhaus',
  'folio_ethereal',
  'folio_topographic',
  'folio_brutalist',
  'folio_nocturne',
  'folio_botanical',
] as const;

export const DEFAULT_COVER_PALETTES = [
  'archival_alabaster',
  'oxford_blue',
  'imperial_crimson',
  'forest_emerald',
  'terracotta_linen',
  'gallimard_cream',
  'midnight_obsidian',
] as const;

function stableIndex(workId: string, salt: string, size: number): number {
  const digest = createHash('sha256').update(`${workId}\0${salt}`).digest();
  return digest.readUInt32BE(0) % size;
}

export function stableCoverTheme(workId: string): {
  layout: typeof DEFAULT_COVER_LAYOUTS[number];
  paletteId: typeof DEFAULT_COVER_PALETTES[number];
} {
  return {
    layout: DEFAULT_COVER_LAYOUTS[stableIndex(workId, 'layout', DEFAULT_COVER_LAYOUTS.length)],
    paletteId: DEFAULT_COVER_PALETTES[stableIndex(workId, 'palette', DEFAULT_COVER_PALETTES.length)],
  };
}
