import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Chapter, Work } from '../types/textbase';

test('chapter HTML stays intact and a missing HTML heading gets no database title fallback', async context => {
  const globals = globalThis as any;
  const previous = { window: globals.window, localStorage: globals.localStorage };
  const storage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  globals.window = { localStorage: storage, speechSynthesis: { getVoices: () => [] } };
  globals.localStorage = storage;
  try {
    const { readerService } = await import('../services/readerService');
    const { ReaderView } = await import('./ReaderView');
    const work: Work = {
      id: 'author/work', authorId: 'author', authorName: 'Author', title: 'Work',
      detectedLanguage: 'eng', sizeWords: 1, sizeBytes: 1, chapterCount: 1,
      license: '', sourceRepo: '', tags: [], summary: '',
      teiHeaderSummary: { titleStmt: '', publicationStmt: '', sourceDesc: '' }
    };
    const incoming = '<div><h2><span class="head-label">IV</span> HTML title'
      + '<button class="note" title="Heading note"><sup>7</sup></button></h2>'
      + '<hr><p class="subtitle">Original subtitle</p><p>Body.</p></div>';
    const chapter: Chapter = {
      id: 'author/work/chapter', workId: work.id, chapterNumber: 1,
      title: 'Stale database title', subtitle: 'Database subtitle',
      htmlContent: incoming, plainText: 'Body.', wordCount: 1
    };
    context.mock.method(readerService, 'getWorkById', () => work);
    context.mock.method(readerService, 'getChaptersForWork', () => [chapter]);
    context.mock.method(readerService, 'getChapter', () => chapter);
    context.mock.method(readerService, 'isWorkUnlocked', () => true);
    const noop = () => {};
    const render = () => renderToStaticMarkup(createElement(ReaderView, {
      workId: work.id, chapterId: chapter.id, reallySignedIn: false,
      settingsOpen: false, currentUserId: 'guest',
      onBack: noop, onBackToWork: noop, onSelectWork: noop,
      onSettingsOpenChange: noop, onSelectChapter: noop,
      onMoreLikeThis: noop, onOpenAddToCollection: noop
    }));
    const html = render();
    assert.ok(html.includes(incoming), 'heading, label, note, hr and subtitle stay together unchanged');
    assert.equal(html.split('HTML title').length - 1, 1);
    assert.ok(!html.includes('btn-reader-title-to-work'));
    assert.ok(!html.includes('Database subtitle'));

    chapter.htmlContent = '<div><p>No heading supplied.</p></div>';
    const withoutHeading = render();
    assert.ok(withoutHeading.includes(chapter.htmlContent));
    assert.doesNotMatch(withoutHeading, /<h[1-6][^>]*>Stale database title<\/h[1-6]>/);
  } finally {
    Object.assign(globals, previous);
  }
});
