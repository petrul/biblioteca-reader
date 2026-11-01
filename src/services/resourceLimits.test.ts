import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import express from 'express';
import { crawlerPageRateLimit, type CrawlerLimitOptions } from './crawlerPageLimit';
import { RESOURCE_LIMITS } from './resourceLimits';
import { chatRateLimit, type ChatUser } from './chatLimit';
import { currentInitiator } from './initiator';

// What the reader limits, precisely, and when - the specification for
// resourceLimits.ts, checked against the real middleware with its defaults:
//
//   what is limited              who                                  limit           when exceeded
//   ---------------------------  -----------------------------------  --------------  -----------------------------
//   distinct chapters read       a browser keeping its visitor cookie  3000/h/browser  429 + JSON notice until the
//                                (out of any person's reach)                           oldest read leaves the hour
//   distinct chapters read       clients without a valid cookie        150/h/address   same
//   fresh visitor cookies        one address                           40/h            no cookie: counted as cookieless
//   chat/ask/RAG search          anyone not signed in                  refused         401 chat_requires_sign_in
//   chat/ask/RAG search          a signed-in user                      one at a time   409 chat_busy until answered
//   chat/ask/RAG search          a signed-in user                      60/h, 400/day   429 chat_limit until the window
//   chat/ask/RAG search          one address, all users together       240/h           429 chat_limit, scope address
//   chat/ask/RAG search          an administrator                      one at a time,  -
//                                                                      never counted
//   cover generation             anyone                                not limited     - (async and cached)
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
    chatMessagesPerHourPerUser: 60,
    chatMessagesPerDayPerUser: 400,
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

// --- chat: the shared GPU is for signed-in people --------------------------

/** Test sessions: the Cookie "session=<username>" signs that user in; "admin" is an administrator. */
const testUserOf = async (req: express.Request): Promise<ChatUser | null> => {
  const username = /session=([^;]+)/.exec(req.headers.cookie || '')?.[1];
  return username ? { username, isAdmin: username === 'admin' } : null;
};

async function withChat(options: { now?: () => number; answer?: (res: express.Response) => void }, run: (origin: string) => Promise<void>) {
  const app = express();
  app.post('/api/rag/chat', chatRateLimit({ userOf: testUserOf, now: options.now }),
    (_req, res) => options.answer ? options.answer(res) : res.json({ answer: 'ok', as: currentInitiator() }));
  const server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Server did not bind a TCP port');
  try { await run(`http://127.0.0.1:${address.port}`); }
  finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

/** A signed-in user who chats. */
const chatter = (origin: string, username: string) =>
  () => fetch(`${origin}/api/rag/chat`, { method: 'POST', headers: { Cookie: `session=${username}` } });

test('anyone not signed in - a guest, a script - gets no chat at all', async () => {
  await withChat({}, async origin => {
    for (const headers of [{}, { Cookie: 'bib_guest=guest_formidable_dictator' }]) {
      const refused = await fetch(`${origin}/api/rag/chat`, { method: 'POST', headers });
      assert.equal(refused.status, 401);
      assert.equal((await refused.json()).error, 'chat_requires_sign_in');
    }
  });
});

test('a message is sent as its user, so that is who the chat service logs and records', async () => {
  await withChat({}, async origin => {
    assert.equal((await (await chatter(origin, 'petru@scriptorium.ro')()).json()).as, 'petru@scriptorium.ro');
  });
});

test('a user asks one question at a time: the next waits for the answer', async () => {
  const pending: express.Response[] = [];
  await withChat({ answer: res => pending.push(res) }, async origin => {
    const ask = chatter(origin, 'petru@scriptorium.ro');
    const first = ask();
    while (pending.length === 0) await new Promise(resolve => setTimeout(resolve, 5));
    const second = await ask();
    assert.equal(second.status, 409);
    assert.equal((await second.json()).error, 'chat_busy');
    const admin = chatter(origin, 'admin');
    const adminFirst = admin();
    while (pending.length < 2) await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal((await admin()).status, 409, 'administrators too');
    const someoneElse = chatter(origin, 'ana@scriptorium.ro')();
    while (pending.length < 3) await new Promise(resolve => setTimeout(resolve, 5));
    pending.shift()!.json({ answer: 'first' });
    assert.equal((await first).status, 200);
    pending.splice(0).forEach(res => res.json({ answer: 'ok' }));
    assert.equal((await adminFirst).status, 200);
    assert.equal((await someoneElse).status, 200, 'other users are not held up');
    pending.length = 0;
  });
  await withChat({}, async origin => {
    const ask = chatter(origin, 'petru@scriptorium.ro');
    assert.equal((await ask()).status, 200);
    assert.equal((await ask()).status, 200, 'once answered, the next message goes through');
  });
});

test('a user sends 60 chat messages an hour, then waits for the hour', async () => {
  let timestamp = 1_000_000;
  await withChat({ now: () => timestamp }, async origin => {
    const ask = chatter(origin, 'petru@scriptorium.ro');
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

test('a user sends 400 chat messages a day', async () => {
  let timestamp = 1_000_000;
  await withChat({ now: () => timestamp }, async origin => {
    const ask = chatter(origin, 'petru@scriptorium.ro');
    for (let hour = 0; hour < 7; hour++) {
      for (let i = 0; i < 60 && hour * 60 + i < 400; i++) assert.equal((await ask()).status, 200, `hour ${hour} message ${i}`);
      timestamp += 3_600_000;
    }
    const limited = await ask();
    assert.equal(limited.status, 429, 'a fresh hour, but 400 already today');
    assert.equal((await limited.json()).scope, 'day');
  });
});

test('one address, all its users together, sends 240 chat messages an hour', async () => {
  await withChat({}, async origin => {
    for (const user of ['a', 'b', 'c', 'd']) {
      const ask = chatter(origin, `${user}@scriptorium.ro`);
      for (let i = 0; i < 60; i++) assert.equal((await ask()).status, 200);
    }
    const limited = await chatter(origin, 'e@scriptorium.ro')();
    assert.equal(limited.status, 429, 'a fresh user on an address that has used its 240');
    assert.equal((await limited.json()).scope, 'address');
  });
});

test('an administrator is never counted', async () => {
  await withChat({}, async origin => {
    const ask = chatter(origin, 'admin');
    for (let i = 0; i < 500; i++) {
      const status = (await ask()).status;
      if (status !== 200) assert.fail(`message ${i} answered ${status}`);
    }
  });
});
