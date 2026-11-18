import assert from 'node:assert/strict';
import test from 'node:test';
import { COLLECTION_WRITE_ROUTES, registerCollectionWriteRoutes } from './collectionWriteGateway';

test('same-origin gateway registers every collection mutation used by the reader', () => {
  const routes: Array<{ verb: string; path: string; relay: string; guarded: boolean }> = [];
  const app = {
    post(path: string, handler: any) { routes.push({ verb: 'post', path, relay: handler.relay, guarded: handler.guarded }); },
    patch(path: string, handler: any) { routes.push({ verb: 'patch', path, relay: handler.relay, guarded: handler.guarded }); },
    delete(path: string, handler: any) { routes.push({ verb: 'delete', path, relay: handler.relay, guarded: handler.guarded }); },
  };
  registerCollectionWriteRoutes(app, method => ({ relay: method, guarded: false }), handler => ({ ...handler as any, guarded: true }));

  assert.deepEqual(routes, COLLECTION_WRITE_ROUTES.map(([verb, path, method]) => ({
    verb, path, relay: method, guarded: true,
  })));
  assert.ok(routes.some(route => route.path === '/api/collections/mine' && route.verb === 'post'));
  assert.ok(routes.some(route => route.path === '/api/collections/mine/:id/items' && route.verb === 'post'));
  assert.ok(routes.some(route => route.path === '/api/collections/mine/:id/items/:itemId' && route.verb === 'delete'));
});
