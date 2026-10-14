import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveQuoteAddress } from './quoteAddress';
const path = 'writer/book/i';

test('selected display text becomes exact UTF-16 TEI start/end addresses', () => {
  assert.deepEqual(resolveQuoteAddress(path, [{ path: path + '/_2', text: 'Hello world.' }], 'world'), { start: '2.6', end: '2.11' });
  assert.deepEqual(resolveQuoteAddress(path, [{ path: path + '/_2', text: 'A 😀 word.' }], '😀'), { start: '2.2', end: '2.4' });
});
test('whitespace normalization preserves original offsets and paragraph boundaries', () => {
  assert.deepEqual(resolveQuoteAddress(path, [{ path: path + '/_2', text: 'First   word. ' }, { path: path + '/_3/_1', text: 'Next\nline.' }], 'word.\nNext line.'), { start: '2.8', end: '3.1.10' });
});
test('repeated text is resolved using the actual starting block and prefix', () => {
  const paragraphs = [{ path: path + '/_2', text: 'echo echo' }];
  assert.throws(() => resolveQuoteAddress(path, paragraphs, 'echo'), /ambiguous/);
  assert.deepEqual(resolveQuoteAddress(path, paragraphs, 'echo', 'echo echo', 'echo '), { start: '2.5', end: '2.9' });
});
test('unmatched display text and paths outside the chapter do not invent addresses', () => {
  assert.throws(() => resolveQuoteAddress(path, [{ path: 'other/book/_1', text: 'A phrase' }], 'A phrase'), /could not be resolved/);
  assert.throws(() => resolveQuoteAddress(path, [{ path: path + '/_2', text: 'A phrase' }], 'Different words'), /could not be resolved/);
});
