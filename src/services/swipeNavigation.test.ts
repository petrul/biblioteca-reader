import assert from 'node:assert/strict';
import test from 'node:test';
import { swipeTarget } from './swipeNavigation';

test('swiping right on the first chapter goes back to the work card', () => {
  assert.deepEqual(swipeTarget('right', undefined, 'capitolul_2'), { kind: 'work' });
});

test('swiping right elsewhere turns to the previous chapter', () => {
  assert.deepEqual(swipeTarget('right', 'capitolul_1', 'capitolul_3'), { kind: 'chapter', chapterId: 'capitolul_1' });
});

test('swiping left turns to the next chapter, and does nothing on the last one', () => {
  assert.deepEqual(swipeTarget('left', 'capitolul_1', 'capitolul_3'), { kind: 'chapter', chapterId: 'capitolul_3' });
  assert.equal(swipeTarget('left', 'capitolul_9', undefined), null);
});

test('a single-chapter work: right goes to the work card, left does nothing', () => {
  assert.deepEqual(swipeTarget('right', undefined, undefined), { kind: 'work' });
  assert.equal(swipeTarget('left', undefined, undefined), null);
});
