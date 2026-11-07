import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { requireAdmin } from './adminGate';

async function withApp(isAdmin: () => Promise<boolean>, run: (base: string, calls: string[]) => Promise<void>) {
  const app = express();
  const calls: string[] = [];
  app.post('/api/covers/work', requireAdmin(isAdmin), (_req, res) => { calls.push('rendered'); res.json({ ok: true }); });
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address(); assert(address && typeof address !== 'string');
  try { await run(`http://127.0.0.1:${address.port}`, calls); }
  finally { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}

test('a cover render with an arbitrary coverArtUrl is refused to anyone but an administrator', async () => {
  await withApp(async () => false, async (base, calls) => {
    const response = await fetch(`${base}/api/covers/work`, { method: 'POST' });
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { error: 'administrators only' });
    assert.deepEqual(calls, []);
  });
});

test('when the admin check itself fails (biblioteca-server down), the gate stays closed', async () => {
  await withApp(async () => { throw new Error('unreachable'); }, async (base, calls) => {
    assert.equal((await fetch(`${base}/api/covers/work`, { method: 'POST' })).status, 403);
    assert.deepEqual(calls, []);
  });
});

test('an administrator gets through', async () => {
  await withApp(async () => true, async (base, calls) => {
    const response = await fetch(`${base}/api/covers/work`, { method: 'POST' });
    assert.equal(response.status, 200);
    assert.deepEqual(calls, ['rendered']);
  });
});
