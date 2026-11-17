import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const globals = globalThis as any;
let calls: any[] = [];

beforeEach(() => {
  calls = [];
  globals.fetch = async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init, body: init.body ? JSON.parse(String(init.body)) : undefined });
    return new Response(JSON.stringify({ data: { myReaderState: { revision: 2, lastSearch: { query: 'hamlet' }, workspace: { active: true }, updatedAt: 'now' } } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
});

test('reader GraphQL calls stay same-origin and carry named operations', async () => {
  const { fetchReaderState } = await import('./readerGraphql');
  const state = await fetchReaderState();
  assert.equal(state.revision, 2);
  assert.equal(calls[0].url, '/api/reader-graphql');
  assert.equal(calls[0].body.operationName, 'MyReaderState');
});
