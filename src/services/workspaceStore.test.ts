import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const globals = globalThis as any;
const values = new Map<string, string>();

beforeEach(async () => {
  values.clear();
  globals.localStorage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  };
  (await import('./workspaceStore')).resetWorkspaceForTests();
});

test('anonymous workspace state is local and remembers the discarded layout', async () => {
  const store = await import('./workspaceStore');
  await store.loadWorkspaceState(false);
  store.setWorkspace({ version: 1, active: true, left: { kind: 'collection', id: 'favorites' }, filters: { left: 'hamlet' } });
  await store.persistWorkspaceState();
  assert.equal(values.size, 1);
  assert.deepEqual(JSON.parse(values.get('biblioteca.reader.workspace.v1')!).workspace.left, { kind: 'collection', id: 'favorites' });
  store.setWorkspace({ ...store.getWorkspace(), active: false });
  assert.equal(store.getWorkspace().active, false);
});

test('last search stores bounded results and the active result for shortcut restoration', async () => {
  const store = await import('./workspaceStore');
  await store.loadWorkspaceState(false);
  store.setLastSearch({
    version: 1,
    query: 'garden',
    mode: 'lucene',
    scope: 'work',
    workId: 'bacon/gardens',
    options: {},
    page: 2,
    pageSize: 6,
    fetchedPages: [1, 2],
    results: [{ id: 'r1', mode: 'lucene', type: 'snippet', workId: 'bacon/gardens', workTitle: 'Gardens', authorId: 'bacon', authorName: 'Bacon', snippet: 'garden', language: 'eng' } as any],
    activeResultId: 'r1',
    updatedAt: '2026-11-08T00:00:00Z'
  });
  await store.persistWorkspaceState();
  const raw = JSON.parse(values.get('biblioteca.reader.workspace.v1')!);
  assert.equal(raw.lastSearch.page, 2);
  assert.equal(raw.lastSearch.results[0].id, 'r1');
  assert.equal(raw.lastSearch.activeResultId, 'r1');
});
