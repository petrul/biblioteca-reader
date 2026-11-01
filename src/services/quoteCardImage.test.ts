import assert from 'node:assert/strict';
import test from 'node:test';
import { fragmentCardImagePath } from './fragmentGateway';
import { QUOTE_CARD_HEIGHT, QUOTE_CARD_WIDTH, cachedQuoteCard, fittedQuote, renderQuoteCard } from './quoteCardImage';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const size = (png: Buffer) => [png.readUInt32BE(16), png.readUInt32BE(20)];

test('a quote card is a 1200x630 PNG, whatever the script', async () => {
  for (const text of ['Am trăit, şi trăim încă.', 'Μῆνιν ἄειδε θεὰ Πηληϊάδεω Ἀχιλῆος', 'Мой дядя самых честных правил']) {
    const png = await renderQuoteCard({ text, authorName: 'Autor', workTitle: 'Opera', chapterTitle: 'Capitolul I' });
    assert.deepEqual(png.subarray(0, 8), PNG_SIGNATURE);
    assert.deepEqual(size(png), [QUOTE_CARD_WIDTH, QUOTE_CARD_HEIGHT]);
  }
});

test('a short quote is set large; a long one smaller, cut at a word with an ellipsis', () => {
  assert.deepEqual(fittedQuote('  Vin   ploile.\n'), { text: 'Vin ploile.', fontSize: 50 });
  const long = fittedQuote('cuvânt '.repeat(200));
  assert.equal(long.fontSize, 30);
  assert.ok(long.text.length <= 401 && long.text.endsWith('cuvânt…'), long.text);
});

test('letters spelled with a combining mark are composed, so the fonts can draw them', () => {
  // Ana Comnena's Alexiada: "[S\u0327efii cumani amintit\u0326i ..." drew squares
  assert.equal(fittedQuote('S\u0327efii amintit\u0326i s\u0326i letopiset\u0327ele').text, 'Şefii amintiți și letopiseţele');
});

test('a card is rendered once, then served from memory', async () => {
  let resolved = 0;
  const content = async () => { resolved++; return { text: 'Vin ploile.', authorName: 'A', workTitle: 'W' }; };
  const first = await cachedQuoteCard('test-key', content);
  assert.equal(await cachedQuoteCard('test-key', content), first);
  assert.equal(resolved, 1);
});

test("a fragment's og:image is its card, pinned to its revision", () => {
  assert.equal(fragmentCardImagePath({ sourcePath: 'hugo/le_roi_s_amuse', selector: '_3..5', sourceVersion: 'abc' }),
    '/api/fragments/card.png?path=hugo%2Fle_roi_s_amuse&selector=_3..5&rev=abc');
  assert.equal(fragmentCardImagePath({ sourcePath: 'a/b', selector: '_1' }), '/api/fragments/card.png?path=a%2Fb&selector=_1');
});
