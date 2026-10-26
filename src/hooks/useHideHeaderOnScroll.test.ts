import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';

// The reader page's three bars (navbar, chapter toolbar, mobile bottom nav)
// each run their own instance of this hook. That is deliberate: the hook is
// a pure function of window scroll events with fixed thresholds, so every
// instance derives the identical state and the bars move in lockstep. These
// tests pin that contract: the thresholds themselves, and the guarantee
// that two consumers never disagree.

const HIDE_AFTER = 80; // hook constant: never hide near the very top

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

async function mountProbes(enabled: boolean, count: number) {
  const dom = installDom();
  const { act, createElement } = await import('react');
  const { createRoot } = await import('react-dom/client');
  const { useHideHeaderOnScroll } = await import('../hooks/useHideHeaderOnScroll');

  const Probe = () => {
    const visible = useHideHeaderOnScroll(enabled);
    return createElement('span', { className: 'probe' }, visible ? 'V' : 'H');
  };

  const host = dom.window.document.createElement('div');
  dom.window.document.body.appendChild(host);
  const root = createRoot(host as unknown as HTMLElement);
  await act(async () => {
    root.render(createElement('div', null,
      ...Array.from({ length: count }, (_, i) => createElement(Probe, { key: i }))));
  });

  const scrollTo = async (y: number) => {
    Object.defineProperty(dom.window, 'scrollY', { value: y, configurable: true });
    await act(async () => { dom.window.dispatchEvent(new dom.window.Event('scroll')); });
  };
  const states = () => Array.from(dom.window.document.querySelectorAll('.probe')).map(el => el.textContent);
  return {
    scrollTo, states,
    unmount: async () => { await act(async () => root.unmount()); await dom.restore(); }
  };
}

test('hides while scrolling down, returns on any real scroll up, never hides near the top', async () => {
  const probe = await mountProbes(true, 1);
  try {
    assert.deepEqual(probe.states(), ['V'], 'visible at the top of the page');

    await probe.scrollTo(HIDE_AFTER - 10);
    assert.deepEqual(probe.states(), ['V'], 'never hides near the top, even on scroll down');

    await probe.scrollTo(300);
    assert.deepEqual(probe.states(), ['H'], 'hides once a real scroll down passes the top zone');

    await probe.scrollTo(500);
    assert.deepEqual(probe.states(), ['H'], 'stays hidden while scrolling further down');

    await probe.scrollTo(480);
    assert.deepEqual(probe.states(), ['V'], 'a real scroll up brings it back');

    await probe.scrollTo(485);
    assert.deepEqual(probe.states(), ['V'], 'sub-threshold jitter does not flip the state');

    await probe.scrollTo(900);
    assert.deepEqual(probe.states(), ['H']);
    await probe.scrollTo(HIDE_AFTER - 1);
    assert.deepEqual(probe.states(), ['V'], 'near the top it is always shown again');
  } finally {
    await probe.unmount();
  }
});

test('every consumer instance stays in lockstep through a scroll sequence', async () => {
  const probes = await mountProbes(true, 2);
  try {
    for (const y of [0, 300, 600, 550, 700, 40]) {
      await probes.scrollTo(y);
      const states = probes.states();
      assert.equal(states[0], states[1], `all bars agree at scrollY ${y} (got ${states})`);
    }
    assert.deepEqual(probes.states(), ['V', 'V'], 'back near the top, all bars are visible');
  } finally {
    await probes.unmount();
  }
});

test('disabled consumers never hide and never attach scroll listeners', async () => {
  const probe = await mountProbes(false, 1);
  try {
    assert.deepEqual(probe.states(), ['V']);
    await probe.scrollTo(900);
    assert.deepEqual(probe.states(), ['V'], 'off the reader page the bar is the primary navigation and stays');
  } finally {
    await probe.unmount();
  }
});
