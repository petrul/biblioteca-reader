import assert from 'node:assert/strict';
import test from 'node:test';

// A search result's bookmark stays filled once the result is saved in any
// of the user's collections: SearchView derives that from savedReferenceIds.

test('savedReferenceIds collects every referenceId across all collections', async () => {
  (globalThis as any).window ??= { localStorage: undefined, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => true };
  const { savedReferenceIds } = await import('./SearchView');
  const item = (referenceId: string) => ({ id: referenceId, type: 'chapter', referenceId, workId: 'a/w', workTitle: 'W', authorName: 'A', addedAt: '' });
  const ids = savedReferenceIds([
    { id: 'c1', userId: 'u', name: 'Favorites', isDefaultFavorites: true, createdAt: '', updatedAt: '', items: [item('a/w/ch-1')] },
    { id: 'c2', userId: 'u', name: 'Essays', isDefaultFavorites: false, createdAt: '', updatedAt: '', items: [item('a/w'), item('a/w/ch-1')] },
  ] as any);
  assert.deepEqual([...ids].sort(), ['a/w', 'a/w/ch-1']);
  assert.equal(savedReferenceIds([]).size, 0);
});
