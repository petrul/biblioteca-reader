import type { BookmarkPosition } from './bookmarkStore';

// Which hero the main page shows above the catalog (BrowseView):
//
// - 'explore': the "Explore..." pitch, for a reader not (yet) engaged -
//   no work with REAL_READER_THRESHOLD_SECONDS of real reading time;
// - 'workspace': the "My Books" shelf, for an engaged reader, once its
//   works have resolved;
// - null: nothing yet. Until the shelf has been read for the reader's
//   actual identity (the sign-in check still running, the shelf fetch not
//   back) the answer is unknown, and an engaged reader whose works are still
//   loading must not see the Explore card either - it used to flash for
//   long-engaged signed-in readers on every page load.

export type HeroCard = 'explore' | 'workspace' | null;

export interface HeroState {
  /** The shelf has been read for the reader's known identity. */
  shelfKnown: boolean;
  /** Some work has the engaged reader's amount of real reading time. */
  isEngagedReader: boolean;
  /** How many of the shelf's works have resolved so far. */
  shelfWorks: number;
}

export function heroCard({ shelfKnown, isEngagedReader, shelfWorks }: HeroState): HeroCard {
  if (!shelfKnown) return null;
  if (!isEngagedReader) return 'explore';
  return shelfWorks > 0 ? 'workspace' : null;
}

// How long a reader must have spent (tab-visible, on any single work) to
// count as a real reader rather than someone who clicked in once and
// bounced - gates whether they see "My Books" at all vs. the first-time
// Explore card. Deliberately per-work, not summed across works - "read this
// or that work for five minutes."
export const REAL_READER_THRESHOLD_SECONDS = 5 * 60;

export function isEngagedReader(positions: Record<string, BookmarkPosition>): boolean {
  return Object.values(positions).some(
    (position) => (position.attentionSeconds ?? 0) >= REAL_READER_THRESHOLD_SECONDS
  );
}
