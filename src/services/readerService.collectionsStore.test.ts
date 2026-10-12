import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import type { PreferencesStore, UserPreferences } from './preferencesStore';

// Collections (and their item order) are user preferences persisted through
// ONE interface, PreferencesStore: this browser's localStorage when the
// reader is anonymous, the account's server-side document once signed in
// (readerService.attachCollectionsStore). The views keep reading them
// synchronously from readerService's cache.

class FakeWebStorage implements Storage {
  private map = new Map<string, string>();
  get length() { return this.map.size; }
  clear() { this.map.clear(); }
  getItem(key: string) { return this.map.has(key) ? this.map.get(key)! : null; }
  key(index: number) { return Array.from(this.map.keys())[index] ?? null; }
  removeItem(key: string) { this.map.delete(key); }
  setItem(key: string, value: string) { this.map.set(key, value); }
}

/** The server side as the reader sees it: one JSON document, get + merge-put. */
class FakeAccountStore implements PreferencesStore {
  document: UserPreferences;
  writes = 0;
  constructor(initial: UserPreferences = {}) { this.document = JSON.parse(JSON.stringify(initial)); }
  async get() { return JSON.parse(JSON.stringify(this.document)); }
  async set(patch: Partial<UserPreferences>) { this.writes++; this.document = { ...this.document, ...JSON.parse(JSON.stringify(patch)) }; }
}

const PREFERENCES_KEY = 'biblioteca.reader.preferences.v1';
const chapter = (n: number) => ({
  type: 'chapter' as const, referenceId: `author/work/ch-${n}`, workId: 'author/work',
  workTitle: 'The Work', authorName: 'The Author', chapterId: `author/work/ch-${n}`, chapterTitle: `Chapter ${n}`,
});
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

let storage: FakeWebStorage;
beforeEach(async () => {
  storage = new FakeWebStorage();
  const globals = globalThis as any;
  globals.localStorage = storage;
  globals.window = { localStorage: storage, dispatchEvent: () => true, addEventListener: () => {}, removeEventListener: () => {} };
  (await import('./readerService')).resetCollectionsForTests();
});

const localDocument = (): UserPreferences => JSON.parse(storage.getItem(PREFERENCES_KEY) ?? '{}');

test('an anonymous reader\'s collections are stored in this browser\'s local preferences', async () => {
  const { readerService, ANONYMOUS_USER_ID } = await import('./readerService');
  readerService.addItemToCollection(ANONYMOUS_USER_ID, 'col-favorites', chapter(1));
  await settle();
  const stored = localDocument().collections!;
  assert.equal(stored.find(c => c.id === 'col-favorites')!.items[0].chapterTitle, 'Chapter 1');
});

test('a signed-in reader\'s collections come from and go to the account store, not localStorage', async () => {
  const { readerService } = await import('./readerService');
  const account = new FakeAccountStore({
    collections: [{ id: 'col-favorites', userId: 'petru', name: 'Favorites', isDefaultFavorites: true, createdAt: '', updatedAt: '', items: [] },
      { id: 'col-essays', userId: 'petru', name: 'Essays', isDefaultFavorites: false, createdAt: '', updatedAt: '', items: [] }],
  });
  await readerService.attachCollectionsStore('petru', account);
  assert.deepEqual(readerService.getCollections('petru').map(c => c.name), ['Favorites', 'Essays'], 'served from the account');

  const writesBefore = account.writes;
  readerService.addItemToCollection('petru', 'col-essays', chapter(7));
  await settle();
  assert.ok(account.writes > writesBefore, 'the change was written to the account store');
  assert.equal(account.document.collections!.find(c => c.id === 'col-essays')!.items[0].chapterTitle, 'Chapter 7');
  assert.ok(!JSON.stringify(localDocument()).includes('Chapter 7'), 'nothing of the account leaks into localStorage');
});

test('reordering moves an item and the new order is what gets stored', async () => {
  const { readerService } = await import('./readerService');
  const account = new FakeAccountStore();
  await readerService.attachCollectionsStore('petru', account);
  for (const n of [1, 2, 3]) readerService.addItemToCollection('petru', 'col-favorites', chapter(n));
  // addItemToCollection prepends: the list reads 3, 2, 1.
  const items = () => readerService.getCollections('petru').find(c => c.id === 'col-favorites')!.items;
  assert.deepEqual(items().map(i => i.chapterTitle), ['Chapter 3', 'Chapter 2', 'Chapter 1']);

  readerService.moveItemInCollection('petru', 'col-favorites', items()[2].id, -1);
  assert.deepEqual(items().map(i => i.chapterTitle), ['Chapter 3', 'Chapter 1', 'Chapter 2']);
  readerService.moveItemInCollection('petru', 'col-favorites', items()[0].id, -1); // already first: no-op
  assert.deepEqual(items().map(i => i.chapterTitle), ['Chapter 3', 'Chapter 1', 'Chapter 2']);
  await settle();
  assert.deepEqual(account.document.collections![0].items.map(i => i.chapterTitle), ['Chapter 3', 'Chapter 1', 'Chapter 2']);
});

test('an account without collections is seeded from what this browser held for it (legacy key)', async () => {
  storage.setItem('biblioteca_reader_collections_petru', JSON.stringify([
    { id: 'col-favorites', userId: 'petru', name: 'Favorites', isDefaultFavorites: true, createdAt: '', updatedAt: '', items: [{ ...chapter(4), id: 'x', addedAt: '' }] },
  ]));
  const { readerService } = await import('./readerService');
  const account = new FakeAccountStore();
  await readerService.attachCollectionsStore('petru', account);
  assert.equal(account.document.collections![0].items[0].chapterTitle, 'Chapter 4');
  assert.equal(readerService.getCollections('petru')[0].items[0].chapterTitle, 'Chapter 4');
});

test('preferencesStoreFor picks the account store when signed in, localStorage when not', async () => {
  const { preferencesStoreFor } = await import('./identity');
  const { LocalPreferencesStore, RemotePreferencesStore } = await import('./preferencesStore');
  assert.ok(preferencesStoreFor(true) instanceof RemotePreferencesStore);
  assert.ok(preferencesStoreFor(false) instanceof LocalPreferencesStore);
});
