import assert from 'node:assert/strict';
import test from 'node:test';
import { rememberSessionResults, resetSessionResultsForTests, sessionResultsFor } from './sessionSearchResults';

class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

test('the latest results survive a reload in the same session, for that query only', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: new MemoryStorage() });
  try {
    resetSessionResultsForTests();
    const results = [{ id: 'r1', workTitle: 'Odyssey' }] as any;
    rememberSessionResults(' Odyssey ', results);
    resetSessionResultsForTests(true); // reload: memory gone, session storage kept
    assert.deepEqual(sessionResultsFor('odyssey'), results);
    assert.equal(sessionResultsFor('Iliad'), null);
    rememberSessionResults('Iliad', []);
    assert.equal(sessionResultsFor('Odyssey'), null, 'only the latest search is kept');
  } finally {
    resetSessionResultsForTests();
    if (original) Object.defineProperty(globalThis, 'sessionStorage', original);
    else delete (globalThis as any).sessionStorage;
  }
});
