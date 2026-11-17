import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SearchResult } from '../types/textbase';
import { searchResultEntryList } from './adapters';
import { ListCursor } from './cursor';
const hit = (id: string): SearchResult => ({ id, mode: 'lucene', type: 'chapter', workId: 'a/book', workTitle: 'Book', authorName: 'Author', chapterId: `a/book/${id}`, chapterTitle: id, snippet: id, language: 'en' as SearchResult['language'] });
test('entry lists page, iterate and keep stable search paths', async () => {
  const list = searchResultEntryList([hit('one'), hit('two')]);
  assert.equal(list.size, 2);
  assert.deepEqual((await list.page(1, 1)).entries.map(entry => entry.ref.path), ['a/book/two']);
  const seen: string[] = []; for await (const entry of list) seen.push(entry.id); assert.deepEqual(seen, ['one', 'two']);
  const cursor = new ListCursor(list); assert.equal((await cursor.next())?.id, 'two'); assert.equal(cursor.index, 1); assert.equal((await cursor.previous())?.id, 'one');
});
