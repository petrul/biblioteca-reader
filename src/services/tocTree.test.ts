import assert from 'node:assert/strict';
import test from 'node:test';
import type { Chapter } from '../types/textbase';
import { ancestorIds, buildTocEntries, isPreviewPage } from './tocTree';

const anc = (id: string, depth: number) => ({ id, title: id.toUpperCase(), depth });
const a = anc('w/a', 1);
const a1 = anc('w/a/1', 2);
const b = anc('w/b', 1);
const page = (id: string, n: number, ancestors: ReturnType<typeof anc>[], isSection = false): Chapter =>
  ({ id, workId: 'w', chapterNumber: n, title: `T ${id}`, ancestors, ...(isSection ? { isSection } : {}) } as Chapter);

const chapters = [
  page('w', 1, [], true),
  page('w/c1', 2, []),
  page('w/a', 3, [], true),
  page('w/a/x', 4, [a]),
  page('w/a/1', 5, [a], true),
  page('w/a/1/y', 6, [a, a1]),
  page('w/a/1/z', 7, [a, a1]),
  page('w/b', 8, [], true),
  page('w/b/q', 9, [b]),
];
const label = (e: ReturnType<typeof buildTocEntries>[number]) => `${e.type[0]}:${e.chapter.id}`;

test('sections are rows of their own and everything below the top level starts collapsed', () => {
  const rows = buildTocEntries(chapters, new Set(), null);
  assert.deepEqual(rows.map(label), ['s:w', 'c:w/c1', 's:w/a', 's:w/b']);
  assert.ok(rows.every(r => r.type !== 'section' || r.chapter.id === 'w' || !r.expanded));
  assert.equal(rows[0].type === 'section' && rows[0].collapsible, false, 'the work title page is not collapsible');
});

test('the path to the current page is open, and a current section opens its own children', () => {
  const open = new Set(ancestorIds(chapters[5]));
  assert.deepEqual([...open].sort(), ['w/a', 'w/a/1']);
  assert.deepEqual(buildTocEntries(chapters, open, null).map(label),
    ['s:w', 'c:w/c1', 's:w/a', 'c:w/a/x', 's:w/a/1', 'c:w/a/1/y', 'c:w/a/1/z', 's:w/b']);
  assert.deepEqual(ancestorIds(chapters[4]), ['w/a', 'w/a/1']);
});

test('a collapsed parent hides an expanded child', () => {
  assert.deepEqual(buildTocEntries(chapters, new Set(['w/a/1']), null).map(label), ['s:w', 'c:w/c1', 's:w/a', 's:w/b']);
});

test('a search lists matches under their sections, expanded and not collapsible', () => {
  const rows = buildTocEntries(chapters, new Set(), c => c.id === 'w/a/1/z' || c.id === 'w/b/q');
  assert.deepEqual(rows.map(label), ['s:w/a', 's:w/a/1', 'c:w/a/1/z', 's:w/b', 'c:w/b/q']);
  assert.ok(rows.every(r => r.type !== 'section' || (r.expanded && !r.collapsible)));
});

test('a search can match a section on its own', () => {
  assert.deepEqual(buildTocEntries(chapters, new Set(), c => c.id === 'w/b').map(label), ['s:w/b']);
});

test('the free preview covers the first chapter and the title pages before it', () => {
  assert.ok(isPreviewPage(chapters, chapters[0]));
  assert.ok(isPreviewPage(chapters, chapters[1]));
  assert.ok(!isPreviewPage(chapters, chapters[2]));
  assert.ok(!isPreviewPage(chapters, chapters[3]));
});
