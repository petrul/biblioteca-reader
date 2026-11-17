import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DefaultWorkCover } from './DefaultWorkCover';

test('the default work cover masks the source image white bottom margin', () => {
  const html = renderToStaticMarkup(createElement(DefaultWorkCover, { title: 'Alexiada', author: 'Ana Comnena' }));
  assert.match(html, /data-testid="default-cover-bottom"/);
  assert.match(html, /bg-\[#061f3e\]/);
});
