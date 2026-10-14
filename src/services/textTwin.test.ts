import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { Server } from 'node:http';
import { load } from 'cheerio';
import { negotiatePage, prepareTwin, registerTextTwins, rewriteTwinLink } from './textTwin';
import { parseAppPath, buildAppPath } from '../router';
import { paragraphShareUrl, parseParagraphRange } from './paragraphLinks';

const html = `<!doctype html><html><head><title>Old</title><meta property="og:url" content="."><script>alert(1)</script></head><body><nav><a href="/hugo/chatiments/ii?noredirect=">Next</a><a href="/hugo">Author</a></nav><div class="body-of-text"><h2>I</h2><p>First &amp; second.</p><p id="source-id">A quotation <em>here</em><button class="note" title="A footnote" onclick="bad()">1</button>.</p><img src="/hugo/chatiments/_binary/plate"></div><script src="/js/reader.js"></script></body></html>`;
async function listen(app: ReturnType<typeof express>) {
  const server = await new Promise<Server>(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const address = server.address() as { port: number };
  return { server, url: `http://127.0.0.1:${address.port}` };
}
async function close(server: Server) { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }

test('negotiation honors overrides, media quality, browsers and text clients', () => {
  for (const agent of ['curl/8.0', 'Lynx/2.9', 'facebookexternalhit', 'Twitterbot', 'Slackbot', 'Mozilla/5.0 Googlebot', 'WhatsApp', 'TelegramBot', 'Discordbot', 'LinkedInBot']) assert.equal(negotiatePage('text/html', agent, 'navigate'), 'html');
  assert.equal(negotiatePage('text/html', 'Mozilla/5.0', 'navigate'), 'spa');
  assert.equal(negotiatePage('', 'curl/8'), 'html');
  assert.equal(negotiatePage('text/plain;q=0.3,text/html;q=0.9', 'Mozilla/5.0'), 'spa');
  assert.equal(negotiatePage('application/json,text/html;q=0.5', 'Mozilla/5.0'), 'json');
  assert.equal(negotiatePage('text/markdown', 'Mozilla/5.0'), 'markdown');
  assert.equal(negotiatePage('text/plain', 'Mozilla/5.0'), 'text');
  assert.equal(negotiatePage('application/json', 'Mozilla/5.0', '', 'text'), 'html');
});

test('root routes mirror author, opus and nested chapter paths and reserve application assets', () => {
  assert.equal(parseAppPath('/hugo/chatiments').chapterId, 'hugo/chatiments');
  assert.equal(parseAppPath('/hugo/chatiments/livre/i', '#p2-4').block?.end, 4);
  assert.equal(parseAppPath('/hugo').authorId, 'hugo');
  assert.equal(buildAppPath({ view: 'reader', chapterId: 'hugo/chatiments/i' }), '/hugo/chatiments/i');
  assert.equal(buildAppPath({ view: 'search' }), '/app/search');
  assert.equal(parseAppPath('/api/divs').view, 'notFound');
  assert.equal(parseAppPath('/assets/index.js').view, 'notFound');
  assert.equal(parseAppPath('/biblioteca/cover').view, 'notFound');
  assert.equal(parseAppPath('/app/admin').view, 'admin');
  assert.equal(paragraphShareUrl('hugo/chatiments/i', { start: 2, end: 4 }), '/hugo/chatiments/i?p=2-4#p2-4');
  for (const value of ['0', '-2', '4-2', '1-999999', '<script>', '2x']) assert.equal(parseParagraphRange(value), null);
});

test('upstream literary HTML is reused without scripts and notes remain readable', () => {
  const twin = prepareTwin(html, 'http://upstream/hugo/chatiments/i', { start: 2, end: 2 });
  assert.equal(twin.$('script').length, 0);
  assert.equal(twin.$('[onclick]').length, 0);
  assert.equal(twin.$('#source-id').attr('data-reader-paragraph'), 'p2');
  assert.equal(twin.$('#p2').length, 1);
  assert.equal(twin.$('.shared-passage').length, 1);
  assert.match(twin.text, /A footnote/);
  assert.match(twin.markdown, /## I/);
  assert.equal(twin.$('nav a').first().attr('href'), '/hugo/chatiments/ii?view=text');
  assert.equal(twin.$('img').attr('src'), '/api/server-content/hugo/chatiments/_binary/plate');
  assert.equal(rewriteTwinLink('javascript:alert(1)', 'http://upstream/hugo/chatiments/i', 'http://upstream'), '');
  assert.throws(() => prepareTwin(html, 'http://upstream/hugo/chatiments/i', { start: 3, end: 3 }), /does not exist/);
  // The original prose stays intact; only the visible footnote was added.
  const original = load(html);
  twin.body.find('.footnote').remove();
  assert.equal(twin.body.text(), original('.body-of-text').text());
});

test('HTTP same URL serves HTML, SPA, plain text, Markdown and JSON, with safe preview gating', async () => {
  const upstream = express(); let premium = false; let htmlCalls = 0;
  upstream.get('/api/divs', (req, res) => {
    const path = String(req.query.path);
    if (path.startsWith('missing/')) { res.status(404).json({}); return; }
    res.json({ id: path === 'hugo/chatiments' ? 1 : 2, path, head: path === 'hugo/chatiments' ? 'Les Châtiments' : 'I', leaf: path !== 'hugo/chatiments', accessType: premium ? 'premium' : 'free', author: { displayName: 'Victor Hugo' } });
  });
  upstream.get('/api/divs/1/toc', (_req, res) => res.json([{ path: 'hugo/chatiments', leaf: false }, { path: 'hugo/chatiments/i', leaf: true }, { path: 'hugo/chatiments/ii', leaf: true }]));
  upstream.get('/hugo/chatiments/i.xml', (_req, res) => res.type('application/xml').send('<TEI><p>First</p></TEI>'));
  upstream.get('/hugo/chatiments/_binary/plate', (_req, res) => res.type('image/png').send(Buffer.from([137,80,78,71])));
  upstream.get('*.xml', (_req, res) => res.status(404).end());
  upstream.get('/hugo/chatiments/*', (req, res) => { assert.equal(req.get('cookie'), undefined); htmlCalls++; res.type('html').send(html); });
  const source = await listen(upstream), app = express();
  registerTextTwins(app, { serverUrl: source.url, originFor: () => 'https://library.test', defaultImage: () => 'https://library.test/default.jpg' });
  app.get('*', (_req, res) => res.type('html').send('<div id="root"></div><script src="/assets/app.js"></script>'));
  const reader = await listen(app);
  try {
    const path = '/hugo/chatiments/i';
    for (const headers of ['curl/8', 'Lynx/2.9', 'facebookexternalhit', 'Twitterbot', 'Slackbot', 'WhatsApp', 'TelegramBot', 'Discordbot', 'LinkedInBot', 'Mozilla/5.0 Googlebot'].map(agent => ({ 'User-Agent': agent, Accept: 'text/html' }))) {
      const response = await fetch(reader.url + path + '?p=2', { headers });
      assert.equal(response.status, 200);
      for (const name of ['Accept', 'User-Agent', 'Sec-Fetch-Mode']) assert.match(response.headers.get('vary')!, new RegExp(name));
      const $ = load(await response.text());
      assert.equal($('script').length, 0);
      assert.equal($('link[rel="canonical"]').attr('href'), 'https://library.test' + path);
      assert.equal($('meta[property="og:url"]').attr('content'), 'https://library.test' + path + '?p=2');
      assert.match($('meta[property="og:description"]').attr('content')!, /A quotation/);
      assert.equal($('meta[property="og:image"]').attr('content'), 'https://library.test/api/covers/work/hugo/chatiments');
    }
    for (const agent of ['Mozilla/5.0 Chrome/130', 'Mozilla/5.0 Firefox/130', 'Mozilla/5.0 Version/18 Safari/605', 'Mozilla/5.0 Edg/130', 'Mozilla/5.0 iPhone Safari/605']) {
      const browser = await fetch(reader.url + path, { headers: { Accept: 'text/html', 'User-Agent': agent, 'Sec-Fetch-Mode': 'navigate' } });
      const body = await browser.text();
      assert.match(body, /id="root"/); assert.match(body, /<script/);
      assert.doesNotMatch(body, /First &amp; second/);
    }
    const forced = await fetch(reader.url + path + '?view=text', { headers: { Accept: 'text/html', 'User-Agent': 'Mozilla/5.0' } });
    assert.doesNotMatch(await forced.text(), /<script/);
    for (const type of ['text/plain', 'text/markdown', 'application/json']) {
      const response = await fetch(reader.url + path, { headers: { Accept: type } });
      assert.match(response.headers.get('content-type')!, new RegExp(type.replace('/', '\\/')));
      const body = await response.text(); assert.match(body, /First/);
      if (type === 'application/json') assert.equal(JSON.parse(body).id, 2);
    }
    assert.equal((await fetch(reader.url + path + '?p=0')).status, 400);
    assert.equal((await fetch(reader.url + path + '?p=99')).status, 404);
    assert.equal((await fetch(reader.url + '/missing/opus')).status, 404);
    const old = await fetch(reader.url + '/app/reader/hugo/chatiments/i?p=2', { redirect: 'manual' });
    assert.equal(old.status, 301); assert.equal(old.headers.get('location'), path + '?p=2');
    const xml = await fetch(reader.url + '/hugo/chatiments/i.xml');
    assert.equal(xml.status, 200); assert.match(await xml.text(), /<TEI>/);
    const binary = await fetch(reader.url + '/hugo/chatiments/_binary/plate');
    assert.equal(binary.status, 200); assert.equal(binary.headers.get('content-type'), 'image/png');
    assert.deepEqual([...new Uint8Array(await binary.arrayBuffer())], [137,80,78,71]);
    premium = true;
    const before = htmlCalls;
    assert.equal((await fetch(reader.url + '/hugo/chatiments/ii')).status, 403);
    assert.equal(htmlCalls, before);
    assert.equal((await fetch(reader.url + path)).status, 200);
    assert.equal((await fetch(reader.url + '/api/edits', { method: 'POST' })).status, 501);
  } finally { await close(reader.server); await close(source.server); }
});
