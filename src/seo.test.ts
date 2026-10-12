import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPageSeo, buildRobotsTxt, buildSitemapXml, parseAppPath, renderIndexHtml, type PageSeo } from './seo';

const BIBLIOTECA_SERVER_URL = 'http://biblioteca-server.test';
const ORIGIN = 'https://biblioteca.scriptorium.ro';
const DEFAULT_IMAGE = `${ORIGIN}/cover-blue.jpg`;

// A tiny route table keyed by a regex over the request URL - every test
// below only needs to describe the handful of upstream responses its own
// route actually triggers, not the whole of biblioteca-server's API.
function withFetchMock<T>(routes: Array<[RegExp, () => Response]>, fn: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = input instanceof Request ? input.url : String(input);
    const match = routes.find(([pattern]) => pattern.test(url));
    if (!match) throw new Error(`unmocked fetch: ${url}`);
    return match[1]();
  }) as typeof fetch;
  return fn().finally(() => { globalThis.fetch = original; });
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

function seoFor(route: ReturnType<typeof parseAppPath>, path: string, search = ''): Promise<PageSeo> {
  return buildPageSeo({
    route,
    origin: ORIGIN,
    path,
    searchParams: new URLSearchParams(search),
    bibliotecaServerUrl: BIBLIOTECA_SERVER_URL,
    defaultImage: DEFAULT_IMAGE
  });
}

const STORED_COVER = 'https://test.scriptorium.ro/biblioteca/covers/abbott_edwin_a/flatland-0123abcd.png';

test('work page: real title/description, the stored cover as og+twitter image, Book JSON-LD', async () => {
  const seo = await withFetchMock(
    [[/\/api\/divs\?path=/, () => json({ id: 1, head: 'Flatland', coverUrl: STORED_COVER, author: { displayName: 'Edwin A. Abbott' } })]],
    () => seoFor(parseAppPath('/app/work/abbott_edwin_a/flatland'), '/app/work/abbott_edwin_a/flatland')
  );

  assert.equal(seo.title, 'Flatland by Edwin A. Abbott | Biblioteca');
  assert.match(seo.description, /Flatland/);
  assert.equal(seo.image, STORED_COVER);
  assert.equal(seo.imageType, 'image/png');
  assert.equal(seo.robots, 'index, follow');
  assert.ok(seo.jsonLd);
  const ld = JSON.parse(seo.jsonLd!);
  assert.equal(ld['@type'], 'Book');
  assert.equal(ld.image, seo.image);
});

test('a work without a stored cover gets the default image - SEO never asks for a cover to be rendered', async () => {
  const seo = await withFetchMock(
    [[/\/api\/divs\?path=/, () => json({ id: 1, head: 'Flatland', author: { displayName: 'Edwin A. Abbott' } })]],
    () => seoFor(parseAppPath('/app/work/abbott_edwin_a/flatland'), '/app/work/abbott_edwin_a/flatland')
  );
  assert.equal(seo.image, DEFAULT_IMAGE);
  assert.equal(seo.imageType, 'image/jpeg');
  assert.ok(!seo.image.includes('/api/covers/'), 'no on-demand cover rendering URL');
});

test('reader page with an inline TEI illustration: og/twitter image is the illustration, not the cover', async () => {
  const chapterPath = '/app/reader/mitru/povesti_despre_pacala_si_tandala/lacul_popii';
  const seo = await withFetchMock(
    [
      [/\/api\/divs\?path=mitru%2Fpovesti_despre_pacala_si_tandala%2Flacul_popii/, () =>
        json({ id: 2, head: 'Lacul popii', author: { displayName: 'Alexandru Mitru' } })],
      [/\/api\/divs\?path=mitru%2Fpovesti_despre_pacala_si_tandala$/, () =>
        json({ id: 1, head: 'Povești despre Păcală și Tândală', author: { displayName: 'Alexandru Mitru' } })],
      [/\.xml$/, () => new Response(
        '<div><p><figure><binaryObject encoding="base64" mimeType="image/jpg" xml:id="d3e4561">...</binaryObject></figure></p></div>',
        { status: 200, headers: { 'Content-Type': 'application/xml' } }
      )]
    ],
    () => seoFor(parseAppPath(chapterPath), chapterPath)
  );

  assert.equal(seo.image, `${ORIGIN}/api/server-content/mitru/povesti_despre_pacala_si_tandala/_binary/d3e4561`);
  assert.equal(seo.imageType, 'image/jpeg');
  assert.match(seo.imageAlt, /Illustration/);
  assert.equal(seo.robots, 'index, follow');
  const ld = JSON.parse(seo.jsonLd!);
  assert.equal(ld.image, seo.image);
});

