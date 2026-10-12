import { mkdir, writeFile } from 'node:fs/promises';

// Sources from THIS app's own /api/docs.json (see openapi-public.ts), not
// biblioteca-server's - the typed client (serversideApi.ts) must only
// ever describe this app's real, registered proxy routes, never
// biblioteca-server's/nestjs's raw internal surface (see
// biblioteca-server/README.md's "Public vs internal REST endpoints").
// That means this needs a running `npm run dev` of THIS app first, not
// biblioteca-server.
const readerUrl = (process.env.READER_URL || 'http://localhost:3333').replace(/\/$/, '');
const output = new URL('../openapi/reader-api.json', import.meta.url);
const response = await fetch(`${readerUrl}/api/docs`, {
  headers: { Accept: 'application/json' }
});

if (!response.ok) {
  throw new Error(`Could not export OpenAPI JSON from ${readerUrl}: HTTP ${response.status}`);
}

const json = await response.text();
if (!/"openapi"\s*:\s*"3\./.test(json)) {
  throw new Error(`${readerUrl}/api/docs did not return an OpenAPI 3 document`);
}

await mkdir(new URL('../openapi/', import.meta.url), { recursive: true });
await writeFile(output, json);
console.log(`Exported ${json.length} bytes from ${readerUrl}/api/docs`);
