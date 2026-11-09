import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { divisionPathOf, readerLocation, registerRelocationRedirects, relocatedPagePath, relocationLookup } from './relocationRedirect';

// A division relocated by a TEI reimport (biblioteca-server's Relocation):
// what the reader's server makes of it.

test('an upstream Location becomes a path on this origin, content pages under their prefix', () => {
  assert.equal(readerLocation('http://localhost:8080/a/w/new.html?depth=0&fragments=1', true), '/api/server-content/a/w/new.html?depth=0&fragments=1');
  assert.equal(readerLocation('http://localhost:8080/api/divs?path=a/w/new', false), '/api/divs?path=a/w/new');
  assert.equal(readerLocation('/a/w/new', false), '/a/w/new');
});

test('reader pages name their division; other pages none', () => {
  assert.equal(divisionPathOf('/shakespeare/the_tragedy/act_iv/another'), '/shakespeare/the_tragedy/act_iv/another');
  assert.equal(divisionPathOf('/app/reader/shakespeare/the_tragedy/act_iv'), '/shakespeare/the_tragedy/act_iv');
  assert.equal(divisionPathOf('/app/work/shakespeare/the_tragedy'), '/shakespeare/the_tragedy');
  assert.equal(divisionPathOf('/app/catalog'), null);
  assert.equal(divisionPathOf('/shakespeare'), null); // an author page
});

test('the new page keeps the old URL form and query', () => {
  assert.equal(relocatedPagePath('/a/w/old', '/a/w/new', '?p=3'), '/a/w/new?p=3');
  assert.equal(relocatedPagePath('/app/reader/a/w/old', '/a/w/new'), '/app/reader/a/w/new');
  assert.equal(relocatedPagePath('/app/work/a/old', '/a/new'), '/app/work/a/new');
});

test('the lookup asks the server, and any failure is "not relocated"', async () => {
  const asked: string[] = [];
  const answering = (status: number, body: unknown): typeof fetch => (async (url: string | URL | Request) => {
    asked.push(String(url));
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  assert.equal(await relocationLookup('http://srv', 1000, answering(200, { newPath: '/a/w/new' }))('/a/w/old'), '/a/w/new');
  assert.equal(asked[0], 'http://srv/api/relocations?path=%2Fa%2Fw%2Fold');
  assert.equal(await relocationLookup('http://srv', 1000, answering(404, {}))('/a/w/old'), null);
  assert.equal(await relocationLookup('http://srv', 1000, answering(200, { newPath: 'no-slash' }))('/a/w/old'), null);
  const failing = (async () => { throw new Error('down'); }) as typeof fetch;
  assert.equal(await relocationLookup('http://srv', 1000, failing)('/a/w/old'), null);
});

test('an old address answers 301 - pages, text editions, exports; everything else passes through', async () => {
  const app = express();
  registerRelocationRedirects(app, async path => (path === '/a/w/old' ? '/a/w/new' : null));
  app.get('*', (_req, res) => res.send('reader app'));
  const server = app.listen(0);
  const { port } = server.address() as { port: number };
  const get = (path: string, accept = 'text/html') => fetch(`http://127.0.0.1:${port}${path}`, { redirect: 'manual', headers: { accept } });
  try {
    let response = await get('/a/w/old?p=2');
    assert.equal(response.status, 301);
    assert.equal(response.headers.get('location'), '/a/w/new?p=2');
    response = await get('/app/reader/a/w/old');
    assert.equal(response.headers.get('location'), '/app/reader/a/w/new');
    assert.equal((await get('/a/w/live')).status, 200);
    assert.equal((await get('/app/catalog')).status, 200);
    assert.equal((await get('/a/w/old', 'application/json')).headers.get('location'), '/a/w/new'); // a crawler's JSON twin too
    assert.equal((await get('/a/w/old.txt', '*/*')).headers.get('location'), '/a/w/new.txt');
    assert.equal((await get('/api/divs')).status, 200); // the API is the proxy's business
  } finally {
    server.close();
  }
});
