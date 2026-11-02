# Covers and thumbnails

## Covers

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

### Development cover-cache MinIO setup

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

## Thumbnails through the reader gateway

Stored cover URLs remain original URLs in catalogue data. Display components
request same-origin WebP thumbnails from `/api/cover-thumbnails?url=...&width=320`.
Cards use 320 pixels, the main work cover 640, and checkout previews 160. Existing
local/data-image defaults pass through unchanged; a thumbnail load failure uses
the existing local fallback. Old locally cached work metadata is also handled
by the cover component. Cover downloads/rendering and stored originals are untouched.

The gateway forwards only thumbnail GET requests to `COVERS_API_URL`, including
`/api/cover-thumbnails/cache/<key>` for cached images. It preserves ETag,
Cache-Control and hit/miss headers and rewrites Content-Location to same origin.
It never forwards browser cookies/Authorization or exposes cache deletion.
The routes appear in `/api/docs` and have their own
`/api/cover-thumbnails/openapi.json` document.

The covers service must run its new `src2/` API and allow the original MinIO
origin through `THUMBNAIL_SOURCE_ORIGINS` or its MinIO URL configuration. It
owns conversion and persistent disk caching; the reader has no second disk cache.

For bare-metal thumbnail development on zmeu, use
`rake 'run[zmeu,http://localhost:3335]'` to select the dev covers endpoint
explicitly after loading the pass-store profile. Omitting the second argument
keeps the configured profile endpoint.
