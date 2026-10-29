import assert from 'node:assert/strict';
import test from 'node:test';
import type { UserPreferences } from './preferencesStore';

(globalThis as any).window = { localStorage: { getItem: () => null } };
const { LocalPreferencesStore, RemotePreferencesStore, migrateLocalPreferencesToRemote } = await import('./preferencesStore');

async function withAccount(run: (state: { document: UserPreferences; fail: boolean }) => Promise<void>) {
  const originalFetch = globalThis.fetch;
  const state = { document: {} as UserPreferences, fail: false };
  const storage = new Map<string, string>();
  const originalWindow = globalThis.window;
  (globalThis as any).window = { localStorage: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  } };
  globalThis.fetch = async input => {
    const request = input as Request;
    if (request.method === 'GET') return Response.json(state.document);
    if (state.fail) return Response.json({ error: 'not saved' }, { status: 403 });
    const document = await request.json();
    // An older request finishing last must not erase a later change.
    if (document.fontSize === 19) await new Promise(resolve => setTimeout(resolve, 20));
    state.document = document;
    return Response.json(document);
  };
  try { await run(state); }
  finally { globalThis.fetch = originalFetch; (globalThis as any).window = originalWindow; }
}

test('sign-in cannot replace account collections with stale browser collections', async () => {
  await withAccount(async state => {
    const remote = [{ id: 'account-collection', items: [{ id: 'saved-on-another-device' }] }];
    state.document = { collections: remote as any, fontSize: 22 };
    await new LocalPreferencesStore().set({ collections: [] , readerTheme: 'paper' });
    await migrateLocalPreferencesToRemote();
    assert.deepEqual(state.document.collections, remote);
    assert.equal(state.document.fontSize, 22);
    assert.equal(state.document.readerTheme, 'paper');
  });
});

test('overlapping preference writes from different store instances preserve every key', async () => {
  await withAccount(async state => {
    await Promise.all([
      new RemotePreferencesStore().set({ fontSize: 19 }),
      new RemotePreferencesStore().set({ collections: [] }),
      new RemotePreferencesStore().set({ readerTheme: 'paper' }),
    ]);
    assert.deepEqual(state.document, { fontSize: 19, collections: [], readerTheme: 'paper' });
  });
});

test('overlapping local preference writes preserve collections and display settings', async () => {
  await withAccount(async () => {
    await Promise.all([
      new LocalPreferencesStore().set({ collections: [] }),
      new LocalPreferencesStore().set({ readerTheme: 'paper' }),
    ]);
    assert.deepEqual(await new LocalPreferencesStore().get(), { collections: [], readerTheme: 'paper' });
  });
});

test('rapid collection edits persist the newest complete collection', async () => {
  await withAccount(async state => {
    const store = new RemotePreferencesStore();
    await Promise.all([
      store.set({ fontSize: 19, collections: [{ id: 'favorites', items: [] }] as any }),
      store.set({ fontSize: 22, collections: [{ id: 'favorites', items: [{ id: 'new-item' }] }] as any }),
    ]);
    assert.equal(state.document.collections![0].items.length, 1);
  });
});

test('a rejected save rejects its promise and a subsequent save can recover', async () => {
  await withAccount(async state => {
    state.fail = true;
    await assert.rejects(new RemotePreferencesStore().set({ collections: [] }), /403/);
    state.fail = false;
    await new RemotePreferencesStore().set({ fontSize: 22 });
    assert.equal(state.document.fontSize, 22);
  });
});
