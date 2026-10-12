import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';

const { dependencies } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

// Bundle openapi-fetch's ESM entry to preserve its default export in CommonJS.
// Keep the other runtime packages external, as in the existing Docker build.
await build({
  entryPoints: ['server.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  external: Object.keys(dependencies).filter(name => name !== 'openapi-fetch'),
  sourcemap: true,
  outfile: 'dist/server.cjs',
});
