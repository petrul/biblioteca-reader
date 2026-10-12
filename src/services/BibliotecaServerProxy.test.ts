import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BibliotecaServerProxy } from './BibliotecaServerProxy';

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
