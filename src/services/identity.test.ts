import assert from 'node:assert/strict';
import test from 'node:test';

// The one-tap sign-in persistence chain, pinned by unit tests (there were
// no prior one-tap unit tests - these are the first). Two links in the
// chain failed on prod, together explaining "I one-tap authenticated
// several times but every visit still lands me logged out":
//
// 1. GoogleOneTap initialized GIS with auto_select: false - so Google never
//    silently re-issued a credential to a returning visitor; and
// 2. the stored Google ID token (identity.ts's restoreStoredGoogleCredential)
//    only lives ~1h, after which it is deliberately purged - the fingerprint
//    the user saw as a missing biblioteca.reader.googleCredential.v1 key.
//
// The server session cookie itself is a plain servlet session (dies with
// the browser), so with auto_select off, an hour after any sign-in there
// was nothing left to restore a session from. The fix: auto_select on
// (Google re-credentials silently on every visit, refreshing the stored
// token), with disableAutoSelect called on an explicit sign-out so leaving
// is respected.

// node has no window/localStorage/fetch - polyfill before importing the
// modules under test (ESM imports are hoisted, hence the dynamic ones).
const backing = new Map<string, string>();
const localStorageMock = {
  getItem: (key: string) => (backing.has(key) ? backing.get(key)! : null),
  setItem: (key: string, value: string) => { backing.set(key, String(value)); },
  removeItem: (key: string) => { backing.delete(key); },
  clear: () => backing.clear(),
};
const googleIdApi = {
  initialize: () => undefined,
  prompt: () => undefined,
  renderButton: () => undefined,
  cancel: () => undefined,
  disableAutoSelectCalls: 0,
  disableAutoSelect() { this.disableAutoSelectCalls++; },
};
(globalThis as any).window = {
  localStorage: localStorageMock,
  google: { accounts: { id: googleIdApi } },
};
// readerService addresses localStorage as the bare global (browser style),
// identity.ts as window.localStorage - polyfill both to the same store.
(globalThis as any).localStorage = localStorageMock;
(globalThis as any).fetch = async () => ({ ok: true, status: 200, json: async () => ({}), text: async () => '' });

const STORED_GOOGLE_CREDENTIAL = 'biblioteca.reader.googleCredential.v1';
const STORED_USER = 'biblioteca_reader_user';
const STORED_COLLECTIONS_PREFIX = 'biblioteca_reader_collections_';

// A Google-shaped ID token: three dot-separated base64url parts, the
// payload carrying the exp claim restoreStoredGoogleCredential checks.
function fakeIdToken(expEpochSeconds: number): string {
  const part = (obj: unknown) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  return `${part({ alg: 'none' })}.${part({ exp: expEpochSeconds })}.sig`;
}

test('one-tap initializes GIS with auto_select on - the persistence bug fix', async () => {
  const { GoogleOneTapAuth } = await import('./googleOneTapAuth');
  const oneTap = new GoogleOneTapAuth({
    clientId: 'a-client-id',
    credentialStorageKey: 'unused',
    onCredential: async () => undefined,
  });
  const options = oneTap.initializeOptions('a-client-id');

  // The regression: this used to be false, which meant Google never
  // silently re-credentialed a returning visitor - combined with the
  // stored credential's ~1h expiry, every visit more than an hour after
  // the last sign-in landed as Guest.
  assert.equal(options.auto_select, true);
  // The rest of the prompt policy, pinned so it cannot silently drift.
  assert.equal(options.cancel_on_tap_outside, false);
  assert.equal(options.client_id, 'a-client-id');
});

