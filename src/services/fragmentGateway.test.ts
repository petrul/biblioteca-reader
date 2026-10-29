import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import type { Server } from 'node:http';
import { registerFragmentGateway, legacyParagraphFragment, fragmentSeo } from './fragmentGateway';

const version = 'a'.repeat(64);
const source = 'writer/book/chapter';
const text = 'Exact <words> & source.';
async function listen(app: ReturnType<typeof express>) {
  const server = await new Promise<Server>(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  return { server, url: `http://127.0.0.1:${(server.address() as { port: number }).port}` };
}
async function setup(run: (url: string) => Promise<void>, premium = false) {
  const upstream = express();
  upstream.get('/api/divs', (_req, res) => res.json({ id: 1, head: 'Book', accessType: premium ? 'premium' : 'free' }));
  upstream.get('/api/divs/1/toc', (_req, res) => res.json([{ path: source, leaf: false }, { path: source + '/first', leaf: true }, { path: source + '/locked', leaf: true }]));
  upstream.get('/api/fragments', (req, res) => {
    if (req.query.rev && req.query.rev !== version) { res.status(409).json({ error: 'Source changed' }); return; }
    if (req.query.selector === '_999' || String(req.query.path).endsWith('/_999')) { res.status(400).json({ error: 'Invalid node' }); return; }
    if (String(req.query.path).replace(/^\//, '') === source + '/_99') { res.json({ kind: 'page', sourcePath: source + '/_99' }); return; }
    const tail = String(req.query.path).split('/').at(-1);
    const selector = req.query.selector || (tail?.startsWith('_') ? tail : '_2');
    const canonicalPath = '/' + source + '/' + selector + '?rev=' + version;
    res.json({ kind: 'fragment', sourcePath: source, selector, sourceVersion: version,
      canonicalPath, contextPath: canonicalPath + '&display=context', workId: 'writer/book',
      workTitle: 'Book', chapterId: source, chapterTitle: 'Chapter', authorName: 'Writer',
      language: 'en', text, html: '<p>Exact &lt;words&gt; &amp; source.</p>', startOffset: 0, endOffset: text.length, readingPages: selector === '_4' ? [source + '/locked'] : [source] });
  });
  upstream.get('/' + source + '.html', (_req, res) => res.type('html').send('<div><p><span data-fragment-text data-fragment-from="0" data-fragment-to="23">Exact &lt;words&gt; &amp; source.</span></p><p>Following paragraph.</p></div>'));
  const a = await listen(upstream), app = express(); app.use(express.json());
  registerFragmentGateway(app, { serverUrl: a.url, originFor: () => 'https://library.test' });
  app.get('*', (_req, res) => res.type('html').send('<div id="root"></div><script src="/app.js"></script>'));
  const b = await listen(app);
  try { await run(b.url); }
  finally { await Promise.all([a.server, b.server].map(server => new Promise<void>(resolve => server.close(() => resolve())))); }
}

test('legacy vector URLs and quote/query aliases redirect to the same unprefixed selector convention', async () => {
  await setup(async base => {
    for (const [path, selector] of [['/' + source + '/_2', '_2'], ['/quote/' + source + '?start=2.0&end=2.8', '_2:0..2:8'], ['/' + source + '?start=2.0&end=2.8', '_2:0..2:8']]) {
      const response = await fetch(base + path, { redirect: 'manual' });
      assert.equal(response.status, 302);
      assert.equal(response.headers.get('location'), '/' + source + '/' + selector + '?rev=' + version);
    }
  });
});

test('curl text, JSON, Markdown and HTML render the same precise fragment; modern browsers get the SPA', async () => {
  await setup(async base => {
    const path = '/' + source + '/_2?rev=' + version;
    assert.equal(await (await fetch(base + path, { headers: { Accept: 'text/plain' } })).text(), text);
    const json = await (await fetch(base + path, { headers: { Accept: 'application/json' } })).json();
    assert.equal(json.text, text);
    assert.equal(json.canonicalUrl, 'https://library.test' + path);
    const markdown = await (await fetch(base + path, { headers: { Accept: 'text/markdown' } })).text();
    assert.ok(markdown.startsWith(text)); assert.ok(markdown.includes('Writer, Book'));
    const htmlResponse = await fetch(base + path, { headers: { Accept: 'text/html', 'User-Agent': 'curl/8' } });
    const html = await htmlResponse.text();
    assert.match(html, /Exact &lt;words&gt; &amp; source/); assert.doesNotMatch(html, /<script/);
    assert.match(html, /rel="canonical"/); assert.match(htmlResponse.headers.get('vary')!, /Accept/);
    const browser = await fetch(base + path, { headers: { Accept: 'text/html', 'User-Agent': 'Mozilla/5.0 Chrome/130', 'Sec-Fetch-Mode': 'navigate' } });
    assert.match(await browser.text(), /<script src="\/app.js"/);
  });
});

test('context HTML marks the exact source fragment and retains surrounding text', async () => {
  await setup(async base => {
    const response = await fetch(base + '/' + source + '/_2?rev=' + version + '&display=context', { headers: { Accept: 'text/html', 'User-Agent': 'curl/8' } });
    const html = await response.text();
    assert.match(html, /<mark>Exact &lt;words&gt; &amp; source\.<\/mark>/);
    assert.match(html, /Following paragraph/);
  });
});

test('real anonymous divisions and raw exports bypass fragment rewriting', async () => {
  await setup(async base => {
    for (const path of ['/' + source + '/_99', '/' + source + '/_2.txt', '/api/server-content/' + source + '/_2.html']) {
      const response = await fetch(base + path, { redirect: 'manual' });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('location'), null);
      assert.match(await response.text(), /app.js/);
    }
  });
});

test('bad ranges, unsupported media and changed source revisions fail explicitly', async () => {
  await setup(async base => {
    assert.equal((await fetch(base + '/' + source + '?start=1.0')).status, 400);
    assert.equal((await fetch(base + '/' + source + '/_999')).status, 400);
    assert.equal((await fetch(base + '/' + source + '/_2?rev=' + 'b'.repeat(64))).status, 409);
    assert.equal((await fetch(base + '/' + source + '/_2?rev=' + version, { headers: { Accept: 'image/png' } })).status, 406);
    assert.equal((await fetch(base + '/api/fragments?path=' + source + '&selector=_2&selector=_3')).status, 400);
  });
});

test('paragraph aliases use rendered source paths instead of confusing paragraph N with XML child N', () => {
  const html = '<h3>Title</h3><p class="deco-end">Decoration</p><p data-source-path="2">One</p><p data-source-path="3.1">Two</p>';
  assert.deepEqual(legacyParagraphFragment(html, '1', source), { sourcePath: source, selector: '_2' });
  assert.deepEqual(legacyParagraphFragment(html, '1-2', source), { sourcePath: source, selector: '_2..3.1' });
  assert.throws(() => legacyParagraphFragment(html, '3', source));
  assert.throws(() => legacyParagraphFragment(html, '0', source));
});

test('ancestor fragment endpoints cannot bypass premium preview access in any representation', async () => {
  await setup(async base => {
    for (const accept of ['text/plain', 'text/html', 'application/json', 'text/markdown']) {
      const response = await fetch(base + '/' + source + '/_4?rev=' + version, { headers: { Accept: accept } });
      assert.equal(response.status, 403);
      assert.ok(!(await response.text()).includes(text));
    }
    assert.equal((await fetch(base + '/api/fragments?path=' + source + '&selector=_4')).status, 403);
    assert.equal((await fetch(base + '/api/fragments?path=' + source + '&selector=_2')).status, 200);
  }, true);
});
