import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import satoriModule from 'satori';

// The picture a shared quote link shows in a chat or a feed (og:image): the
// reader's quote card - FragmentCard.tsx - drawn as a 1200x630 PNG. The same
// card blue on the site's blue-green gradient, the amber "Source fragment"
// label and rule, the quotation in Newsreader, then the author in Cinzel and
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
}

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

/** The quotation as it fits the card: whole words, an ellipsis when cut. */
export function fittedQuote(text: string): { text: string; fontSize: number } {
  const plain = drawable(text).replace(/\s+/g, ' ').trim();
  const sizes: Array<[number, number]> = [[110, 50], [190, 42], [300, 35], [420, 30]];
  for (const [chars, fontSize] of sizes) if (plain.length <= chars) return { text: plain, fontSize };
  const cut = plain.slice(0, 400);
  const lastSpace = cut.lastIndexOf(' ');
  return { text: `${(lastSpace > 300 ? cut.slice(0, lastSpace) : cut).replace(/[\s,;:.—-]+$/u, '')}…`, fontSize: 30 };
}

const clip = (value: string, max: number) => {
  const text = drawable(value);
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
};

type Node = { type: string; props: { style?: Record<string, unknown>; children?: unknown } };
const h = (type: string, style: Record<string, unknown>, ...children: unknown[]): Node =>
  ({ type, props: { style, children: children.length === 1 ? children[0] : children } });

function card(content: QuoteCardContent): Node {
  const quote = fittedQuote(content.text);
  return h('div', {
    width: '100%', height: '100%', display: 'flex', padding: 36,
    background: 'linear-gradient(90deg, #024063 0%, #3ca83f 22%, #044a6f 100%)',
  },
  h('div', {
    position: 'relative', width: QUOTE_CARD_WIDTH - 72, height: QUOTE_CARD_HEIGHT - 72,
    display: 'flex', flexDirection: 'column', overflow: 'hidden',
    background: '#061d28', border: '2px solid rgba(255,255,255,0.2)', borderRadius: 36, color: '#ffffff',
  },
  h('div', { position: 'absolute', top: -40, right: 40, fontFamily: SERIF, fontSize: 360, lineHeight: 1, color: 'rgba(252,211,77,0.07)' }, '”'),
  h('div', {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '22px 48px', borderBottom: '1px solid rgba(255,255,255,0.15)',
  },
  h('div', { display: 'flex', fontFamily: SANS, fontWeight: 700, fontSize: 22, color: '#fcd34d' }, '“  Source fragment'),
  h('div', { display: 'flex', fontFamily: DISPLAY, fontWeight: 600, fontSize: 24, color: 'rgba(255,255,255,0.75)', letterSpacing: 2 }, 'Biblioteca')),
  h('div', { flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', overflow: 'hidden', padding: '20px 56px 12px' },
    h('div', {
      display: 'flex', width: '100%', borderLeft: '6px solid #f59e0b', paddingLeft: 30,
      fontFamily: SERIF, fontSize: quote.fontSize, lineHeight: 1.35, color: '#ffffff',
    }, `«${quote.text}»`)),
  h('div', {
    display: 'flex', flexDirection: 'column', flexShrink: 0, gap: 4, margin: '0 56px', padding: '16px 0 26px',
    borderTop: '1px solid rgba(255,255,255,0.15)',
  },
  h('div', { display: 'flex', fontFamily: DISPLAY, fontWeight: 600, fontSize: 30 }, clip(content.authorName, 60)),
  h('div', { display: 'flex', fontFamily: SERIF, fontStyle: 'italic', fontSize: 28, color: '#fcd34d' }, clip(content.workTitle, 80)),
  ...(content.chapterTitle && content.chapterTitle !== content.workTitle
    ? [h('div', { display: 'flex', fontFamily: SANS, fontSize: 20, color: 'rgba(255,255,255,0.6)' }, clip(content.chapterTitle, 100))]
    : []))));
}

/** The quote card as a PNG. */
export async function renderQuoteCard(content: QuoteCardContent): Promise<Buffer> {
  const svg = await satori(card(content) as never, { width: QUOTE_CARD_WIDTH, height: QUOTE_CARD_HEIGHT, fonts: loadFonts() });
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
