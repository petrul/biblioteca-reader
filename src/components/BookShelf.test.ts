import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Sparkles } from 'lucide-react';

// The home page's shelves - Featured, Discover, My Books and one per
// stored collection - share BookShelf's frame and ShelfCard's card; the two
// carousels only supply what goes on each card. Static renders pin the
// shared structure, the ids e2e tests and keyboard routing rely on, and
// what each carousel puts on its cards.

class FakeStorage implements Storage {
  private readonly map = new Map<string, string>();
  get length() { return this.map.size; }
  clear() { this.map.clear(); }
  getItem(key: string) { return this.map.get(key) ?? null; }
  key(index: number) { return [...this.map.keys()][index] ?? null; }
  removeItem(key: string) { this.map.delete(key); }
  setItem(key: string, value: string) { this.map.set(key, value); }
}

// readerService (imported by the carousels) reads browser storage on load.
const storage = new FakeStorage();
(globalThis as any).localStorage = storage;
// Cover lookups (getWorkById) must never reach a real server from a test.
(globalThis as any).fetch = async () => new Response('', { status: 404 });
(globalThis as any).window ??= { localStorage: storage, location: { origin: 'http://localhost' }, dispatchEvent: () => true, addEventListener: () => {}, removeEventListener: () => {} };

const { BookShelf, ShelfCard } = await import('./BookShelf');
const { FeaturedBookCarousel } = await import('./FeaturedBookCarousel');
const { CollectionShelfCarousel } = await import('./CollectionShelfCarousel');

const render = (type: any, props: any, ...children: any[]) => renderToStaticMarkup(createElement(type, props, ...children));

const card = (id: string, extra: Record<string, unknown> = {}) => createElement(ShelfCard, {
  key: id, id: `card-${id}`, title: `Title ${id}`, authorName: 'An Author', eyebrow: 'Work',
  onOpen: () => {}, actionId: `open-${id}`, actionLabel: 'Open Book', ...extra
});

const shelfProps = { instanceId: 'test-shelf', title: 'Shelf Title', subtitle: 'Shelf subtitle', icon: Sparkles, countLabel: '2 Items' };

test('a shelf has its title, count, subtitle and instance-scoped icon and arrow ids around its cards', () => {
  const html = render(BookShelf, shelfProps, card('a'), card('b'));
  for (const text of ['Shelf Title', '2 Items', 'Shelf subtitle', 'Title a', 'Title b']) assert.ok(html.includes(text), text);
  for (const id of ['carousel-icon-badge-test-shelf', 'carousel-btn-prev-test-shelf', 'carousel-btn-next-test-shelf', 'card-a', 'card-b'])
    assert.ok(html.includes(`id="${id}"`), id);
});

test('a loading shelf shows its loading label only until it has cards', () => {
  const empty = render(BookShelf, { ...shelfProps, loading: true, loadingLabel: 'Loading discoveries…' });
  assert.ok(empty.includes('Loading discoveries…'));
  const filled = render(BookShelf, { ...shelfProps, loading: true, loadingLabel: 'Loading discoveries…' }, card('a'));
  assert.ok(!filled.includes('Loading discoveries…'));
  assert.ok(filled.includes('Title a'));
});

test('a card shows its badge, detail and extra action only when given', () => {
  const plain = render(ShelfCard, { id: 'c', title: 'Faust', authorName: 'Goethe', eyebrow: 'Chapter', onOpen: () => {}, actionId: 'open-c', actionLabel: 'Read' });
  assert.ok(plain.includes('Faust') && plain.includes('Goethe') && plain.includes('Chapter') && plain.includes('id="open-c"') && plain.includes('Read'));
  assert.ok(!plain.includes('<p class="text-[11px] text-emerald-100/70'), 'no detail paragraph without a detail');

  const full = render(ShelfCard, {
    id: 'c', title: 'Faust', authorName: 'Goethe', eyebrow: 'Quote', onOpen: () => {}, actionId: 'open-c', actionLabel: 'Open Quote',
    badge: createElement('span', null, 'BADGE'), detail: 'Habe nun, ach!', extraAction: createElement('button', { id: 'extra' })
  });
  for (const text of ['BADGE', 'Habe nun, ach!', 'id="extra"']) assert.ok(full.includes(text), text);
});

