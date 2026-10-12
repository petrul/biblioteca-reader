import { test } from 'node:test';
import assert from 'node:assert/strict';
import { migrateLocalToRemote, LocalBookmarkStore, RemoteBookmarkStore, type BookmarkStore, type BookmarkPosition } from './bookmarkStore.ts';

// Minimal in-memory Storage (the Web Storage API shape), so
// LocalBookmarkStore's own real implementation - not just the abstract
// migration logic - can be exercised without a browser.
class FakeWebStorage implements Storage {
  private map = new Map<string, string>();
  get length() { return this.map.size; }
  clear() { this.map.clear(); }
  getItem(key: string) { return this.map.has(key) ? this.map.get(key)! : null; }
  key(index: number) { return Array.from(this.map.keys())[index] ?? null; }
  removeItem(key: string) { this.map.delete(key); }
  setItem(key: string, value: string) { this.map.set(key, value); }
}

// Bare in-memory fakes standing in for LocalBookmarkStore/a real
// server-backed store - migrateLocalToRemote only depends on the
// BookmarkStore interface, so these are enough to test it without a
// browser (localStorage) or a network call (textbase-server) at all.
class FakeBookmarkStore implements BookmarkStore {
  data: Record<string, BookmarkPosition> = {};
  setCalls: Array<[string, BookmarkPosition]> = [];
  attentionCalls: Array<[string, number]> = [];

  constructor(seed: Record<string, BookmarkPosition> = {}) {
    this.data = { ...seed };
  }

  async getAll() { return { ...this.data }; }
  async get(workId: string) { return this.data[workId] ?? null; }
  async set(workId: string, position: BookmarkPosition) {
    this.setCalls.push([workId, position]);
    this.data[workId] = position;
  }
  async addAttention(workId: string, secondsDelta: number) {
    this.attentionCalls.push([workId, secondsDelta]);
    const existing = this.data[workId];
    if (!existing) return;
    existing.attentionSeconds = (existing.attentionSeconds ?? 0) + secondsDelta;
  }
  async setScrollFraction(workId: string, divPath: string, fraction: number) {
    const existing = this.data[workId];
    if (!existing || existing.divPath !== divPath) return;
    existing.scrollFraction = fraction;
  }
  async clear() { this.data = {}; }
}

test('migrates every local bookmark to remote, then clears local', async () => {
  const local = new FakeBookmarkStore({
    'alecsandri/legende': { divPath: 'alecsandri/legende/dumbrava_rosie', updatedAt: 111 },
    'caragiale/o_noapte_furtunoasa': { divPath: 'caragiale/o_noapte_furtunoasa/actul_i', updatedAt: 222 }
  });
  const remote = new FakeBookmarkStore();

  await migrateLocalToRemote(local, remote);

  assert.deepEqual(await remote.get('alecsandri/legende'), { divPath: 'alecsandri/legende/dumbrava_rosie', updatedAt: 111 });
  assert.deepEqual(await remote.get('caragiale/o_noapte_furtunoasa'), { divPath: 'caragiale/o_noapte_furtunoasa/actul_i', updatedAt: 222 });
  assert.deepEqual(await local.getAll(), {});
});

test('merges into remote rather than replacing it - untouched works stay put', async () => {
  const local = new FakeBookmarkStore({
    'alecsandri/legende': { divPath: 'alecsandri/legende/dumbrava_rosie', updatedAt: 111 }
  });
  const remote = new FakeBookmarkStore({
    // Progress on a different work, from a previous session/device -
    // migration must not touch or drop this.
    'creanga/povesti': { divPath: 'creanga/povesti/soacra_cu_trei_nurori', updatedAt: 999 }
  });

  await migrateLocalToRemote(local, remote);

  assert.deepEqual(await remote.get('creanga/povesti'), { divPath: 'creanga/povesti/soacra_cu_trei_nurori', updatedAt: 999 });
  assert.deepEqual(await remote.get('alecsandri/legende'), { divPath: 'alecsandri/legende/dumbrava_rosie', updatedAt: 111 });
});

