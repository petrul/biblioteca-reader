// Where a horizontal swipe on the reading column leads (ReaderView applies
// it; swipeNavigation.test.ts pins the rule):
//
// - swipe left ("forward") turns to the next chapter, and does nothing on
//   the last one;
// - swipe right ("back") turns to the previous chapter - and on the work's
//   first chapter, where there is none, goes back to the work's card page
//   (/{author}/{opus}), the page the book was opened from.

export type SwipeTarget = { kind: 'chapter'; chapterId: string } | { kind: 'work' } | null;

export function swipeTarget(
  direction: 'left' | 'right',
  prevChapterId: string | undefined,
  nextChapterId: string | undefined,
): SwipeTarget {
  if (direction === 'left') return nextChapterId ? { kind: 'chapter', chapterId: nextChapterId } : null;
  return prevChapterId ? { kind: 'chapter', chapterId: prevChapterId } : { kind: 'work' };
}
