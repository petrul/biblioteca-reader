import assert from 'node:assert/strict';
import test from 'node:test';
import { withoutLegacyCoverArtUrl } from './coverRequest';

test('stored cover JSON does not re-propose deleted local author portraits', () => {
  assert.deepEqual(
    withoutLegacyCoverArtUrl({ title: 'Alexiada', coverArtUrl: 'http://localhost:8080/img/authors/comnena.jpg', layout: 'folio_bauhaus' }),
    { title: 'Alexiada', layout: 'folio_bauhaus' }
  );
  const external = { title: 'Alexiada', coverArtUrl: 'https://commons.wikimedia.org/a.jpg' };
  assert.equal(withoutLegacyCoverArtUrl(external), external);
});
