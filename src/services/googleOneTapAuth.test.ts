import assert from 'node:assert/strict';
import test from 'node:test';

// The full Google One Tap scenario suite, exercising the reusable module
// (googleOneTapAuth.ts) against a mocked browser: every auth lifecycle
// state a UI service can find itself in. The scenarios, in the order a
// reader actually lives them:
//
//   1. a brand-new, unauthenticated visit  -> the one-tap prompt IS presented
//   2. Google hands over a credential      -> it reaches the app callback,
//                                              and after a successful
//                                              backend exchange it is
//                                              stored in localStorage
//   3. the reader leaves and returns within
//      the token's ~1h lifetime            -> the stored credential
//                                              restores the session
//   4. the reader returns after it expired  -> purged, guest again
//   5. an explicit sign-out                 -> credential gone,
//                                              auto-select ended, and a
//                                              new visit re-presents the
//                                              prompt
//   ...plus the degenerate cases: no client id, GIS script failure, an
//   empty/absent credential, a failing backend exchange, repeated prompt
//   calls, the explicit button path, and component remounts.
//
// Node has no window/document/localStorage - polyfill before importing the
// module under test (ESM imports are hoisted, hence the dynamic imports).

const STORAGE_KEY = 'test.googleCredential.v1';
const GSI_SCRIPT_ID = 'google-identity-services';

interface ScriptTag {
  id: string;
  src: string;
  onload: (() => void) | null;
  onerror: (() => void) | null;
}

function freshBrowser() {
  const backing = new Map<string, string>();
  const calls = {
    initialize: [] as Record<string, unknown>[],
    prompt: 0,
    renderButton: [] as unknown[][],
    disableAutoSelect: 0,
  };
  const idApi = {
    initialize(options: Record<string, unknown>) { calls.initialize.push(options); },
    prompt() { calls.prompt++; },
    renderButton(parent: unknown, options: unknown) { calls.renderButton.push([parent, options]); },
    cancel() { /* unused in these scenarios */ },
    disableAutoSelect() { calls.disableAutoSelect++; },
  };
  const scripts = new Map<string, ScriptTag>();
  const documentMock = {
    getElementById: (id: string) => scripts.get(id) ?? null,
    createElement: () => ({ id: '', src: '', async: false, defer: false, onload: null, onerror: null }) as ScriptTag,
    head: { appendChild: (tag: ScriptTag) => { scripts.set(tag.id, tag); } },
  };
  (globalThis as any).window = {
    localStorage: {
      getItem: (key: string) => (backing.has(key) ? backing.get(key)! : null),
      setItem: (key: string, value: string) => { backing.set(key, String(value)); },
      removeItem: (key: string) => { backing.delete(key); },
      clear: () => backing.clear(),
    },
    document: documentMock,
  };
  (globalThis as any).document = documentMock;
  return { backing, calls, scripts, idApi };
}

/** ready() resolves only once the injected GIS script "loads" - and
 *  loading the real GIS script is what defines window.google. Fire both,
 *  exactly what the browser does. */
async function readyWithScriptLoaded(browser: ReturnType<typeof freshBrowser>, oneTap: { ready(): Promise<void> }) {
  const ready = oneTap.ready();
  await new Promise(resolve => setImmediate(resolve)); // let the script get injected
  (globalThis as any).window.google = { accounts: { id: browser.idApi } };
  browser.scripts.get(GSI_SCRIPT_ID)!.onload?.();
  await ready;
}

// A Google-shaped ID token: three dot-separated base64url parts, the
// payload carrying the exp claim restoreStoredGoogleCredential checks.
function fakeIdToken(expEpochSeconds: number): string {
  const part = (obj: unknown) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  return `${part({ alg: 'none' })}.${part({ exp: expEpochSeconds })}.sig`;
}

function expiringIn(seconds: number): string {
  return fakeIdToken(Math.floor(Date.now() / 1000) + seconds);
}

// The app-side integration contract from the module header: exchange the
// credential with the backend, and on SUCCESS store it.
function appIntegration(backendSucceeds = true) {
  const seen: string[] = [];
  return {
    seen,
    onCredential: async (credential: string) => {
      seen.push(credential);
      const { storeGoogleCredential } = await import('./googleOneTapAuth');
      if (backendSucceeds) storeGoogleCredential(STORAGE_KEY, credential);
    },
  };
}

