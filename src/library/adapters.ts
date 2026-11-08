import type { CollectionItem, PersonalCollection, SavedSearch, SavedSearchItem, SearchResult } from '../types/textbase';
import { searchTargetPath } from '../services/searchTargets';
import type { Entry, EntryList, ListKey, ListPage, PassageRef } from './types';
function refFor(item: { target?: SearchResult['target']; workId: string; chapterId?: string }): PassageRef {
  const path = searchTargetPath(item); const target = item.target;
  return { path, kind: target?.kind === 'fragment' ? 'fragment' : item.chapterId ? 'chapter' : 'work' };
}
export function collectionEntry(item: CollectionItem): Entry { return { id: item.id, ref: { path: item.referenceId, kind: item.type === 'quote' ? 'quote' : item.type }, label: item.chapterTitle || item.workTitle, workId: item.workId, workTitle: item.workTitle, authorName: item.authorName, chapterId: item.chapterId, chapterTitle: item.chapterTitle, snippet: item.quoteText, addedAt: item.addedAt, source: 'collection', original: item }; }
export function savedSearchEntry(item: SavedSearchItem): Entry { return { id: item.id, ref: refFor(item), label: item.chapterTitle || item.workTitle, workId: item.workId, workTitle: item.workTitle, authorName: item.authorName, chapterId: item.chapterId, chapterTitle: item.chapterTitle, snippet: item.snippet, score: item.score, addedAt: item.addedAt, source: 'saved-search', original: item }; }
export function searchResultEntry(item: SearchResult): Entry { return { id: item.id, ref: refFor(item), label: item.chapterTitle || item.workTitle, workId: item.workId, workTitle: item.workTitle, authorName: item.authorName, chapterId: item.chapterId, chapterTitle: item.chapterTitle, snippet: item.snippet, score: item.score, source: 'search', original: item }; }
class MemoryEntryList implements EntryList {
  private readonly listeners = new Set<() => void>();
  constructor(public readonly key: ListKey, public readonly title: string, private readonly entries: Entry[]) {}
  get size(): number { return this.entries.length; }
  async page(offset: number, limit: number): Promise<ListPage> { const safeOffset = Math.max(0, offset); const safeLimit = Math.max(1, limit); const entries = this.entries.slice(safeOffset, safeOffset + safeLimit); return { entries, offset: safeOffset, limit: safeLimit, hasMore: safeOffset + entries.length < this.entries.length }; }
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  [Symbol.asyncIterator](): AsyncIterator<Entry> { let index = 0; const entries = this.entries; return { next: async () => index < entries.length ? { value: entries[index++], done: false } : { value: undefined, done: true } }; }
}
export function collectionEntryList(collection: PersonalCollection): EntryList { return new MemoryEntryList(`collection:${collection.id}`, collection.name, collection.items.map(collectionEntry)); }
export function savedSearchEntryList(search: SavedSearch): EntryList { return new MemoryEntryList(`saved-search:${search.id}`, search.name, search.items.map(savedSearchEntry)); }
export function searchResultEntryList(results: SearchResult[], title = 'Search results', key: ListKey = 'search:last'): EntryList { return new MemoryEntryList(key, title, results.map(searchResultEntry)); }
