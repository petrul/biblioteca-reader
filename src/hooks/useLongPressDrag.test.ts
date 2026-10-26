import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';

// The dockable-chat gesture: long-press grabs the element, the pointer
// tracks 1:1, and the release point decides - inside the bottom nav's rect
// the bubble docks, anywhere else it snaps back. A press released early,
// cancelled by an early move, or grabbed but never dragged past the
// tolerance is a tap, and the host's click must still go through.

const NAV_RECT = { left: 0, top: 300, right: 400, bottom: 400, width: 400, height: 100, x: 0, y: 300 };

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
  for (const key of ['HTMLElement', 'Element', 'Node', 'Event', 'MouseEvent']) {
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

async function mountProbe(context: { mock: any }) {
  const dom = installDom();
  const { act, createElement } = await import('react');
  const { createRoot } = await import('react-dom/client');
  const { useLongPressDrag } = await import('../hooks/useLongPressDrag');

  context.mock.timers.enable({ apis: ['setTimeout'] });

  const nav = dom.window.document.createElement('div');
  nav.id = 'mobile-bottom-nav';
  (nav as any).getBoundingClientRect = () => ({ ...NAV_RECT, toJSON: () => ({}) });
  dom.window.document.body.appendChild(nav);

  const calls = { target: 0, outside: 0, clicks: 0, active: [] as Array<[boolean, boolean]> };
  const Probe = () => {
    const drag = useLongPressDrag({
      targetId: 'mobile-bottom-nav',
      onDropTarget: () => { calls.target += 1; },
      onDropOutside: () => { calls.outside += 1; },
      onDragActiveChange: (active, over) => { calls.active.push([active, over]); },
    });
    return createElement('div', null,
      createElement('span', { id: 'drag-state' }, JSON.stringify({ dragging: drag.dragging, offset: drag.offset })),
      createElement('button', {
        id: 'grab',
        onPointerDown: drag.onPointerDown,
        onClick: () => { if (!drag.justDragged()) calls.clicks += 1; }
      }, 'grab'));
  };

  const host = dom.window.document.createElement('div');
  dom.window.document.body.appendChild(host);
  const root = createRoot(host as unknown as HTMLElement);
  await act(async () => { root.render(createElement(Probe)); });

  const grab = dom.window.document.getElementById('grab')!;
  const fire = async (target: any, type: string, x: number, y: number) => {
    await act(async () => {
      target.dispatchEvent(new dom.window.MouseEvent(type, { bubbles: true, clientX: x, clientY: y }));
    });
  };
  const press = (x: number, y: number) => fire(grab, 'pointerdown', x, y);
  const move = (x: number, y: number) => fire(dom.window, 'pointermove', x, y);
  const release = (x: number, y: number) => fire(dom.window, 'pointerup', x, y);
  const hold = async (ms: number) => { await act(async () => { context.mock.timers.tick(ms); }); };
  const state = () => JSON.parse(dom.window.document.getElementById('drag-state')!.textContent!);

  return {
    calls, press, move, release, hold, state,
    clickGrab: async () => { await act(async () => { grab.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); }); },
    unmount: async () => { await act(async () => root.unmount()); await dom.restore(); }
  };
}

test('a long-press drag released on the bottom nav drops on the target', async context => {
  const probe = await mountProbe(context);
  try {
    await probe.press(100, 100);
    await probe.hold(500);
    assert.equal(probe.state().dragging, true, 'the grab activates after the long-press threshold');

    await probe.move(100, 320);
    assert.deepEqual(probe.state().offset, { dx: 0, dy: 220 }, 'the element tracks the pointer 1:1');

    await probe.release(100, 320);
    assert.equal(probe.state().dragging, false);
    assert.equal(probe.calls.target, 1, 'released inside the nav rect');
    assert.equal(probe.calls.outside, 0);
    await probe.clickGrab();
    assert.equal(probe.calls.clicks, 0, 'the drop suppresses the trailing click');
  } finally {
    await probe.unmount();
  }
});

test('a drag released away from the bottom nav snaps back (drop outside)', async context => {
  const probe = await mountProbe(context);
  try {
    await probe.press(100, 100);
    await probe.hold(500);
    await probe.move(200, 150);
    await probe.release(200, 150);
    assert.equal(probe.calls.outside, 1, 'released outside the nav rect');
    assert.equal(probe.calls.target, 0);
    assert.equal(probe.state().offset, null, 'the transform resets for the snap back');
  } finally {
    await probe.unmount();
  }
});

test('a quick press stays a tap: no grab, no drop, click goes through', async context => {
  const probe = await mountProbe(context);
  try {
    await probe.press(100, 100);
    await probe.release(100, 100);
    await probe.hold(500);
    assert.equal(probe.state().dragging, false, 'no grab after the press already ended');
    assert.equal(probe.calls.target + probe.calls.outside, 0, 'no drop on a tap');
    await probe.clickGrab();
    assert.equal(probe.calls.clicks, 1, 'the tap still clicks');
  } finally {
    await probe.unmount();
  }
});

test('moving before the long-press threshold cancels the grab', async context => {
  const probe = await mountProbe(context);
  try {
    await probe.press(100, 100);
    await probe.move(140, 100);
    await probe.hold(500);
    assert.equal(probe.state().dragging, false, 'an early real move is not a grab');
    assert.equal(probe.calls.target + probe.calls.outside, 0);
  } finally {
    await probe.unmount();
  }
});

test('a grab that never travels past the tolerance is a tap that over-held', async context => {
  const probe = await mountProbe(context);
  try {
    await probe.press(100, 100);
    await probe.hold(500);
    assert.equal(probe.state().dragging, true);
    await probe.release(100, 100);
    assert.equal(probe.calls.target + probe.calls.outside, 0, 'no drop without a real drag');
    await probe.clickGrab();
    assert.equal(probe.calls.clicks, 1, 'and the click still fires');
  } finally {
    await probe.unmount();
  }
});
