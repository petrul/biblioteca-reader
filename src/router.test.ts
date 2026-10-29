import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCatalogFragment, parseAppPath } from './router';

// The works catalog has no Edition (free / premium / unlocked) filter any more.
// Links saved while it existed (#works?access=premium) must not bring back a
// hidden filter that nothing on the page could clear: the parameter is ignored
// and never written again, while the other filters keep working.
test('an old ?access= Edition filter in a catalog link is ignored and not written back', () => {
  const route = parseAppPath('/', '#works?access=premium&lang=fra&page=2');
  assert.equal(route.view, 'browse');
  assert.deepEqual(route.catalog, {
    tab: 'works', worksQuery: '', worksLang: 'fra', worksPage: 2,
    authorsQuery: '', authorsPage: 1, listsType: 'all',
  });
  assert.equal(buildCatalogFragment(route.catalog!), '#works?lang=fra&page=2');
});
