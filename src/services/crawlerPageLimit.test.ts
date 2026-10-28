import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import express from 'express';
import { crawlerPageRateLimit } from './crawlerPageLimit';

async function withReader(handler: express.RequestHandler, run: (origin: string) => Promise<void>) {
  const app = express();
  app.use(handler);
  app.get('*', (_req, res) => res.type('html').send('<html>page</html>'));
  const server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Server did not bind a TCP port');
  try { await run(`http://127.0.0.1:${address.port}`); }
  finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}

test('limits HTML crawls per client per window and returns a paid-access contact message', async () => {
  let timestamp = 10_000;
  await withReader(crawlerPageRateLimit({ hourlyLimit: 2, windowMs: 3_600_000, now: () => timestamp }), async origin => {
    const headers = { Accept: 'text/html', 'User-Agent': 'ExampleBot/1.0' };
    assert.equal((await fetch(`${origin}/work/one`, { headers })).status, 200);
    assert.equal((await fetch(`${origin}/work/two`, { headers })).status, 200);
    const limited = await fetch(`${origin}/work/three`, { headers });
    assert.equal(limited.status, 429);
    assert.equal(limited.headers.get('retry-after'), '3600');
    assert.match(await limited.text(), /paid higher-volume access, contact petru@scriptorium\.ro/);
    timestamp += 3_600_001;
    assert.equal((await fetch(`${origin}/work/four`, { headers })).status, 200);
  });
});

test('skips APIs, assets and sitemaps, but content paths cannot evade the limit with another Accept type', async () => {
  await withReader(crawlerPageRateLimit({ hourlyLimit: 1 }), async origin => {
    const htmlHeaders = { Accept: 'text/html' };
    for (const path of ['/api/authors', '/assets/app.js', '/sitemap.xml']) {
      assert.equal((await fetch(`${origin}${path}`, { headers: htmlHeaders })).status, 200);
    }
    assert.equal((await fetch(`${origin}/work/one`, { headers: { Accept: 'application/json' } })).status, 200);
    assert.equal((await fetch(`${origin}/work/two`, { headers: htmlHeaders })).status, 429);
  });
});
