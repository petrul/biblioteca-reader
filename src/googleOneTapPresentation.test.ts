import assert from 'node:assert/strict';
import test from 'node:test';
import { googleIdentityPresentation } from './components/GoogleOneTap';

test('signed-in users keep GIS mounted for silent profile refresh, without a login prompt', () => {
  assert.deepEqual(googleIdentityPresentation(true), { rendered: true, presentPrompt: false });
});

test('anonymous users mount GIS with the One Tap prompt', () => {
  assert.deepEqual(googleIdentityPresentation(false), { rendered: true, presentPrompt: true });
});

test('unknown authentication state does not initialize GIS prematurely', () => {
  assert.deepEqual(googleIdentityPresentation(null), { rendered: false, presentPrompt: false });
});