test('an expired stored credential is purged; an unexpired one is restored', async () => {
  const { restoreStoredGoogleCredential } = await import('./identity');

  // Expired: removed from storage and reported absent - this purge is the
  // fingerprint of "signed in an hour+ ago, logged out now".
  localStorageMock.setItem(STORED_GOOGLE_CREDENTIAL, fakeIdToken(Math.floor(Date.now() / 1000) - 60));
  assert.equal(restoreStoredGoogleCredential(), null);
  assert.equal(localStorageMock.getItem(STORED_GOOGLE_CREDENTIAL), null);

  // Unexpired: returned as-is and kept.
  const fresh = fakeIdToken(Math.floor(Date.now() / 1000) + 60 * 60);
  localStorageMock.setItem(STORED_GOOGLE_CREDENTIAL, fresh);
  assert.equal(restoreStoredGoogleCredential(), fresh);
  assert.equal(localStorageMock.getItem(STORED_GOOGLE_CREDENTIAL), fresh);
});

test('sign-out ends auto-select so an explicit logout is respected', async () => {
  const { signOut } = await import('./identity');

  localStorageMock.setItem(STORED_GOOGLE_CREDENTIAL, fakeIdToken(Math.floor(Date.now() / 1000) + 60 * 60));
  const callsBefore = googleIdApi.disableAutoSelectCalls;
  await signOut();

  // The stored credential goes...
  assert.equal(localStorageMock.getItem(STORED_GOOGLE_CREDENTIAL), null);
  // ...and GIS auto-select is ended for this origin, otherwise the next
  // page load would instantly re-sign-in a reader who just chose to leave.
  assert.equal(googleIdApi.disableAutoSelectCalls, callsBefore + 1);
});

test('reading the current user fabricates nothing, and stale demo personas are purged', async () => {
  const { readerService } = await import('./readerService');

  // No fabricated persona at all: with nothing persisted there is no user.
  localStorageMock.clear();
  const user = readerService.getCurrentUser();
  assert.equal(user, null);
  assert.equal(localStorageMock.getItem(STORED_USER), null);

  // Stale pre-populated persona from an older session: removed, together
  // with its pristine seeded collections key - which is also swept when
  // it lingers on its own (the persona is no longer persisted anywhere).
  localStorageMock.setItem(STORED_USER, JSON.stringify({ id: 'usr-scholar-1', email: 'petru@scriptorium.ro', name: 'Scholar Petru', role: 'admin', authProvider: 'google' }));
  localStorageMock.setItem(`${STORED_COLLECTIONS_PREFIX}usr-scholar-1`, JSON.stringify([
    { id: 'col-favorites', userId: 'usr-scholar-1', name: 'Favorites', items: [] },
  ]));
  readerService.getCurrentUser();
  assert.equal(localStorageMock.getItem(STORED_USER), null);
  assert.equal(localStorageMock.getItem(`${STORED_COLLECTIONS_PREFIX}usr-scholar-1`), null);

  // An orphaned pristine demo collections key (persona key already gone)
  // is swept too - deleting it by hand now sticks, nothing re-seeds it.
  localStorageMock.clear();
  localStorageMock.setItem(`${STORED_COLLECTIONS_PREFIX}usr-scholar-1`, JSON.stringify([
    { id: 'col-favorites', userId: 'usr-scholar-1', name: 'Favorites', items: [] },
  ]));
  readerService.getCurrentUser();
  assert.equal(localStorageMock.getItem(`${STORED_COLLECTIONS_PREFIX}usr-scholar-1`), null);

  // A demo persona's collection with real reader-added items is NOT stale
  // mock data - it stays.
  localStorageMock.clear();
  localStorageMock.setItem(`${STORED_COLLECTIONS_PREFIX}usr-scholar-1`, JSON.stringify([
    { id: 'col-favorites', userId: 'usr-scholar-1', name: 'Favorites', items: [{ id: 'real-item' }] },
  ]));
  readerService.getCurrentUser();
  assert.notEqual(localStorageMock.getItem(`${STORED_COLLECTIONS_PREFIX}usr-scholar-1`), null);

  // A real signed-in identity is never touched.
  localStorageMock.clear();
  localStorageMock.setItem(STORED_USER, JSON.stringify({ id: 'petru@scriptorium.ro', email: 'petru@scriptorium.ro', name: 'Petru', role: 'reader', authProvider: 'google' }));
  readerService.getCurrentUser();
  assert.notEqual(localStorageMock.getItem(STORED_USER), null);
});
