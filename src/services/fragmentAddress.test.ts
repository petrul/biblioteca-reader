import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalSelector, fragmentPath, legacyFragmentSelector, parseFragmentLocation } from './fragmentAddress';
import { parseAppPath, buildAppPath } from '../router';

const source = 'strabo/geography/head_first';
test('node paths, text points and cross-element ranges have one unambiguous canonical grammar', () => {
  for (const selector of ['_1', '_1.2.3', '_1:10..1:30', '_1:40..2.3.2:15', '_1..3']) {
    const location = { sourcePath: source, selector };
    const url = fragmentPath(location);
    assert.equal(url, '/' + source + '/' + selector);
    assert.deepEqual(parseFragmentLocation(url), location);
    const route = parseAppPath(url);
    assert.equal(route.view, 'reader');
    assert.equal(route.chapterId, source, 'a fragment must not become a synthetic chapter');
    assert.deepEqual(route.fragment, location);
    assert.equal(buildAppPath(route), url);
  }
  assert.equal(canonicalSelector('_001.02:00010..1.2:030'), '_1.2:10..1.2:30');
});

test('legacy dot offsets and stored vector paths normalize without changing source coordinates', () => {
  assert.equal(legacyFragmentSelector('1.10', '1.30'), '_1:10..1:30');
  assert.equal(legacyFragmentSelector('1.2.3.10', '2.3.2.15'), '_1.2.3:10..2.3.2:15');
  assert.deepEqual(parseFragmentLocation('/quote/' + source, '?end=1.30&start=1.10'), { sourcePath: source, selector: '_1:10..1:30' });
  assert.deepEqual(parseFragmentLocation('/' + source, '?start=1.10&end=1.30'), { sourcePath: source, selector: '_1:10..1:30' });
  assert.deepEqual(parseFragmentLocation('/' + source + '/_1/_2/_3'), { sourcePath: source, selector: '_1.2.3' });
});

test('context and pinned revision round-trip while the normal source path remains a normal page', () => {
  const revision = 'a'.repeat(64);
  const location = { sourcePath: source, selector: '_1', revision, contextOnly: true };
  const url = fragmentPath(location), [path, query] = url.split('?');
  assert.equal(url, '/' + source + '/_1?rev=' + revision + '&display=context');
  assert.deepEqual(parseFragmentLocation(path, query), location);
  assert.equal(parseFragmentLocation('/' + source), null);
  assert.equal(parseFragmentLocation('/api/divs', '?path=' + source + '/_1'), null);
  for (const extension of ['html', 'txt', 'xml', 'json']) assert.equal(parseFragmentLocation('/' + source + '/_1.' + extension), null);
});

test('malformed selectors and conflicting query parameters fail rather than silently showing the whole page', () => {
  for (const selector of ['_', '_0', '_1:2', '_1..', '_1...2', '_1..2..3', '_1.-2', '_1:-1..1:2', '_1/2', '_2147483648', '_1:2147483648..1:2'])
    assert.throws(() => canonicalSelector(selector), undefined, selector);
  for (const query of ['?start=1.10', '?end=1.30', '?start=1.10&start=1.20&end=1.30', '?start=1.10&end=1.30&rev=invalid', '?start=0.1&end=1.4'])
    assert.throws(() => parseFragmentLocation('/' + source, query), undefined, query);
  assert.throws(() => fragmentPath({ sourcePath: 'author/../etc', selector: '_1' }));
});