test('local bookmark overwrites remote for the same work (local was the more recent activity)', async () => {
  const local = new FakeBookmarkStore({
    'alecsandri/legende': { divPath: 'alecsandri/legende/legenda_ciocarliei', updatedAt: 500 }
  });
  const remote = new FakeBookmarkStore({
    'alecsandri/legende': { divPath: 'alecsandri/legende/dumbrava_rosie', updatedAt: 100 }
  });

  await migrateLocalToRemote(local, remote);

  assert.deepEqual(await remote.get('alecsandri/legende'), { divPath: 'alecsandri/legende/legenda_ciocarliei', updatedAt: 500 });
});

test('migrating an empty local store is a no-op on remote, and leaves local empty', async () => {
  const local = new FakeBookmarkStore();
  const remote = new FakeBookmarkStore({
    'creanga/povesti': { divPath: 'creanga/povesti/soacra_cu_trei_nurori', updatedAt: 999 }
  });

  await migrateLocalToRemote(local, remote);

  assert.deepEqual(await remote.getAll(), {
    'creanga/povesti': { divPath: 'creanga/povesti/soacra_cu_trei_nurori', updatedAt: 999 }
  });
  assert.deepEqual(await local.getAll(), {});
});

test('migration carries accumulated local attentionSeconds over to remote', async () => {
  const local = new FakeBookmarkStore({
    'alecsandri/legende': { divPath: 'alecsandri/legende/dumbrava_rosie', updatedAt: 111, attentionSeconds: 340 }
  });
  const remote = new FakeBookmarkStore();

  await migrateLocalToRemote(local, remote);

  assert.deepEqual(remote.attentionCalls, [['alecsandri/legende', 340]]);
});

test('migration does not call addAttention for a work with no accumulated local time', async () => {
  const local = new FakeBookmarkStore({
    'alecsandri/legende': { divPath: 'alecsandri/legende/dumbrava_rosie', updatedAt: 111 }
  });
  const remote = new FakeBookmarkStore();

  await migrateLocalToRemote(local, remote);

  assert.deepEqual(remote.attentionCalls, []);
});

test('local is fully cleared even when it had nothing remote did not already have', async () => {
  const shared = { divPath: 'alecsandri/legende/dumbrava_rosie', updatedAt: 111 };
  const local = new FakeBookmarkStore({ 'alecsandri/legende': shared });
  const remote = new FakeBookmarkStore({ 'alecsandri/legende': shared });

  await migrateLocalToRemote(local, remote);

  assert.deepEqual(await local.getAll(), {});
});

test('LocalBookmarkStore itself round-trips through its backing storage', async () => {
  const store = new LocalBookmarkStore(new FakeWebStorage());
  assert.equal(await store.get('alecsandri/legende'), null);

  await store.set('alecsandri/legende', { divPath: 'alecsandri/legende/dumbrava_rosie', updatedAt: 111 });
  assert.deepEqual(await store.get('alecsandri/legende'), { divPath: 'alecsandri/legende/dumbrava_rosie', updatedAt: 111, scrollFraction: 0 });

  await store.set('creanga/povesti', { divPath: 'creanga/povesti/soacra_cu_trei_nurori', updatedAt: 222 });
  assert.deepEqual(await store.getAll(), {
    'alecsandri/legende': { divPath: 'alecsandri/legende/dumbrava_rosie', updatedAt: 111, scrollFraction: 0 },
    'creanga/povesti': { divPath: 'creanga/povesti/soacra_cu_trei_nurori', updatedAt: 222, scrollFraction: 0 }
  });
});

test('LocalBookmarkStore.addAttention accumulates onto an existing position', async () => {
  const store = new LocalBookmarkStore(new FakeWebStorage());
  await store.set('alecsandri/legende', { divPath: 'alecsandri/legende/dumbrava_rosie', updatedAt: 111 });

  await store.addAttention('alecsandri/legende', 45);
  await store.addAttention('alecsandri/legende', 30);

  assert.deepEqual(await store.get('alecsandri/legende'), {
    divPath: 'alecsandri/legende/dumbrava_rosie', updatedAt: 111, attentionSeconds: 75, scrollFraction: 0
  });
});

test('LocalBookmarkStore.addAttention is a no-op when no position has been saved for that work', async () => {
  const store = new LocalBookmarkStore(new FakeWebStorage());
  await store.addAttention('alecsandri/legende', 60);
  assert.equal(await store.get('alecsandri/legende'), null);
});

