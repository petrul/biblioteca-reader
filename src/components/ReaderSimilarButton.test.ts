import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';
import type { Chapter, Work } from '../types/textbase';

// The "Similar" button (#btn-sel-similar) is the reader's entry point to
// semantic search for a passage. It lives in the shared selection toolbar,
// which must appear for BOTH ways a reader picks a passage:
//   - selecting arbitrary text with the pointer, and
//   - tapping a paragraph (ReaderBlockSelection turns the tap into a
//     selection of the whole block).
// The real ReaderView is mounted into a happy-dom document so the actual
// selection/tap wiring runs, not a re-implementation of it. The Playwright
// spec e2e/reader-similarity.spec.ts covers the same flows in a browser,
// down to the similarity dialog.

const PARAGRAPH = 'Arma virumque cano, Troiae qui primus ab oris Italiam fato profugus venit.';

const work: Work = {
  id: 'vergilius/aeneis', authorId: 'vergilius', authorName: 'Vergilius', title: 'Aeneis',
  detectedLanguage: 'lat', sizeWords: 12, sizeBytes: 80, chapterCount: 1,
  license: '', sourceRepo: '', tags: [], summary: '',
  teiHeaderSummary: { titleStmt: '', publicationStmt: '', sourceDesc: '' }
};
const chapter: Chapter = {
  id: 'vergilius/aeneis/liber_i', workId: work.id, chapterNumber: 1, title: 'Liber I',
  htmlContent: `<div><p id="para">${PARAGRAPH}</p><p>Litora, multum ille et terris iactatus et alto.</p></div>`,
  plainText: PARAGRAPH, wordCount: 12
};

