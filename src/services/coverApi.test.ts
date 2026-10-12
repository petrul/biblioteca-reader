import assert from 'node:assert/strict';
import test from 'node:test';
import { generateWorkCover } from './coverApi';

test('renders a work cover through the reader same-origin API', async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl = '';
  let requestedBody: any;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    requestedUrl = input instanceof Request ? input.url : String(input);
    requestedBody = JSON.parse(init?.body ? String(init.body) : await (input as Request).text());
    return new Response(new Blob(['png']), { status: 200, headers: { 'Content-Type': 'image/png' } });
  }) as typeof fetch;

  try {
    const blob = await generateWorkCover({
      workId: 'shakespeare/hamlet',
      title: 'Hamlet',
      author: 'William Shakespeare',
      coverArtUrl: 'https://example.test/hamlet.jpg',
    });
    assert.equal(requestedUrl, 'http://localhost/api/covers/work');
    assert.deepEqual(requestedBody, {
      workId: 'shakespeare/hamlet',
      title: 'Hamlet',
      author: 'William Shakespeare',
      coverArtUrl: 'https://example.test/hamlet.jpg',
    });
    assert.equal(await blob.text(), 'png');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
