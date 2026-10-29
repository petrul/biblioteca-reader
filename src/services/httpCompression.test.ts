import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import test from 'node:test';
import express from 'express';
import { responseCompression } from './httpCompression';

// The reader compresses by default, itself - not only behind Caddy.
// Raw node:http requests, so the encoding on the wire is what we see
// (fetch would decode it transparently).

const bigJson = JSON.stringify(Array.from({ length: 2000 }, (_, i) => ({ path: `ariosto_ludovico/orlando_furioso/canto_${i}`, leaf: true })));

async function withApp(run: (port: number) => Promise<void>) {
  const app = express();
  app.use(responseCompression());
  app.get('/toc', (_req, res) => res.type('json').send(bigJson));
  app.get('/small', (_req, res) => res.type('json').send('{"ok":true}'));
  app.get('/page', (_req, res) => res.type('html').send(`<html>${'<p>stanza</p>'.repeat(500)}</html>`));
  app.get('/cover.png', (_req, res) => res.type('png').send(Buffer.alloc(50_000, 7)));
  const server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Server did not bind a TCP port');
  try { await run(address.port); }
  finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}

function get(port: number, path: string, acceptEncoding?: string) {
  return new Promise<{ encoding: string | undefined; bytes: number }>((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, path, headers: acceptEncoding ? { 'Accept-Encoding': acceptEncoding } : {} }, res => {
      let bytes = 0;
      res.on('data', chunk => { bytes += chunk.length; });
      res.on('end', () => resolve({ encoding: res.headers['content-encoding'], bytes }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('a large JSON response is compressed, to a fraction of its size', async () => {
  await withApp(async port => {
    const gzip = await get(port, '/toc', 'gzip');
    assert.equal(gzip.encoding, 'gzip');
    assert.ok(gzip.bytes < Buffer.byteLength(bigJson) / 5, `${gzip.bytes} B on the wire for ${Buffer.byteLength(bigJson)} B of JSON`);
    assert.equal((await get(port, '/toc', 'br, gzip')).encoding, 'br', 'Brotli when the client accepts it');
  });
});

test('pages are compressed too', async () => {
  await withApp(async port => assert.equal((await get(port, '/page', 'gzip')).encoding, 'gzip'));
});

test('small responses, images and clients not asking for it get the bytes as they are', async () => {
  await withApp(async port => {
    assert.equal((await get(port, '/small', 'gzip')).encoding, undefined, 'under 1 KB');
    assert.equal((await get(port, '/cover.png', 'gzip')).encoding, undefined, 'already compressed format');
    const plain = await get(port, '/toc');
    assert.equal(plain.encoding, undefined, 'no Accept-Encoding');
    assert.equal(plain.bytes, Buffer.byteLength(bigJson));
  });
});
