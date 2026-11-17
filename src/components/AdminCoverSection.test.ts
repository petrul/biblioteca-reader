import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';

function installDom() {
  const dom = new Window({ url: 'http://reader.test/app/work/comnena/alexiada' });
  const globals = globalThis as any;
  const saved = new Map<string, PropertyDescriptor | undefined>();
  const define = (key: string, value: unknown) => {
    if (!saved.has(key)) saved.set(key, Object.getOwnPropertyDescriptor(globals, key));
    Object.defineProperty(globals, key, { value, configurable: true, writable: true });
  };
  for (const key of ['window', 'document', 'navigator', 'location', 'localStorage', 'sessionStorage']) {
    define(key, (dom.window as any)[key]);
  }
  for (const key of ['HTMLElement', 'Element', 'Node', 'Text', 'Event', 'MouseEvent', 'PointerEvent',
    'KeyboardEvent', 'MutationObserver', 'ResizeObserver', 'IntersectionObserver', 'Range', 'DOMRect',
    'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'matchMedia']) {
    if (key in dom.window) define(key, (dom.window as any)[key]);
  }
  define('IS_REACT_ACT_ENVIRONMENT', true);
  return {
    dom,
    restore: async () => {
      await dom.happyDOM.close();
      for (const [key, descriptor] of saved) {
        if (descriptor) Object.defineProperty(globals, key, descriptor);
        else delete globals[key];
      }
    }
  };
}

test('New random JSON only updates the editable request; Generate cover renders the PNG', async context => {
  const dom = installDom();
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; method: string; body?: string }> = [];
  (globalThis as any).fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method || 'GET';
    requests.push({ url, method, body: typeof init?.body === 'string' ? init.body : undefined });
    if (url.includes('/request?path=')) return Response.json({ coverUrl: undefined, request: null });
    if (url.includes('/request/random?path=')) {
      return Response.json({ request: { title: 'Alexiada', author: 'Ana Comnena', layout: 'folio_nocturne' } });
    }
    if (url.endsWith('/api/admin/covers/work')) {
      return Response.json({ coverUrl: 'https://test.scriptorium.ro/biblioteca/covers/comnena/alexiada-new.png', request: { title: 'Alexiada', author: 'Ana Comnena', layout: 'folio_nocturne' } });
    }
    return new Response('', { status: 404 });
  };
  try {
    const { act, createElement } = await import('react');
    const { createRoot } = await import('react-dom/client');
    const { AdminCoverSection } = await import('./AdminCoverSection');
    const changed: string[] = [];
    const host = dom.dom.window.document.createElement('div');
    dom.dom.window.document.body.appendChild(host);
    const root = createRoot(host as unknown as HTMLElement);
    await act(async () => {
      root.render(createElement(AdminCoverSection, { workId: 'comnena/alexiada', onCoverChanged: (url: string) => changed.push(url) }));
    });
    const random = dom.dom.window.document.getElementById('btn-admin-new-random-json') as unknown as HTMLButtonElement;
    assert.ok(random);
    await act(async () => { random.click(); });
    assert.equal(requests.filter(request => request.method === 'POST').length, 0, 'rolling JSON must not render');
    assert.deepEqual(changed, []);
    assert.match(requests.find(request => request.url.includes('/request/random?'))?.url || '', /&nonce=/, 'random JSON requests must bypass browser caches');
    assert.match(dom.dom.window.document.querySelector('textarea')?.value || '', /folio_nocturne/);
    const generate = dom.dom.window.document.getElementById('btn-admin-generate-cover') as unknown as HTMLButtonElement;
    await act(async () => { generate.click(); });
    assert.equal(requests.filter(request => request.method === 'POST').length, 1);
    assert.deepEqual(changed, ['https://test.scriptorium.ro/biblioteca/covers/comnena/alexiada-new.png']);
    assert.ok(dom.dom.window.document.querySelector('[data-testid="admin-cover-image"]'), 'the generated PNG is shown');
    await act(async () => root.unmount());
  } finally {
    globalThis.fetch = originalFetch;
    await dom.restore();
  }
});

test('an existing generated cover is propagated to the front work card on load', async () => {
  const dom = installDom();
  const originalFetch = globalThis.fetch;
  (globalThis as any).fetch = async () => Response.json({
    coverUrl: 'https://test.scriptorium.ro/biblioteca/covers/comnena/alexiada-existing.png',
    request: { title: 'Alexiada', author: 'Ana Comnena', layout: 'folio_nocturne' },
  });
  try {
    const { act, createElement } = await import('react');
    const { createRoot } = await import('react-dom/client');
    const { AdminCoverSection } = await import('./AdminCoverSection');
    const changed: string[] = [];
    const host = dom.dom.window.document.createElement('div');
    dom.dom.window.document.body.appendChild(host);
    const root = createRoot(host as unknown as HTMLElement);
    await act(async () => {
      root.render(createElement(AdminCoverSection, { workId: 'comnena/alexiada', onCoverChanged: (url: string) => changed.push(url) }));
    });
    await act(async () => new Promise(resolve => setTimeout(resolve, 20)));
    assert.deepEqual(changed, ['https://test.scriptorium.ro/biblioteca/covers/comnena/alexiada-existing.png']);
    await act(async () => root.unmount());
  } finally {
    globalThis.fetch = originalFetch;
    await dom.restore();
  }
});
