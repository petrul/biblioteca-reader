import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chapterTransitionClass, PENDING_TURN_MAX_AGE_MS } from './chapterTransition';

const NOW = 1_000_000;
const turn = (direction: 'next' | 'prev', ageMs = 100) => ({ direction, at: NOW - ageMs });

test('arriving on a work flips the page, as when opening the book', () => {
  // the first chapter shown
  assert.equal(chapterTransitionClass(null, 'eminescu/poezii', null, NOW), 'chapter-turn-next');
  // the work switching underneath (e.g. "More like this" into another book)
  assert.equal(chapterTransitionClass('eminescu/poezii', 'creanga/amintiri', null, NOW), 'chapter-turn-next');
  // even when the change was a noted next/previous turn: a new book still opens with the flip
  assert.equal(chapterTransitionClass('eminescu/poezii', 'creanga/amintiri', turn('next'), NOW), 'chapter-turn-next');
  assert.equal(chapterTransitionClass('eminescu/poezii', 'creanga/amintiri', turn('prev'), NOW), 'chapter-turn-next');
});

test('page after page within the same work slides in from the direction of travel', () => {
  assert.equal(chapterTransitionClass('eminescu/poezii', 'eminescu/poezii', turn('next'), NOW), 'chapter-slide-next');
  assert.equal(chapterTransitionClass('eminescu/poezii', 'eminescu/poezii', turn('prev'), NOW), 'chapter-slide-prev');
});

test('within the same work, a chapter change that is no next/previous turn plays nothing', () => {
  // a TOC jump or deep link: no turn noted
  assert.equal(chapterTransitionClass('eminescu/poezii', 'eminescu/poezii', null, NOW), '');
  // a stale turn (a Back that never left the chapter) does not animate a later jump
  assert.equal(chapterTransitionClass('eminescu/poezii', 'eminescu/poezii', turn('prev', PENDING_TURN_MAX_AGE_MS), NOW), '');
});
