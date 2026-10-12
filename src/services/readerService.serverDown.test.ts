import { test } from 'node:test';
import assert from 'node:assert/strict';

// The server-down contract for chapter reading, locked after a dead
// biblioteca-server left the reader spinning forever on "tap next" with no
// declaration: a content load that cannot arrive must (a) stop counting as
// "still streaming" (isChapterContentFailed - ReaderView shows its
// not-available state instead of an eternal spinner) and (b) report the
// failed request directly, without retrieving browse pages, so the
// ServerStatusToast declares the outage. Recovery follows the toast's own
// Retry path: retryServerConnection, then the chapter loads on demand.

// countNotes parses the fetched chapter HTML with DOMParser - Node has none.
(globalThis as any).DOMParser = class {
  parseFromString(): { querySelectorAll: () => [] } {
    return { querySelectorAll: () => [] };
  }
};

class FakeStorage implements Storage {
  private readonly store = new Map<string, string>();
  getItem(key: string): string | null { return this.store.get(key) ?? null; }
  setItem(key: string, value: string): void { this.store.set(key, value); }
  removeItem(key: string): void { this.store.delete(key); }
  clear(): void { this.store.clear(); }
  key(index: number): string | null { return [...this.store.keys()][index] ?? null; }
  get length(): number { return this.store.size; }
}

const WORK = 'ariosto_ludovico/orlando_furioso';
const CH14 = `${WORK}/canto_diciottesimo/14`;
const CH15 = `${WORK}/canto_diciottesimo/15`;

function emptyPage() {
  return { items: [], page: 1, size: 12, totalItems: 0, totalPages: 1 };
}

function healthyFetch(input: RequestInfo | URL): Promise<Response> {
  const url = String(input instanceof Request ? input.url : input);
  if (url.includes('/api/divs/42/toc')) {
    return Promise.resolve(Response.json([
      { leaf: true, path: CH14, head: 'Canto XVIII, 14' },
      { leaf: true, path: CH15, head: 'Canto XVIII, 15' }
    ]));
  }
  if (url.includes('/api/divs') && url.includes(`path=${WORK.split('/').map(encodeURIComponent).join('%2F')}`)) {
    return Promise.resolve(Response.json({
      id: 42, opus: true, path: WORK, head: 'Orlando Furioso', lang: 'it',
      author: { strId: 'ariosto_ludovico', firstName: 'Ludovico', lastName: 'Ariosto' }
    }));
  }
  if (url.includes('/api/authors/page')) return Promise.resolve(Response.json(emptyPage()));
  if (url.includes('/api/lucene/status')) return Promise.resolve(Response.json({}));
  if (url.includes('/api/works')) return Promise.resolve(Response.json(emptyPage()));
  if (url.includes('/api/collections/system/repos')) return Promise.resolve(Response.json([]));
  if (url.includes('/api/collections/system/featured')) return Promise.resolve(Response.json([]));
  if (url.includes(`/api/server-content/${CH14}.txt`)) return Promise.resolve(new Response('fourteen text'));
  if (url.includes(`/api/server-content/${CH14}.xml`)) return Promise.resolve(new Response('<tei/>'));
  if (url.includes(`/api/server-content/${CH14}.json`)) return Promise.resolve(new Response('{}'));
  if (url.includes(`/api/server-content/${CH14}.html`)) return Promise.resolve(new Response('<p>14</p>'));
  if (url.includes(`/api/server-content/${CH15}.txt`)) return Promise.resolve(new Response('fifteen text'));
  if (url.includes(`/api/server-content/${CH15}.xml`)) return Promise.resolve(new Response('<tei/>'));
  if (url.includes(`/api/server-content/${CH15}.json`)) return Promise.resolve(new Response('{}'));
  if (url.includes(`/api/server-content/${CH15}.html`)) return Promise.resolve(new Response('<p>15</p>'));
  return Promise.resolve(new Response('', { status: 404 }));
}

// What the reader's own proxy answers when the upstream is unreachable:
// 502 with an error body - the same shape a genuinely dead server produces.
function deadFetch(): Promise<Response> {
  return Promise.resolve(new Response('{"error":"biblioteca-server unreachable"}', { status: 502 }));
}

async function until(cond: () => boolean, what: string, timeoutMs = 10000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!cond()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for: ${what}`);
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

let importSeq = 0;

async function boot(fetchImpl: (input: RequestInfo | URL) => Promise<Response>) {
  const storage = new FakeStorage();
  (globalThis as any).localStorage = storage;
  (globalThis as any).window = { localStorage: storage, location: { origin: 'http://localhost' } };
  (globalThis as any).location = { origin: 'http://localhost' };
  (globalThis as any).fetch = fetchImpl;
  importSeq += 1;
  const mod = await import(`./readerService.ts?serverDownTest=${importSeq}`);
  await new Promise(resolve => setTimeout(resolve, 0));
  await new Promise(resolve => setTimeout(resolve, 0));
  return mod;
}

test('a failed chapter-content load declares the server down instead of loading forever', async () => {
  const { readerService } = await boot(healthyFetch);

  // Warm the work, its TOC, and the first chapter while the server is up.
  readerService.getWorkById(WORK);
  await until(() => readerService.getWorkById(WORK) !== undefined, 'work fetch');
  readerService.getChaptersForWork(WORK);
  await until(() => readerService.getChaptersForWork(WORK).length === 2, 'TOC fetch');
  readerService.getChapter(WORK, CH14);
  await until(() => readerService.getChapter(WORK, CH14)?.plainText === 'fourteen text', 'first chapter content');
  assert.equal(readerService.isServerDown(), false);
  assert.equal(readerService.isChapterContentFailed(CH15), false);

  // The server dies mid-session; the user taps next. Without the failure
  // marker plus request failure reporting this spun forever with no toast.
  (globalThis as any).fetch = deadFetch;
  readerService.getChapter(WORK, CH15);
  await until(() => readerService.isChapterContentFailed(CH15), 'content failure marker');
  await until(() => readerService.isServerDown(), 'serverDown declared for the toast');

  // Recovery goes through the toast's own Retry: the status check clears
  // serverDown, and the previously failed chapter loads on demand.
  (globalThis as any).fetch = healthyFetch;
  await readerService.retryServerConnection();
  assert.equal(readerService.isServerDown(), false);
  readerService.getChapter(WORK, CH15);
  await until(() => readerService.getChapter(WORK, CH15)?.plainText === 'fifteen text'
    && !readerService.isChapterContentFailed(CH15), 'recovered chapter content');
});
