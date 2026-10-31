import { test } from 'node:test';
import assert from 'node:assert/strict';

// The guest home page's Discover shelf: a random sample drawn by the server
// (/api/collections/system/discover), fetched once per page load so the
// shelf stays put while the reader browses, and held like the featured
// shelf - its works resolve by id and follow cover changes.

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

const div = (author: string, opus: string, head: string) => ({
  id: importSeq * 100 + head.length, head, path: `${author}/${opus}`, completePath: `${author}/${opus}`,
  opus: true, wordSize: 1000, author: { strId: author, displayName: author }
});

async function boot(discover: () => Promise<Response>) {
  const storage = new FakeStorage();
  const requests: string[] = [];
  (globalThis as any).localStorage = storage;
  (globalThis as any).window = { localStorage: storage, location: { origin: 'http://localhost' } };
  (globalThis as any).location = { origin: 'http://localhost' };
  (globalThis as any).fetch = (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input);
    requests.push(url);
    if (url.includes('/api/collections/system/discover')) return discover();
    return Promise.resolve(new Response('', { status: 404 }));
  };
  importSeq += 1;
  const mod = await import(`./readerService.ts?discoverTest=${importSeq}`);
  return { readerService: mod.readerService, requests };
}

const settle = () => new Promise(resolve => setTimeout(resolve, 0));

test('the Discover shelf asks the server for 20 random works, once per page load', async () => {
  const { readerService, requests } = await boot(async () => Response.json([
    div('creanga', 'amintiri', 'Amintiri din copilărie'),
    div('plato', 'apology', 'Apology')
  ]));

  assert.deepEqual(readerService.getDiscoverWorks(), []);
  assert.equal(readerService.isDiscoverLoading(), true);
  await settle(); await settle();

  assert.equal(readerService.isDiscoverLoading(), false);
  assert.deepEqual(readerService.getDiscoverWorks().map((w: { id: string }) => w.id), ['creanga/amintiri', 'plato/apology']);
  readerService.getDiscoverWorks();
  readerService.getDiscoverWorks();
  const discoverRequests = requests.filter(url => url.includes('/system/discover'));
  assert.equal(discoverRequests.length, 1);
  assert.match(discoverRequests[0], /[?&]size=20\b/);
});

test('Discover works resolve by id and follow a regenerated cover', async () => {
  const { readerService } = await boot(async () => Response.json([div('plato', 'apology', 'Apology')]));
  readerService.getDiscoverWorks();
  await settle(); await settle();

  assert.equal(readerService.getWorkById('plato/apology')?.title, 'Apology');
  readerService.setWorkCover('plato/apology', 'https://covers.test/apology.png');
  assert.equal(readerService.getDiscoverWorks()[0].coverImage, 'https://covers.test/apology.png');
});

test('a failed Discover request ends loading with an empty shelf instead of spinning', async () => {
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    const { readerService } = await boot(async () => new Response('', { status: 500 }));
    readerService.getDiscoverWorks();
    await settle(); await settle();
    assert.equal(readerService.isDiscoverLoading(), false);
    assert.deepEqual(readerService.getDiscoverWorks(), []);
  } finally {
    console.warn = originalWarn;
  }
});
