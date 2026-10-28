import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sameOriginFetch } from './sameOriginFetch';

test('sameOriginFetch rejects cross-origin requests and disables redirects', async () => {
  const originalFetch = globalThis.fetch;
  const originalLocation = Object.getOwnPropertyDescriptor(globalThis, 'location');
  let fetchOptions: RequestInit | undefined;
  Object.defineProperty(globalThis, 'location', { configurable: true, value: { origin: 'https://reader.test' } });
  globalThis.fetch = async (_input, init) => {
    fetchOptions = init;
    return new Response('ok');
  };
  try {
    await assert.rejects(sameOriginFetch('https://other.test/api/data'), /same origin/);
    await sameOriginFetch('/api/data');
    assert.equal(fetchOptions?.credentials, 'same-origin');
    assert.equal(fetchOptions?.redirect, 'error');
  } finally {
    globalThis.fetch = originalFetch;
    if (originalLocation) Object.defineProperty(globalThis, 'location', originalLocation);
    else delete (globalThis as typeof globalThis & { location?: Location }).location;
  }
});
