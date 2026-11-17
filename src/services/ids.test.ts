import { test } from 'node:test';
import assert from 'node:assert/strict';

test('newId works when randomUUID is unavailable on an insecure LAN origin', async () => {
  const globals = globalThis as typeof globalThis & { crypto: Crypto };
  const original = globals.crypto;
  Object.defineProperty(globals, 'crypto', {
    configurable: true,
    value: { getRandomValues(bytes: Uint8Array) { bytes.fill(7); return bytes; } },
  });
  try {
    const { newId } = await import('./ids');
    assert.match(newId(), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  } finally {
    Object.defineProperty(globals, 'crypto', { configurable: true, value: original });
  }
});
