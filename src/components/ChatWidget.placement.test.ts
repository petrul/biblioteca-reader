import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';

// Placement contract of the dockable assistant: while docked, the floating
// bubble leaves the screen at every breakpoint - the chat lives in the
// bottom nav below lg and in the navbar on lg+; floating (the default) the
// bubble is always there. The `open` prop lets App own the panel so the
// docked tab/button can open the same chat.

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

async function mountWidget(props: Record<string, unknown> = {}) {
  const dom = installDom();
  const { act, createElement } = await import('react');
  const { createRoot } = await import('react-dom/client');
  const { ChatWidget } = await import('./ChatWidget');

  const host = dom.window.document.createElement('div');
  dom.window.document.body.appendChild(host);
  const root = createRoot(host as unknown as HTMLElement);
  await act(async () => {
    root.render(createElement(ChatWidget, props as any));
  });
  return {
    bubble: () => dom.window.document.querySelector('button[aria-label="Deschide chatul"], button[aria-label="Închide chatul"]'),
    panel: () => dom.window.document.querySelector('section[aria-label="Biblioteca chat"]'),
    unmount: async () => { await act(async () => root.unmount()); await dom.restore(); }
  };
}

test('floating by default: the bubble stays on screen, the panel closed', async () => {
  const widget = await mountWidget();
  try {
    const bubble = widget.bubble();
    assert.ok(bubble, 'the floating bubble is rendered');
    assert.ok(!bubble!.classList.contains('hidden'), 'the bubble is visible on mobile while floating');
    assert.equal(widget.panel(), null, 'the chat panel starts closed');
  } finally {
    await widget.unmount();
  }
});

test('docked: the bubble leaves the screen at every breakpoint', async () => {
  const widget = await mountWidget({ placement: 'docked' });
  try {
    const bubble = widget.bubble();
    assert.ok(bubble, 'the bubble element still renders');
    assert.ok(bubble!.classList.contains('hidden'), 'hidden while docked - the toolbars carry the chat now');
  } finally {
    await widget.unmount();
  }
});

test('controlled open: the open prop renders the same chat panel', async () => {
  const widget = await mountWidget({ open: true, onOpenChange: () => {} });
  try {
    assert.ok(widget.panel(), 'the chat panel is rendered when open is passed');
    assert.ok(widget.bubble(), 'the bubble stays rendered next to the panel');
  } finally {
    await widget.unmount();
  }
});
