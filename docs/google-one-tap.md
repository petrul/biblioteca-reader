# Reusing Google One Tap in another Scriptorium UI

The browser-facing implementation is intentionally framework-free:
`src/services/googleOneTapAuth.ts` has no React imports, Biblioteca types, or
reader-specific dependencies. Copy it and its focused test
(`src/services/googleOneTapAuth.test.ts`) into another Scriptorium UI.

Instantiate it with the target OAuth client id, a namespaced storage key, and
a callback that exchanges the ID token with that application's backend:

```ts
const oneTap = new GoogleOneTapAuth({
  clientId: import.meta.env.VITE_GOOGLE_CLIENT_ID,
  credentialStorageKey: 'my-app.googleCredential.v1',
  onCredential: async (idToken) => {
    const response = await fetch('/api/auth/google', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ credential: idToken }),
    });
    if (!response.ok) throw new Error('Google sign-in was rejected');
    storeGoogleCredential(oneTap.credentialStorageKey, idToken);
  },
  onError: (message) => console.warn(message),
});

await oneTap.ready();
oneTap.presentPrompt();
```

The module owns GIS script loading and initialization, auto-select restoration,
the picture essential claim, prompt diagnostics without credential logging,
expiry cleanup, explicit button rendering, and sign-out through
`purgeStoredGoogleCredential` plus `disableGoogleAutoSelect`.

## Profile photo refresh

An ID token authenticates the user. To obtain the current profile photo, use
`requestGoogleProfileAccessToken(clientId)`, requesting `openid email profile`
with `include_granted_scopes=true` and `prompt=""`. Fetch
`https://openidconnect.googleapis.com/v1/userinfo` with its Bearer token and
cache only the returned `picture` URL as a UI convenience.

The reader sends that access token to the authenticated same-origin endpoint
`POST /api/auth/google/profile` so the server can persist the photo. A copied
application should expose the same narrow endpoint, validate the profile email
against the authenticated account, and never accept an arbitrary avatar URL
from an unauthenticated browser request.

## React integration (optional)

`src/components/GoogleOneTap.tsx` is only a thin React adapter around the
framework-free module. Non-React applications can use the service directly.

## Configuration and tests

Map pass-store `GOOGLE_OAUTH_CLIENT_ID` to `VITE_GOOGLE_CLIENT_ID`. In Google
OAuth data access, allow `openid`, `userinfo.email`, and `userinfo.profile`.
Copy the focused test with the module: it protects initialization and picture,
anonymous versus signed prompt policy, OAuth scopes and silent consent reuse,
expiry cleanup, sign-out cancellation, and profile/account mismatch rejection.
