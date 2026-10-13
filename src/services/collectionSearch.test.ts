import assert from 'node:assert/strict';
import test from 'node:test';
import type { CollectionItem, PersonalCollection, SavedSearch } from '../types/textbase';
import {
  buildCollectionsView,
  firstMatchRowKey,
  matchesSearch,
  navRows,
  viewGroups,
} from './collectionSearch';

const item = (n: number, over: Partial<CollectionItem> = {}): CollectionItem => ({
  id: `item-${n}`,
  addedAt: '2026-01-01T00:00:00Z',
  type: 'chapter',
  referenceId: `a/w/c${n}`,
  workId: 'a/w',
  chapterId: `c${n}`,
  workTitle: 'Iliada',
  authorName: 'Homer',
  chapterTitle: `Cântul ${n}`,
  ...over,
} as CollectionItem);

const collection = (id: string, name: string, items: CollectionItem[], favorites = false): PersonalCollection => ({
  id, name, kind: favorites ? 'favorites' : 'user', userId: 'u', isDefaultFavorites: favorites,
  createdAt: '', updatedAt: '', items,
});

const search = (id: string, name: string, query: string): SavedSearch => ({
  id, name, query, kind: 'search', createdAt: '', updatedAt: '',
  items: [{ id: `${id}-1`, addedAt: '', workId: 'a/stoa', workTitle: 'Meditations', authorName: 'Marcus', snippet: 'the obstacle is the way' }],
});

const fixtures = () => ({
  collections: [
    collection('fav', 'Favorites', [item(1), item(2, { type: 'quote', quoteText: 'Sing, goddess, the wrath', chapterTitle: undefined })], true),
    collection('greek', 'Greek tragedy', [item(3, { workTitle: 'Oedipus', authorName: 'Sophocles' })]),
    collection('empty', 'Thesis notes', []),
  ],
  searches: [search('s1', 'Stoic obstacles', 'obstacle')],
});

test('matchesSearch ignores case and accents and needs every word', () => {
  assert.ok(matchesSearch('', 'anything'));
  assert.ok(matchesSearch('  ', undefined));
  assert.ok(matchesSearch('CANTUL iliada', 'Iliada', 'Cântul 4'));
  assert.ok(!matchesSearch('cantul odyssey', 'Iliada', 'Cântul 4'));
});

test('without a query every section shows, groups unfiltered', () => {
  const { collections, searches } = fixtures();
  const view = buildCollectionsView(collections, searches, '');
  assert.equal(view.favorites?.items.length, 2);
  assert.deepEqual(view.collections.map(g => g.title), ['Greek tragedy', 'Thesis notes']);
  assert.deepEqual(view.searches.map(g => g.title), ['Stoic obstacles']);
});

test('a query keeps only matching items and drops groups with none', () => {
  const { collections, searches } = fixtures();
  const view = buildCollectionsView(collections, searches, 'goddess');
  assert.equal(view.favorites?.items.length, 1);
  assert.equal(view.collections.length, 0);
  assert.equal(view.searches.length, 0);
});

test('a group whose name matches shows all of its items', () => {
  const { collections, searches } = fixtures();
  const view = buildCollectionsView(collections, searches, 'greek');
  assert.equal(view.favorites, null);
  assert.deepEqual(view.collections.map(g => [g.title, g.items.length]), [['Greek tragedy', 1]]);
  const named = buildCollectionsView(collections, searches, 'stoic');
  assert.equal(named.searches[0].items.length, 1);
});

test('saved-search items are found by their snippet', () => {
  const { collections, searches } = fixtures();
  const view = buildCollectionsView(collections, searches, 'the way');
  assert.deepEqual(viewGroups(view).map(g => g.key), ['search:s1']);
});

test('a specific type filter narrows collections and hides saved searches', () => {
  const { collections, searches } = fixtures();
  const view = buildCollectionsView(collections, searches, '', 'quote');
  assert.equal(view.favorites?.items.length, 1);
  assert.equal(view.collections[1].items.length, 0);
  assert.equal(view.searches.length, 0);
});

test('keyboard rows: no header for Favorites, collapsed groups hide their items, searches get a run row', () => {
  const { collections, searches } = fixtures();
  const view = buildCollectionsView(collections, searches, '');
  const collapsed = navRows(view, group => group.section === 'favorites');
  assert.deepEqual(collapsed.map(r => r.kind), ['item', 'item', 'header', 'header', 'header']);
  const open = navRows(view, () => true);
  assert.ok(open.some(r => r.kind === 'run' && r.group.key === 'search:s1'));
});

test('the highlight lands on the first matching item, else the first header', () => {
  const { collections, searches } = fixtures();
  const rows = navRows(buildCollectionsView(collections, searches, 'greek'), () => true);
  assert.equal(rows.find(r => r.key === firstMatchRowKey(rows))?.kind, 'item');
  const headersOnly = navRows(buildCollectionsView(collections, searches, ''), () => false);
  assert.equal(headersOnly.find(r => r.key === firstMatchRowKey(headersOnly))?.kind, 'header');
});