test('LocalBookmarkStore.set preserves attentionSeconds already accumulated (merge, not replace)', async () => {
  const store = new LocalBookmarkStore(new FakeWebStorage());
  await store.set('alecsandri/legende', { divPath: 'alecsandri/legende/dumbrava_rosie', updatedAt: 111 });
  await store.addAttention('alecsandri/legende', 200);

  // Turning a page - a fresh set() with no attentionSeconds field at all,
  // exactly as App.tsx's handleSelectChapter calls it.
  await store.set('alecsandri/legende', { divPath: 'alecsandri/legende/dumbrava_a_doua', updatedAt: 222 });

  assert.deepEqual(await store.get('alecsandri/legende'), {
    divPath: 'alecsandri/legende/dumbrava_a_doua', updatedAt: 222, attentionSeconds: 200, scrollFraction: 0
  });
});

test('LocalBookmarkStore.set resets scrollFraction to 0 on a genuinely new div, but preserves it when re-saving the same div', async () => {
  const store = new LocalBookmarkStore(new FakeWebStorage());
  await store.set('alecsandri/legende', { divPath: 'alecsandri/legende/dumbrava_rosie', updatedAt: 111 });
  await store.setScrollFraction('alecsandri/legende', 'alecsandri/legende/dumbrava_rosie', 0.65);

  // "Continue Reading" resuming the SAME div must not wipe the position being resumed to.
  await store.set('alecsandri/legende', { divPath: 'alecsandri/legende/dumbrava_rosie', updatedAt: 222 });
  assert.equal((await store.get('alecsandri/legende'))?.scrollFraction, 0.65);

  // Turning the page to a genuinely different div starts fresh at its own top.
  await store.set('alecsandri/legende', { divPath: 'alecsandri/legende/dumbrava_a_doua', updatedAt: 333 });
  assert.equal((await store.get('alecsandri/legende'))?.scrollFraction, 0);
});

test('LocalBookmarkStore.setScrollFraction stores a clamped fraction for the matching div', async () => {
  const store = new LocalBookmarkStore(new FakeWebStorage());
  await store.set('alecsandri/legende', { divPath: 'alecsandri/legende/dumbrava_rosie', updatedAt: 111 });

  await store.setScrollFraction('alecsandri/legende', 'alecsandri/legende/dumbrava_rosie', 1.4);
  assert.equal((await store.get('alecsandri/legende'))?.scrollFraction, 1);

  await store.setScrollFraction('alecsandri/legende', 'alecsandri/legende/dumbrava_rosie', -0.2);
  assert.equal((await store.get('alecsandri/legende'))?.scrollFraction, 0);
});

test('LocalBookmarkStore.setScrollFraction is a no-op when no position has been saved for that work', async () => {
  const store = new LocalBookmarkStore(new FakeWebStorage());
  await store.setScrollFraction('alecsandri/legende', 'alecsandri/legende/dumbrava_rosie', 0.5);
  assert.equal(await store.get('alecsandri/legende'), null);
});

test('LocalBookmarkStore.setScrollFraction is a no-op for a stale divPath (reader has since moved to a different chapter)', async () => {
  const store = new LocalBookmarkStore(new FakeWebStorage());
  await store.set('alecsandri/legende', { divPath: 'alecsandri/legende/dumbrava_a_doua', updatedAt: 111 });
  await store.setScrollFraction('alecsandri/legende', 'alecsandri/legende/dumbrava_a_doua', 0.3);

  // Late update naming the chapter the reader has since left - must not touch the current one.
  await store.setScrollFraction('alecsandri/legende', 'alecsandri/legende/dumbrava_rosie', 0.9);

  assert.equal((await store.get('alecsandri/legende'))?.scrollFraction, 0.3);
});

test('LocalBookmarkStore feeds migrateLocalToRemote directly, end to end', async () => {
  const backingStorage = new FakeWebStorage();
  const local = new LocalBookmarkStore(backingStorage);
  await local.set('alecsandri/legende', { divPath: 'alecsandri/legende/dumbrava_rosie', updatedAt: 111 });
  const remote = new FakeBookmarkStore();

  await migrateLocalToRemote(local, remote);

  assert.deepEqual(await remote.get('alecsandri/legende'), { divPath: 'alecsandri/legende/dumbrava_rosie', updatedAt: 111, scrollFraction: 0 });
  assert.deepEqual(await local.getAll(), {});
  // the underlying storage itself was actually cleared, not just shadowed
  assert.equal(backingStorage.length, 0);
});

