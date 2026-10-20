import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { BibliotecaServerProxy } from './BibliotecaServerProxy.ts';

// The random-discovery button's reader-side contract, in two halves:
//
// 1. BibliotecaServerProxy must relay the server's /util/random redirect as
//    DATA (200 + {location} JSON, no Location header). A browser fetch()
//    auto-follows any Location on a 3xx - off-origin to the server's own
//    HTML page or a CORS failure - so the client would never see the JSON.
//    It must also keep remapping the public /api/util/random path to the
//    server's unprefixed /util/random upstream.
// 2. getRandomDiscovery must report the chapterId as the COMPLETE stable
//    path (author/opus/divs...), the same shape as parseAppPath's
//    /app/reader deep links and the div.path chapter ids from
//    fetchRealChaptersForWork. An opus-relative id builds URLs missing the
//    author and never matches a chapter, which the reader surfaces as
//    "chapter not available".

class FakeStorage implements Storage {
  private readonly store = new Map<string, string>();
  getItem(key: string): string | null { return this.store.get(key) ?? null; }
  setItem(key: string, value: string): void { this.store.set(key, value); }
  removeItem(key: string): void { this.store.delete(key); }
  clear(): void { this.store.clear(); }
  key(index: number): string | null { return [...this.store.keys()][index] ?? null; }
  get length(): number { return this.store.size; }
}

function emptyPage() {
  return { items: [], page: 1, size: 12, totalItems: 0, totalPages: 1 };
}

let importSeq = 0;

// Boots a fresh readerService module instance (the catalogCache test's own
// pattern: query-suffixed dynamic import for clean module state) against a
// fake fetch that settles the boot catalog with empty pages and answers
// /api/util/random with the given location - null means a failed upstream.
async function bootWithRandomLocation(location: string | null) {
  const storage = new FakeStorage();
  (globalThis as any).localStorage = storage;
  (globalThis as any).window = { localStorage: storage, location: { origin: 'http://localhost' } };
  (globalThis as any).location = { origin: 'http://localhost' };
  (globalThis as any).fetch = (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes('/api/util/random')) {
      return location
        ? Response.json({ location })
        : new Response('', { status: 404 });
    }
    if (url.includes('/api/authors/page')) return Response.json(emptyPage());
    if (url.includes('/api/works')) return Response.json(emptyPage());
    if (url.includes('/api/collections/system/repos')) return Response.json([]);
    if (url.includes('/api/collections/system/featured')) return Response.json([]);
    return new Response('', { status: 404 });
  };
  importSeq += 1;
  const mod = await import(`./readerService.ts?randomDiscoveryTest=${importSeq}`);
  await new Promise(resolve => setTimeout(resolve, 0));
  await new Promise(resolve => setTimeout(resolve, 0));
  return mod;
}

test('chapterId is the complete stable path, author and opus included', async () => {
  const { readerService } = await bootWithRandomLocation(
    'http://localhost:8080/hugo/correspondanceii/1867_3/a_francois_victor_7');
  const discovery = await readerService.getRandomDiscovery();
  assert.equal(discovery.type, 'chapter');
  assert.equal(discovery.workId, 'hugo/correspondanceii');
  assert.equal(discovery.chapterId, 'hugo/correspondanceii/1867_3/a_francois_victor_7');
});

test('deeply nested div chains keep every ancestor segment in the chapterId', async () => {
  // A root div whose urlFragment differs from the opus strId adds a level:
  // the regression shape that produced /app/reader/doi_morti_vii/... URLs
  // missing the author. The complete path must survive intact.
  const { readerService } = await bootWithRandomLocation(
    'http://localhost:8080/anon/biblia_ortodoxa/vechiul_testament/ii_paralipomena_ii_cronici/pregatiri_de_razboi');
  const discovery = await readerService.getRandomDiscovery();
  assert.equal(discovery.workId, 'anon/biblia_ortodoxa');
  assert.equal(
    discovery.chapterId,
    'anon/biblia_ortodoxa/vechiul_testament/ii_paralipomena_ii_cronici/pregatiri_de_razboi');
});

