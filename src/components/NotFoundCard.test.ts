import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NotFoundCard } from './NotFoundCard';

test('reader not-found page uses its bundled 404 artwork', () => {
  const html = renderToStaticMarkup(createElement(NotFoundCard, {
    message: 'Not found',
    primaryLabel: 'Back',
    onPrimary: () => {},
  }));

  assert.match(html, /src="\/404\.jpeg"/);
});
