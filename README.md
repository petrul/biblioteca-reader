# Biblioteca Reader

The public site of [Biblioteca](https://biblioteca.scriptorium.ro): a React
reading app plus the Node server that serves it, and the only part of the
family a browser ever talks to.

- **Read** any work at the same URL biblioteca-server uses
  (`/shakespeare/the_tragedy/act_i/scene`). Browsers get the app; curl, Lynx
  and social crawlers get a clean text edition of the same page.
- **Quote** any passage, down to a character range. A shared quote opens as a
  card, and previews in chats and feeds as a 1200x630 PNG.
- **Search** by title, author, words (Lucene) or meaning (vectors), and find
  passages similar to a selection.
- **Keep** reading progress, bookmarks, favorites, collections and saved
  searches: in the account when signed in (Google One Tap), in the browser
  otherwise.
- **Chat** with the library, a book or a collection (signed-in users only).

```
browser ──same origin only──▶ biblioteca-reader (server.ts)
                                 ├──▶ biblioteca-server   texts, search, accounts
                                 ├──▶ biblioteca-nestjs   chat, vectorizing status
                                 └──▶ biblioteca-covers   covers, thumbnails
```

## Quick start

Every Biblioteca project has the same Rake interface. The tasks load the
`biblioteca/<profile>` pass-store profile, by default the machine's hostname:

```bash
rake run                  # Vite + Express on http://localhost:3333 (PORT overrides)
rake "run[zmeu]"          # with an explicit profile
rake "run[yoga]"          # yoga development profile
rake "run[zmeu,http://localhost:3335]"   # and a different covers service
rake test                 # typecheck + unit tests
rake ci                   # clean, install, test, build, publish the Docker image
rake gen-client           # regenerate the upstream API clients (see below)
```

Needs Node and a running biblioteca-server (`BIBLIOTECA_EXTERNAL_URL`,
`localhost:8080` when run bare metal). Playwright end-to-end tests live in
`e2e/` (`npx playwright test`). `npm run test:bundle` checks that the
production server bundle starts and renders a quote card; run
`node scripts/build-server.mjs` first.

For the yoga LAN setup, port 3333 may already belong to another Scriptorium
site. Start the reader on 3334 and open it from a phone on the same network:

```bash
PORT=3334 rake "run[yoga]"
```

Then use `http://<yoga-lan-ip>:3334/app/` (or
`http://yoga.local:3334/app/`). The development Vite allowlist includes
`yoga.local` and the yoga LAN address. The yoga backend's local TEI source is
the build at `/home/petru/work/corpus/scriptorium-masters/build`; the former
`/home/petru/work/scriptorium-masters/build` path is no longer valid.

## Configuration

[`.env.example`](.env.example) documents the variables with dummy values;
real values come only from the pass store.

| Variable | Purpose |
| --- | --- |
| `BIBLIOTECA_EXTERNAL_URL` | biblioteca-server |
| `NESTJS_URL` | biblioteca-nestjs (chat, vectorizing status) |
| `COVERS_API_URL` | biblioteca-covers (default `http://localhost:3335`) |
| `GOOGLE_OAUTH_CLIENT_ID` | Google One Tap; becomes `VITE_GOOGLE_CLIENT_ID` and must equal the server's |
| `MINIO_URL`, `MINIO_CREDS` | Optional cover cache in MinIO; credentials never reach the browser |
| `PORT` | Listening port, default 3333 |

Payments (`STRIPE_*`) are deliberately left unconfigured: those features
report themselves as unavailable.

## The one rule: the browser talks only to this server

React code calls only relative `/api/...` URLs on its own origin. It never
calls biblioteca-server, biblioteca-nestjs, biblioteca-covers or MinIO
directly. `server.ts` is the single gateway: it owns the upstream URLs, the
cookie forwarding, the allowlists, timeouts and errors.

A new browser data need means three steps:

1. a narrow route in `server.ts`;
2. an entry in the allowlist in `scripts/build-openapi-public.mjs`;
3. `rake gen-serverside-client`.

Never import an upstream client into the UI.

| Generated client | Browser (`src/`) | `server.ts` |
| --- | --- | --- |
| `same-origin-api.d.ts`, this app's own API via `serversideApi.ts` | **the only one** | yes |
| `biblioteca-server-api.d.ts` | never | yes |
| `biblioteca-nestjs-api.d.ts` | never | yes |
| `biblioteca-covers-api.d.ts` | never | yes |

The clients are generated from **running** services at the repo's current
code, and checked in. The steps and the two traps are in
[docs/api-clients.md](docs/api-clients.md).

## How it works

| Area | Where | More |
| --- | --- | --- |
| Routing: the app under `/app/...`, reading pages at the server's own paths, crawler detection | `server.ts`, `src/router.ts`, `src/services/textTwin.ts` | [docs/same-url.md](docs/same-url.md) |
| Fragments and quote cards: addresses, the gateway, the og:image PNG | `src/services/fragment*.ts`, `quoteTwin.ts`, `quoteCardImage.ts` | biblioteca-server's [fragment spec](../biblioteca-server/docs/fragment-presentation-spec.md) |
| Chat gate: signed-in users only, one message at a time, 60/hour and 400/day | `src/services/chatLimit.ts` | |
| Every limit (reading pace, crawlers, chat) in one place | `src/services/resourceLimits.ts` | `resourceLimits.test.ts` states each one |
| Who is asking: user, generated guest name (`guest_<adj>_<noun>`), anonymous | `src/services/initiator.ts`, `readerInitiator.ts`, `guestName.ts` | |
| Sign-in | `src/services/googleOneTapAuth.ts` | [docs/google-one-tap.md](docs/google-one-tap.md), server [authentication](../biblioteca-server/docs/authentication.md) |
| Collections, favorites, saved searches | `src/services/collection*.ts`, `preferencesStore.ts` | [docs/collections-persistence.md](docs/collections-persistence.md), [search and collections spec](docs/search-and-collections-spec.md) |
| Covers and WebP thumbnails | `src/services/cover*.ts` | [docs/covers.md](docs/covers.md) |

Catalogue pages, author lists and search results are always live server
data. Do not add a persistent full-catalogue cache: newly imported works
must appear at once.

## License

Copyright 2026 Editii Scriptorium srl. Licensed under the [Apache License, Version 2.0](LICENSE); see also [NOTICE](NOTICE).
