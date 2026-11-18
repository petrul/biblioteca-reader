/** The collection mutations that the reader must expose on its same-origin
 * gateway.  Keeping this list in one small helper makes it hard to add a
 * client write without also registering the corresponding proxy route. */
export type CollectionWriteMethod = 'POST' | 'PATCH' | 'DELETE';

type RouteRegistrar = {
  post(path: string, handler: unknown): void;
  patch(path: string, handler: unknown): void;
  delete(path: string, handler: unknown): void;
};

type RelayFactory = (method: CollectionWriteMethod) => unknown;
type WriteGuard = (handler: unknown) => unknown;

export const COLLECTION_WRITE_ROUTES = [
  ['post', '/api/collections/mine', 'POST'],
  ['post', '/api/collections/mine/searches', 'POST'],
  ['post', '/api/collections/mine/:id/items', 'POST'],
  ['patch', '/api/collections/mine/:id', 'PATCH'],
  ['delete', '/api/collections/mine/:id', 'DELETE'],
  ['delete', '/api/collections/mine/:id/items/:itemId', 'DELETE'],
] as const;

export function registerCollectionWriteRoutes(
  app: RouteRegistrar,
  relay: RelayFactory,
  guard: WriteGuard,
): void {
  for (const [verb, path, method] of COLLECTION_WRITE_ROUTES) {
    app[verb](path, guard(relay(method)));
  }
}
