import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';
import { htmlToPlainText } from './plainText';

// The reader derives a chapter's plain text from its HTML instead of a
// second .txt request; it must say what biblioteca-server's tei2text.xsl
// says (checked on dev chapters: identical apart from whitespace).
const parser = () => new (new Window().DOMParser)() as unknown as DOMParser;

test('headings, verse lines and paragraphs each on their own line', () => {
  const html = `<div><h2 id="a">Floarea</h2>
    <div class="lg"><p class="l">Prima linie,</p><p class="l">a doua linie.</p></div>
    <p>Un paragraf <em>frumos</em>.</p></div>`;
  assert.equal(htmlToPlainText(html, parser()), 'Floarea\n\nPrima linie,\na doua linie.\nUn paragraf frumos.');
});

test('a note keeps its text in brackets, from the button title', () => {
  const html = '<p>Text<button type="button" class="btn note" title="explicaţia  notei "><sup>1</sup></button> continuă.</p>';
  assert.equal(htmlToPlainText(html, parser()), 'Text [explicaţia notei] continuă.');
});

test('the title decoration and author line are not text; illustrations and breaks are', () => {
  const html = `<div><h1>Psalmii</h1><p class="deco-title-author-separator">❖</p><h2 class="author">Anonim</h2>
    <p>unu<br/>doi</p><img class="illustration" src="/x/_binary/f1"/></div>`;
  assert.equal(htmlToPlainText(html, parser()), 'Psalmii\n\nunu\ndoi\n[IMAGE].');
});

test('table cells and adjacent blocks never run words together', () => {
  const html = '<table><tr><td>Geleitwort</td><td>1</td></tr><tr><td>Der Satyr</td><td>14</td></tr></table><p>A</p><p>B</p>';
  assert.equal(htmlToPlainText(html, parser()), 'Geleitwort 1\nDer Satyr 14\nA\nB');
});
