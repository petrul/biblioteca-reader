import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BibliotecaServerProxy, isSafeServerContentPath } from './BibliotecaServerProxy';

test('content proxy paths cannot escape the public content surface', () => {
  for (const path of ['/api/users/me', '/actuator/health', '/../api/users/me', '/%2e%2e/actuator/health', '/%252e%252e%252fapi/users/me', '//attacker.test/path', '/a%5cb']) {
    assert.equal(isSafeServerContentPath(path), false, path);
  }
  for (const path of ['/author/work/chapter.html', '/img/generic-author.webp', '/css/teidiv.css', '/author/work/chapter.html?p=2']) {
    assert.equal(isSafeServerContentPath(path), true, path);
  }
});

test('every registered same-origin Biblioteca proxy propagates upstream 404, including empty content responses', async () => {
  const routes: { method: string; path: string; handler: Function }[] = [];
  const app = {
    get: (path: string, handler: Function) => routes.push({ method: 'GET', path, handler }),
    put: (path: string, handler: Function) => routes.push({ method: 'PUT', path, handler }),
  };
  new BibliotecaServerProxy('http://upstream.test').register(app as any);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(null, { status: 404 });
  try {
    for (const route of routes) {
      const paths = route.path.includes('*')
        ? ['txt', 'xml', 'json', 'html'].map(ext => `/api/server-content/zevaco/buridan/x_buridan.${ext}`)
        : [route.path.replace(':id', '42').replace(':strId', 'zevaco')];
      for (const originalUrl of paths) {
        const req = { originalUrl, headers: {}, get: () => 'application/json', body: {} };
        await new Promise<void>((resolve, reject) => {
          const res = {
            statusCode: 200,
            status(code: number) { this.statusCode = code; return this; },
            setHeader() {},
            send(body: Buffer) {
              try {
                assert.equal(this.statusCode, 404, `${route.method} ${originalUrl}`);
                assert.equal(body.length, 0, `${route.method} ${originalUrl} must preserve the empty error body`);
                resolve();
              } catch (error) { reject(error); }
            },
            json(body: unknown) { reject(new Error(`unexpected fallback for ${originalUrl}: ${JSON.stringify(body)}`)); },
          };
          route.handler(req, res);
        });
      }
    }
    assert.ok(routes.some(route => route.method === 'PUT'));
    assert.ok(routes.some(route => route.path === '/api/server-content/*'));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('the Discover shelf route is public and relays its size to biblioteca-server unchanged', async () => {
  const routes = new Map<string, Function>();
  new BibliotecaServerProxy('http://upstream.test').register({ get: (path: string, handler: Function) => routes.set(path, handler), put: () => {} } as any);
  const handler = routes.get('/api/collections/system/discover');
  assert.ok(handler, 'discover must be a registered public GET route');
  const originalFetch = globalThis.fetch;
  const upstreamUrls: string[] = [];
  globalThis.fetch = async input => {
    upstreamUrls.push(String(input));
    return Response.json([{ path: 'plato/apology' }]);
  };
  try {
    const req = { originalUrl: '/api/collections/system/discover?size=20', path: '/api/collections/system/discover', headers: {}, get: () => 'application/json' };
    const body = await new Promise<Buffer>((resolve) => {
      const res = { statusCode: 0, status(code: number) { this.statusCode = code; return this; }, setHeader() {}, send: resolve };
      handler(req, res);
    });
    assert.deepEqual(upstreamUrls, ['http://upstream.test/api/collections/system/discover?size=20']);
    assert.deepEqual(JSON.parse(body.toString()), [{ path: 'plato/apology' }]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
