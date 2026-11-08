import type { CollectionItem, SavedSearchItem, SearchResult } from '../types/textbase';
export type EntryKind = 'work' | 'chapter' | 'fragment' | 'quote' | 'search-hit';
export interface PassageRef { path: string; kind: EntryKind; start?: string; end?: string; }
export interface Entry {
  id: string; ref: PassageRef; label: string; workId: string; workTitle: string; authorName: string;
  chapterId?: string; chapterTitle?: string; snippet?: string; score?: number; addedAt?: string;
  source: 'collection' | 'saved-search' | 'search'; original: CollectionItem | SavedSearchItem | SearchResult;
}
export type ListKey = `collection:${string}` | `search:${string}` | `saved-search:${string}` | 'search:last';
export interface ListPage { entries: Entry[]; offset: number; limit: number; hasMore: boolean; }
export interface EntryList {
  readonly key: ListKey; readonly title: string; readonly size: number | undefined;
  page(offset: number, limit: number): Promise<ListPage>; subscribe(listener: () => void): () => void;
  [Symbol.asyncIterator](): AsyncIterator<Entry>;
}
