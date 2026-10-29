import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { Server } from 'node:http';
import { registerQuoteTwins, quoteSource } from './quoteTwin';
import { parseAppPath, buildAppPath } from '../router';
async function listen(app: ReturnType<typeof express>) {
  const server = await new Promise<Server>(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  return { server, url: `http://127.0.0.1:${(server.address() as { port: number }).port}` };
}
async function close(server: Server) { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }

test('quote routes retain the exact server chapter path and TEI start/end boundaries', () => {
  const route = parseAppPath('/quote/hugo/chatiments/i', '', '?start=2.0&end=2.25');
  assert.equal(route.view, 'reader');
  assert.equal(route.chapterId, 'hugo/chatiments/i');
  assert.equal(buildAppPath(route), '/hugo/chatiments/i/_2:0..2:25');
  assert.throws(() => quoteSource('hugo/chatiments/i', new URLSearchParams()), /Invalid/);
  assert.throws(() => quoteSource('hugo/../secrets', new URLSearchParams('start=2.0&end=2.25')), /Invalid/);
});

test('same quote URL serves JS to modern browsers and server quotation text to curl/Lynx/social scrapers', async () => {
  const upstream = express();
  upstream.get('/api/divs', (_req, res) => res.json({ id: 1, head: 'Les Châtiments', author: { displayName: 'Victor Hugo' } }));
  upstream.get('/api/fragments', (req, res) => {
    assert.equal(req.query.path, 'hugo/chatiments/i');
    assert.equal(req.query.selector, '_2:0..2:25');
    res.json({ kind: 'fragment', text: 'Identical quoted words.\n\nAnother paragraph.',
      html: '<p>Identical quoted words.</p><p>Another paragraph.</p>',
      authorName: 'Victor Hugo', workTitle: 'Les Châtiments', canonicalPath: '/hugo/chatiments/i/_2:0..2:25?rev=' + 'a'.repeat(64) });
  });
  const source = await listen(upstream), app = express();
  registerQuoteTwins(app, { serverUrl: source.url, originFor: () => 'https://library.test' });
  app.get('*', (_req, res) => res.type('html').send('<div id="root"></div><script src="/app.js"></script>'));
  const reader = await listen(app), path = '/quote/hugo/chatiments/i?start=2.0&end=2.25';
  try {
    for (const agent of ['curl/8', 'Lynx/2.9', 'facebookexternalhit', 'Twitterbot', 'Slackbot', 'WhatsApp', 'TelegramBot', 'Discordbot', 'LinkedInBot']) {
      const response = await fetch(reader.url + path, { headers: { Accept: 'text/html', 'User-Agent': agent } });
      assert.equal(response.status, 200, agent);
      const html = await response.text();
      assert.match(html, /Identical quoted words/, agent); assert.doesNotMatch(html, /<script/, agent);
      assert.match(html, /https:\/\/library.test\/hugo\/chatiments\/i\/_2:0\.\.2:25\?rev=/);
      assert.match(response.headers.get('vary')!, /User-Agent/);
    }
    const response = await fetch(reader.url + path, { headers: { Accept: 'text/html', 'User-Agent': 'Mozilla/5.0 Chrome/130' } });
    assert.match(await response.text(), /<script/);
    const api = await fetch(reader.url + '/api/quote?path=hugo%2Fchatiments%2Fi&start=2.0&end=2.25');
    const data = await api.json(); assert.deepEqual(data.paragraphs, ['Identical quoted words.', 'Another paragraph.']);
    assert.equal(data.canonicalUrl, 'https://library.test/hugo/chatiments/i/_2:0..2:25?rev=' + 'a'.repeat(64));
    const plain = await fetch(reader.url + path, { headers: { Accept: 'text/plain' } });
    assert.equal(await plain.text(), data.text);
  } finally { await close(reader.server); await close(source.server); }
});
