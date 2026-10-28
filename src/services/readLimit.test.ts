import assert from 'node:assert/strict';
import test from 'node:test';
import { installReadLimitWatcher, READ_LIMIT_EVENT, readLimitNotice, type ReadLimitNotice } from './readLimit';

function fakeWindow(response: Response) {
  const target = new EventTarget() as EventTarget & { fetch: typeof fetch };
  target.fetch = async () => response;
  return target;
}

test('a read_limit 429 raises the notice event and leaves the body to the caller', async () => {
  const body = { error: 'read_limit', scope: 'visitor', limit: 1500, retryAfterSeconds: 120, contact: 'petru@scriptorium.ro', message: 'pause' };
  const target = fakeWindow(new Response(JSON.stringify(body), { status: 429, headers: { 'Content-Type': 'application/json' } }));
  const seen = new Promise<ReadLimitNotice>(resolve =>
    target.addEventListener(READ_LIMIT_EVENT, event => resolve((event as CustomEvent<ReadLimitNotice>).detail)));
  installReadLimitWatcher(target as unknown as Window);

  const response = await target.fetch('/api/server-content/x.txt');
  assert.equal((await response.json()).message, 'pause', 'the caller can still read the body');
  const notice = await seen;
  assert.equal(notice.retryAfterSeconds, 120);
  assert.equal(notice.scope, 'visitor');
});

test('other 429s and ordinary errors raise nothing', async () => {
  assert.equal(readLimitNotice({ error: 'too_many_signins', message: 'x' }), null);
  assert.equal(readLimitNotice('Automated crawling limit reached'), null);
  const target = fakeWindow(new Response('busy', { status: 429, headers: { 'Content-Type': 'text/plain' } }));
  let raised = false;
  target.addEventListener(READ_LIMIT_EVENT, () => { raised = true; });
  installReadLimitWatcher(target as unknown as Window);
  await target.fetch('/x');
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(raised, false);
});
