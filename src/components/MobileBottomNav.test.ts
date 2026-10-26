import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';

// On the reader page the mobile bottom nav must follow the same hide/show
// cycle as the navbar and the chapter toolbar: App drives `visible` from
// useHideHeaderOnScroll (same hook, same thresholds, so all bars move in
// lockstep), and the component slides itself out of the viewport. These
// tests pin the slide classes; every other page leaves `visible` at its
// default, because off-reader the bottom nav is the primary navigation.

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

async function mountNav(props: Record<string, unknown>) {
  const dom = installDom();
  const { act, createElement } = await import('react');
  const { createRoot } = await import('react-dom/client');
  const { MobileBottomNav } = await import('./MobileBottomNav');

  const host = dom.window.document.createElement('div');
  dom.window.document.body.appendChild(host);
  const root = createRoot(host as unknown as HTMLElement);
  const passed = { ...props, currentUser: null };
  await act(async () => {
    root.render(createElement(MobileBottomNav, passed as any));
  });
  return {
    nav: () => dom.window.document.getElementById('mobile-bottom-nav'),
    chatTab: () => dom.window.document.getElementById('mobile-nav-chat'),
    act,
    unmount: async () => { await act(async () => root.unmount()); await dom.restore(); }
  };
}

test('the bottom nav slides away while the reading bars are hidden', async () => {
  const nav = await mountNav({ visible: false });
  try {
    const element = nav.nav();
    assert.ok(element, 'the bottom nav is rendered');
    assert.ok(element!.classList.contains('translate-y-full'), 'hidden state slides the bar out of view');
    assert.ok(!element!.classList.contains('translate-y-0'), 'hidden state drops the visible position');
    assert.ok(element!.classList.contains('transition-transform'), 'the slide is animated like the bars above');
  } finally {
    await nav.unmount();
  }
});

test('the bottom nav stays visible by default and when shown', async () => {
  for (const visible of [undefined, true]) {
    const nav = await mountNav({ visible });
    try {
      const element = nav.nav();
      assert.ok(element, 'the bottom nav is rendered');
      assert.ok(element!.classList.contains('translate-y-0'), 'the bar sits in view');
      assert.ok(!element!.classList.contains('translate-y-full'), 'the bar is not slid away');
    } finally {
      await nav.unmount();
    }
  }
});

// The dockable assistant: docked, the chat bubble becomes the bar's fourth
// tab; floating, the bar shows only navigation. The tab's tap opens the
// chat panel (long-press-drag, covered by useLongPressDrag.test.ts, is how
// it leaves the bar again). The old admin button was removed - admins use
// the navbar's hamburger.
test('the docked chat tab opens the assistant from the bar', async () => {
  let opened = 0;
  const nav = await mountNav({ chatDocked: true, onChatOpen: () => { opened += 1; } });
  try {
    const tab = nav.chatTab();
    assert.ok(tab, 'the chat tab appears in the bar when docked');
    await nav.act(async () => { tab!.dispatchEvent(new (globalThis as any).MouseEvent('click', { bubbles: true })); });
    assert.equal(opened, 1, 'tapping the docked tab opens the chat');
  } finally {
    await nav.unmount();
  }
});

test('no chat tab while the assistant floats, and no admin button anymore', async () => {
  const nav = await mountNav({ chatDocked: false, isAdmin: true, onOpenAdminSidebar: () => {} });
  try {
    assert.equal(nav.chatTab(), null, 'no chat tab while the bubble floats');
    assert.equal(nav.nav()!.querySelector('#mobile-nav-admin-drawer'), null, 'the admin button was removed from the bar');
  } finally {
    await nav.unmount();
  }
});
