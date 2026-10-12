import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SearchResult, SearchMode } from '../types/textbase';

// searchCombined's own contract, independent of any live server (the e2e
// search-view spec covers the view wiring; this pins the aggregation
// semantics that the "Found N matches across all modes" summary relies on):
//
// 1. Tiered ordering: author hits rank before title hits, before lucene,
//    before vector - regardless of which mode answers fastest.
// 2. Cross-mode dedupe by workId::chapterId, first (highest) tier wins.
// 3. One hung mode can never hold up the others: past the per-mode
//    timeout it contributes nothing and the combined result still
//    resolves (mock timers fast-forward the 10s bound).
// 4. A rejecting mode is isolated the same way.
// 5. onUpdate progressively reports the merged-so-far list while modes
//    are still in flight.

class FakeStorage implements Storage {
  private readonly store = new Map<string, string>();
  getItem(key: string): string | null { return this.store.get(key) ?? null; }
  setItem(key: string, value: string): void { this.store.set(key, value); }
  removeItem(key: string): void { this.store.delete(key); }
  clear(): void { this.store.clear(); }
  key(index: number): string | null { return [...this.store.keys()][index] ?? null; }
  get length(): number { return this.store.size; }
}

// Fresh readerService module instance, the randomDiscovery test's own
// pattern (query-suffixed import for clean module state, empty catalog
// answers so nothing in the boot path reaches for a real server).
async function bootReaderService() {
  const storage = new FakeStorage();
  (globalThis as any).localStorage = storage;
  (globalThis as any).window = { localStorage: storage, location: { origin: 'http://localhost' } };
  (globalThis as any).location = { origin: 'http://localhost' };
  (globalThis as any).fetch = () => Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve({ items: [], page: 1, size: 12, totalItems: 0, totalPages: 1 })
  });
  const mod = await import(`./readerService.ts?search-combined=${importSeq++}`);
  return mod.readerService;
}
let importSeq = 0;

type ModeResponse = { results: SearchResult[]; total: number; totalPages: number; mode: SearchMode; tookMs: number };

function result(mode: SearchMode, id: string, chapterId?: string): SearchResult {
  return {
    id: `${mode}-${id}`,
    mode,
    type: chapterId ? 'chapter' : 'work',
    workId: id,
    workTitle: id,
    authorName: 'Fixture Author',
    chapterId,
    snippet: 'fixture',
    language: 'eng'
  };
}

function stubModes(service: any, byMode: Record<string, SearchResult[] | Promise<never>>): void {
  service.searchConnected = (mode: SearchMode) => {
    const stubbed = byMode[mode];
    if (stubbed === undefined) throw new Error(`unexpected mode ${mode}`);
    if (stubbed instanceof Promise) return stubbed;
    const response: ModeResponse = { results: stubbed, total: stubbed.length, totalPages: 1, mode, tookMs: 1 };
    return Promise.resolve(response);
  };
}

test('combined search merges the modes tiered: author, title, lucene, vector', async () => {
  const service = await bootReaderService();
  stubModes(service, {
    author: [result('author', 'papini')],
    title: [result('title', 'testonia-maxima'), result('title', 'testonia-minor')],
    lucene: [result('lucene', 'lucene-hit')],
    vector: [result('vector', 'vector-hit')]
  });

  const combined = await service.searchCombined('testonia');

  assert.deepEqual(combined.map(r => r.workId), [
    'papini',            // tier 1a: author first
    'testonia-maxima',   // tier 1b: title
    'testonia-minor',
    'lucene-hit',        // tier 2
    'vector-hit'         // tier 3
  ]);
});

test('the same work+chapter from a lower tier never duplicates a higher-tier hit', async () => {
  const service = await bootReaderService();
  stubModes(service, {
    title: [result('title', 'same-work', 'same/chapter')],
    lucene: [result('lucene', 'same-work', 'same/chapter')],
    vector: [result('vector', 'same-work', 'other/chapter')],
    author: []
  });

  const combined = await service.searchCombined('dupes');

  assert.deepEqual(combined.map(r => `${r.workId}::${r.chapterId}`), [
    'same-work::same/chapter',   // title tier wins
    'same-work::other/chapter'   // different chapter is a distinct result
  ]);
});

test('one hung mode falls back to nothing at the per-mode timeout and never blocks the others', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const service = await bootReaderService();
  stubModes(service, {
    author: [result('author', 'author-hit')],
    title: [result('title', 'title-hit')],
    lucene: [result('lucene', 'lucene-hit')],
    vector: new Promise<never>(() => { /* hangs forever, like a GPU-contended vector backend */ })
  });

  const updates: SearchResult[][] = [];
  const combinedPromise = service.searchCombined('slow-vector', 5, results => updates.push([...results]));
  // Let the fast modes settle (microtasks only - their timers are cleared),
  // then fast-forward past the 10s per-mode bound: the hung vector mode
  // contributes its empty fallback and the combined result resolves.
  await new Promise(resolve => setImmediate(resolve));
  t.mock.timers.tick(10_000);
  const combined = await combinedPromise;
  t.mock.timers.reset();

  assert.deepEqual(combined.map(r => r.workId), ['author-hit', 'title-hit', 'lucene-hit']);
  // The progressive updates were live during the search, not only at the end.
  assert.ok(updates.length >= 1, 'onUpdate fired before the final merge');
});

test('a rejecting mode is isolated: the others still compose the combined result', async () => {
  const service = await bootReaderService();
  stubModes(service, {
    author: [result('author', 'author-hit')],
    title: [result('title', 'title-hit')],
    lucene: Promise.reject(new Error('lucene backend down')),
    vector: [result('vector', 'vector-hit')]
  });

  const combined = await service.searchCombined('failing-mode');

  assert.deepEqual(combined.map(r => r.workId), ['author-hit', 'title-hit', 'vector-hit']);
});
