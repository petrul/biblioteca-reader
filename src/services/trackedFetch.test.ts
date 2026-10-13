import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SERVER_ERROR_EVENT, trackedFetch } from './serversideApi';

test('trackedFetch reports server-side HTTP failures to the reader UI', async () => {
  const originalFetch = globalThis.fetch;
  const previousWindow = globalThis.window;
  const events: Event[] = [];
  const eventTarget = new EventTarget();
  eventTarget.addEventListener(SERVER_ERROR_EVENT, event => events.push(event));
  Object.defineProperty(globalThis, 'window', { configurable: true, value: eventTarget });
  globalThis.fetch = async () => new Response(null, { status: 503 });

  try {
    await trackedFetch('/api/test');
    assert.equal(events.length, 1);
    assert.equal(events[0].type, SERVER_ERROR_EVENT);
    assert.equal((events[0] as CustomEvent<number>).detail, 503);
  } finally {
    globalThis.fetch = originalFetch;
    Object.defineProperty(globalThis, 'window', { configurable: true, value: previousWindow });
  }
});