/** Deliver a Google credential through the captured GIS initialize callback. */
async function googleDeliversCredential(browser: ReturnType<typeof freshBrowser>, credential: string) {
  const callback = browser.calls.initialize[0].callback as (response: { credential: string }) => void;
  callback({ credential });
  // The delivery chain is async - let the app's exchange+store settle.
  await new Promise(resolve => setImmediate(resolve));
}

test('a new, unauthenticated visit presents the one-tap prompt', async () => {
  const browser = freshBrowser();
  const { GoogleOneTapAuth } = await import('./googleOneTapAuth');
  const oneTap = new GoogleOneTapAuth({ clientId: 'client-id', credentialStorageKey: STORAGE_KEY, onCredential: appIntegration().onCredential });

  // No stored credential (brand-new visitor)...
  assert.equal(browser.backing.get(STORAGE_KEY), undefined);
  // ...GIS loads and initializes (auto_select on - the persistence fix)...
  await readyWithScriptLoaded(browser, oneTap);
  assert.equal(browser.calls.initialize.length, 1);
  assert.equal(browser.calls.initialize[0].auto_select, true);
  assert.equal(browser.calls.initialize[0].essential_claims, 'picture');
  assert.equal(browser.calls.initialize[0].client_id, 'client-id');
  // ...and the automatic prompt IS presented.
  oneTap.presentPrompt();
  assert.equal(browser.calls.prompt, 1);
});

test('profile refresh requests the approved scopes and reuses prior consent silently', async () => {
  const browser = freshBrowser();
  const { requestGoogleProfileAccessToken } = await import('./googleOneTapAuth');
  let options: Record<string, any> | undefined;
  let requestOptions: Record<string, unknown> | undefined;
  (globalThis as any).window.google = {
    accounts: {
      id: browser.idApi,
      oauth2: {
        initTokenClient(clientOptions: Record<string, any>) {
          options = clientOptions;
          return {
            requestAccessToken(args: Record<string, unknown>) {
              requestOptions = args;
              clientOptions.callback({ access_token: 'profile-access-token' });
            },
          };
        },
      },
    },
  };

  const token = await requestGoogleProfileAccessToken('client-id');

  assert.equal(token, 'profile-access-token');
  assert.equal(options?.client_id, 'client-id');
  assert.equal(options?.scope, 'openid email profile');
  assert.equal(options?.include_granted_scopes, true);
  assert.deepEqual(requestOptions, { prompt: '' });
});

test('an authenticated visit stores the Google credential in localStorage', async () => {
  const browser = freshBrowser();
  const { GoogleOneTapAuth } = await import('./googleOneTapAuth');
  const app = appIntegration();
  const oneTap = new GoogleOneTapAuth({ clientId: 'client-id', credentialStorageKey: STORAGE_KEY, onCredential: app.onCredential });

  await readyWithScriptLoaded(browser, oneTap);
  const credential = expiringIn(60 * 60);
  await googleDeliversCredential(browser, credential);

  // The app's backend exchange saw exactly the token Google delivered...
  assert.deepEqual(app.seen, [credential]);
  // ...and a successful exchange stored it in localStorage.
  assert.equal(browser.backing.get(STORAGE_KEY), credential);
});

test('a return visit within the token lifetime restores the stored credential', async () => {
  const browser = freshBrowser();
  const { restoreStoredGoogleCredential } = await import('./googleOneTapAuth');
  const fresh = expiringIn(30 * 60);
  browser.backing.set(STORAGE_KEY, fresh);
  assert.equal(restoreStoredGoogleCredential(STORAGE_KEY), fresh);
  // Still there: an unexpired token is kept, not consumed.
  assert.equal(browser.backing.get(STORAGE_KEY), fresh);
});

