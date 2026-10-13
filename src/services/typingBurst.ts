// Single-letter shortcuts (the work card's and the reader's 'i'/'x' flips,
// the reader's 't' ToC and 'S' settings toggles, the 's' collections jump)
// must not fire while the
// user is actually typing a word on the page - typing "right" contains
// 'i' and would flip the card mid-word, covering the page with the stats
// face; the same word's 's' and 't' would toggle panels the same way. A
// letter arriving within this window after another letter is treated as
// typing, not a deliberate shortcut.
// Module-level on purpose: both components share one burst timeline.

const TYPING_BURST_MS = 800;
let lastLetterAt = 0;

export function isTypingBurst(now: number = Date.now()): boolean {
  return now - lastLetterAt < TYPING_BURST_MS;
}

export function noteLetterKey(now: number = Date.now()): void {
  lastLetterAt = now;
}
