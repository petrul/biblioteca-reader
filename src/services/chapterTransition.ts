// The one-shot animation the reader's text column plays on arriving at a
// chapter (ReaderView applies the class, index.css defines it):
//
// - arriving on a work - the first chapter shown, or the work switching
//   underneath (e.g. "More like this" jumping into another book) - plays
//   the 3D page flip (chapter-turn-next), like opening the book;
// - a next/previous turn within the same work plays the calmer slide
//   (chapter-slide-*), the new page coming in from the direction of travel;
// - anything else within the work (a TOC jump, a deep link) plays nothing.

export type ChapterTurnDirection = 'next' | 'prev';

/** A next/previous navigation noted just before the chapter changes. */
export interface PendingChapterTurn {
  direction: ChapterTurnDirection;
  at: number;
}

// A noted turn only animates a chapter change that follows it promptly: the
// toolbar's Back (a history back) notes a 'prev' turn that may never land on
// another chapter, and must not animate a later, unrelated TOC jump.
export const PENDING_TURN_MAX_AGE_MS = 2000;

/**
 * @param previousWorkId the work whose chapter was showing before, or null
 *                       when nothing was showing yet
 * @param workId         the work now being shown
 * @param pendingTurn    the next/previous navigation that led here, if any
 * @param now            the current time, in ms
 * @return the animation class to apply, or '' for none
 */
export function chapterTransitionClass(
  previousWorkId: string | null,
  workId: string,
  pendingTurn: PendingChapterTurn | null,
  now: number,
): string {
  if (previousWorkId !== workId) return 'chapter-turn-next';
  if (pendingTurn && now - pendingTurn.at < PENDING_TURN_MAX_AGE_MS) return `chapter-slide-${pendingTurn.direction}`;
  return '';
}
