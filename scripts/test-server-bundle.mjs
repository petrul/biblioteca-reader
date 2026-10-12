import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';

const probe = createServer();
await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
const { port } = probe.address();
await new Promise(resolve => probe.close(resolve));
const child = spawn(process.execPath, ['dist/server.cjs'], {
  env: { PATH: process.env.PATH, NODE_ENV: 'production', PORT: String(port), BIBLIOTECA_EXTERNAL_URL: 'http://127.0.0.1:1' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let output = '';
for (const stream of [child.stdout, child.stderr]) {
  stream.on('data', chunk => { output = (output + chunk).slice(-4000); });
}
try {
  const deadline = Date.now() + 15000;
  let info;
  while (Date.now() < deadline) {
    assert.equal(child.exitCode, null, output);
    try {
      const response = await fetch('http://127.0.0.1:' + port + '/api/info',
        { signal: AbortSignal.timeout(1000) });
      if (response.ok) { info = await response.json(); break; }
    } catch { /* Wait for the server to listen. */ }
    await delay(100);
  }
  assert.ok(info, 'Packaged server did not become ready: ' + output);
  const manifest = JSON.parse(await readFile('package.json', 'utf8'));
  assert.equal(info.version, manifest.version);
  console.log('Packaged production server smoke check passed:', info.version);
} finally {
  const exited = new Promise(resolve => child.once('exit', resolve));
  child.kill('SIGTERM');
  await Promise.race([exited, delay(2000)]);
  if (child.exitCode === null) child.kill('SIGKILL');
}
