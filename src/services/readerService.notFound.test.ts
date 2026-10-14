import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

test('404 content with stale metadata displays Chapter not available, without declaring a healthy server down', async () => {
  const originalFetch = globalThis.fetch;
  const globals = globalThis as any;
  const previous = { window: globals.window, location: globals.location, localStorage: globals.localStorage };
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) };
  globals.window = { localStorage: storage, location: { origin: 'http://localhost' }, speechSynthesis: { getVoices: () => [] } };
  globals.location = globals.window.location;
  globals.localStorage = storage;
  const workId = 'zevaco/buridan';
  const chapterId = `${workId}/x_buridan`;
  const page = { items: [], page: 1, size: 12, totalItems: 0, totalPages: 1 };
  globalThis.fetch = async input => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes('/api/server-content/')) return new Response(null, { status: 404 });
    if (url.includes('/api/divs/42/toc')) return Response.json([{ leaf: true, path: chapterId, head: 'Buridan' }]);
    if (url.includes('/api/divs?')) return Response.json({ id: 42, opus: true, path: workId, head: 'Buridan', lang: 'fr', author: { strId: 'zevaco', firstName: 'Michel', lastName: 'Zévaco' } });
    if (url.includes('/api/authors/page') || url.includes('/api/works')) return Response.json(page);
    if (url.includes('/api/collections/system/')) return Response.json([]);
    if (url.includes('/api/lucene/status')) return Response.json({});
    return new Response(null, { status: 404 });
  };
  const until = async (predicate: () => boolean) => {
    const deadline = Date.now() + 5000;
    while (!predicate()) {
      assert.ok(Date.now() < deadline, 'reader must settle instead of spinning forever');
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  };
  try {
    const { readerService } = await import('./readerService');
    readerService.getWorkById(workId);
    await until(() => Boolean(readerService.getWorkById(workId)));
    readerService.getChaptersForWork(workId);
    await until(() => readerService.getChaptersForWork(workId).length === 1);
    readerService.getChapter(workId, chapterId);
    await until(() => readerService.isChapterContentFailed(chapterId));
    assert.ok(readerService.getChapter(workId, chapterId), 'metadata remains present for this regression');
    await readerService.retryServerConnection();
    assert.equal(readerService.isChapterContentFailed(chapterId), true, 'a healthy status check must not erase a permanent content 404');
    await until(() => Boolean(readerService.getWorkById(workId)) && !readerService.isWorkLoading(workId));
    const { ReaderView } = await import('../components/ReaderView');
    const noop = () => {};
    const html = renderToStaticMarkup(createElement(ReaderView, {
      workId, chapterId, reallySignedIn: false, settingsOpen: false, currentUserId: 'guest',
      onBack: noop, onBackToWork: noop, onSelectWork: noop, onSettingsOpenChange: noop,
      onSelectChapter: noop, onMoreLikeThis: noop, onOpenAddToCollection: noop,
    }));
    assert.match(html, /Chapter not available/);
    assert.match(html, /Return to Work/);
    assert.doesNotMatch(html, /reader-chapter-toolbar|reader-text-container|animate-spin/);
    assert.equal(readerService.isServerDown(), false);
    const { ServerStatusToast } = await import('../components/ServerStatusToast');
    assert.equal(renderToStaticMarkup(createElement(ServerStatusToast)), '');
    globalThis.fetch = async () => new Response(null, { status: 502 });
    await readerService.retryServerConnection();
    const outage = renderToStaticMarkup(createElement(ServerStatusToast));
    assert.match(outage, /Server down/);
    // the server-error artwork is inlined: it must show while the server is unreachable
    assert.match(outage, /src="data:image\/jpeg;base64,/);
    assert.doesNotMatch(outage, /Fetch failed|catalog can’t load/);
    assert.equal(outage.match(/Server down/g)?.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
    Object.assign(globals, previous);
  }
});