test('reader page with no inline image falls back to the work\'s stored cover', async () => {
  const chapterPath = '/app/reader/abbott_edwin_a/flatland/preface';
  const seo = await withFetchMock(
    [
      [/\/api\/divs\?path=abbott_edwin_a%2Fflatland%2Fpreface/, () => json({ id: 3, head: 'Preface', author: { displayName: 'Edwin A. Abbott' } })],
      [/\/api\/divs\?path=abbott_edwin_a%2Fflatland$/, () => json({ id: 1, head: 'Flatland', coverUrl: STORED_COVER, author: { displayName: 'Edwin A. Abbott' } })],
      [/\.xml$/, () => new Response('<div><p>No images here.</p></div>', { status: 200, headers: { 'Content-Type': 'application/xml' } })]
    ],
    () => seoFor(parseAppPath(chapterPath), chapterPath)
  );

  assert.equal(seo.image, STORED_COVER);
  assert.equal(seo.imageType, 'image/png');
});

test('author page: bio as description, portrait proxied through server-content as og+twitter image, Person JSON-LD', async () => {
  const seo = await withFetchMock(
    [[/\/api\/authors\/abbott$/, () => json({
      strId: 'abbott', displayName: 'G. F. Abbott', bio: 'A Greek-British travel writer.',
      image_href: 'http://biblioteca-server.test/img/authors/abbott.jpg', birthDate: '1874', deathDate: '1947'
    })]],
    () => seoFor(parseAppPath('/app/author/abbott'), '/app/author/abbott')
  );

  assert.equal(seo.title, 'G. F. Abbott | Biblioteca');
  assert.equal(seo.description, 'A Greek-British travel writer.');
  assert.equal(seo.image, `${ORIGIN}/api/server-content/img/authors/abbott.jpg`);
  assert.equal(seo.imageType, 'image/jpeg');
  const ld = JSON.parse(seo.jsonLd!);
  assert.equal(ld['@type'], 'Person');
  assert.equal(ld.image, seo.image);
});

