import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import satoriModule from 'satori';
import { load } from 'cheerio';

// The picture a shared quote link shows in a chat or a feed (og:image): the
// reader's quote card - FragmentCard.tsx - drawn as a 1200x630 PNG. The same
// card blue on the site's blue-green gradient, "BIBLIOTECA ◆ <site address>"
// at the top left, the amber rule, the quotation in Newsreader, then the author in Cinzel and
// the work and chapter beneath. Fonts are the reader's own @fontsource
// packages, so the image speaks the site's type; Greek and Cyrillic fall back
// to Gentium Book Plus.

// The CommonJS server bundle (scripts/build-server.mjs, a "type": "module"
// package) hands satori's whole namespace in as the default import; tsx and
// Vite hand the function itself.
const satori: typeof satoriModule = (satoriModule as unknown as { default?: typeof satoriModule }).default ?? satoriModule;

export const QUOTE_CARD_WIDTH = 1200;
export const QUOTE_CARD_HEIGHT = 630;

export interface QuoteCardContent {
  text: string;
  authorName: string;
  workTitle: string;
  chapterTitle?: string;
  /** The address shown after BIBLIOTECA: the site that serves the card. */
  site?: string;
}

export const DEFAULT_SITE = 'https://biblioteca.scriptorium.ro';

type Weight = 400 | 500 | 600 | 700;
interface Font { name: string; data: Buffer; weight: Weight; style: 'normal' | 'italic' }

let fonts: Font[] | undefined;
function loadFonts(): Font[] {
  if (fonts) return fonts;
  const file = (pkg: string, name: string) =>
    readFileSync(path.join(process.cwd(), 'node_modules', '@fontsource', pkg, 'files', `${name}.woff`));
  // Each subset is its own family: satori looks for a missing glyph in the
  // next family of the fontFamily list, not in another file of the same one.
  const family = (name: string, pkg: string, variants: Array<[Weight, 'normal' | 'italic']>, subsets: string[]) =>
    variants.flatMap(([weight, style]) => subsets.map(subset => ({ name: `${name} ${subset}`, weight, style, data: file(pkg, `${pkg}-${subset}-${weight}-${style}`) })));
  fonts = [
    ...family('Newsreader', 'newsreader', [[400, 'normal'], [400, 'italic']], LATIN),
    ...family('Cinzel', 'cinzel', [[600, 'normal']], LATIN),
    ...family('Plus Jakarta Sans', 'plus-jakarta-sans', [[400, 'normal'], [700, 'normal']], LATIN),
    ...family('Gentium Book Plus', 'gentium-book-plus', [[400, 'normal']], [...LATIN, ...OTHER_SCRIPTS]),
  ];
  return fonts;
}

const LATIN = ['latin', 'latin-ext'];
const OTHER_SCRIPTS = ['greek', 'greek-ext', 'cyrillic', 'cyrillic-ext'];
/** A family, then Gentium for whatever script it lacks. */
const stack = (name: string) => [...LATIN.map(subset => `${name} ${subset}`), ...[...LATIN, ...OTHER_SCRIPTS].map(subset => `Gentium Book Plus ${subset}`)]
  .map(family => `'${family}'`).join(', ');
const SERIF = stack('Newsreader'), DISPLAY = stack('Cinzel'), SANS = stack('Plus Jakarta Sans');

/**
 * Text as the card's fonts can draw it: composed (NFC). Some sources spell
 * ş, ţ, ă as a letter plus a combining mark (S + U+0327), and the fonts have
 * the composed letters but no combining marks - those drew as squares.
 */
const drawable = (text: string) => text.normalize('NFC');

/**
 * The words of a fragment the card shows: its HTML without footnotes (the
 * server renders a TEI note as <span class="note"> [...]</span>, inline in
 * the text), else its plain text. Line breaks become spaces.
 */
export function quoteCardText(html: string | null | undefined, text: string): string {
  if (!html) return text;
  const $ = load(`<div id="quote">${html}</div>`);
  $('.note, sup, script, style').remove();
  $('br').replaceWith(' ');
  $('p, div, .l, .lg').append(' ');
  const words = $('#quote').text().replace(/\s+/g, ' ').trim();
  return words || text;
}

/**
 * The quotation as it fits the card - in type big enough to read when the
 * card is shown as a thumbnail (LinkedIn shows shared links about 190px wide,
 * a sixth of the card): short quotes whole, longer ones cut at a word after
 * at most QUOTE_CARD_MAX_CHARS characters, with an ellipsis.
 */
export function fittedQuote(text: string): { text: string; fontSize: number } {
  const plain = drawable(text).replace(/\s+/g, ' ').trim();
  const sizes: Array<[number, number]> = [[60, 84], [100, 72], [QUOTE_CARD_MAX_CHARS, 62]];
  for (const [chars, fontSize] of sizes) if (plain.length <= chars) return { text: plain, fontSize };
  const cut = plain.slice(0, QUOTE_CARD_MAX_CHARS);
  const lastSpace = cut.lastIndexOf(' ');
  return { text: `${(lastSpace > QUOTE_CARD_MAX_CHARS * 0.6 ? cut.slice(0, lastSpace) : cut).replace(/[\s,;:.—-]+$/u, '')}…`, fontSize: 62 };
}

