import assert from 'node:assert/strict';
import test from 'node:test';
import { PersonalCollection, SavedSearch } from '../types/textbase';
import { collectionShelves } from './collectionShelves';

const at = '2026-10-31T00:00:00.000Z';

function collection(id: string, name: string, items: PersonalCollection['items'], isDefaultFavorites = false): PersonalCollection {
  return { id, kind: isDefaultFavorites ? 'favorites' : 'user', userId: 'reader', name, isDefaultFavorites, createdAt: at, updatedAt: at, items };
}

const work = { workId: 'creanga/amintiri', workTitle: 'Amintiri din copilărie', authorName: 'Ion Creangă', addedAt: at };

test('one shelf per non-empty collection: Favorites first, then own collections, then saved searches', () => {
  const searches: SavedSearch[] = [{
    id: 's1', kind: 'search', name: 'pacala', query: 'pacala', createdAt: at, updatedAt: at,
    items: [{ id: 'h1', ...work, chapterId: 'creanga/amintiri/partea_i', snippet: '…Păcală…' }]
  }];
  const shelves = collectionShelves([
    collection('c1', 'Poetry', [{ id: 'i1', type: 'work', referenceId: work.workId, ...work }]),
    collection('c2', 'Empty', []),
    collection('fav', 'Favorites', [{ id: 'i2', type: 'work', referenceId: work.workId, ...work }], true)
  ], searches);

  assert.deepEqual(shelves.map(s => [s.name, s.kind]), [['Favorites', 'favorites'], ['Poetry', 'user'], ['pacala', 'search']]);
  assert.deepEqual(shelves[2].entries[0].target, { kind: 'chapter', workId: 'creanga/amintiri', chapterId: 'creanga/amintiri/partea_i' });
  assert.equal(shelves[2].entries[0].detail, '…Păcală…');
});

test('each entry opens what was saved: the work, the chapter, or the quote', () => {
  const [shelf] = collectionShelves([collection('fav', 'Favorites', [
    { id: 'w', type: 'work', referenceId: work.workId, ...work },
    { id: 'c', type: 'chapter', referenceId: 'creanga/amintiri/partea_ii', chapterId: 'creanga/amintiri/partea_ii', chapterTitle: 'Partea a doua', ...work },
    { id: 'q', type: 'quote', referenceId: 'quote-1', quoteText: 'Stau câteodată și-mi aduc aminte…', ...work }
  ], true)], []);

  assert.deepEqual(shelf.entries.map(e => [e.label, e.detail, e.target]), [
    ['Work', undefined, { kind: 'work', workId: 'creanga/amintiri' }],
    ['Chapter', 'Partea a doua', { kind: 'chapter', workId: 'creanga/amintiri', chapterId: 'creanga/amintiri/partea_ii' }],
    ['Quote', 'Stau câteodată și-mi aduc aminte…', { kind: 'quote', quoteId: 'quote-1' }]
  ]);
});