test('a stored credential past its ~1h exp is purged on restore', async () => {
  const browser = freshBrowser();
  const { restoreStoredGoogleCredential } = await import('./googleOneTapAuth');
  browser.backing.set(STORAGE_KEY, expiringIn(-60));
  assert.equal(restoreStoredGoogleCredential(STORAGE_KEY), null);
  // The purge is the fingerprint of "signed in an hour+ ago, logged out
  // now" - the key silently vanishing from localStorage.
  assert.equal(browser.backing.get(STORAGE_KEY), undefined);
});

test('sign-out works: credential purged, auto-select ended, prompt offered again next visit', async () => {
  const browser = freshBrowser();
  const { GoogleOneTapAuth, purgeStoredGoogleCredential, disableGoogleAutoSelect } = await import('./googleOneTapAuth');
  const app = appIntegration();
  const oneTap = new GoogleOneTapAuth({ clientId: 'client-id', credentialStorageKey: STORAGE_KEY, onCredential: app.onCredential });

  // Sign in first: prompt presented, Google credential delivered+stored.
  await readyWithScriptLoaded(browser, oneTap);
  oneTap.presentPrompt();
  await googleDeliversCredential(browser, expiringIn(60 * 60));
  assert.equal(browser.backing.get(STORAGE_KEY) !== undefined, true);
  assert.equal(browser.calls.prompt, 1);

  // Sign out: the app purges the stored credential and ends auto-select,
  // so an explicit logout is respected instead of being instantly undone
  // by the next auto-select.
  purgeStoredGoogleCredential(STORAGE_KEY);
  disableGoogleAutoSelect();
  assert.equal(browser.backing.get(STORAGE_KEY), undefined);
  assert.equal(browser.calls.disableAutoSelect, 1);

  // The next visit is a guest again, and the prompt is presented afresh
  // (a fresh instance = a fresh page load).
  const nextVisit = new GoogleOneTapAuth({ clientId: 'client-id', credentialStorageKey: STORAGE_KEY, onCredential: app.onCredential });
  await readyWithScriptLoaded(browser, nextVisit);
  nextVisit.presentPrompt();
  assert.equal(browser.calls.prompt, 2);
});

test('no client id configured: sign-in is simply not offered', async () => {
  const browser = freshBrowser();
  const { GoogleOneTapAuth } = await import('./googleOneTapAuth');
  const oneTap = new GoogleOneTapAuth({ clientId: '', credentialStorageKey: STORAGE_KEY, onCredential: async () => undefined });

  await oneTap.ready();
  // No GIS script tag, no initialization, no prompt - a UI with Google
  // sign-in unconfigured stays silent.
  assert.equal(browser.scripts.size, 0);
  assert.equal(browser.calls.initialize.length, 0);
  oneTap.presentPrompt();
  assert.equal(browser.calls.prompt, 0);
});

test('a GIS script that fails to load surfaces the error and presents nothing', async () => {
  const browser = freshBrowser();
  const { GoogleOneTapAuth } = await import('./googleOneTapAuth');
  const errors: string[] = [];
  const oneTap = new GoogleOneTapAuth({
    clientId: 'client-id',
    credentialStorageKey: STORAGE_KEY,
    onCredential: async () => undefined,
    onError: (message) => errors.push(message),
  });

  const readyPromise = oneTap.ready();
  await new Promise(resolve => setImmediate(resolve)); // script injected
  browser.scripts.get(GSI_SCRIPT_ID)!.onerror?.();
  await readyPromise;

  assert.equal(errors.length, 1);
  assert.equal(browser.calls.initialize.length, 0);
  oneTap.presentPrompt();
  assert.equal(browser.calls.prompt, 0);
});

test('a callback with no credential is ignored', async () => {
  const browser = freshBrowser();
  const { GoogleOneTapAuth } = await import('./googleOneTapAuth');
  const app = appIntegration();
  const oneTap = new GoogleOneTapAuth({ clientId: 'client-id', credentialStorageKey: STORAGE_KEY, onCredential: app.onCredential });

  await readyWithScriptLoaded(browser, oneTap);
  const callback = browser.calls.initialize[0].callback as (response: { credential?: string }) => void;
  callback({});
  await new Promise(resolve => setImmediate(resolve));
  // No credential means no backend exchange, nothing stored.
  assert.deepEqual(app.seen, []);
  assert.equal(browser.backing.get(STORAGE_KEY), undefined);
});

