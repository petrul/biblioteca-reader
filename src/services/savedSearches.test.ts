import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { SearchResult } from '../types/textbase';

const store = new Map<string, string>();
const globals = globalThis as any;
const realFetch = globals.fetch;

beforeEach(async () => {
  store.clear();
  globals.localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
  globals.fetch = realFetch;
  (await import('./savedSearches')).resetSavedSearchesForTests();
});

const hit = (n: number): SearchResult => ({
  id: `h${n}`, mode: 'lucene', type: 'chapter', workId: 'shakespeare/hamlet', workTitle: 'Hamlet',
  authorName: 'Shakespeare', chapterId: `shakespeare/hamlet/${n}`, chapterTitle: `Act ${n}`, snippet: `to be ${n}`,
  language: 'en' as SearchResult['language'],
});

test('an anonymous reader\'s saved search is named after the query and kept locally', async () => {
  const { saveSearch, getSavedSearches } = await import('./savedSearches');
  const saved = await saveSearch('  to be   or not ', 'all', [hit(1), hit(2)]);
  assert.equal(saved.kind, 'search');
  assert.equal(saved.name, 'to be or not');
  assert.match(saved.id, /^[0-9a-f-]{36}$/);
  assert.equal(getSavedSearches()[0].items.length, 2);
  assert.ok(store.get('biblioteca_reader_saved_searches')!.includes('to be 1'));

  const again = await saveSearch('to be or not', 'all', [hit(1)]);
  assert.equal(again.name, 'to be or not (2)');
});

test('a saved search can be renamed and deleted', async () => {
  const { saveSearch, renameSavedSearch, deleteSavedSearch, getSavedSearches } = await import('./savedSearches');
  const { id } = await saveSearch('hamlet', 'lucene', [hit(1)]);
  await renameSavedSearch(id, 'Hamlet quotes');
  assert.equal(getSavedSearches()[0].name, 'Hamlet quotes');
  await deleteSavedSearch(id);
  assert.deepEqual(getSavedSearches(), []);
});

test('a signed-in reader\'s saved searches use the scoped REST API', async () => {
  const calls: { url: string; method: string; body?: any }[] = [];
  globals.fetch = async (url: string, init: RequestInit = {}) => {
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url: String(url), method: init.method ?? 'GET', body });
    const json = (value: unknown) => new Response(JSON.stringify(value), { status: 200, headers: { 'Content-Type': 'application/json' } });
    if (String(url).endsWith('/api/collections/mine')) {
      return json([
        { id: 'fav', name: 'favorites', kind: 'FAVORITES', items: [] },
        { id: 's1', name: 'old search', kind: 'SEARCH', searchQuery: 'old', searchParams: '{"mode":"grep"}', createdAt: 't',
          items: [{ id: 'i1', divPath: 'a/b/c', divHead: 'Chapter', snippet: 'x', addedAt: 't' }] },
      ]);
    }
    if (init.method === 'POST') return json({ id: 's2', name: body.name, kind: 'SEARCH', searchQuery: body.query, createdAt: 't', items: [] });
    return new Response(null, { status: 200 });
  };
  const { attachSavedSearchesAccount, saveSearch, getSavedSearches, deleteSavedSearch } = await import('./savedSearches');
  await attachSavedSearchesAccount();
  assert.ok(calls.some(c => c.method === 'GET' && c.url.endsWith('/api/collections/mine')));
  assert.ok(calls.every(c => !c.url.endsWith('/graphql')));
  assert.deepEqual(getSavedSearches().map(s => s.name), ['old search']);
  assert.equal(getSavedSearches()[0].items[0].chapterId, 'a/b/c');

  await saveSearch('to be', 'lucene', [hit(1)]);
  const post = calls.find(c => c.method === 'POST' && c.url.endsWith('/api/collections/mine/searches'))!;
  assert.equal(post.body.query, 'to be');
  assert.deepEqual(post.body.hits, [{ path: 'shakespeare/hamlet/1', snippet: 'to be 1' }]);
  assert.deepEqual(getSavedSearches().map(s => s.id), ['s2', 's1']);
  assert.equal(store.size, 0, 'nothing of the account is kept in localStorage');

  await deleteSavedSearch('s1');
  assert.ok(calls.some(c => c.method === 'DELETE' && c.url.endsWith('/api/collections/mine/s1')));
});