test('a work with no chapter breakdown is its own single chapter', async () => {
  // parseAppPath accepts /app/reader/author/opus as a reader deep link whose
  // chapter path equals the work path (see fetchRealChaptersForWork's
  // "[root]" fallback) - the random pick must use the same shape.
  const { readerService } = await bootWithRandomLocation('http://localhost:8080/negri_ada/fatalita');
  const discovery = await readerService.getRandomDiscovery();
  assert.equal(discovery.type, 'chapter');
  assert.equal(discovery.workId, 'negri_ada/fatalita');
  assert.equal(discovery.chapterId, 'negri_ada/fatalita');
});

test('percent-encoded path segments are decoded', async () => {
  const { readerService } = await bootWithRandomLocation(
    'http://localhost:8080/anon/la_bible_ancien_testament/le_livre_du_proph%C3%A8te_j%C3%A9r%C3%A9mie/chapitre_3');
  const discovery = await readerService.getRandomDiscovery();
  assert.equal(discovery.workId, 'anon/la_bible_ancien_testament');
  assert.equal(discovery.chapterId,
    'anon/la_bible_ancien_testament/le_livre_du_prophète_jérémie/chapitre_3');
});

test('a failed upstream resolves to an empty discovery, not a throw', async () => {
  const { readerService } = await bootWithRandomLocation(null);
  const discovery = await readerService.getRandomDiscovery();
  assert.deepEqual(discovery, { type: 'work', workId: '' });
});

// --- BibliotecaServerProxy relay contract ---

// Node's real fetch, captured before any test stubs globalThis.fetch (the
// readerService boots above replace it without restoring). The proxy tests
// need it to talk to the local express app; the stub stays reserved for the
// proxy's own upstream calls.
const nodeFetch = globalThis.fetch.bind(globalThis);

test('an upstream redirect is relayed as data, never as a browser-followable redirect', async () => {
  const location = 'http://localhost:8080/hugo/correspondanceii/1867_3/a_francois_victor_7';
  let requestedUrl = '';
  const realFetch = globalThis.fetch;
  (globalThis as any).fetch = async (input: any, init?: any) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes('upstream.test')) {
      requestedUrl = url;
      return new Response(null, { status: 302, headers: { Location: location } });
    }
    return nodeFetch(input, init);
  };
  const app = express();
  new BibliotecaServerProxy('http://upstream.test').register(app);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  try {
    const { port } = server.address() as AddressInfo;
    const res = await nodeFetch(`http://127.0.0.1:${port}/api/util/random`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('location'), null);
    assert.deepEqual(await res.json(), { location });
    // The public /api/util/random path is remapped to the server's own
    // unprefixed /util/random upstream.
    assert.equal(requestedUrl, 'http://upstream.test/util/random');
  } finally {
    server.close();
    (globalThis as any).fetch = realFetch;
  }
});

test('an upstream READER (dev profile pointed at the public prod URL) is asked on the public path after a 404', async () => {
  const location = 'http://server:8080/goethe/afinitatile_elective/partea_a_doua/capitolul_i';
  const requestedUrls: string[] = [];
  const realFetch = globalThis.fetch;
  (globalThis as any).fetch = async (input: any, init?: any) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes('upstream.test')) {
      requestedUrls.push(url);
      // The prod reader serves only /api/util/random, already as data.
      return url.endsWith('/api/util/random') ? Response.json({ location }) : new Response('', { status: 404 });
    }
    return nodeFetch(input, init);
  };
  const app = express();
  new BibliotecaServerProxy('http://upstream.test').register(app);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  try {
    const { port } = server.address() as AddressInfo;
    const res = await nodeFetch(`http://127.0.0.1:${port}/api/util/random`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { location });
    assert.deepEqual(requestedUrls, ['http://upstream.test/util/random', 'http://upstream.test/api/util/random']);
  } finally {
    server.close();
    (globalThis as any).fetch = realFetch;
  }
});

test('non-redirect upstream responses pass through with status and body intact', async () => {
  const realFetch = globalThis.fetch;
  (globalThis as any).fetch = async (input: any, init?: any) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes('upstream.test')) {
      return Response.json({ hello: 'world' }, { status: 200 });
    }
    return nodeFetch(input, init);
  };
  const app = express();
  new BibliotecaServerProxy('http://upstream.test').register(app);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  try {
    const { port } = server.address() as AddressInfo;
    const res = await nodeFetch(`http://127.0.0.1:${port}/api/lucene/status`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { hello: 'world' });
  } finally {
    server.close();
    (globalThis as any).fetch = realFetch;
  }
});
