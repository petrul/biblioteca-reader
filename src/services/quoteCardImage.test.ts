import assert from 'node:assert/strict';
import test from 'node:test';
import { fragmentCardImagePath } from './fragmentGateway';
import { QUOTE_CARD_HEIGHT, QUOTE_CARD_MAX_CHARS, QUOTE_CARD_WIDTH, cachedQuoteCard, fittedQuote, quoteCardLayout, quoteCardText, quoteShareTitle, renderQuoteCard, type Node } from './quoteCardImage';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const size = (png: Buffer) => [png.readUInt32BE(16), png.readUInt32BE(20)];

test('a quote card is a 1200x630 PNG, whatever the script', async () => {
  for (const text of ['Am trăit, şi trăim încă.', 'Μῆνιν ἄειδε θεὰ Πηληϊάδεω Ἀχιλῆος', 'Мой дядя самых честных правил']) {
    const png = await renderQuoteCard({ text, authorName: 'Autor', workTitle: 'Opera', chapterTitle: 'Capitolul I' });
    assert.deepEqual(png.subarray(0, 8), PNG_SIGNATURE);
    assert.deepEqual(size(png), [QUOTE_CARD_WIDTH, QUOTE_CARD_HEIGHT]);
  }
});

test('the quote stays readable as a ~200px thumbnail: large type, opening words only', () => {
  // LinkedIn shows a shared link's image about 190px wide - a sixth of the
  // card - so even the smallest quote type is 62px (about 10px there)
  assert.deepEqual(fittedQuote('  Vin   ploile.\n'), { text: 'Vin ploile.', fontSize: 84 });
  for (const length of [10, 80, 120, 300, 5000]) {
    const fitted = fittedQuote('cuvânt '.repeat(Math.ceil(length / 7)).slice(0, length));
    assert.ok(fitted.fontSize >= 62, `${length} chars: ${fitted.fontSize}px`);
    assert.ok(fitted.text.length <= QUOTE_CARD_MAX_CHARS + 1, `${length} chars: ${fitted.text.length} drawn`);
  }
  const long = fittedQuote('cuvânt '.repeat(200));
  assert.ok(long.text.endsWith('cuvânt…'), long.text);
});

test("a shared quote's title opens with its words, then author and work", () => {
  const byron = { text: 'And thus the heart will break, yet brokenly live on: even as a broken mirror, which the glass in every fragment multiplies', authorName: 'George Byron', workTitle: 'Poetry. Vol. VI.' };
  assert.equal(quoteShareTitle(byron), '«And thus the heart will break, yet brokenly live on: even as a broken…» — George Byron, Poetry. Vol. VI.');
  assert.equal(quoteShareTitle({ ...byron, text: 'Vin ploile.' }), '«Vin ploile.» — George Byron, Poetry. Vol. VI.');
  assert.equal(quoteShareTitle({ html: 'Maniak<span class="note"> [nota]</span> şi alţi', text: 'unused', authorName: 'Ana Comnena', workTitle: 'Alexiada' }),
    '«Maniak şi alţi» — Ana Comnena, Alexiada', 'no footnotes in the title either');
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

/** Every string the layout draws, in order. */
const drawnTexts = (node: unknown): string[] => {
  if (typeof node === 'string') return [node];
  if (Array.isArray(node)) return node.flatMap(drawnTexts);
  if (node && typeof node === 'object') return drawnTexts((node as Node).props.children);
  return [];
};

test('the header reads BIBLIOTECA, a diamond, then the site address - no "Source fragment"', () => {
  const layout = quoteCardLayout({ text: 'Vin ploile.', authorName: 'A', workTitle: 'W', site: 'https://biblioteca.scriptorium.ro' });
  const texts = drawnTexts(layout);
  assert.deepEqual(texts.slice(1, 3), ['BIBLIOTECA', 'https://biblioteca.scriptorium.ro'], texts.join(' | '));
  assert.ok(!texts.some(text => /source fragment/i.test(text)));
  // the diamond is a drawn shape, so no font needs a glyph for it
  const nodes = (node: unknown): Node[] => Array.isArray(node) ? node.flatMap(nodes)
    : node && typeof node === 'object' ? [node as Node, ...nodes((node as Node).props.children)] : [];
  assert.equal(nodes(layout).filter(node => node.props.style?.transform === 'rotate(45deg)').length, 1);
});

test('footnotes are left out of the quotation', () => {
  // Ana Comnena's Alexiada, VIII.iv.2: a TEI note inline in the paragraph
  const html = '<div><p>Togortak, Maniak<span class="note"> [Şefii cumani amintiţi de Ana Comnena sînt atestaţi şi de letopiseţele ruseşti, cf. Liubarski, n. 835.]\n</span> şi alţi c&icirc;ţiva războinici</p></div>';
  assert.equal(quoteCardText(html, 'unused'), 'Togortak, Maniak şi alţi cîţiva războinici');
  assert.equal(quoteCardText('<p>un vers<br/>alt vers</p>', 'unused'), 'un vers alt vers');
  assert.equal(quoteCardText(null, 'the plain text'), 'the plain text');
});
