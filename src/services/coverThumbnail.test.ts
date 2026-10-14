import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { coverThumbnailUrl } from './coverThumbnail';
import { WorkCoverImage } from '../components/DefaultWorkCover';

test('remote covers request same-origin thumbnails and preserve signed URL parameters', () => {
  const original = 'https://assets.example/covers/book.png?signature=a+b&revision=2';
  const url = new URL(coverThumbnailUrl(original)!, 'https://reader.example');
  assert.equal(url.origin, 'https://reader.example');
  assert.equal(url.pathname, '/api/cover-thumbnails');
  assert.equal(url.searchParams.get('url'), original);
  assert.equal(url.searchParams.get('width'), '320');
  assert.equal(new URL(coverThumbnailUrl(original, 640)!, 'https://reader.example').searchParams.get('width'), '640');
});

test('local defaults, data images, and existing proxy URLs are not sent to the covers service', () => {
  for (const source of [undefined, '/app/cover-blue.jpg', '/api/cover-thumbnails?url=x&width=320', 'data:image/png;base64,aGVsbG8=', 'blob:https://reader.example/image']) {
    assert.equal(coverThumbnailUrl(source), source);
  }
});

test('cover components render thumbnail URLs while originals remain available as data', () => {
  const original = 'https://assets.example/covers/work.png';
  const html = renderToStaticMarkup(createElement(WorkCoverImage, { src: original, title: 'Work', author: 'Author', thumbnailWidth: 640 }));
  assert.match(html, /src="\/api\/cover-thumbnails\?/);
  assert.match(html, /width=640/);
  assert.doesNotMatch(html, /src="https:\/\/assets/);
  assert.match(renderToStaticMarkup(createElement(WorkCoverImage, { title: 'Work', author: 'Author' })), /Default cover for Work by Author/);
});
