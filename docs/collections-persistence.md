# Collection persistence

Signed-in favorites and curated collections are stored in the `collections`
key of the authenticated user's JSON preferences document:
`GET/PUT /api/users/me/preferences` on biblioteca-server. PostgreSQL persists
this in `user_preference`, keyed by username. The reader proxies requests and
session cookies to that server. Anonymous collections stay in localStorage.
Saved searches use the separate `book_collection` tables and APIs.

## Loss prevention

- On sign-in, an existing account's collections take precedence over the
  browser's retained anonymous copy. Only an account without a collections
  key is seeded from browser preferences.
- Preference read/merge/write operations are ordered across store instances.
  Where Web Locks are available, cooperating tabs share the write lock.
- HTTP rejection fails the save. The save dialog waits for acknowledgment;
  a failed write shows a notice with a retry action. Unsaved changes remain
  in memory: keep the page open until retry succeeds.
- An empty account collection list does not resurrect legacy browser data;
  it gets a new empty Favorites collection. A late read after sign-out cannot
  reattach the previous account.

Collections are still stored as a whole array. Simultaneous edits from different
devices to that array do not have server-side conflict detection. This fix
does not migrate collections to the collection-item API.

## Verification

Run `rake 'test[zmeu]'` for the reader. The persistence regression tests cover
stale migration, overlapping writes, rejected writes, retry, empty accounts,
and a read finishing after sign-out.

For a live check, start the development services with `rake 'run[zmeu]'` in
their existing tmux panes. Provide `COLLECTIONS_TEST_USERNAME` and
`COLLECTIONS_TEST_PASSWORD` for a disposable dev account, then run:

```sh
npm run test:e2e -- e2e/collections-persistence.spec.ts --workers=1
```

The test uses `BASE_URL` (default `http://localhost:3333`) and
`COLLECTIONS_TEST_SERVER_URL` (default `http://localhost:8080`). It signs in,
creates a collection through the UI, saves an item, interleaves display
preferences, exercises stale sign-in migration, reloads, signs in from a fresh
browser, and checks rejected-save retry. It requires an existing disposable
account and leaves its verification collections for inspection; the caller
must remove that account's test data afterward. Never run with a real user's
account.
