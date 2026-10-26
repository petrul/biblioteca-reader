import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';

// DragGhost is the reusable visual half of useLongPressDrag: nothing while
// idle; while dragging, a bubble portaled to document.body (a toolbar's
// transform/backdrop-filter must not become its containing block) centered
// on origin + offset.

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
  for (const key of ['HTMLElement', 'Element', 'Node', 'Event']) {
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

async function mountGhost(drag: { dragging: boolean; origin: { x: number; y: number } | null; offset: { dx: number; dy: number } | null }) {
  const dom = installDom();
  const { act, createElement } = await import('react');
  const { createRoot } = await import('react-dom/client');
  const { DragGhost } = await import('./DragGhost');

  const host = dom.window.document.createElement('div');
  dom.window.document.body.appendChild(host);
  const root = createRoot(host as unknown as HTMLElement);
  await act(async () => {
    root.render(createElement(DragGhost, { drag, testId: 'ghost' }, 'x'));
  });
  return {
    ghost: () => dom.window.document.querySelector('[data-testid="ghost"]') as unknown as HTMLElement | null,
    host,
    body: dom.window.document.body,
    unmount: async () => { await act(async () => root.unmount()); await dom.restore(); }
  };
}

test('no ghost without an active drag', async () => {
  for (const drag of [
    { dragging: false, origin: null, offset: null },
    { dragging: false, origin: { x: 10, y: 10 }, offset: { dx: 5, dy: 5 } },
  ]) {
    const mounted = await mountGhost(drag);
    try {
      assert.equal(mounted.ghost(), null);
    } finally {
      await mounted.unmount();
    }
  }
});

test('the ghost is portaled to body and centered on origin + offset', async () => {
  const mounted = await mountGhost({ dragging: true, origin: { x: 100, y: 100 }, offset: { dx: 50, dy: 20 } });
  try {
    const ghost = mounted.ghost();
    assert.ok(ghost, 'the ghost renders while dragging');
    assert.equal(ghost!.parentElement, mounted.body, 'portaled to body, not kept inside the host');
    assert.equal(ghost!.style.left, '122px', 'origin.x + offset.dx - diameter/2');
    assert.equal(ghost!.style.top, '92px', 'origin.y + offset.dy - diameter/2');
  } finally {
    await mounted.unmount();
  }
});
