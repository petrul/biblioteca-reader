import assert from 'node:assert/strict';
import test from 'node:test';
import { ServerCollectionsStore } from './collectionsStore';

test('server collection adapter reads curated collections from collection tables', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async input => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.includes('/api/collections/mine')) {
      return Response.json([{
        id: '11111111-1111-1111-1111-111111111111',
        name: 'Favorites',
        kind: 'FAVORITES',
        favorites: true,
        createdAt: '2026-11-08T00:00:00Z',
        items: [{ id: '22222222-2222-2222-2222-222222222222', kind: 'DIV', divPath: '/shakespeare/hamlet/act_i', divHead: 'Act I', addedAt: '2026-11-08T00:00:00Z' }]
      }]);
    }
    return new Response(null, { status: 404 });
  };
  try {
    const store = new ServerCollectionsStore('petru', { async get() { return {}; }, async set() {} });
    const result = await store.get();
    assert.equal(result.collections?.[0].isDefaultFavorites, true);
    assert.equal(result.collections?.[0].items[0].referenceId, 'shakespeare/hamlet/act_i');
    assert.equal(result.collections?.[0].items[0].type, 'chapter');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
