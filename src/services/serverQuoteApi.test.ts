import assert from 'node:assert/strict';
import test from 'node:test';
import { savedQuoteAddress } from './serverQuoteApi';

// A collection's quote item saved as a legacy browser-local id
// (quote-temp-...) opened on another browser as "This legacy quotation
// is unavailable in this browser." The item's own snapshot - chapter and
// text - is enough to find the passage again.
const saved = {
  workId: 'moore_thomas/the_complete',
  chapterId: 'moore_thomas/the_complete/poems_relating_to_america/she_sung_of_love',
  quoteText: 'Who ever loved, but had the thought\n\n  That he and all he loved must part?'
};

function answering(status: number, body: unknown): string[] {
  const requests: string[] = [];
  globalThis.fetch = (async (input: Request | string) => {
    const request = input instanceof Request ? input : new Request(input);
    requests.push(`${request.method} ${new URL(request.url).pathname} ${await request.text()}`);
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  return requests;
}

test('a saved quote that still resolves opens at its exact fragment', async () => {
  const requests = answering(200, {
    canonicalUrl: 'http://localhost/moore_thomas/the_complete/poems_relating_to_america/she_sung_of_love/_4:0..4:302?rev=f5fe',
    text: 'Who ever loved...'
  });

  assert.equal(await savedQuoteAddress(saved),
    '/moore_thomas/the_complete/poems_relating_to_america/she_sung_of_love/_4:0..4:302?rev=f5fe');
  assert.deepEqual(requests, [`POST /api/quote ${JSON.stringify({ path: saved.chapterId, text: saved.quoteText })}`]);
});

test('a saved quote whose text no longer resolves still opens its chapter', async () => {
  answering(404, { error: 'not found' });

  assert.equal(await savedQuoteAddress(saved), '/' + saved.chapterId);
});

test('a snapshot without a chapter has no address', async () => {
  const requests = answering(200, {});

  assert.equal(await savedQuoteAddress({ workId: saved.workId, quoteText: saved.quoteText }), null);
  assert.deepEqual(requests, []);
});
