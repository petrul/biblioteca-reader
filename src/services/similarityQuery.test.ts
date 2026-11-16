import assert from 'node:assert/strict';
import test from 'node:test';
import { currentPageSimilarityQuery, limitSimilarityQuery, MAX_SIMILARITY_QUERY_CHARS } from './similarityQuery';

test('More Like This uses the rendered page and preserves complete words up to the URL budget', () => {
  const root = { innerText: '  First paragraph.\n\nSecond paragraph with the page context.  ' } as HTMLElement;
  assert.equal(currentPageSimilarityQuery(root, 'Work title'), 'First paragraph. Second paragraph with the page context.');
  const long = `${'word '.repeat(MAX_SIMILARITY_QUERY_CHARS)}tail`;
  const limited = limitSimilarityQuery(long);
  assert.ok(limited.length <= MAX_SIMILARITY_QUERY_CHARS);
  assert.ok(!limited.endsWith(' '));
  assert.equal(currentPageSimilarityQuery(null, '  Work title  '), 'Work title');
});
