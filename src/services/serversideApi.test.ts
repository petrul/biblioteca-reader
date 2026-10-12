import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { authorFromServer, chapterContentUrl, fetchRealChapterContent, fetchRealChaptersForWork, luceneSnippet, mapServerLanguage, rewriteServerBinaryUrls, workFromServerDiv } from './serversideApi';

test('reading succeeds without requesting the XML or JSON export endpoints', async () => {
  const originalFetch = globalThis.fetch;
  const parserDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'DOMParser');
  Object.defineProperty(globalThis, 'DOMParser', {
    configurable: true,
    value: class {
      parseFromString() { return { querySelectorAll: () => [] }; }
    }
  });
  const requests: string[] = [];
  globalThis.fetch = async input => {
    const url = String(input);
    requests.push(url);
    if (url.endsWith('.txt')) return new Response('Chapter text.');
    if (url.endsWith('.html')) return new Response('<p>Chapter text.</p>');
    return new Response(null, { status: 503 });
  };
  try {
    const chapter = await fetchRealChapterContent('author/work/chapter');
    assert.equal(chapter?.htmlContent, '<p>Chapter text.</p>');
    assert.equal(chapter?.plainText, 'Chapter text.');
    assert.deepEqual(requests.sort(), [
      '/api/server-content/author/work/chapter.html',
      '/api/server-content/author/work/chapter.txt'
    ]);
  } finally {
    globalThis.fetch = originalFetch;
    if (parserDescriptor) Object.defineProperty(globalThis, 'DOMParser', parserDescriptor);
    else Reflect.deleteProperty(globalThis, 'DOMParser');
  }
});

test('export links encode chapter paths without fetching content', () => {
  assert.equal(chapterContentUrl('author/work/a & b', 'xml'),
    '/api/server-content/author/work/a%20%26%20b.xml');
  assert.equal(chapterContentUrl('author/work/a & b', 'json'),
    '/api/server-content/author/work/a%20%26%20b.json');
});

test('maps every currently supported server language to reader codes', () => {
  assert.equal(mapServerLanguage('RO'), 'ron');
  assert.equal(mapServerLanguage('ZH'), 'zho');
  assert.equal(mapServerLanguage('GR'), 'grc');
});

