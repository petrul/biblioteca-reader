import { test } from 'node:test';
import assert from 'node:assert/strict';
import { heroCard } from './heroCard';

test('nothing is shown while the shelf is not known yet - no Explore flash for a signed-in reader', () => {
  // the sign-in check or the shelf fetch is still running: whatever the
  // provisional values say, neither card
  assert.equal(heroCard({ shelfKnown: false, isEngagedReader: false, shelfWorks: 0 }), null);
  assert.equal(heroCard({ shelfKnown: false, isEngagedReader: true, shelfWorks: 3 }), null);
});

test('a reader without real reading time gets the Explore card', () => {
  assert.equal(heroCard({ shelfKnown: true, isEngagedReader: false, shelfWorks: 0 }), 'explore');
  // touched works alone do not earn My Books
  assert.equal(heroCard({ shelfKnown: true, isEngagedReader: false, shelfWorks: 4 }), 'explore');
});

test('an engaged reader gets My Books, and never the Explore card while its works load', () => {
  assert.equal(heroCard({ shelfKnown: true, isEngagedReader: true, shelfWorks: 2 }), 'workspace');
  assert.equal(heroCard({ shelfKnown: true, isEngagedReader: true, shelfWorks: 0 }), null);
});