export const QUOTE_CARD_MAX_CHARS = 130;

/**
 * A shared quote's title (og:title, <title>): its opening words, then who and
 * where - «And thus the heart will break…» — George Byron, Poetry. Vol. VI.
 * Where a site shows the card as a thumbnail, the title says what is quoted.
 */
export function quoteShareTitle(quote: { html?: string | null; text: string; authorName: string; workTitle: string }, maxChars = 70): string {
  const words = drawable(quoteCardText(quote.html, quote.text)).replace(/\s+/g, ' ').trim();
  let opening = words;
  if (words.length > maxChars) {
    const cut = words.slice(0, maxChars);
    const lastSpace = cut.lastIndexOf(' ');
    opening = `${(lastSpace > maxChars * 0.5 ? cut.slice(0, lastSpace) : cut).replace(/[\s,;:.—-]+$/u, '')}…`;
  }
  return `«${opening}» — ${drawable(quote.authorName)}, ${drawable(quote.workTitle)}`;
}

const clip = (value: string, max: number) => {
  const text = drawable(value);
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
};

export type Node = { type: string; props: { style?: Record<string, unknown>; children?: unknown } };
const h = (type: string, style: Record<string, unknown>, ...children: unknown[]): Node =>
  ({ type, props: { style, children: children.length === 1 ? children[0] : children } });

/** The card's layout tree, for satori. */
export function quoteCardLayout(content: QuoteCardContent): Node {
  const quote = fittedQuote(content.text);
  const byline = [clip(content.authorName, 50), clip(content.workTitle, 60)].filter(Boolean);
  return h('div', {
    width: '100%', height: '100%', display: 'flex', padding: 20,
    background: 'linear-gradient(90deg, #024063 0%, #3ca83f 22%, #044a6f 100%)',
  },
  h('div', {
    position: 'relative', width: QUOTE_CARD_WIDTH - 40, height: QUOTE_CARD_HEIGHT - 40,
    display: 'flex', flexDirection: 'column', overflow: 'hidden',
    background: '#061d28', border: '2px solid rgba(255,255,255,0.2)', borderRadius: 32, color: '#ffffff',
  },
  h('div', { position: 'absolute', top: -60, right: 30, fontFamily: SERIF, fontSize: 420, lineHeight: 1, color: 'rgba(252,211,77,0.08)' }, '”'),
  h('div', {
    display: 'flex', alignItems: 'center', flexShrink: 0,
    padding: '18px 48px', borderBottom: '1px solid rgba(255,255,255,0.15)',
  },
  h('div', { display: 'flex', fontFamily: DISPLAY, fontWeight: 600, fontSize: 30, color: '#fcd34d', letterSpacing: 3 }, 'BIBLIOTECA'),
  // the diamond is drawn, not a glyph: no font of the card need have one
  h('div', { display: 'flex', width: 11, height: 11, margin: '0 20px', background: '#f59e0b', transform: 'rotate(45deg)' }),
  h('div', { display: 'flex', fontFamily: SANS, fontSize: 26, color: 'rgba(255,255,255,0.75)' }, clip(content.site || DEFAULT_SITE, 50))),
  h('div', { flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', overflow: 'hidden', padding: '16px 48px' },
    h('div', {
      display: 'flex', width: '100%', borderLeft: '8px solid #f59e0b', paddingLeft: 32,
      fontFamily: SERIF, fontSize: quote.fontSize, lineHeight: 1.22, color: '#ffffff',
    }, `«${quote.text}»`)),
  // author and work on one line, as large as the room allows; the chapter
  // would be unreadable in a thumbnail, and the link leads to it
  h('div', {
    display: 'flex', alignItems: 'baseline', flexShrink: 0, margin: '0 48px', padding: '16px 0 24px',
    borderTop: '1px solid rgba(255,255,255,0.15)', overflow: 'hidden',
  },
  h('div', { display: 'flex', flexShrink: 0, fontFamily: DISPLAY, fontWeight: 600, fontSize: 38 }, byline[0]),
  h('div', { display: 'flex', fontFamily: SERIF, fontStyle: 'italic', fontSize: 36, color: '#fcd34d', marginLeft: 24 }, byline[1] ?? ''))));
}

/** The quote card as a PNG. */
export async function renderQuoteCard(content: QuoteCardContent): Promise<Buffer> {
  const svg = await satori(quoteCardLayout(content) as never, { width: QUOTE_CARD_WIDTH, height: QUOTE_CARD_HEIGHT, fonts: loadFonts() });
  return new Resvg(svg, { fitTo: { mode: 'width', value: QUOTE_CARD_WIDTH } }).render().asPng();
}

const CACHE_LIMIT = 256;
const rendered = new Map<string, Promise<Buffer>>();

/** renderQuoteCard, remembered for the last 256 quotes: a shared link's card is fetched by every chat it lands in. */
export function cachedQuoteCard(key: string, content: () => Promise<QuoteCardContent>): Promise<Buffer> {
  const known = rendered.get(key);
  if (known) {
    rendered.delete(key);
    rendered.set(key, known);
    return known;
  }
  const png = content().then(renderQuoteCard);
  rendered.set(key, png);
  png.catch(() => rendered.delete(key));
  if (rendered.size > CACHE_LIMIT) rendered.delete(rendered.keys().next().value!);
  return png;
}
