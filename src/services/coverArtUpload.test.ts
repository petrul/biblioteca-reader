import test from 'node:test';
import assert from 'node:assert/strict';
import { withCoverArt } from './coverArtUpload';

const ART = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';

test('an uploaded image becomes the cover request\'s coverArtUrl, everything else unchanged', () => {
  const before = JSON.stringify({ title: 'Alexiada', author: 'Ana Comnena', coverArtUrl: 'https://ziarullumina.ro/x.webp', theme: { paletteId: 'mint_bubblegum' } }, null, 2);
  const after = JSON.parse(withCoverArt(before, ART));
  assert.deepEqual(after, { title: 'Alexiada', author: 'Ana Comnena', coverArtUrl: ART, theme: { paletteId: 'mint_bubblegum' } });
});

test('a request without cover art gets one', () => {
  assert.equal(JSON.parse(withCoverArt('{"title":"Poezii","author":"Mihai Eminescu"}', ART)).coverArtUrl, ART);
});

test('invalid JSON or a non-object is refused, with a reason', () => {
  assert.throws(() => withCoverArt('{"title": ', ART), /JSON is not valid/);
  assert.throws(() => withCoverArt('[1,2]', ART), /must be an object/);
});
