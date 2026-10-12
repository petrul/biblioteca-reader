# Biblioteca Reader

Textbase Reader is the browser UI for the TEI corpus exposed by `textbase-server`. 
It keeps the existing discovery, scholarly reader, collections, search, admin, and payment designs while presenting live server records first and the original demonstration corpus afterward for comparison.

## Run locally

Requirements: Node.js 20+ and a running `biblioteca-server`.

```bash
rake npminstall
rake run            # dev profile: http://localhost:3333
```

The rake tasks load `biblioteca/dev` from the pass store through its own
`load-env.sh` - the same mechanism as biblioteca-server and
biblioteca-nestjs - so the reader fronts the `BIBLIOTECA_EXTERNAL_URL`
that stage advertises, and `GOOGLE_OAUTH_CLIENT_ID` is mapped automatically
to the build-time `VITE_GOOGLE_CLIENT_ID` (it must equal the server's own
`google.oauth.client-id`). `.env.example` documents the variables with
dummy values only; there are no `.env` files to copy. The reader listens
on <http://localhost:3333> (set `PORT` to change it) and expects the
server per `BIBLIOTECA_EXTERNAL_URL` (localhost:8080 when run bare).
Stripe is intentionally unconfigured for now: the `STRIPE_*` variables are
simply not provided anywhere and every payment feature reports itself
unconfigured.
Cover rendering is optional and defaults to `http://localhost:3335`; set
`COVERS_API_URL` only when the covers service lives elsewhere. The browser
still calls only `/api/covers/work` on this reader origin.
When `MINIO_URL` and `MINIO_CREDS` are present, the reader caches generated PNGs
under `covers/works/<authorId>/<opusId>-<identity-hash>.png` in the configured
the bucket named in `MINIO_URL`. A cache hit avoids invoking
the headless cover renderer. The browser still receives the image through the
reader's same-origin route; MinIO credentials never leave the server. New
cover jobs are owned by biblioteca-nestjs and use `covers/` directly; the
bucket may be anonymous/public-readable, but it must not be publicly writable.

Work cards show one fallback cover, `DefaultWorkCover` (the brush-paper
`cover-blue.jpg` with the title and author), both when the server has no
generated `coverUrl` and when a cover URL fails to load (`WorkCoverImage`). Cover generation is performed
asynchronously by `biblioteca-nestjs` after opus import/reimport; the reader
does not call the covers renderer directly.

Safe example values (never real credentials):

```dotenv
MINIO_URL=http://srv2.local:20124/biblioteca
MINIO_CREDS=example-cover-cache-access-key:example-cover-cache-secret-key
```

The URL includes the bucket and is the server-side MinIO API endpoint. The
credential is `access-key:secret-key`; it belongs to a restricted writer
account and stays in the pass store, never reaching the browser.

#### Development cover-cache MinIO setup

The development integration MinIO instance is the general-purpose MinIO
started by `scripts/docker/integration-deps/run-mini.sh` (not Milvus's
separate MinIO). Create a dedicated writer account and restrict it to the
cover prefix. The exact commands below use the MinIO Client (`mcli` here to
avoid colliding with Midnight Commander):

```bash
mcli alias set int-minio http://mini.local:20104 <root-user> <root-password>
mcli mb --ignore-existing int-minio/biblioteca
mcli anonymous set download int-minio/biblioteca
mcli admin policy create int-minio biblioteca-covers-writer ./biblioteca-covers-policy.json
mcli admin user add int-minio biblioteca-covers <generated-password>
mcli admin policy attach int-minio biblioteca-covers-writer --user biblioteca-covers
mcli admin user svcacct add int-minio biblioteca-covers
```

The writer policy should allow `s3:ListBucket` only for `covers/*`, and
`s3:GetObject`/`s3:PutObject` only for
`arn:aws:s3:::biblioteca/covers/*`. Store the generated access key and secret
as `MINIO_CREDS` under the appropriate `biblioteca/<profile>` pass-store
directory. Do not commit the credential or put a real value in `.env.example`.