// Install a happy-dom window as the global browser environment for React.
function installDom() {
  const window = new Window({ url: 'http://localhost/vergilius/aeneis/liber_i' });
  const globals = globalThis as any;
  const saved = new Map<string, PropertyDescriptor | undefined>();
  const define = (key: string, value: unknown) => {
    if (!saved.has(key)) saved.set(key, Object.getOwnPropertyDescriptor(globals, key));
    Object.defineProperty(globals, key, { value, configurable: true, writable: true });
  };
  define('window', window);
  define('document', window.document);
  define('navigator', window.navigator);
  define('location', window.location);
  define('localStorage', window.localStorage);
  define('sessionStorage', window.sessionStorage);
  for (const key of ['HTMLElement', 'Element', 'Node', 'Text', 'Event', 'MouseEvent', 'PointerEvent',
    'KeyboardEvent', 'MutationObserver', 'ResizeObserver', 'IntersectionObserver', 'Range', 'DOMRect',
    'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'matchMedia']) {
    if (key in window) define(key, (window as any)[key]);
  }
  // Nothing in these flows needs the network; answer any stray load as "not found".
  define('fetch', async () => new Response('', { status: 404 }));
  (window as any).speechSynthesis = { getVoices: () => [], speak() {}, cancel() {} };
  define('IS_REACT_ACT_ENVIRONMENT', true);
  return {
    window,
    restore: async () => {
      await window.happyDOM.close();
      for (const [key, descriptor] of saved) {
        if (descriptor) Object.defineProperty(globals, key, descriptor);
        else delete globals[key];
      }
    }
  };
}

async function mountReader(context: { mock: any }, htmlContent = chapter.htmlContent) {
  const dom = installDom();
  const { act, createElement } = await import('react').then(react => ({ act: react.act, createElement: react.createElement }));
  const { createRoot } = await import('react-dom/client');
  const { readerService } = await import('../services/readerService');
  const { ReaderView } = await import('./ReaderView');
  context.mock.method(readerService, 'getWorkById', () => work);
  const renderedChapter = { ...chapter, htmlContent };
  context.mock.method(readerService, 'getChaptersForWork', () => [renderedChapter]);
  context.mock.method(readerService, 'getChapter', () => renderedChapter);
  context.mock.method(readerService, 'isWorkUnlocked', () => true);

  const host = dom.window.document.createElement('div');
  dom.window.document.body.appendChild(host);
  const root = createRoot(host as unknown as HTMLElement);
  const noop = () => {};
  await act(async () => {
    root.render(createElement(ReaderView, {
      workId: work.id, chapterId: chapter.id, reallySignedIn: false,
      settingsOpen: false, currentUserId: 'guest',
      onBack: noop, onBackToWork: noop, onSelectWork: noop,
      onSettingsOpenChange: noop, onSelectChapter: noop,
      onMoreLikeThis: noop, onOpenAddToCollection: noop
    }));
  });
  const document = dom.window.document;
  const paragraph = document.getElementById('para');
  assert.ok(paragraph, 'the chapter paragraph is rendered');
  // ReaderView reads the selection 50ms after pointerup; the wait also lets
  // the mount's own async effects (stored preferences, bookmarks) finish
  // inside act.
  const settle = () => act(() => new Promise<void>(resolve => setTimeout(resolve, 80)));
  await settle();
  const similarButton = () => document.getElementById('btn-sel-similar');
  return {
    document, paragraph: paragraph!, settle, similarButton, act,
    unmount: async () => { await act(async () => root.unmount()); await dom.restore(); }
  };
}

test('the Similar button is offered once the reader selects arbitrary text', async context => {
  const reader = await mountReader(context);
  try {
    assert.equal(reader.similarButton(), null, 'no toolbar before anything is selected');

    // Select a fragment from the middle of the paragraph, the way a mouse
    // drag would. The paragraph's text node, not its first child: the
    // reader prepends a #p1 link anchor to paragraphs with their own id.
    const text = Array.from(reader.paragraph.childNodes).find(node => node.nodeType === 3)!;
    const range = reader.document.createRange();
    range.setStart(text as any, 5);
    range.setEnd(text as any, 30);
    const selection = reader.document.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    await reader.act(async () => { reader.document.dispatchEvent(new (globalThis as any).Event('pointerup')); });
    await reader.settle();

    assert.ok(reader.document.getElementById('selection-quote-toolbar'), 'the selection toolbar appears');
    const similar = reader.similarButton();
    assert.ok(similar, 'the Similar button is presented for a text selection');
    assert.equal(similar!.textContent, 'Similar');
    assert.equal(selection.toString(), PARAGRAPH.slice(5, 30), 'the toolbar is for exactly the selected fragment');
    assert.equal(reader.paragraph.closest('.reader-text-container')!.classList.contains('reader-block-selection'), false,
      'manual text selection keeps its normal highlight');
  } finally {
    await reader.unmount();
  }
});

test('hovering or tapping a verse targets its stanza while a manual verse selection stays exact', async context => {
  const reader = await mountReader(context,
    '<div class="lg" id="stanza"><div class="l" id="para"><em>First verse.</em></div><div class="l">Second verse.</div></div>');
  try {
    const verse = reader.paragraph;
    const stanza = reader.document.getElementById('stanza')!;
    const inline = verse.querySelector('em')!;
    await reader.act(async () => {
      inline.dispatchEvent(new (globalThis as any).PointerEvent('pointerover', { bubbles: true, pointerType: 'mouse' }));
    });
    assert.ok(stanza.classList.contains('block-hover'));
    assert.equal(verse.classList.contains('block-hover'), false);
    await reader.act(async () => { inline.dispatchEvent(new (globalThis as any).MouseEvent('click', { bubbles: true })); });
    await reader.settle();
    assert.ok(stanza.classList.contains('block-active'));
    assert.equal(verse.classList.contains('block-active'), false);
    assert.equal(reader.document.getSelection()!.toString(), stanza.textContent);
    assert.ok(reader.similarButton());

    const range = reader.document.createRange();
    range.selectNodeContents(verse as any);
    const selection = reader.document.getSelection()!;
    selection.removeAllRanges(); selection.addRange(range);
    await reader.act(async () => {
      reader.document.dispatchEvent(new (globalThis as any).Event('selectionchange'));
      reader.document.dispatchEvent(new (globalThis as any).Event('pointerup'));
    });
    await reader.settle();
    assert.equal(selection.toString(), 'First verse.');
    assert.equal(stanza.closest('.reader-text-container')!.classList.contains('reader-block-selection'), false);
    assert.ok(reader.similarButton());
  } finally { await reader.unmount(); }
});

test('Similar reveals the whole-paragraph selection used for its search', async context => {
  const reader = await mountReader(context);
  try {
    await reader.act(async () => { reader.paragraph.dispatchEvent(new (globalThis as any).MouseEvent('click', { bubbles: true })); });
    await reader.settle();
    const container = reader.paragraph.closest('.reader-text-container')!;
    assert.ok(container.classList.contains('reader-block-selection'));
    await reader.act(async () => {
      reader.similarButton()!.dispatchEvent(new (globalThis as any).MouseEvent('click', { bubbles: true }));
    });
    assert.equal(container.classList.contains('reader-block-selection'), false, 'the native selection highlight is visible');
    assert.equal(reader.document.getSelection()!.toString().trim(), PARAGRAPH);
  } finally { await reader.unmount(); }
});

test('the Similar button is offered when the reader taps a paragraph', async context => {
  const reader = await mountReader(context);
  try {
    assert.equal(reader.similarButton(), null, 'no toolbar before the tap');

    await reader.act(async () => { reader.paragraph.dispatchEvent(new (globalThis as any).MouseEvent('click', { bubbles: true })); });
    await reader.settle();

    assert.ok(reader.paragraph.classList.contains('block-active'), 'the tapped paragraph is the active block');
    assert.equal(reader.document.getSelection()!.toString().trim(), PARAGRAPH, 'the whole paragraph is selected');
    assert.ok(reader.paragraph.closest('.reader-text-container')!.classList.contains('reader-block-selection'),
      'only the automatically selected range has its text highlight hidden');
    const similar = reader.similarButton();
    assert.ok(similar, 'the Similar button is presented for a tapped paragraph');
    assert.equal(similar!.textContent, 'Similar');

    await reader.act(async () => { reader.paragraph.dispatchEvent(new (globalThis as any).MouseEvent('click', { bubbles: true })); });
    await reader.settle();
    assert.equal(reader.document.getElementById('selection-quote-toolbar'), null, 'retapping clears the selection toolbar');
    assert.equal(reader.document.getSelection()!.toString(), '', 'retapping clears the native selection');
    assert.equal(reader.paragraph.classList.contains('block-active'), false, 'retapping clears the active paragraph');
    assert.equal(reader.paragraph.closest('.reader-text-container')!.classList.contains('reader-block-selection'), false);
  } finally {
    await reader.unmount();
  }
});
