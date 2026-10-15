import { test } from 'node:test';
import assert from 'node:assert/strict';

// The reader deliberately does not persist or hydrate a full catalogue. It
// asks the server for the visible page instead, so these tests exercise the
// online-first boot path and page navigation rather than an obsolete cache.

class FakeStorage implements Storage {
  private readonly store = new Map<string, string>();
  getItem(key: string): string | null { return this.store.get(key) ?? null; }
  setItem(key: string, value: string): void { this.store.set(key, value); }
  removeItem(key: string): void { this.store.delete(key); }
  clear(): void { this.store.clear(); }
  key(index: number): string | null { return [...this.store.keys()][index] ?? null; }
  get length(): number { return this.store.size; }
}

let importSeq = 0;

function page<T>(items: T[], pageNumber = 1, totalItems = items.length) {
  return { items, page: pageNumber, size: 12, totalItems, totalPages: Math.max(1, Math.ceil(totalItems / 12)) };
}

async function boot(fetchImpl: (url: string) => Promise<Response>) {
  const storage = new FakeStorage();
  storage.setItem('textbase.reader.catalog.v2', JSON.stringify({
    works: [{ id: 'stale/work', title: 'Must not hydrate' }],
    authors: [{ id: 'stale', name: 'Must not hydrate' }],
    savedAt: Date.now()
  }));
  (globalThis as any).localStorage = storage;
  (globalThis as any).window = { localStorage: storage, location: { origin: 'http://localhost' } };
  (globalThis as any).location = { origin: 'http://localhost' };
  (globalThis as any).fetch = (input: RequestInfo | URL) => fetchImpl(String(input instanceof Request ? input.url : input));
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    importSeq += 1;
    const mod = await import(`./readerService.ts?onlineFirstTest=${importSeq}`);
    await new Promise(resolve => setTimeout(resolve, 0));
    await new Promise(resolve => setTimeout(resolve, 0));
    return { mod, storage };
  } finally {
    console.warn = originalWarn;
  }
}

test('boot makes no catalogue requests and ignores persisted full-catalog snapshots', async () => {
  const requests: string[] = [];
  const { mod, storage } = await boot(async url => {
    requests.push(url);
    if (url.includes('/api/authors/page')) return Response.json(page([]));
    if (url.includes('/api/works')) return Response.json(page([]));
    if (url.includes('/api/collections/system/repos')) return Response.json([]);
    if (url.includes('/api/collections/system/featured')) return Response.json([]);
    return new Response('', { status: 404 });
  });

  assert.deepEqual(requests, []);
  assert.equal(mod.readerService.getAuthors().total, 0);
  assert.equal(mod.readerService.getWorks().total, 0);
  assert.equal(mod.readerService.isServerDown(), false);
  assert.ok(storage.getItem('textbase.reader.catalog.v2'));
});

test('page navigation replaces the in-memory page and uses the server totals', async () => {
  const requests: string[] = [];
  const { mod } = await boot(async url => {
    requests.push(url);
    if (url.includes('/api/authors/page')) {
      const requestedPage = new URL(url, 'http://localhost').searchParams.get('page');
      return Response.json(page([{ strId: `author-${requestedPage}`, displayName: `Author ${requestedPage}` }], Number(requestedPage), 25));
    }
    if (url.includes('/api/works')) {
      const requestedPage = new URL(url, 'http://localhost').searchParams.get('page');
      return Response.json(page([{ completePath: `author/work-${requestedPage}`, head: `Work ${requestedPage}`, opus: true }], Number(requestedPage), 25));
    }
    if (url.includes('/api/collections/system/repos')) return Response.json([]);
    if (url.includes('/api/collections/system/featured')) return Response.json([]);
    return new Response('', { status: 404 });
  });

  await mod.readerService.loadAuthorsPage(2);
  await mod.readerService.loadWorksPage(2);
  assert.equal(mod.readerService.getAuthors().authors[0]?.id, 'author-2');
  assert.equal(mod.readerService.getAuthors().total, 25);
  assert.equal(mod.readerService.getWorks().works[0]?.id, 'author/work-2');
  assert.equal(mod.readerService.getWorks().totalPages, 3);
  assert.ok(requests.some(url => url.includes('/api/authors/page?page=2')));
  assert.ok(requests.some(url => url.includes('/api/works?page=2')));
});