test('author with no portrait falls back to the generic default image', async () => {
  const seo = await withFetchMock(
    [[/\/api\/authors\//, () => json({ strId: 'nobody', displayName: 'Nobody Special' })]],
    () => seoFor(parseAppPath('/app/author/nobody'), '/app/author/nobody')
  );
  assert.equal(seo.image, DEFAULT_IMAGE);
});

test('quote page: generic default image and title, noindex (content only ever lives in localStorage)', async () => {
  const seo = await seoFor(parseAppPath('/app/quote/quote-123'), '/app/quote/quote-123');
  assert.equal(seo.image, DEFAULT_IMAGE);
  assert.equal(seo.imageType, 'image/jpeg');
  assert.equal(seo.title, 'Quoted Passage | Biblioteca');
  assert.equal(seo.robots, 'noindex, follow');
  assert.equal(seo.jsonLd, null);
});

test('search page: dynamic title from the query, generic default image, noindex/follow', async () => {
  const seo = await seoFor(parseAppPath('/app/search', '', 'mode=title&q=flatland'), '/app/search', 'mode=title&q=flatland');
  assert.equal(seo.title, '“flatland” search results | Biblioteca');
  assert.equal(seo.image, DEFAULT_IMAGE);
  assert.equal(seo.robots, 'noindex, follow');
});

test('admin and collections pages: generic default image, noindex/nofollow', async () => {
  const admin = await seoFor(parseAppPath('/app/admin'), '/app/admin');
  assert.equal(admin.image, DEFAULT_IMAGE);
  assert.equal(admin.robots, 'noindex, nofollow');

  const collections = await seoFor(parseAppPath('/app/collections'), '/app/collections');
  assert.equal(collections.image, DEFAULT_IMAGE);
  assert.equal(collections.robots, 'noindex, nofollow');
});

test('home/browse page: generic default image, indexable, WebSite JSON-LD with a search action', async () => {
  const seo = await seoFor(parseAppPath('/app'), '/app');
  assert.equal(seo.image, DEFAULT_IMAGE);
  assert.equal(seo.robots, 'index, follow');
  const ld = JSON.parse(seo.jsonLd!);
  assert.equal(ld['@type'], 'WebSite');
  assert.equal(ld.potentialAction['@type'], 'SearchAction');
});

test('a resolution failure (biblioteca-server unreachable) falls back to generic SEO rather than throwing', async () => {
  const seo = await withFetchMock(
    [[/\/api\/divs\?path=/, () => { throw new Error('ECONNREFUSED'); }]],
    () => seoFor(parseAppPath('/app/work/nope/nope'), '/app/work/nope/nope')
  );
  assert.equal(seo.title, 'Biblioteca — a digital library of classics');
  assert.equal(seo.image, DEFAULT_IMAGE);
});

test('renderIndexHtml: og/twitter cards (including image) are present and escaped in the HTML shell', () => {
  const template = [
    '<title>__PAGE_TITLE__</title>',
    '<meta name="description" content="__PAGE_DESCRIPTION__" />',
    '<meta name="robots" content="__ROBOTS__" />',
    '<link rel="canonical" href="__CANONICAL_URL__" />',
    '<meta property="og:title" content="__PAGE_TITLE__" />',
    '<meta property="og:description" content="__PAGE_DESCRIPTION__" />',
    '<meta property="og:url" content="__CANONICAL_URL__" />',
    '<meta property="og:image" content="__OG_IMAGE_URL__" />',
    '<meta property="og:image:type" content="__OG_IMAGE_TYPE__" />',
    '<meta property="og:image:alt" content="__OG_IMAGE_ALT__" />',
    '<meta name="twitter:card" content="summary_large_image" />',
    '<meta name="twitter:title" content="__PAGE_TITLE__" />',
    '<meta name="twitter:description" content="__PAGE_DESCRIPTION__" />',
    '<meta name="twitter:image" content="__OG_IMAGE_URL__" />',
    '__JSON_LD__'
  ].join('\n');

  const seo: PageSeo = {
    language: 'en',
    title: 'Tom & Jerry\'s "Tale" | Biblioteca',
    description: 'A <story> with "quotes" & ampersands.',
    image: `${ORIGIN}/api/covers/work/a/b`,
    imageType: 'image/png',
    imageAlt: 'Cover art',
    canonicalUrl: `${ORIGIN}/app/work/a/b`,
    robots: 'index, follow',
    jsonLd: '{"@type":"Book","name":"</script><script>alert(1)</script>"}'
  };

  const html = renderIndexHtml(template, seo);

  // og: card present with a real image
  assert.match(html, /<meta property="og:title" content="Tom &amp; Jerry&#39;s &quot;Tale&quot; \| Biblioteca" \/>/);
  assert.match(html, new RegExp(`<meta property="og:image" content="${seo.image.replace(/\//g, '\\/')}" \\/>`));
  assert.match(html, /<meta property="og:image:type" content="image\/png" \/>/);
  // twitter: card present with the same image
  assert.match(html, /<meta name="twitter:card" content="summary_large_image" \/>/);
  assert.match(html, new RegExp(`<meta name="twitter:image" content="${seo.image.replace(/\//g, '\\/')}" \\/>`));
  // description is HTML-escaped (no raw <story> / unescaped quotes reach the DOM attribute)
  assert.match(html, /content="A &lt;story&gt; with &quot;quotes&quot; &amp; ampersands\."/);
  // JSON-LD is embedded but defanged against breaking out of the <script>
  // tag: every '<' in the payload is escaped to the literal text \u003c
  // (still valid inside a JSON string), so only this module's own
  // wrapper tags remain as real '<script'/'</script>' sequences - the
  // payload's attempted "</script><script>alert(1)</script>" must not
  // add any more of either.
  assert.equal((html.match(/<script type="application\/ld\+json">/g) ?? []).length, 1);
  assert.equal((html.match(/<\/script>/g) ?? []).length, 1);
  assert.ok(html.includes('\\u003c/script>\\u003cscript>alert(1)\\u003c/script>'));
  // no leftover placeholders
  assert.ok(!html.includes('__'));
});

test('buildRobotsTxt: allows the site, blocks api/admin/collections, points at the sitemap', () => {
  const txt = buildRobotsTxt(ORIGIN);
  assert.match(txt, /^User-agent: \*/);
  assert.match(txt, /Disallow: \/api\//);
  assert.match(txt, /Disallow: \/app\/admin/);
  assert.match(txt, /Disallow: \/app\/collections/);
  assert.match(txt, new RegExp(`Sitemap: ${ORIGIN}/sitemap\\.xml`));
  // search results are crawlable (noindex'd via meta robots instead, not blocked here)
  assert.ok(!txt.includes('/app/search'));
});

test('buildSitemapXml: paginates past the works endpoint\'s silent 100-item cap and de-dupes', async () => {
  let worksPageCalls = 0;
  const xml = await withFetchMock(
    [
      [/\/api\/authors\/$/, () => json([{ strId: 'abbott' }, { strId: 'mitru' }])],
      [/\/api\/works\?page=/, () => {
        worksPageCalls += 1;
        // Page 0: a full 100-item page that includes a duplicate of a work
        // page 1 will also return (simulating pagination drift on a live,
        // changing catalog) - the sitemap must still de-dupe it.
        if (worksPageCalls === 1) {
          const items = Array.from({ length: 100 }, (_, i) => ({ opus: true, path: `author${i}/work${i}` }));
          return json({ items });
        }
        if (worksPageCalls === 2) {
          return json({ items: [{ opus: true, path: 'author0/work0' }, { opus: true, path: 'mitru/povesti' }] });
        }
        return json({ items: [] });
      }]
    ],
    () => buildSitemapXml(ORIGIN, BIBLIOTECA_SERVER_URL)
  );

  assert.ok(worksPageCalls >= 2, 'must follow pagination past the first 100-item page');
  assert.equal((xml.match(/<url>/g) ?? []).length, 1 + 2 + 101); // home + 2 authors + 101 distinct works
  assert.equal((xml.match(/author0\/work0/g) ?? []).length, 1, 'duplicate work URL must be de-duped');
  assert.ok(xml.includes(`<loc>${ORIGIN}/app</loc>`));
  assert.ok(xml.includes(`<loc>${ORIGIN}/app/author/mitru</loc>`));
  assert.ok(xml.includes(`<loc>${ORIGIN}/app/work/mitru/povesti</loc>`));
});
