import { test } from 'node:test';
import assert from 'node:assert/strict';

// The authors PAGE listing puts authors into realAuthors WITHOUT their
// works. loadAuthorById's old skip-guard tested only "is the author in
// realAuthors" - so after browsing the catalog, clicking an author
// no-op'ed and the author page showed 0 works (/app/author/adler).
// Only a FULLY HYDRATED author (opera fetched, works mapped) may skip.

test('author page still hydrates works after the authors listing loaded the author', async () => {
  const originalFetch = globalThis.fetch;
  const globals = globalThis as any;
  const previous = { window: globals.window, location: globals.location, localStorage: globals.localStorage };
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) };
  globals.window = { localStorage: storage, location: { origin: 'http://localhost' }, speechSynthesis: { getVoices: () => [] } };
  globals.location = globals.window.location;
  globals.localStorage = storage;
  const adlerDto = { strId: 'adler', firstName: 'Alfred', lastName: 'Adler', displayName: 'Alfred Adler' };
  const opusDto = { path: 'adler/psihologia', head: 'Psihologia şcolarului greu educabil', wordSize: 79238, depth: 0, id: 42284, urlFragment: 'psihologia' };
  const divDto = { id: 42284, path: 'adler/psihologia', head: 'Psihologia şcolarului greu educabil', wordSize: 79238, author: { strId: 'adler', firstName: 'Alfred', lastName: 'Adler', displayName: 'Alfred Adler' }, language: 'ron' };
  let authorDetailHits = 0;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes('/api/authors/page')) {
      if (new URL(url).searchParams.get('page') === '2') {
        return Response.json({ items: [{ strId: 'about', displayName: 'Edmond About' }], page: 2, size: 12, totalItems: 13, totalPages: 2 });
      }
      return Response.json({ items: [adlerDto], page: 1, size: 12, totalItems: 1, totalPages: 1 });
    }
    if (url.includes('/api/works')) {
      return Response.json({ items: [], page: 1, size: 12, totalItems: 0, totalPages: 1 });
    }
    if (url.includes('/api/authors/adler')) {
      authorDetailHits++;
      return Response.json({ ...adlerDto, opera: [opusDto] });
    }
    if (url.includes('/api/divs')) return Response.json(divDto);
    return new Response(null, { status: 404 });
  }) as typeof fetch;
  try {
    const { readerService } = await import('./readerService');
    await readerService.loadAuthorsPage(1, '');
    assert.ok(readerService.getAuthorById('adler'), 'the listing put adler into realAuthors');
    assert.equal(readerService.getAuthorWorks('adler').length, 0, 'the listing carries no works');

    await readerService.loadAuthorById('adler');
    const works = readerService.getAuthorWorks('adler');
    assert.equal(works.length, 1, 'the page visit hydrates the works despite the listing');
    assert.ok(works[0].title.length > 0, 'the work keeps its title');
    assert.equal(works[0].chapterCount > 1, true, 'and its word-based chapter count');

    await readerService.loadAuthorById('adler');
    assert.equal(authorDetailHits, 1, 'a fully hydrated author still skips the refetch');

    // Catalogue pagination (including a response arriving after navigation)
    // replaces its visible page, not the hydrated author detail.
    await readerService.loadWorksPage(1);
    await readerService.loadAuthorsPage(2);
    assert.equal(readerService.getWorks().works.length, 0, 'catalogue retains its own empty page');
    await readerService.loadAuthorById('adler');
    assert.equal(readerService.getAuthorById('adler')?.name, 'Alfred Adler', 'author survives unrelated author-page pagination');
    assert.equal(readerService.getAuthorWorks('adler').length, 1, 'hydrated works survive catalogue pagination and revisiting');
    assert.equal(authorDetailHits, 1, 'retained detail does not require extra requests');
  } finally {
    globalThis.fetch = originalFetch;
    Object.assign(globals, previous);
  }
});