## Architecture

### Browser networking boundary (mandatory)

The browser UI talks **only to this reader's own same-origin server**. React
components must use relative `/api/...` URLs (including
`/api/server-content/...` for raw book content) and must never call
`biblioteca-server`, `biblioteca-nestjs`, `biblioteca-covers`, MinIO, or any
other upstream host directly. `server.ts` is the single server-side gateway:
it owns the upstream URLs, authentication/cookie forwarding, allowlists,
timeouts, error translation, and same-origin response shape. Any new browser
data need therefore requires a narrow route in `server.ts`, documentation in
the reader OpenAPI contract, and regeneration with `rake gen-serverside-client`; do not
expose an upstream client or URL to the UI as a shortcut.

```text
React components
      |
readerService (online-first page requests; transient UI state only)
      |
generated OpenAPI client ---- canonical .txt/.json/.xml/.xhtml exports
      |                                      |
same-origin /api gateway in server.ts --------+
      |
textbase-server (unchanged)
```

- `server.ts` exposes a read-only `/api/server-content/*` proxy for raw book content. This avoids browser CORS differences while preserving all `biblioteca-server` routes, status codes, media types, and server-side decisions.
- The browser UI must call only this reader's same-origin server API. For example, work-cover rendering is `POST /api/covers/work`; `server.ts` adds the randomized cover theme and talks to `biblioteca-covers` privately. React code must never call biblioteca-server, biblioteca-nestjs, or biblioteca-covers directly.
- `openapi/reader-api.json` is the exported server contract (this app's own `/api/docs`, synced by `rake gen-serverside-client`). `openapi-typescript` generates `src/generated/same-origin-api.d.ts`, and `openapi-fetch` makes typed requests from `src/services/serversideApi.ts`.
- `readerService` requests only the visible author/work page from the live API; it does not persist or preload a full catalogue. Author works and chapter content are fetched on demand.
- Catalogue pages, author lists, repositories, and search results are live server data. Do not reintroduce a persistent full-catalogue cache: this UI is intentionally online-first so newly imported works appear without waiting for a cache refresh.
- Live chapter IDs are their full server paths. This preserves nested TEI divisions and bookmarkable reader links rather than inventing or flattening fragments.
- The four reader tabs use the server's canonical `.txt`, `.json`, `.xml`, and `.xhtml` representations.

### Refresh the API clients

`rake gen-client` regenerates the three upstream service clients from the
running sibling services. The profile is picked like every
other rake task: argument first, then the `PROFILE` env var, then the
machine's hostname.

- `gen-biblioteca-client` regenerates `src/generated/biblioteca-server-api.d.ts`
  — a typed client of biblioteca-server's raw spec
  (`${BIBLIOTECA_EXTERNAL_URL}/api/docs`), the same shape as
  biblioteca-nestjs's own `rake gen-client`. Nothing imports it yet; it
  exists so a direct server-side call can be typed against the real DTOs.
- `gen-serverside-client` regenerates `src/generated/same-origin-api.d.ts` —
  the client `serversideApi.ts` is typed against, describing THIS app's own
  server-side express API (served at `/api/docs`, Swagger UI at `/api/ui`) —
  via the allowlist pipeline (`npm run openapi:update`): shapes from the
  running biblioteca-server (`BIBLIOTECA_SERVER_URL`, default
  localhost:8080), the route list synced from this app's own dev server,
  then `openapi-typescript`. Start the dev server first (`rake run`,
  default localhost:3333) and after the latest `openapi:public:build`,
  since server.ts imports openapi-public.json at startup — a reader booted
  before the rebuild serves the previous document and the sync
  round-trips it.
- `gen-vectorizer-client` regenerates `src/generated/biblioteca-nestjs-api.d.ts`
  from the running biblioteca-nestjs vectorizer's live document
  (`NESTJS_URL/api/ui-json`, default localhost:3334). Its raw spec is used
  directly — the vectorizer's admin surface has no allowlist/proxy layer.
- `gen-cover-api` regenerates `src/generated/biblioteca-covers-api.d.ts`
  from `COVERS_API_URL/api/docs` (default `http://localhost:3335`). This
  client is for server-side integrations; browser code still uses only the
  reader's same-origin `/api/covers/work` route.

The biblioteca-server and vectorizer spec jsons are downloaded transiently
and removed after generation; the generated `.d.ts` files are checked in.
Commit them so API drift is reviewable.

##### Running the regeneration, end to end

All four sibling clients are generated off **running** servers, so a full
`rake gen-client` needs biblioteca-server, biblioteca-nestjs, and
biblioteca-covers up — and running the repo's current
code, not whatever the deployed containers happen to be:

```bash
# 1. biblioteca-server, on :8080 (rake run picks the pass-store profile by
#    hostname; bootRun binds 8080):
cd ../biblioteca-server && rake run
# 2. biblioteca-nestjs, on :3000:
cd ../biblioteca-nestjs && rake run
# 3. this app's own dev server, on :3333 by default (PORT/READER_URL to
#    override; the default port can be busy on dev machines):
cd ../biblioteca-reader && rake run          # or: PORT=3334 npm run dev
# 4. then, from this repo:
rake gen-client                               # regenerates the three upstream clients
```

Two traps, both hit in practice:

- **Generate off repo HEAD, not the deployed containers.** The deployed
  biblioteca-server image can lag the repo (e.g. a renamed endpoint
  exists in HEAD but not in the running container) — the generator fails
  loudly on a missing allowlisted path, which is exactly the design, but
  the fix is running the repo's server locally, not loosening the
  allowlist.
- **`gen-serverside-client` is a round trip through this app's own
  running server**: `openapi:public:build` writes `openapi-public.json`,
  but `server.ts` imports that file **at startup**, so a reader booted
  before the rebuild serves the previous document and the sync step
  copies it straight back — a silent no-op. After changing anything in
  the allowlist/`openapi-public.json`, rebuild first, *then* restart the
  dev server, *then* run `openapi:sync` + `openapi:generate` (or just the
  full `rake gen-serverside-client` again once the server is new).

#### Which client may be used where (important for coding agents)

The browser UI talks **only** to this app's own server-side API. The other
two clients exist for the server-side component (`server.ts`) to relay
through — importing them into browser code is wrong even when the types
happen to fit: it bypasses the reviewed public contract (and the
`/api/**` gateway's proxying, auth, and same-origin behavior) and couples
the UI to upstream surfaces this app deliberately does not expose.

| Client | Browser UI (`src/` React code) | Server side (`server.ts`) |
| --- | --- | --- |
| `same-origin-api.d.ts` (this app's own API, via `serversideApi.ts`) | **yes — the only one** | yes |
| `biblioteca-server-api.d.ts` (biblioteca-server raw) | **never** | yes — relay/proxy calls |
| `biblioteca-nestjs-api.d.ts` (biblioteca-nestjs) | **never** | yes — relay/proxy calls |

Rule of thumb: a new browser-side data need means adding a route to
`server.ts` (and to the allowlist in `scripts/build-openapi-public.mjs`),
then `rake gen-serverside-client` — not importing an upstream client into the UI.

## Covers and future default illustrations

When an author thumbnail is present, the reader uses it through the same-origin proxy. Otherwise it chooses a deterministic stock book image, so the same work keeps the same fallback cover.

A proper default-illustration feature belongs in Textbase metadata rather than being silently generated by the reader. A future server-side pipeline can generate an illustration from title, author, language, period, and optionally a synopsis; store the image URL plus provider/model, prompt, license, creation time, and review status; and expose those fields in the OpenAPI work DTO. The reader adapter can then prefer a reviewed generated illustration, followed by an author image and finally the current stock fallback. This makes inexpensive AI image services easy to add without losing provenance or editorial control.

## Verification

```bash
npm test
npm run lint
npm run build
```

The tests certify language/cover mapping and that the checked-in OpenAPI export contains every endpoint used by the reader integration.
