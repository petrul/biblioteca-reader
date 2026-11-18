import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ChatReferences, bibliotecaPathHref, chatReferencesFromPassages, chatReferencesFromText, markdownInline } from './ChatWidget';

test('chat turns stable Biblioteca passage paths into same-origin reader links', () => {
  const html = renderToStaticMarkup(createElement('p', null, markdownInline(
    'J. Dawson este indicat în frazer/the_belief/the_belief/lecture_vi/_125.'
  )));
  assert.match(html, /data-biblioteca-reference="true"/);
  assert.match(html, /href="\/frazer\/the_belief\/the_belief\/lecture_vi\/_125"/);
  assert.match(html, /frazer\/the_belief\/the_belief\/lecture_vi\/_125/);
});

test('numbered citations in an answer link to the corresponding reference', () => {
  const html = renderToStaticMarkup(createElement('p', null, markdownInline(
    'Pasajul relevant este aici [1].',
    [{ href: '/frazer/the_belief/lecture_vi/_125', label: 'The Belief' }],
  )));
  assert.match(html, /href="\/frazer\/the_belief\/lecture_vi\/_125"/);
  assert.match(html, />\[1\]<\/a>/);
});

test('chat references are synthesized from passages, deduplicated, and rendered after the answer', () => {
  const references = chatReferencesFromPassages([
    { url: 'http://localhost:8080/frazer/the_belief/the_belief/lecture_vi/_125', title: 'The Belief — Lecția VI' },
    { url: '/frazer/the_belief/the_belief/lecture_vi/_125', title: 'duplicate' },
    { url: 'https://biblioteca.test/frazer/the_golden_bough_viii/spirits_of_the_corn/footnotes/_1996' },
  ]);
  assert.deepEqual(references.map(reference => reference.href), [
    '/frazer/the_belief/the_belief/lecture_vi/_125',
    '/frazer/the_golden_bough_viii/spirits_of_the_corn/footnotes/_1996',
  ]);
  const html = renderToStaticMarkup(createElement(ChatReferences, { references, onSaveReference: () => {}, onSaveReferences: () => {} }));
  assert.match(html, /data-testid="chat-references"/);
  assert.match(html, /Referințe pentru explorare/);
  assert.match(html, /href="\/frazer\/the_belief\/the_belief\/lecture_vi\/_125"/);
  assert.match(html, /The Belief — Lecția VI/);
  assert.match(html, /href="\/frazer\/the_golden_bough_viii\/spirits_of_the_corn\/footnotes\/_1996"/);
  assert.match(html, /Salvează lista/);
  assert.match(html, /Salvează The Belief/);
  assert.doesNotMatch(html, /localhost:8080/);
});

test('reference URLs never preserve an internal host', () => {
  assert.equal(bibliotecaPathHref('http://localhost:8080/frazer/the_belief/lecture_vi/_125'), '/frazer/the_belief/lecture_vi/_125');
  assert.equal(bibliotecaPathHref('https://biblioteca.test/frazer/the_belief/lecture_vi/_125?x=1'), '/frazer/the_belief/lecture_vi/_125');
  assert.equal(bibliotecaPathHref('not a passage'), null);
});

test('a model citation in prose is also promoted to the references list', () => {
  assert.deepEqual(chatReferencesFromText('Sursa este frazer/the_golden_bough_viii/spirits_of_the_corn/footnotes/_1996.'), [
    {
      href: '/frazer/the_golden_bough_viii/spirits_of_the_corn/footnotes/_1996',
      label: 'frazer/the_golden_bough_viii/spirits_of_the_corn/footnotes/_1996',
      title: 'frazer/the_golden_bough_viii/spirits_of_the_corn/footnotes/_1996',
    },
  ]);
  const empty = renderToStaticMarkup(createElement(ChatReferences, { references: [] }));
  assert.match(empty, /data-testid="chat-references"/);
  assert.match(empty, /Nu am găsit o trimitere stabilă/);
});