const work = (id: string, extra: Record<string, unknown> = {}) => ({
  id, title: `Title of ${id}`, authorName: 'Author', authorId: id.split('/')[0], summary: `Summary of ${id}`, ...extra
});

test('a works shelf: one card per work with read and bookmark buttons, an access pill, and a volume count', () => {
  const html = render(FeaturedBookCarousel, {
    instanceId: 'discover-works', title: 'Discover', subtitle: 'Random', onSelectWork: () => {}, onOpenAddToCollection: () => {},
    works: [work('plato/apology'), work('goethe/faust', { subtitle: 'Der Tragödie erster Teil' })]
  });
  assert.ok(html.includes('2 Volumes'));
  for (const id of ['carousel-book-discover-works-plato/apology', 'btn-carousel-read-discover-works-plato/apology', 'btn-carousel-bookmark-discover-works-goethe/faust'])
    assert.ok(html.includes(`id="${id}"`), id);
  // Every server work is free today (payments are switched off).
  assert.equal(html.match(/>Free</g)?.length, 2);
  assert.ok(html.includes('Classical Digital Edition'), 'a work without a subtitle gets the default eyebrow');
  assert.ok(html.includes('Der Tragödie erster Teil'));
  assert.ok(html.includes('Summary of plato/apology'));

  const noBookmark = render(FeaturedBookCarousel, { instanceId: 'x', onSelectWork: () => {}, works: [work('plato/apology')] });
  assert.ok(!noBookmark.includes('btn-carousel-bookmark-'), 'no bookmark button without onOpenAddToCollection');
});

test('an explicit works shelf that is still loading shows its own loading label', () => {
  const html = render(FeaturedBookCarousel, { instanceId: 'discover-works', onSelectWork: () => {}, works: [], loading: true, loadingLabel: 'Loading discoveries…' });
  assert.ok(html.includes('Loading discoveries…'));
});

test('a collection shelf labels each saved entry and names its action after what it opens', () => {
  const base = { workId: 'goethe/faust', workTitle: 'Faust', authorName: 'Goethe' };
  const html = render(CollectionShelfCarousel, {
    onOpenEntry: () => {},
    shelf: {
      id: 'fav', kind: 'favorites', name: 'Favorites', entries: [
        { ...base, key: 'w', label: 'Work', target: { kind: 'work', workId: 'goethe/faust' } },
        { ...base, key: 'c', label: 'Chapter', detail: 'Zueignung', target: { kind: 'chapter', workId: 'goethe/faust', chapterId: 'goethe/faust/1' } },
        { ...base, key: 'q', label: 'Quote', detail: 'Habe nun, ach!', target: { kind: 'quote', quoteId: 'quote-1' } }
      ]
    }
  });
  assert.ok(html.includes('id="shelf-collection-fav"'));
  assert.ok(html.includes('3 Items'));
  assert.ok(html.includes('Your favourite works, chapters and passages'));
  assert.ok(html.includes('id="btn-carousel-open-collection-fav-w"'));
  for (const text of ['Open Book', 'Read', 'Open Quote', 'Zueignung', '“Habe nun, ach!”']) assert.ok(html.includes(text), text);
});

test('a collection shelf counts a single item in the singular and prefers the collection description', () => {
  const html = render(CollectionShelfCarousel, {
    onOpenEntry: () => {},
    shelf: { id: 'u', kind: 'user', name: 'Seminar', description: 'For the seminar', entries: [
      { key: 'w', label: 'Work', workId: 'plato/apology', workTitle: 'Apology', authorName: 'Plato', target: { kind: 'work', workId: 'plato/apology' } }
    ] }
  });
  assert.ok(html.includes('1 Item<'));
  assert.ok(html.includes('For the seminar'));
  assert.ok(!html.includes('Your collection'));
});
