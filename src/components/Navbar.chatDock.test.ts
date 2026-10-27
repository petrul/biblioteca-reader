import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';

// The docked assistant on lg+: the navbar carries a chat button (below lg
// the docked chat lives in the bottom nav instead - see
// MobileBottomNav.test.ts). Tapping it opens the same chat panel; the
// long-press drag that floats it again is covered by
// useLongPressDrag.test.ts and the e2e spec.

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
  for (const key of ['HTMLElement', 'Element', 'Node', 'Event', 'MouseEvent', 'PointerEvent']) {
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

async function mountNavbar(props: Record<string, unknown>) {
  const dom = installDom();
  const { act, createElement } = await import('react');
  const { createRoot } = await import('react-dom/client');
  const { Navbar } = await import('./Navbar');

  const host = dom.window.document.createElement('div');
  dom.window.document.body.appendChild(host);
  const root = createRoot(host as unknown as HTMLElement);
  const passed = { reallySignedIn: false, onOpenAuth: () => {}, ...props };
  await act(async () => {
    root.render(createElement(Navbar, passed as any));
  });
  return {
    chatButton: () => dom.window.document.getElementById('nav-chat-btn'),
    collectionsButton: () => dom.window.document.getElementById('nav-collections-quick-btn'),
    act,
    unmount: async () => { await act(async () => root.unmount()); await dom.restore(); }
  };
}

test('the book button opens the Collections screen', async () => {
  let navigated = '';
  const nav = await mountNavbar({
    currentView: 'reader',
    onNavigate: (view: string) => { navigated = view; },
    onOpenCollectionsQuickFind: () => { throw new Error('mobile must not open quick-find'); },
  });
  try {
    (globalThis.window as any).matchMedia = () => ({ matches: true });
    const button = nav.collectionsButton();
    assert.ok(button, 'the book button appears in the reader navbar');
    await nav.act(async () => { button!.dispatchEvent(new (globalThis as any).MouseEvent('click', { bubbles: true })); });
    assert.equal(navigated, 'collections');
  } finally {
    await nav.unmount();
  }
});

test('the book button does not depend on viewport detection', async () => {
  let navigated = '';
  const nav = await mountNavbar({
    currentView: 'reader',
    onNavigate: (view: string) => { navigated = view; },
  });
  try {
    const button = nav.collectionsButton();
    assert.ok(button);
    await nav.act(async () => { button!.dispatchEvent(new (globalThis as any).MouseEvent('click', { bubbles: true })); });
    assert.equal(navigated, 'collections');
  } finally {
    await nav.unmount();
  }
});

test('the docked chat button opens the assistant from the navbar', async () => {
  let opened = 0;
  const nav = await mountNavbar({ chatDocked: true, onChatToggle: () => { opened += 1; } });
  try {
    const button = nav.chatButton();
    assert.ok(button, 'the chat button appears in the navbar when docked');
    await nav.act(async () => { button!.dispatchEvent(new (globalThis as any).MouseEvent('click', { bubbles: true })); });
    assert.equal(opened, 1, 'tapping the docked chat button opens the chat');
  } finally {
    await nav.unmount();
  }
});

test('no navbar chat button while the assistant floats', async () => {
  const nav = await mountNavbar({ chatDocked: false });
  try {
    assert.equal(nav.chatButton(), null, 'no chat button while the bubble floats');
  } finally {
    await nav.unmount();
  }
});
