import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderServerErrorPage } from './httpErrorPage';

test('reader server error page uses its bundled art under the public base path', () => {
  const html = renderServerErrorPage('/app');

  assert.match(html, /src="\/app\/500\.jpeg"/);
  assert.match(html, /5xx/);
  assert.match(html, /href="\/app\/"/);
});
