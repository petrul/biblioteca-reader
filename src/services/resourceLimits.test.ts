import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import express from 'express';
import { crawlerPageRateLimit, type CrawlerLimitOptions } from './crawlerPageLimit';
import { RESOURCE_LIMITS } from './resourceLimits';

// What the reader limits, precisely, and when - the specification for
// resourceLimits.ts, checked against the real middleware with its defaults:
//
//   what is limited              who                                  limit           when exceeded
//   ---------------------------  -----------------------------------  --------------  -----------------------------
//   distinct chapters read       a browser keeping its visitor cookie  never limited   -
//   distinct chapters read       clients without a valid cookie        150/h/address   429 + JSON notice until the
//                                                                                      oldest read leaves the hour
//   fresh visitor cookies        one address                           40/h            no cookie: counted as cookieless
//
// The per-request size caps (search results, TOC pages...) are the
// server's - see biblioteca-server's ResourceLimitsTest.

async function withReader(options: CrawlerLimitOptions, run: (origin: string) => Promise<void>) {
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

const chapter = (n: number) => `/api/server-content/hugo/les_miserables/${n}.html`;
const PAGE = { Accept: 'text/html', 'Sec-Fetch-Dest': 'document' };

test('the limits are these and no others', () => {
  assert.deepEqual(RESOURCE_LIMITS, {
    cookielessChaptersPerHour: 150,
    newVisitorCookiesPerHour: 40,
    windowMs: 3_600_000,
    contact: 'petru@scriptorium.ro',
  });
});

test('a browser keeping its visitor cookie is never limited', async () => {
  await withReader({}, async origin => {
    const cookie = (await fetch(`${origin}/hugo`, { headers: PAGE })).headers.get('set-cookie')!.split(';')[0];
    for (let i = 0; i < 2_000; i++) {
      const status = (await fetch(`${origin}${chapter(i)}`, { headers: { Cookie: cookie } })).status;
      if (status !== 200) assert.fail(`chapter ${i} answered ${status}`);
    }
  });
});

test('a client without a valid cookie reads 150 distinct chapters an hour per address', async () => {
  let timestamp = 1_000_000;
  await withReader({ now: () => timestamp }, async origin => {
    for (let i = 0; i < 150; i++) assert.equal((await fetch(`${origin}${chapter(i)}`)).status, 200, `chapter ${i}`);
    assert.equal((await fetch(`${origin}${chapter(5)}`)).status, 200, 'a chapter already read this hour is free');

    const limited = await fetch(`${origin}${chapter(150)}`);
    assert.equal(limited.status, 429);
    assert.equal(limited.headers.get('retry-after'), '3600');
    const notice = await limited.json();
    assert.deepEqual([notice.error, notice.scope, notice.limit], ['read_limit', 'cookieless', 150]);
    assert.match(notice.message, /Reading in a browser with cookies enabled is not limited/);
    assert.match(notice.message, /contact petru@scriptorium\.ro/);

    timestamp += 3_600_000;
    assert.equal((await fetch(`${origin}${chapter(150)}`)).status, 200, 'an hour later the oldest reads have left the window');
  });
});

test('one address gets 40 fresh visitor cookies an hour, then none', async () => {
  await withReader({}, async origin => {
    for (let i = 0; i < 40; i++) {
      assert.ok((await fetch(`${origin}/page/${i}`, { headers: PAGE })).headers.get('set-cookie'), `cookie ${i}`);
    }
    assert.equal((await fetch(`${origin}/page/40`, { headers: PAGE })).headers.get('set-cookie'), null);
  });
});
