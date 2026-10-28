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

const chapter = (n: number | string, ext = 'html') => `/api/server-content/hugo/les_miserables/tome_i/${n}.${ext}`;
const PAGE = { Accept: 'text/html', 'Sec-Fetch-Dest': 'document' };

/** A browser: loads the page first, then keeps the visitor cookie it is given. */
async function browser(origin: string) {
  let cookie = '';
  const read = async (path: string, headers: Record<string, string> = {}) => {
    const response = await fetch(`${origin}${path}`, { headers: { ...headers, ...(cookie ? { Cookie: cookie } : {}) } });
    const set = response.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return response;
  };
  await read('/hugo/les_miserables', PAGE);
  assert.ok(cookie, 'the page load hands out a visitor cookie');
  return read;
}

test('only chapter content counts - everything else is free, whatever it is', async () => {
  await withReader({ cookielessHourly: 1 }, async origin => {
    for (const path of ['/hugo/les_miserables/tome_i/1', '/assets/app.js', '/src/App.tsx', '/@vite/client', '/api/authors',
                        '/api/server-content/img/generic-author.webp', '/api/server-content/css/site.css',
                        `${chapter(1)}/_binary/fig-1`, `${chapter('toc', 'json')}?depth=0`, '/sitemap.xml']) {
      assert.equal((await fetch(`${origin}${path}`)).status, 200, path);
    }
    assert.equal((await fetch(`${origin}${chapter(1)}`)).status, 200);
    assert.equal((await fetch(`${origin}${chapter(2)}`)).status, 429);
  });
});

test('a chapter counts once per hour, whatever formats or reloads fetch it', async () => {
  await withReader({ cookielessHourly: 1 }, async origin => {
    for (const ext of ['html', 'txt', 'xml', 'json', 'html', 'txt']) {
      assert.equal((await fetch(`${origin}${chapter(1, ext)}`)).status, 200, ext);
    }
    assert.equal((await fetch(`${origin}${chapter(2)}`)).status, 429);
  });
});

test('a browser keeping its cookie reads well past what a cookieless client gets', async () => {
  await withReader({ visitorHourly: 40, cookielessHourly: 3 }, async origin => {
    const read = await browser(origin);
    for (let i = 0; i < 40; i++) {
      assert.equal((await read(chapter(i, i % 2 ? 'txt' : 'html'))).status, 200, `chapter ${i}`);
    }
    const limited = await read(chapter(40));
    assert.equal(limited.status, 429);
    assert.equal((await limited.json()).scope, 'visitor');
  });
});

test('cookieless clients get a small budget, then a JSON notice until the hour passes', async () => {
  let timestamp = 10_000;
  await withReader({ cookielessHourly: 2, now: () => timestamp }, async origin => {
    assert.equal((await fetch(`${origin}${chapter(1)}`)).status, 200);
    assert.equal((await fetch(`${origin}${chapter(2, 'txt')}`)).status, 200);

    const limited = await fetch(`${origin}${chapter(3)}`);
    assert.equal(limited.status, 429);
    assert.equal(limited.headers.get('retry-after'), '3600');
    const notice = await limited.json();
    assert.equal(notice.error, 'read_limit');
    assert.equal(notice.scope, 'cookieless');
    assert.equal(notice.limit, 2);
    assert.match(notice.message, /2 chapters per hour/);
    assert.match(notice.message, /paid service - contact petru@scriptorium\.ro/);

    timestamp += 3_600_001;
    assert.equal((await fetch(`${origin}${chapter(3)}`)).status, 200);
  });
});

test('an address minting cookie after cookie gets no more of them', async () => {
  await withReader({ newVisitorsHourly: 2 }, async origin => {
    assert.ok((await fetch(`${origin}/a`, { headers: PAGE })).headers.get('set-cookie'));
    assert.ok((await fetch(`${origin}/b`, { headers: PAGE })).headers.get('set-cookie'));
    assert.equal((await fetch(`${origin}/c`, { headers: PAGE })).headers.get('set-cookie'), null, 'no third fresh cookie this hour');
  });
});

test('only page loads hand out cookies - not module, asset or API requests', async () => {
  await withReader({}, async origin => {
    for (const path of ['/src/App.tsx', '/assets/app.js', chapter(1)]) {
      assert.equal((await fetch(`${origin}${path}`, { headers: { Accept: '*/*' } })).headers.get('set-cookie'), null, path);
    }
  });
});

test('many people behind one address share only the high per-address ceiling', async () => {
  await withReader({ visitorHourly: 100, addressHourly: 5, newVisitorsHourly: 10 }, async origin => {
    const people = [await browser(origin), await browser(origin), await browser(origin)];
    let served = 0;
    // The same chapter read by different people still counts per person.
    for (let i = 0; i < 6; i++) if ((await people[i % 3](chapter(Math.floor(i / 3)))).status === 200) served++;
    assert.equal(served, 5);
    assert.equal((await (await people[0](chapter(9))).json()).scope, 'address');
  });
});

test('a forged visitor cookie counts as no cookie', async () => {
  await withReader({ cookielessHourly: 1 }, async origin => {
    const forged = { Cookie: 'bib_v=someone.not-a-valid-signature' };
    assert.equal((await fetch(`${origin}${chapter(1)}`, { headers: forged })).status, 200);
    const limited = await fetch(`${origin}${chapter(2)}`, { headers: forged });
    assert.equal(limited.status, 429);
    assert.equal((await limited.json()).scope, 'cookieless');
  });
});
