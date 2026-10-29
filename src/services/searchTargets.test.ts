import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceTarget, searchTargetPath } from './searchTargets';

test('search targets keep fragment references separate from reading-page identity', () => {
  const target = sourceTarget('writer/book/chapter/_2');
  assert.deepEqual(target, { kind: 'fragment', reference: { sourcePath: 'writer/book/chapter', selector: '_2' } });
  const first = { workId: 'writer/book', chapterId: 'writer/book/chapter', target };
  const second = { ...first, target: sourceTarget('writer/book/chapter/_3') };
  assert.notEqual(searchTargetPath(first), searchTargetPath(second));
  assert.equal(searchTargetPath(first), '/writer/book/chapter/_2');
  assert.deepEqual(sourceTarget('writer/book/chapter'), { kind: 'page', sourcePath: 'writer/book/chapter' });
  assert.deepEqual(sourceTarget('writer/book'), { kind: 'work', workId: 'writer/book' });
});

test('saved canonical fragments retain selectors and source revisions', () => {
  const path = '/writer/book/chapter/_1:2..3.1.2:8?rev=' + 'a'.repeat(64);
  assert.equal(searchTargetPath({ workId: 'writer/book', target: sourceTarget(path) }), path);
});
