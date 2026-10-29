import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import express from 'express';
import { crawlerPageRateLimit, type CrawlerLimitOptions } from './crawlerPageLimit';
import { RESOURCE_LIMITS } from './resourceLimits';
import { chatRateLimit } from './chatLimit';
import { createVisitorCookies } from './visitorCookie';

// What the reader limits, precisely, and when - the specification for
// resourceLimits.ts, checked against the real middleware with its defaults:
//
//   what is limited              who                                  limit           when exceeded
//   ---------------------------  -----------------------------------  --------------  -----------------------------
//   distinct chapters read       a browser keeping its visitor cookie  3000/h/browser  429 + JSON notice until the
//                                (out of any person's reach)                           oldest read leaves the hour
//   distinct chapters read       clients without a valid cookie        150/h/address   same
//   fresh visitor cookies        one address                           40/h            no cookie: counted as cookieless
//   chat/ask/RAG search          clients without a valid cookie        refused         403 chat_requires_browser
//   chat/ask/RAG search          a browser                             60/h, 300/day   429 chat_limit until the window
//   chat/ask/RAG search          one address, all browsers together    240/h           429 chat_limit, scope address
//   chat/ask/RAG search          an administrator                      never limited   -
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
    browserChaptersPerHour: 3000,
    cookielessChaptersPerHour: 150,
    newVisitorCookiesPerHour: 40,
    chatMessagesPerHourPerBrowser: 60,
    chatMessagesPerDayPerBrowser: 300,
    chatMessagesPerHourPerAddress: 240,
    windowMs: 3_600_000,
    contact: 'petru@scriptorium.ro',
  });
});

test('a browser keeping its visitor cookie reads 3000 distinct chapters an hour - beyond any person', async () => {
  let timestamp = 1_000_000;
  await withReader({ now: () => timestamp }, async origin => {
    const cookie = (await fetch(`${origin}/hugo`, { headers: PAGE })).headers.get('set-cookie')!.split(';')[0];
    const read = (n: number) => fetch(`${origin}${chapter(n)}`, { headers: { Cookie: cookie } });
    for (let i = 0; i < 3000; i++) {
      const status = (await read(i)).status;
      if (status !== 200) assert.fail(`chapter ${i} answered ${status}`);
    }
    assert.equal((await read(42)).status, 200, 'a chapter already read this hour is free');

    const limited = await read(3000);
    assert.equal(limited.status, 429);
    const notice = await limited.json();
    assert.deepEqual([notice.error, notice.scope, notice.limit], ['read_limit', 'browser', 3000]);
    assert.match(notice.message, /3000 different chapters within an hour/);

    assert.equal((await fetch(`${origin}${chapter(3000)}`)).status, 200,
      'browsers are counted each on their own: a cookieless client at the same address is unaffected');
    timestamp += 3_600_000;
    assert.equal((await read(3000)).status, 200, 'an hour later the oldest reads have left the window');
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
    assert.match(notice.message, /reading in a browser with cookies enabled is not limited this way/);
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

// --- chat: the shared GPU is for people ----------------------------------

async function withChat(options: { now?: () => number; isAdmin?: boolean }, run: (origin: string) => Promise<void>) {
  const visitors = createVisitorCookies('test-secret');
  const app = express();
  app.use(crawlerPageRateLimit({ visitors }));
  app.post('/api/rag/chat', chatRateLimit({ visitors, now: options.now, isExempt: async () => Boolean(options.isAdmin) }),
    (_req, res) => res.json({ answer: 'ok' }));
  app.get('*', (_req, res) => res.type('html').send('<html>page</html>'));
  const server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Server did not bind a TCP port');
  try { await run(`http://127.0.0.1:${address.port}`); }
  finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}

/** A browser: loads a page, keeps its visitor cookie, then chats. */
async function chatter(origin: string) {
  const cookie = (await fetch(`${origin}/hugo`, { headers: PAGE })).headers.get('set-cookie')!.split(';')[0];
  return () => fetch(`${origin}/api/rag/chat`, { method: 'POST', headers: { Cookie: cookie } });
}

test('a client that is not a browser - no valid visitor cookie - gets no chat at all', async () => {
  await withChat({}, async origin => {
    for (const headers of [{}, { Cookie: 'bib_v=forged.signature' }]) {
      const refused = await fetch(`${origin}/api/rag/chat`, { method: 'POST', headers });
      assert.equal(refused.status, 403);
      assert.equal((await refused.json()).error, 'chat_requires_browser');
    }
  });
});

test('a browser sends 60 chat messages an hour, then waits for the hour', async () => {
  let timestamp = 1_000_000;
  await withChat({ now: () => timestamp }, async origin => {
    const ask = await chatter(origin);
    for (let i = 0; i < 60; i++) {
      assert.equal((await ask()).status, 200, `message ${i}`);
      timestamp += 1000;
    }
    const limited = await ask();
    assert.equal(limited.status, 429);
    const notice = await limited.json();
    assert.deepEqual([notice.error, notice.scope, notice.limit], ['chat_limit', 'hour', 60]);
    assert.ok(Number(limited.headers.get('retry-after')) > 0);
    timestamp += 3_600_000;
    assert.equal((await ask()).status, 200, 'an hour later');
  });
});

test('a browser sends 300 chat messages a day', async () => {
  let timestamp = 1_000_000;
  await withChat({ now: () => timestamp }, async origin => {
    const ask = await chatter(origin);
    for (let hour = 0; hour < 5; hour++) {
      for (let i = 0; i < 60; i++) assert.equal((await ask()).status, 200, `hour ${hour} message ${i}`);
      timestamp += 3_600_000;
    }
    const limited = await ask();
    assert.equal(limited.status, 429, 'a fresh hour, but 300 already today');
    assert.equal((await limited.json()).scope, 'day');
  });
});

test('one address, all its browsers together, sends 240 chat messages an hour', async () => {
  await withChat({}, async origin => {
    const people = [await chatter(origin), await chatter(origin), await chatter(origin), await chatter(origin)];
    for (const ask of people) for (let i = 0; i < 60; i++) assert.equal((await ask()).status, 200);
    const fifth = await chatter(origin);
    const limited = await fifth();
    assert.equal(limited.status, 429, 'a fresh browser on an address that has used its 240');
    assert.equal((await limited.json()).scope, 'address');
  });
});

test('an administrator is never limited', async () => {
  await withChat({ isAdmin: true }, async origin => {
    for (let i = 0; i < 400; i++) {
      const status = (await fetch(`${origin}/api/rag/chat`, { method: 'POST' })).status;
      if (status !== 200) assert.fail(`message ${i} answered ${status}`);
    }
  });
});
