import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { markdownInline } from './ChatWidget';

test('chat Markdown renders emphasis, code, and safe links as elements', () => {
  const html = renderToStaticMarkup(createElement('p', null, markdownInline('său ucenic sau fiu adoptiv), **Cecilia**, `text` și [Biblioteca](https://biblioteca.scriptorium.ro)')));
  assert.match(html, /<strong>Cecilia<\/strong>/);
  assert.match(html, /<code[^>]*>text<\/code>/);
  assert.match(html, /href="https:\/\/biblioteca\.scriptorium\.ro"/);
  assert.doesNotMatch(html, /<script/);
});
