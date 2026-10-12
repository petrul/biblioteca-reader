import { test } from 'node:test';
import assert from 'node:assert/strict';

// The author page hydrates its works through fetchRealWorkByPath, which
// ALREADY returns a mapped Work - feeding that Work through workFromServerDiv
// a second time produced 51 untitled, 1-chapter, "by Anonymous" cards
// (/app/author/shakespeare). This pins the single-mapping contract.

test('loadAuthorById maps each opus once - hydrated works keep their titles', async () => {
  const originalFetch = globalThis.fetch;
  const globals = globalThis as any;
  const previous = { window: globals.window, location: globals.location, localStorage: globals.localStorage };
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) };
  globals.window = { localStorage: storage, location: { origin: 'http://localhost' }, speechSynthesis: { getVoices: () => [] } };
  globals.location = globals.window.location;
  globals.localStorage = storage;
  const authorDto = {
    strId: 'shakespeare', firstName: 'William', lastName: 'Shakespeare',
    opera: [
      { path: 'shakespeare/macbeth', head: 'Macbeth', wordSize: 15567, depth: 0, id: 4112, urlFragment: 'macbeth' },
      { path: 'shakespeare/otelo', head: 'Otelo', wordSize: 32183, depth: 0, id: 9093, urlFragment: 'otelo' }
    ]
  };
  const divByPath: Record<string, unknown> = {
    'shakespeare/macbeth': { id: 4112, path: 'shakespeare/macbeth', head: 'Macbeth', wordSize: 15567, author: { strId: 'shakespeare', firstName: 'William', lastName: 'Shakespeare', displayName: 'William Shakespeare' }, language: 'de' },
    'shakespeare/otelo': { id: 9093, path: 'shakespeare/otelo', head: 'Otelo', wordSize: 32183, author: { strId: 'shakespeare', firstName: 'William', lastName: 'Shakespeare', displayName: 'William Shakespeare' }, language: 'es' }
  };
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes('/api/authors/')) return Response.json(authorDto);
    if (url.includes('/api/divs')) {
      const path = new URL(url, 'http://localhost').searchParams.get('path') ?? '';
      const div = divByPath[path];
      return div ? Response.json(div) : new Response(null, { status: 404 });
    }
    return new Response(null, { status: 404 });
  }) as typeof fetch;
  try {
    const { readerService } = await import('./readerService');
    await readerService.loadAuthorById('shakespeare');
    const works = readerService.getAuthorWorks('shakespeare');
    assert.equal(works.length, 2, 'both opera entries become works');
    assert.ok(works.every(work => work.title.length > 0), 'every work keeps its title');
    assert.ok(works.every(work => work.chapterCount > 1), 'word sizes survive into chapter counts');
    assert.ok(works.every(work => work.authorName === 'William Shakespeare'), 'the author name is attached');
  } finally {
    globalThis.fetch = originalFetch;
    Object.assign(globals, previous);
  }
});
