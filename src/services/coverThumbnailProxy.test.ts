import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { registerReaderThumbnails } from './coverThumbnailProxy';

async function fixture(upstream: typeof fetch, run: (base: string, docs: { paths: Record<string, unknown> }) => Promise<void>) {
  const app = express(); const docs = { paths: {} };
  registerReaderThumbnails(app, { coversUrl: 'http://covers.internal:3335/', apiDocument: docs }, upstream);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address(); assert(address && typeof address !== 'string');
  try { await run(`http://127.0.0.1:${address.port}`, docs); }
  finally { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}

test('thumbnail gateway relays bytes/cache headers and forwards no browser credentials', async () => {
  const bytes = Buffer.from('RIFF-test-WebP-payload'); const key = 'a'.repeat(64) + '.webp';
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const upstream: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), init });
    return new Response(bytes, { headers: { 'Content-Type': 'image/webp', 'X-Thumbnail-Cache': 'HIT', 'Cache-Control': 'public, max-age=86400', ETag: '"revision"', 'Content-Location': `/api/thumbnails/cache/${key}` } });
  };
  await fixture(upstream, async (base, docs) => {
    const original = 'https://minio.example/covers/work.png?revision=2';
    const response = await fetch(`${base}/api/cover-thumbnails?${new URLSearchParams({ url: original, width: '640' })}`, {
      headers: { Cookie: 'SESSION=private', Authorization: 'Bearer private', 'If-None-Match': '"old"' },
    });
    assert.equal(response.status, 200); assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
    assert.equal(response.headers.get('content-type'), 'image/webp'); assert.equal(response.headers.get('x-thumbnail-cache'), 'HIT');
    assert.equal(response.headers.get('cache-control'), 'public, max-age=86400');
    assert.equal(response.headers.get('content-location'), `/api/cover-thumbnails/cache/${key}`);
    const url = new URL(calls[0].url); assert.equal(url.origin, 'http://covers.internal:3335');
    assert.equal(url.pathname, '/api/thumbnails'); assert.equal(url.searchParams.get('url'), original); assert.equal(url.searchParams.get('width'), '640');
    const headers = new Headers(calls[0].init?.headers);
    assert.equal(headers.get('cookie'), null); assert.equal(headers.get('authorization'), null); assert.equal(headers.get('if-none-match'), '"old"');
    assert(docs.paths['/api/cover-thumbnails']);
    const cached = await fetch(`${base}${response.headers.get('content-location')}`);
    assert.equal(cached.status, 200); assert.equal(new URL(calls[1].url).pathname, `/api/thumbnails/cache/${key}`);
  });
});

test('thumbnail gateway preserves 304 and upstream errors, and rejects invalid requests', async () => {
  let status = 304; let calls = 0;
  const upstream: typeof fetch = async () => {
    calls++;
    return new Response(status === 304 ? null : '{"error":"not cached"}', { status, headers: { ETag: '"revision"', 'Content-Type': 'application/json' } });
  };
  await fixture(upstream, async base => {
    const url = `${base}/api/cover-thumbnails?url=https://minio.example/book.png`;
    assert.equal((await fetch(url)).status, 304);
    status = 404; assert.equal((await fetch(url)).status, 404);
    const before = calls;
    assert.equal((await fetch(`${url}&width=123`)).status, 400);
    assert.equal((await fetch(`${base}/api/cover-thumbnails?url=file:///etc/passwd`)).status, 400);
    assert.equal((await fetch(`${base}/api/cover-thumbnails?url=http://user:pass@minio.example/x`)).status, 400);
    assert.equal((await fetch(`${base}/api/cover-thumbnails/cache/nope`)).status, 400);
    assert.equal(calls, before);
  });
});

test('a broken or outdated thumbnail service yields an error for the local cover fallback', async () => {
  await fixture(async () => { throw new Error('unreachable'); }, async base => {
    assert.equal((await fetch(`${base}/api/cover-thumbnails?url=https://minio.example/x`)).status, 502);
  });
  await fixture(async () => new Response('{}', { headers: { 'Content-Type': 'application/json' } }), async base => {
    assert.equal((await fetch(`${base}/api/cover-thumbnails?url=https://minio.example/x`)).status, 502);
  });
});