test('a missing work deep link makes one targeted request and never retrieves listings', async () => {
  const requests: string[] = [];
  const { mod } = await boot(async url => {
    requests.push(url);
    return new Response(null, { status: 404 });
  });
  for (let render = 0; render < 5; render += 1) {
    assert.equal(mod.readerService.getWorkById('zevaco/buridan'), undefined);
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  assert.equal(requests.length, 1);
  assert.match(requests[0], /\/api\/divs\?path=zevaco%2Fburidan/);
  assert.equal(mod.readerService.isWorkLoading('zevaco/buridan'), false);
  assert.equal(mod.readerService.isServerDown(), false);
  // Explicit connection checks also must not download any listings or retry a 404.
  (globalThis as any).fetch = async (input: RequestInfo | URL) => {
    requests.push(String(input));
    return Response.json({});
  };
  await mod.readerService.retryServerConnection();
  mod.readerService.getWorkById('zevaco/buridan');
  assert.equal(requests.length, 2);
  assert.equal(requests[1], '/api/lucene/status');
});

test('a failed TOC request is not retried on every render', async () => {
  const storage = new FakeStorage();
  (globalThis as any).localStorage = storage;
  (globalThis as any).window = { localStorage: storage, location: { origin: 'http://localhost' } };
  (globalThis as any).location = { origin: 'http://localhost' };
  let tocRequests = 0;
  (globalThis as any).fetch = async (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes('/api/divs')) tocRequests += 1;
    if (url.includes('/api/authors/page')) return Response.json(page([]));
    if (url.includes('/api/works')) return Response.json(page([{ completePath: 'author/work', head: 'Work', opus: true }]));
    if (url.includes('/api/collections/system/repos')) return Response.json([]);
    if (url.includes('/api/collections/system/featured')) return Response.json([]);
    return new Response('', { status: 500 });
  };
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    importSeq += 1;
    const mod = await import(`./readerService.ts?onlineFirstTocFailure=${importSeq}`);
    await new Promise(resolve => setTimeout(resolve, 0));
    await mod.readerService.loadWorksPage(1);
    mod.readerService.getChaptersForWork('author/work');
    await new Promise(resolve => setTimeout(resolve, 0));
    mod.readerService.getChaptersForWork('author/work');
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(tocRequests, 1);
    assert.equal(mod.readerService.chapterLoadFailed('author/work'), true);
  } finally {
    console.warn = originalWarn;
  }
});

test('a new cover shows on an already-loaded catalog page without fetching it again', async () => {
  const requests: string[] = [];
  const { mod } = await boot(async url => {
    requests.push(url);
    if (url.includes('/api/works')) {
      return Response.json(page([
        { completePath: 'freud/das_motiv', head: 'Das Motiv', opus: true, coverUrl: 'https://minio/covers/freud/das_motiv-old.png' },
        { completePath: 'freud/other', head: 'Other', opus: true, coverUrl: 'https://minio/covers/freud/other-a.png' },
      ], 3, 30));
    }
    if (url.includes('/api/collections/system/')) return Response.json([]);
    return new Response('', { status: 404 });
  });

  await mod.readerService.loadWorksPage(3);
  const byId = (id: string) => mod.readerService.getWorks().works.find((work: any) => work.id === id);
  assert.equal(byId('freud/das_motiv')?.coverImage, 'https://minio/covers/freud/das_motiv-old.png');
  const fetched = requests.length;

  // The admin's "Generate cover" on the work card
  mod.readerService.setWorkCover('freud/das_motiv', 'https://minio/covers/freud/das_motiv-new.png');

  // Back on the same catalog page: same page key, so it is not fetched again...
  await mod.readerService.loadWorksPage(3);
  assert.equal(requests.length, fetched);
  // ...and it still shows the new cover; other works keep theirs.
  assert.equal(byId('freud/das_motiv')?.coverImage, 'https://minio/covers/freud/das_motiv-new.png');
  assert.equal(byId('freud/other')?.coverImage, 'https://minio/covers/freud/other-a.png');
});
