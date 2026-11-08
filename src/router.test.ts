import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_CATALOG_STATE, buildAppPath, buildCatalogFragment, parseAppPath } from './router';

// The works catalog has no Edition (free / premium / unlocked) filter any more.
// Links saved while it existed (#works?access=premium) must not bring back a
// hidden filter that nothing on the page could clear: the parameter is ignored
// and never written again, while the other filters keep working.
test('an old ?access= Edition filter in a catalog link is ignored and not written back', () => {
  const route = parseAppPath('/app/catalog', '#works?access=premium&lang=fra&page=2');
  assert.equal(route.view, 'catalog');
  assert.deepEqual(route.catalog, {
    tab: 'works', worksQuery: '', worksLang: 'fra', worksPage: 2,
    authorsQuery: '', authorsPage: 1, listsType: 'all',
  });
  assert.equal(buildCatalogFragment(route.catalog!), '#works?lang=fra&page=2');
});

test('the catalogue has its own page; plain /app is the home page', () => {
  assert.deepEqual(parseAppPath('/app'), { view: 'browse' });
  assert.deepEqual(parseAppPath('/app/catalog'), { view: 'catalog' });
  assert.equal(parseAppPath('/app/catalog', '#authors?q=cicero').catalog?.authorsQuery, 'cicero');
  // Caddy strips the /app mount before the reader's server sees the path.
  assert.equal(parseAppPath('/catalog').view, 'catalog');
  assert.equal(buildAppPath({ view: 'browse' }), '/app');
  assert.equal(buildAppPath({ view: 'catalog' }), '/app/catalog');
  assert.equal(buildAppPath({ view: 'catalog', catalog: { ...DEFAULT_CATALOG_STATE, tab: 'authors', authorsPage: 2 } }),
    '/app/catalog#authors?page=2');
});

test('catalogue links from before it had its own page still open the catalogue', () => {
  const route = parseAppPath('/app', '#lists?type=author');
  assert.equal(route.view, 'catalog');
  assert.equal(route.catalog?.tab, 'reading-lists');
  assert.equal(route.catalog?.listsType, 'author');
});

test('Bible works keep the canonical trad/biblia-* reader namespace', () => {
  const route = parseAppPath('/trad/biblia-ortodoxa/cartea-facerii/1');
  assert.equal(route.view, 'reader');
  assert.equal(route.workId, 'trad/biblia-ortodoxa');
  assert.equal(route.chapterId, 'trad/biblia-ortodoxa/cartea-facerii/1');
  assert.equal(buildAppPath(route), '/trad/biblia-ortodoxa/cartea-facerii/1');
});

test('saved searches have a bookmarkable route', () => {
  assert.deepEqual(parseAppPath('/app/search/saved/search-123'), { view: 'search', search: { savedSearchId: 'search-123' } });
  assert.equal(buildAppPath({ view: 'search', search: { savedSearchId: 'search-123' } }), '/app/search/saved/search-123');
});
