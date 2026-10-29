import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import express from 'express';
import { crawlerPageRateLimit, type CrawlerLimitOptions } from './crawlerPageLimit';

// The mechanics behind the limits in resourceLimits.ts (whose own test is the
// specification): what counts as a chapter read, how chapters are counted,
// and how a browser is recognised.

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

const chapter = (n: number | string, ext = 'html') => `/api/server-content/hugo/les_miserables/tome_i/${n}.${ext}`;
const PAGE = { Accept: 'text/html', 'Sec-Fetch-Dest': 'document' };

test('only chapter content counts - everything else is free, whatever it is', async () => {
  await withReader({ cookielessChaptersPerHour: 1 }, async origin => {
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
  await withReader({ cookielessChaptersPerHour: 1 }, async origin => {
    for (const ext of ['html', 'txt', 'xml', 'json', 'html', 'txt']) {
      assert.equal((await fetch(`${origin}${chapter(1, ext)}`)).status, 200, ext);
    }
    assert.equal((await fetch(`${origin}${chapter(2)}`)).status, 429);
  });
});

test('only page loads hand out visitor cookies - not module, asset or API requests', async () => {
  await withReader({}, async origin => {
    for (const path of ['/src/App.tsx', '/assets/app.js', chapter(1)]) {
      assert.equal((await fetch(`${origin}${path}`, { headers: { Accept: '*/*' } })).headers.get('set-cookie'), null, path);
    }
    assert.ok((await fetch(`${origin}/hugo`, { headers: PAGE })).headers.get('set-cookie'));
  });
});

test('a forged visitor cookie counts as no cookie', async () => {
  await withReader({ cookielessChaptersPerHour: 1 }, async origin => {
    const forged = { Cookie: 'bib_v=someone.not-a-valid-signature' };
    assert.equal((await fetch(`${origin}${chapter(1)}`, { headers: forged })).status, 200);
    assert.equal((await fetch(`${origin}${chapter(2)}`, { headers: forged })).status, 429);
  });
});