// RemoteBookmarkStore talks to /api/reading-progress through
// serversideApi's openapi-fetch client - under this Node runner that
// surfaces as a Request object (not the (url, init) pair a raw fetch
// would pass), so these mocks intercept Requests.
function withFetchMock<T>(impl: typeof fetch, run: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  (globalThis as any).fetch = impl;
  return run().finally(() => { globalThis.fetch = original; });
}

test('RemoteBookmarkStore.getAll maps the reading-progress list by opusPath', () => withFetchMock(
  (async () => new Response(JSON.stringify([
    { opusPath: 'alecsandri/legende', divPath: 'alecsandri/legende/dumbrava_rosie', updatedAt: 111, touchCount: 1, read: false, attentionSeconds: 0, scrollFraction: 0.15 },
    { opusPath: 'creanga/povesti', divPath: 'creanga/povesti/soacra_cu_trei_nurori', updatedAt: 222, touchCount: 3, read: true, attentionSeconds: 480, scrollFraction: 0.8 }
  ]), { status: 200 })) as typeof fetch,
  async () => {
    const store = new RemoteBookmarkStore();
    assert.deepEqual(await store.getAll(), {
      'alecsandri/legende': { divPath: 'alecsandri/legende/dumbrava_rosie', updatedAt: 111, touchCount: 1, read: false, attentionSeconds: 0, scrollFraction: 0.15 },
      'creanga/povesti': { divPath: 'creanga/povesti/soacra_cu_trei_nurori', updatedAt: 222, touchCount: 3, read: true, attentionSeconds: 480, scrollFraction: 0.8 }
    });
  }
));

test('RemoteBookmarkStore.get returns null when textbase-server has no saved position (404)', () => withFetchMock(
  (async () => new Response('', { status: 404 })) as typeof fetch,
  async () => {
    const store = new RemoteBookmarkStore();
    assert.equal(await store.get('alecsandri/legende'), null);
  }
));

test('RemoteBookmarkStore.set PUTs the divPath, and only the divPath', () => withFetchMock(
  (async (request: any) => {
    assert.equal(request.method, 'PUT');
    assert.equal(new URL(request.url).pathname, '/api/reading-progress');
    assert.deepEqual(await request.json(), { divPath: 'alecsandri/legende/dumbrava_rosie' });
    return new Response(JSON.stringify({ opusPath: 'alecsandri/legende', divPath: 'alecsandri/legende/dumbrava_rosie', updatedAt: 111 }), { status: 200 });
  }) as typeof fetch,
  async () => {
    const store = new RemoteBookmarkStore();
    await store.set('alecsandri/legende', { divPath: 'alecsandri/legende/dumbrava_rosie', updatedAt: 111 });
  }
));

test('RemoteBookmarkStore.addAttention PUTs opusPath and secondsDelta to the attention endpoint', () => withFetchMock(
  (async (request: any) => {
    assert.equal(new URL(request.url).pathname, '/api/reading-progress/attention');
    assert.equal(request.method, 'PUT');
    assert.deepEqual(await request.json(), { opusPath: 'alecsandri/legende', secondsDelta: 45 });
    return new Response('{}', { status: 200 });
  }) as typeof fetch,
  async () => {
    const store = new RemoteBookmarkStore();
    await store.addAttention('alecsandri/legende', 45);
  }
));

test('RemoteBookmarkStore.addAttention skips the request entirely for a non-positive delta', () => withFetchMock(
  (async () => { throw new Error('fetch should not have been called'); }) as typeof fetch,
  async () => {
    const store = new RemoteBookmarkStore();
    await store.addAttention('alecsandri/legende', 0);
  }
));

test('RemoteBookmarkStore.setScrollFraction PUTs opusPath, divPath and a clamped fraction to the scroll endpoint', () => withFetchMock(
  (async (request: any) => {
    assert.equal(new URL(request.url).pathname, '/api/reading-progress/scroll');
    assert.equal(request.method, 'PUT');
    assert.deepEqual(await request.json(), {
      opusPath: 'alecsandri/legende', divPath: 'alecsandri/legende/dumbrava_rosie', scrollFraction: 1
    });
    return new Response('{}', { status: 200 });
  }) as typeof fetch,
  async () => {
    const store = new RemoteBookmarkStore();
    await store.setScrollFraction('alecsandri/legende', 'alecsandri/legende/dumbrava_rosie', 1.3);
  }
));
