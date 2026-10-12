import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// The reader's long-press bookmark menu: save a chapter straight into an
// existing collection, or into a new one typed in the last row.

class FakeWebStorage implements Storage {
  private map = new Map<string, string>();
  get length() { return this.map.size; }
  clear() { this.map.clear(); }
  getItem(key: string) { return this.map.has(key) ? this.map.get(key)! : null; }
  key(index: number) { return Array.from(this.map.keys())[index] ?? null; }
  removeItem(key: string) { this.map.delete(key); }
  setItem(key: string, value: string) { this.map.set(key, value); }
}

const chapter = {
  type: 'chapter' as const, referenceId: 'author/work/ch-1', workId: 'author/work',
  workTitle: 'The Work', authorName: 'The Author', chapterId: 'author/work/ch-1', chapterTitle: 'Chapter one',
};

async function withBrowserGlobals(run: () => Promise<void>) {
  const globals = globalThis as any;
  const previous = { window: globals.window, localStorage: globals.localStorage };
  const storage = new FakeWebStorage();
  globals.localStorage = storage;
  globals.window = { localStorage: storage, dispatchEvent: () => true, addEventListener: () => {}, removeEventListener: () => {} };
  try { await run(); } finally { globals.window = previous.window; globals.localStorage = previous.localStorage; }
}

test('bookmarkInto saves into an existing collection, or a new one, and the menu marks where it is saved', () => withBrowserGlobals(async () => {
  const { readerService, ANONYMOUS_USER_ID: user } = await import('../services/readerService');
  const { bookmarkInto, bookmarkTargets } = await import('./BookmarkButton');

  const reading = readerService.createCollection(user, 'Reading list');
  assert.equal(bookmarkInto(user, { collectionId: reading.id }, chapter), reading.id);
  let targets = bookmarkTargets(readerService.getCollections(user), chapter.referenceId);
  assert.deepEqual(targets.map(t => [t.name, t.contains]), [['Favorites', false], ['Reading list', true]]);

  const created = bookmarkInto(user, { newName: '  Late night  ' }, chapter);
  targets = bookmarkTargets(readerService.getCollections(user), chapter.referenceId);
  const late = targets.find(t => t.id === created);
  assert.deepEqual(late && [late.name, late.contains], ['Late night', true]);

  // Saving twice into the same collection does not duplicate the chapter.
  bookmarkInto(user, { collectionId: reading.id }, chapter);
  assert.equal(readerService.getCollections(user).find(c => c.id === reading.id)!.items.length, 1);
}));

test('the menu lists every collection, then a "New collection…" box last', () => withBrowserGlobals(async () => {
  const { BookmarkMenuList } = await import('./BookmarkButton');
  const html = renderToStaticMarkup(createElement(BookmarkMenuList, {
    targets: [{ id: 'col-favorites', name: 'Favorites', contains: true }, { id: 'c2', name: 'Essays', contains: false }],
    onPick: () => {}, onCreate: () => {},
  }));
  const favorites = html.indexOf('Favorites'), essays = html.indexOf('Essays'), input = html.indexOf('placeholder="New collection…"');
  assert.ok(favorites >= 0 && essays > favorites && input > essays, 'collections in order, the new-collection box last');
  assert.equal(html.split('aria-checked="true"').length - 1, 1, 'only the collection holding the chapter is checked');
}));

test('picking a collection that already holds the chapter removes it from there', () => withBrowserGlobals(async () => {
  const { readerService, ANONYMOUS_USER_ID: user } = await import('../services/readerService');
  const { toggleBookmark, bookmarkTargets } = await import('./BookmarkButton');
  const essays = readerService.createCollection(user, 'Essays');
  const holds = () => bookmarkTargets(readerService.getCollections(user), chapter.referenceId).find(t => t.id === essays.id)!.contains;

  assert.equal(toggleBookmark(user, essays.id, chapter), true, 'first pick saves it');
  assert.equal(holds(), true);
  assert.equal(toggleBookmark(user, essays.id, chapter), false, 'picking it again removes it');
  assert.equal(holds(), false);
  assert.equal(readerService.getCollections(user).find(c => c.id === essays.id)!.items.length, 0);
  assert.equal(toggleBookmark(user, essays.id, chapter), true, 'and a third pick saves it back');
}));

