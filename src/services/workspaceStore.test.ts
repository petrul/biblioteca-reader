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
