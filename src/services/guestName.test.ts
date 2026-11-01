import assert from 'node:assert/strict';
import test from 'node:test';
import { ensureGuestName, hasGuestName } from './guestName';

test('a browser asks for a guest name only while it has none', async () => {
  let asked = 0;
  const ask = async () => { asked++; };
  await ensureGuestName('JSESSIONID=abc; bib_guest=guest_formidable_dictator', ask);
  assert.equal(asked, 0);
  await ensureGuestName('JSESSIONID=abc', ask);
  await ensureGuestName('bib_guest=petru@scriptorium.ro', ask);
  assert.equal(asked, 2);
});

test('a failed request leaves the reader anonymous, without an error', async () => {
  await ensureGuestName('', async () => { throw new Error('offline'); });
  assert.equal(hasGuestName('a=1;bib_guest=guest_amber_otter'), true);
});
