import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// Regression guard: a chapter bookmarked in the reader (saved through
// AddToCollectionModal into Favorites) must show up in CollectionsView.
// It broke once when 477c6b8 made App keep CollectionsView mounted (for its
// dismiss animation) while the view kept the list it had copied into state
// at mount. The fix has two halves, both pinned here:
//   1. every collection change notifies readerService subscribers (App
//      re-renders on that), and
//   2. CollectionsView renders what readerService holds now, not a copy.

class FakeWebStorage implements Storage {
  private map = new Map<string, string>();
  get length() { return this.map.size; }
  clear() { this.map.clear(); }
  getItem(key: string) { return this.map.has(key) ? this.map.get(key)! : null; }
  key(index: number) { return Array.from(this.map.keys())[index] ?? null; }
  removeItem(key: string) { this.map.delete(key); }
  setItem(key: string, value: string) { this.map.set(key, value); }
}

const chapterItem = (n: number) => ({
  type: 'chapter' as const,
  referenceId: `author/work/chapter-${n}`,
  workId: 'author/work',
  workTitle: 'The Work',
  authorName: 'The Author',
  chapterId: `author/work/chapter-${n}`,
  chapterTitle: `Bookmarked chapter ${n}`,
});

test('a chapter bookmarked into Favorites notifies subscribers and appears in CollectionsView', async () => {
  const globals = globalThis as any;
  const previous = { window: globals.window, localStorage: globals.localStorage };
  const storage = new FakeWebStorage();
  globals.localStorage = storage;
  globals.window = { localStorage: storage, dispatchEvent: () => true, addEventListener: () => {}, removeEventListener: () => {} };
  try {
    const { readerService, ANONYMOUS_USER_ID } = await import('../services/readerService');
    const { CollectionsView } = await import('./CollectionsView');
    const render = () => renderToStaticMarkup(createElement(CollectionsView, {
      isOpen: true, currentUser: null,
      onOpenAuth: () => {}, onSelectWork: () => {}, onSelectChapter: () => {}, onOpenQuote: () => {},
    } as any));

    // The view is opened (and has read the collections) before anything is bookmarked.
    assert.ok(!render().includes('Bookmarked chapter 1'));

    let notifications = 0;
    const unsubscribe = readerService.subscribe(() => { notifications++; });
    try {
      readerService.addItemToCollection(ANONYMOUS_USER_ID, readerService.getFavoritesId(ANONYMOUS_USER_ID), chapterItem(1));
      assert.ok(notifications > 0, 'saving a bookmark must notify subscribers, or App never re-renders the view');

      const afterFirst = render();
      assert.ok(afterFirst.includes('Bookmarked chapter 1'), 'the bookmarked chapter shows in Favorites');

      readerService.addItemToCollection(ANONYMOUS_USER_ID, readerService.getFavoritesId(ANONYMOUS_USER_ID), chapterItem(2));
      const afterSecond = render();
      assert.ok(afterSecond.includes('Bookmarked chapter 1') && afterSecond.includes('Bookmarked chapter 2'),
        'a later bookmark shows too - the view must not keep an earlier copy');
    } finally {
      unsubscribe();
    }
  } finally {
    globals.window = previous.window;
    globals.localStorage = previous.localStorage;
  }
});

test('every type tab shows its own count, like All (n)', async () => {
  const globals = globalThis as any;
  const previous = { window: globals.window, localStorage: globals.localStorage };
  const storage = new FakeWebStorage();
  globals.localStorage = storage;
  globals.window = { localStorage: storage, dispatchEvent: () => true, addEventListener: () => {}, removeEventListener: () => {} };
  try {
    const { readerService, ANONYMOUS_USER_ID } = await import('../services/readerService');
    const { CollectionsView } = await import('./CollectionsView');
    readerService.addItemToCollection(ANONYMOUS_USER_ID, readerService.getFavoritesId(ANONYMOUS_USER_ID), chapterItem(1));
    readerService.addItemToCollection(ANONYMOUS_USER_ID, readerService.getFavoritesId(ANONYMOUS_USER_ID), chapterItem(2));
    readerService.addItemToCollection(ANONYMOUS_USER_ID, readerService.getFavoritesId(ANONYMOUS_USER_ID), { ...chapterItem(3), type: 'work', referenceId: 'author/other-work', chapterId: undefined });
    const html = renderToStaticMarkup(createElement(CollectionsView, {
      isOpen: true, currentUser: null,
      onOpenAuth: () => {}, onSelectWork: () => {}, onSelectChapter: () => {}, onOpenQuote: () => {},
    } as any)).replace(/<!-- -->/g, '');
    assert.ok(html.includes('All (3)'), 'All (3)');
    assert.ok(html.includes('Works (1)'), 'Works (1)');
    assert.ok(html.includes('Chapters (2)'), 'Chapters (2)');
    assert.ok(html.includes('Quotations (0)'), 'Quotations (0)');
  } finally {
    globals.window = previous.window;
    globals.localStorage = previous.localStorage;
  }
});