test('a failing backend exchange surfaces the error and stores nothing', async () => {
  const browser = freshBrowser();
  const { GoogleOneTapAuth } = await import('./googleOneTapAuth');
  const errors: string[] = [];
  const oneTap = new GoogleOneTapAuth({
    clientId: 'client-id',
    credentialStorageKey: STORAGE_KEY,
    // The app-side exchange fails (e.g. the backend rejects the token) -
    // so per the integration contract it stores nothing.
    onCredential: async () => { throw new Error('server rejected the token'); },
    onError: (message) => errors.push(message),
  });

  await readyWithScriptLoaded(browser, oneTap);
  await googleDeliversCredential(browser, expiringIn(60 * 60));

  assert.deepEqual(errors, ['server rejected the token']);
  assert.equal(browser.backing.get(STORAGE_KEY), undefined);
});

test('the automatic prompt is presented at most once per page load', async () => {
  const browser = freshBrowser();
  const { GoogleOneTapAuth } = await import('./googleOneTapAuth');
  const oneTap = new GoogleOneTapAuth({ clientId: 'client-id', credentialStorageKey: STORAGE_KEY, onCredential: async () => undefined });

  await readyWithScriptLoaded(browser, oneTap);
  oneTap.presentPrompt();
  oneTap.presentPrompt();
  oneTap.presentPrompt();
  assert.equal(browser.calls.prompt, 1);
});

test('ready() initializes GIS exactly once per client id', async () => {
  const browser = freshBrowser();
  const { GoogleOneTapAuth } = await import('./googleOneTapAuth');
  const oneTap = new GoogleOneTapAuth({ clientId: 'client-id', credentialStorageKey: STORAGE_KEY, onCredential: async () => undefined });

  await readyWithScriptLoaded(browser, oneTap);
  await oneTap.ready();
  await oneTap.ready();
  assert.equal(browser.calls.initialize.length, 1);
});

test('the explicit Continue-with-Google button delegates to GIS', async () => {
  const browser = freshBrowser();
  const { GoogleOneTapAuth } = await import('./googleOneTapAuth');
  const oneTap = new GoogleOneTapAuth({ clientId: 'client-id', credentialStorageKey: STORAGE_KEY, onCredential: async () => undefined });

  await readyWithScriptLoaded(browser, oneTap);
  const parent = { node: 'button-parent' } as unknown as HTMLElement;
  oneTap.renderButton(parent, { theme: 'outline' });
  assert.equal(browser.calls.renderButton.length, 1);
  assert.equal(browser.calls.renderButton[0][0], parent);
});

test('remounted components can re-point the handlers without re-initializing GIS', async () => {
  const browser = freshBrowser();
  const { GoogleOneTapAuth } = await import('./googleOneTapAuth');
  const first = appIntegration();
  const oneTap = new GoogleOneTapAuth({ clientId: 'client-id', credentialStorageKey: STORAGE_KEY, onCredential: first.onCredential });
  await readyWithScriptLoaded(browser, oneTap);

  // A React component unmounts/remounts - the shared instance just gets
  // new handlers (setHandlers) and must NOT re-run GIS initialization.
  const second = appIntegration();
  oneTap.setHandlers({ onCredential: second.onCredential });
  await googleDeliversCredential(browser, expiringIn(60 * 60));

  assert.deepEqual(second.seen.length, 1);
  assert.deepEqual(first.seen, []);
  assert.equal(browser.calls.initialize.length, 1);
});

test('disableGoogleAutoSelect never throws when GIS is missing or only partly loaded', async () => {
  const { disableGoogleAutoSelect } = await import('./googleOneTapAuth.ts');
  const g = globalThis as any;
  const previousWindow = g.window;
  try {
    for (const google of [undefined, {}, { accounts: {} }, { accounts: { id: {} } }]) {
      g.window = { google };
      assert.doesNotThrow(() => disableGoogleAutoSelect());
    }
    let disabled = false;
    g.window = { google: { accounts: { id: { disableAutoSelect: () => { disabled = true; } } } } };
    disableGoogleAutoSelect();
    assert.equal(disabled, true);
  } finally {
    g.window = previousWindow;
  }
});

