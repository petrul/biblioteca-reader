import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';

// The navbar search box remembers searches (regressed once, 6c393b2 - keep these):
// - opening it brings back the very last search, with its results at once;
// - the empty box shows a drop-down of the past searches, newest first;
// - searches are recorded (up to 50), in the account's preferences when signed in;
// - nothing is searched on page load, and a pasted paragraph is never re-run unasked.

function installDom() {
  const window = new Window({ url: 'http://localhost/' });
  const globals = globalThis as any;
  const saved = new Map<string, PropertyDescriptor | undefined>();
  const define = (key: string, value: unknown) => {
    if (!saved.has(key)) saved.set(key, Object.getOwnPropertyDescriptor(globals, key));
    Object.defineProperty(globals, key, { value, configurable: true, writable: true });
  };
  define('window', window);
  define('document', window.document);
  define('navigator', window.navigator);
  define('localStorage', window.localStorage);
  for (const key of ['HTMLElement', 'HTMLInputElement', 'Element', 'Node', 'Event', 'MouseEvent', 'PointerEvent', 'KeyboardEvent', 'FocusEvent', 'InputEvent']) {
    if (key in window) define(key, (window as any)[key]);
  }
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

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function mount(pastQueries: string[]) {
  const dom = installDom();
  const { act, createElement } = await import('react');
  const { createRoot } = await import('react-dom/client');
  const history = await import('../services/searchHistory');
  const { readerService } = await import('../services/readerService');
  const { Navbar } = await import('./Navbar');

  history.resetSearchHistoryForTests();
  // oldest first, so the last one is the newest
  for (const query of pastQueries) history.recordSearch({ query, mode: 'all', scope: 'library', options: {} });

  const searched: string[] = [];
  const original = readerService.searchCombined;
  (readerService as any).searchCombined = async (query: string, _limit: number, onUpdate?: (results: any[]) => void) => {
    searched.push(query);
    const results = [{ id: `hit-${query}`, type: 'work', workId: 'w', workTitle: `Result for ${query}`, authorName: 'A', mode: 'title' }];
    onUpdate?.(results);
    return results;
  };

  const host = dom.window.document.createElement('div');
  dom.window.document.body.appendChild(host);
  const root = createRoot(host as unknown as HTMLElement);
  let submitted = '';
  await act(async () => {
    root.render(createElement(Navbar, { reallySignedIn: false, onOpenAuth: () => {}, currentView: 'browse', onSearch: (q: string) => { submitted = q; } } as any));
  });
  const doc = dom.window.document;
  const input = () => doc.querySelector('input[placeholder^="Search classical texts"]') as any;
  const click = async (element: any, type = 'click') => act(async () => { element.dispatchEvent(new (dom.window as any).MouseEvent(type, { bubbles: true, cancelable: true })); });
  return {
    doc, act, searched, history, input,
    submitted: () => submitted,
    open: async () => { await click(doc.getElementById('nav-expand-search-btn')); await act(async () => { await sleep(80); }); },
    type: async (value: string) => act(async () => {
      const element = input();
      const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value')!.set!;
      setter.call(element, value);
      element.dispatchEvent(new (dom.window as any).Event('input', { bubbles: true }));
    }),
    focus: async () => act(async () => { input().dispatchEvent(new (dom.window as any).FocusEvent('focusin', { bubbles: true })); }),
    click,
    key: async (key: string) => act(async () => { input().dispatchEvent(new (dom.window as any).KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })); }),
    historyQueries: () => [...doc.querySelectorAll('#nav-search-history [data-history-query]')].map((b: any) => b.getAttribute('data-history-query')),
    unmount: async () => {
      (readerService as any).searchCombined = original;
      await act(async () => root.unmount());
      history.resetSearchHistoryForTests();
      await dom.restore();
    }
  };
}

test('nothing is searched on page load, even with a search history', async () => {
  const nav = await mount(['Hamlet', 'Odyssey']);
  try {
    await nav.act(async () => { await sleep(500); });
    assert.deepEqual(nav.searched, []);
    assert.equal(nav.input(), null, 'the search box stays closed');
  } finally { await nav.unmount(); }
});

test('opening the search box brings back the very last search and its results at once', async () => {
  const nav = await mount(['Hamlet', 'Odyssey']);
  try {
    await nav.open();
    assert.equal(nav.input().value, 'Odyssey');
    // run without the typing debounce (400ms): already searched 80ms after opening
    assert.deepEqual(nav.searched, ['Odyssey']);
    assert.match(nav.doc.getElementById('nav-search-dropdown')!.textContent!, /Result for Odyssey/);
  } finally { await nav.unmount(); }
});

test('the empty box shows the past searches, newest first, and picking one searches it', async () => {
  const nav = await mount(['Hamlet', 'Odyssey', 'Cicero']);
  try {
    await nav.open();
    await nav.type('');
    await nav.focus();
    assert.deepEqual(nav.historyQueries(), ['Cicero', 'Odyssey', 'Hamlet']);
    const hamlet = nav.doc.querySelector('[data-history-query="Hamlet"]');
    await nav.click(hamlet, 'mousedown');
    await nav.act(async () => { await sleep(50); });
    assert.equal(nav.input().value, 'Hamlet');
    assert.equal(nav.searched.at(-1), 'Hamlet');
    assert.equal(nav.doc.getElementById('nav-search-history'), null, 'the history closes once the box has text');
  } finally { await nav.unmount(); }
});

test('a search is recorded as the newest, and the history keeps the latest 50', async () => {
  const nav = await mount(Array.from({ length: 60 }, (_, i) => `query ${i}`));
  try {
    assert.equal(nav.history.getSearchHistory().length, 50);
    await nav.open();
    await nav.type('Plato Republic');
    await nav.key('Enter');
    assert.equal(nav.submitted(), 'Plato Republic');
    const recorded = nav.history.getSearchHistory();
    assert.equal(recorded.length, 50);
    assert.equal(recorded[0].query, 'Plato Republic');
    assert.equal(nav.history.lastSearchQuery(), 'Plato Republic');
    assert.ok(!recorded.some(entry => entry.query === 'query 10'), 'the oldest fall off');
  } finally { await nav.unmount(); }
});

test('a pasted paragraph is remembered but never re-run when the box opens', async () => {
  const paragraph = 'Arma virumque cano '.repeat(20);
  const nav = await mount([paragraph.trim()]);
  try {
    await nav.open();
    await nav.act(async () => { await sleep(500); });
    assert.deepEqual(nav.searched, []);
    assert.equal(nav.input().value, '');
    await nav.focus();
    assert.equal(nav.historyQueries().length, 1, 'still offered in the history');
  } finally { await nav.unmount(); }
});
