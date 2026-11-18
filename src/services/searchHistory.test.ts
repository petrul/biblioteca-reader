import assert from 'node:assert/strict';
import test from 'node:test';
import { attachSearchHistoryAccount, getSearchHistory, lastSearchQuery, recentSearchQueries, recordSearch, resetSearchHistoryForTests } from './searchHistory';

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

test('search history deduplicates the same scoped query and keeps newest first', () => {
  const original = (globalThis as any).localStorage;
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: new MemoryStorage() });
  try {
    resetSearchHistoryForTests();
    recordSearch({ query: 'Hamlet', mode: 'lucene', scope: 'library', options: {} });
    recordSearch({ query: 'War', mode: 'title', scope: 'work', workId: 'tolstoy/war', options: {} });
    recordSearch({ query: 'Hamlet', mode: 'lucene', scope: 'library', options: {} });
    assert.deepEqual(getSearchHistory().map(item => item.query), ['Hamlet', 'War']);
  } finally {
    if (original === undefined) delete (globalThis as any).localStorage;
    else Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: original });
    resetSearchHistoryForTests();
  }
});

test('signed-in history is loaded from and written to the account preference store', async () => {
  resetSearchHistoryForTests();
  let document: any = { searchHistory: [{ id: 'remote-1', query: 'Cicero', mode: 'all', scope: 'library', options: {}, createdAt: '2026-01-01', updatedAt: '2026-01-01' }] };
  const store = {
    async get() { return document; },
    async set(patch: any) { document = { ...document, ...patch }; }
  };
  await attachSearchHistoryAccount(store, true);
  assert.equal(getSearchHistory()[0]?.query, 'Cicero');
  recordSearch({ query: 'Plato', mode: 'all', scope: 'library', options: {} });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(document.searchHistory.map((item: any) => item.query), ['Plato', 'Cicero']);
  resetSearchHistoryForTests();
});

test('signed-in history keeps the latest 50 searches in the account preferences', async () => {
  resetSearchHistoryForTests();
  let document: any = { searchHistory: [] };
  const store = { async get() { return document; }, async set(patch: any) { document = { ...document, ...patch }; } };
  await attachSearchHistoryAccount(store, true);
  for (let i = 0; i < 55; i++) recordSearch({ query: `q${i}`, mode: 'all', scope: 'library', options: {} });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(document.searchHistory.length, 50);
  assert.equal(document.searchHistory[0].query, 'q54');
  assert.equal(lastSearchQuery(), 'q54');
  // signing in again on another device restores them
  resetSearchHistoryForTests();
  await attachSearchHistoryAccount(store, true);
  assert.equal(lastSearchQuery(), 'q54');
  assert.deepEqual(recentSearchQueries(3).map(entry => entry.query), ['q54', 'q53', 'q52']);
  resetSearchHistoryForTests();
});