test('live TOC chapters retain their non-leaf division hierarchy', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async input => {
    const url = new URL(input instanceof Request ? input.url : String(input), 'http://localhost');
    if (url.pathname === '/api/divs') {
      return Response.json({ id: 42 });
    }
    if (url.pathname === '/api/divs/42/toc') {
      return Response.json([
        { path: 'author/work', head: 'Work', depth: 0, leaf: false },
        { path: 'author/work/book_i', head: 'BOOK I.', depth: 1, leaf: false },
        { path: 'author/work/book_i/1_letter', head: '1. First letter', depth: 2, leaf: true },
        { path: 'author/work/book_i/2_letter', head: '2. Second letter', depth: 2, leaf: true },
        { path: 'author/work/book_ii', head: 'BOOK II.', depth: 1, leaf: false },
        { path: 'author/work/book_ii/1_letter', head: '1. Third letter', depth: 2, leaf: true }
      ]);
    }
    return new Response(null, { status: 404 });
  };
  try {
    const chapters = await fetchRealChaptersForWork('author/work');
    assert.deepEqual(chapters.map(chapter => chapter.chapterNumber), [1, 2, 3]);
    assert.deepEqual(chapters.map(chapter => chapter.ancestors?.map(ancestor => ancestor.title)), [
      ['BOOK I.'],
      ['BOOK I.'],
      ['BOOK II.']
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Lucene results show a bounded excerpt around the searched text', () => {
  const content = `${'introductory text '.repeat(80)}needle phrase ${'trailing text '.repeat(80)}`;
  const snippet = luceneSnippet(content, 'needle phrase');
  assert.ok(snippet.includes('needle phrase'));
  assert.ok(snippet.length <= 766);
  assert.ok(snippet.startsWith('…'));
  assert.ok(snippet.endsWith('…'));
});

test('maps enriched author biography and facts for the author cards', () => {
  const author = authorFromServer({
    strId: 'abbott-edwin',
    firstName: 'Edwin',
    lastName: 'Abbott',
    bio: 'English schoolmaster and theologian.',
    birthDate: '1838-12-20',
    deathDate: '1926-10-12',
    birthPlace: 'London',
    country: 'United Kingdom',
    writingLanguage: 'EN'
  });

  assert.equal(author.bio, 'English schoolmaster and theologian.');
  assert.equal(author.birthYear, 1838);
  assert.equal(author.deathYear, 1926);
  assert.equal(author.birthPlace, 'London');
  assert.equal(author.country, 'United Kingdom');
  assert.equal(author.writingLanguage, 'EN');
});

test('uses the server-backed author work count instead of the partial catalog', () => {
  const author = authorFromServer({
    strId: 'abbott_edwin_a',
    firstName: 'Edwin A.',
    lastName: 'Abbott',
    worksCount: 1
  });

  assert.equal(author.worksCount, 1);
});

test('checked-in OpenAPI export contains every reader integration endpoint', async () => {
  const spec = await readFile(new URL('../../openapi/reader-api.json', import.meta.url), 'utf8');
  for (const path of [
    '/api/drest/teiDivs/search/findOpera',
    '/api/authors/',
    '/api/divs"',
    '/api/divs/{id}/toc',
    '/api/collections/system/repos',
    '/api/search/authors',
    '/api/search/divHeads',
    '/api/search/grep',
    '/api/search/lucene',
    '/api/search/vector'
  ]) assert.ok(spec.includes(path), `missing OpenAPI path ${path}`);
});

test('root-absolute /_binary/ asset URLs are rewritten to the same-origin proxy', () => {
  const html = '<p>text</p>'
    + '<img class="illustration" src="/pardo_bazan/la_dama_joven/la_borgonona/i.html/_binary/d3e6271">'
    + '<a href="/dulfu/ispravile_lui_pacala/fuga.html/_binary/abc123">link</a>'
    + '<a href="/dulfu/ispravile_lui_pacala/fuga">relative chapter link - untouched</a>'
    + '<img src="img/relative.png">'
    + '<img src="https://example.com/x/_binary/y">';
  const rewritten = rewriteServerBinaryUrls(html);
  assert.ok(rewritten.includes('src="/api/server-content/pardo_bazan/la_dama_joven/la_borgonona/i.html/_binary/d3e6271"'));
  assert.ok(rewritten.includes('href="/api/server-content/dulfu/ispravile_lui_pacala/fuga.html/_binary/abc123"'));
  assert.ok(rewritten.includes('href="/dulfu/ispravile_lui_pacala/fuga"'));
  assert.ok(rewritten.includes('src="img/relative.png"'));
  assert.ok(rewritten.includes('src="https://example.com/x/_binary/y"'));
});

test('the /_binary/ rewrite is idempotent', () => {
  const once = rewriteServerBinaryUrls('<img src="/pardo_bazan/la_dama_joven/primer_amor.html/_binary/d3e6489">');
  const twice = rewriteServerBinaryUrls(once);
  assert.equal(once, twice);
  assert.equal(once, '<img src="/api/server-content/pardo_bazan/la_dama_joven/primer_amor.html/_binary/d3e6489">');
});

test('a work card summarises the work with its own description, never a generic edition line', () => {
  const div = (description?: string) => ({ path: 'carlyle/past_and_present', head: 'Past and Present', opus: true,
    author: { strId: 'carlyle', firstName: 'Thomas', lastName: 'Carlyle' }, description } as any);
  assert.equal(workFromServerDiv(div('A study of  the condition\nof England.')).summary, 'A study of the condition of England.');
  assert.equal(workFromServerDiv(div('﻿ ﻿')).summary, '', 'a BOM-only description is no description');
  assert.equal(workFromServerDiv(div()).summary, '');
  assert.ok(!workFromServerDiv(div()).summary.includes('Textbase edition'));
});
