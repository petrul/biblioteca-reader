import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import express from 'express';
import { crawlerPageRateLimit, type ReadLimitOptions } from './crawlerPageLimit';

async function withReader(options: ReadLimitOptions, run: (origin: string) => Promise<void>) {
  const app = express();
  app.use(crawlerPageRateLimit({ secret: 'test-secret', ...options }));
  app.get('*', (_req, res) => res.type('html').send('<html>page</html>'));
  const server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Server did not bind a TCP port');
  try { await run(`http://127.0.0.1:${address.port}`); }
  finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}

/** A browser: keeps the visitor cookie it is given, like a real one. */
function browser(origin: string) {
  let cookie = '';
  return async (path: string) => {
    const response = await fetch(`${origin}${path}`, { headers: cookie ? { Cookie: cookie } : {} });
    const set = response.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return response;
  };
}

test('only reads count: assets, Vite dev modules and other API calls never do', async () => {
  await withReader({ cookielessHourly: 1, newVisitorsHourly: 1 }, async origin => {
    for (const path of ['/assets/app.js', '/src/App.tsx', '/@vite/client', '/@fs/x/y.ts', '/node_modules/.vite/deps/react.js',
                        '/@react-refresh', '/api/authors', '/api/auth/whoami', '/sitemap.xml', '/robots.txt', '/img/logo.png']) {
      assert.equal((await fetch(`${origin}${path}`)).status, 200, path);
    }
  });
});

test('a browser keeping its cookie reads well past what a cookieless client gets', async () => {
  await withReader({ visitorHourly: 50, cookielessHourly: 3 }, async origin => {
    const read = browser(origin);
    for (let i = 0; i < 50; i++) {
      const path = i % 2 ? `/api/server-content/hugo/les_miserables/${i}.txt` : `/hugo/les_miserables/${i}`;
      assert.equal((await read(path)).status, 200, `read ${i}`);
    }
    assert.equal((await read('/hugo/les_miserables/51')).status, 429);
  });
});

test('cookieless clients get a small budget, then a JSON notice on content and a page on page loads', async () => {
  let timestamp = 10_000;
  await withReader({ cookielessHourly: 2, newVisitorsHourly: 0 + 1, now: () => timestamp }, async origin => {
    // The first page load mints this address's one fresh cookie (dropped here, like curl does).
    assert.equal((await fetch(`${origin}/work/one`)).status, 200);
    assert.equal((await fetch(`${origin}/api/server-content/work/one.txt`)).status, 200);
    assert.equal((await fetch(`${origin}/api/server-content/work/two.txt`)).status, 200);

    const content = await fetch(`${origin}/api/server-content/work/three.txt`);
    assert.equal(content.status, 429);
    assert.equal(content.headers.get('retry-after'), '3600');
    const notice = await content.json();
    assert.equal(notice.error, 'read_limit');
    assert.equal(notice.scope, 'cookieless');
    assert.equal(notice.limit, 2);
    assert.match(notice.message, /paid service - contact petru@scriptorium\.ro/);

    const page = await fetch(`${origin}/work/four`);
    assert.equal(page.status, 429);
    assert.match(page.headers.get('content-type') || '', /text\/html/);
    assert.match(await page.text(), /Time for a short pause/);

    timestamp += 3_600_001;
    assert.equal((await fetch(`${origin}/api/server-content/work/five.txt`)).status, 200);
  });
});

test('an address minting cookie after cookie gets no more of them', async () => {
  await withReader({ newVisitorsHourly: 2, cookielessHourly: 1 }, async origin => {
    assert.ok((await fetch(`${origin}/a`)).headers.get('set-cookie'));
    assert.ok((await fetch(`${origin}/b`)).headers.get('set-cookie'));
    const third = await fetch(`${origin}/c`);
    assert.equal(third.headers.get('set-cookie'), null, 'no third fresh cookie this hour');
    assert.equal(third.status, 200, 'served from the cookieless budget');
    assert.equal((await fetch(`${origin}/d`)).status, 429);
  });
});

test('many people behind one address share only the high per-address ceiling', async () => {
  await withReader({ visitorHourly: 100, addressHourly: 5, newVisitorsHourly: 10 }, async origin => {
    const people = [browser(origin), browser(origin), browser(origin)];
    let served = 0;
    for (let i = 0; i < 6; i++) if ((await people[i % 3](`/work/${i}`)).status === 200) served++;
    assert.equal(served, 5);
    const notice = await (await people[0]('/api/server-content/work/x.txt')).json();
    assert.equal(notice.scope, 'address');
  });
});

test('a forged visitor cookie counts as no cookie', async () => {
  await withReader({ newVisitorsHourly: 0 + 1, cookielessHourly: 1 }, async origin => {
    await fetch(`${origin}/mint`); // uses up this address's one fresh cookie
    const forged = { Cookie: 'bib_v=someone.not-a-valid-signature' };
    assert.equal((await fetch(`${origin}/api/server-content/a.txt`, { headers: forged })).status, 200);
    assert.equal((await fetch(`${origin}/api/server-content/b.txt`, { headers: forged })).status, 429);
  });
});
