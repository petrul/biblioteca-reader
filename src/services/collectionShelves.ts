import type { SavedQuote } from './serverQuoteApi';
import { PersonalCollection, SavedSearch } from '../types/textbase';
import { searchTargetPath } from './searchTargets';

// The home page's per-collection shelves for a signed-in reader: one shelf
// per stored collection that has something in it - Favorites first, then
// the reader's own collections, then saved searches - each listing that
// collection's own entries in its own order.

export type ShelfEntryTarget =
  | { kind: 'work'; workId: string }
  | { kind: 'chapter'; workId: string; chapterId: string }
  | { kind: 'quote'; quoteId: string; saved: SavedQuote };

export interface ShelfEntry {
  key: string;
  label: 'Work' | 'Chapter' | 'Quote' | 'Result';
  workId: string;
  workTitle: string;
  authorName: string;
  // The chapter title, quoted text or search snippet; absent for a whole work.
  detail?: string;
  target: ShelfEntryTarget;
}

export interface CollectionShelf {
  id: string;
  kind: 'favorites' | 'user' | 'search';
  name: string;
  description?: string;
  entries: ShelfEntry[];
}

export function collectionShelves(collections: PersonalCollection[], searches: SavedSearch[]): CollectionShelf[] {
  const personal = [
    ...collections.filter(c => c.isDefaultFavorites),
    ...collections.filter(c => !c.isDefaultFavorites)
  ].map((collection): CollectionShelf => ({
    id: collection.id,
    kind: collection.isDefaultFavorites ? 'favorites' : 'user',
    name: collection.name,
    description: collection.description,
    entries: collection.items.map((item): ShelfEntry => {
      const base = { key: item.id, workId: item.workId, workTitle: item.workTitle, authorName: item.authorName };
      if (item.type === 'quote') {
        return { ...base, label: 'Quote', detail: item.quoteText, target: { kind: 'quote', quoteId: item.referenceId, saved: { workId: item.workId, chapterId: item.chapterId, quoteText: item.quoteText } } };
      }
      if (item.type === 'chapter' && item.chapterId) {
        return { ...base, label: 'Chapter', detail: item.chapterTitle, target: { kind: 'chapter', workId: item.workId, chapterId: item.chapterId } };
      }
      return { ...base, label: 'Work', target: { kind: 'work', workId: item.workId } };
    })
  }));
  const saved = searches.map((search): CollectionShelf => ({
    id: search.id,
    kind: 'search',
    name: search.name,
    entries: search.items.map((item): ShelfEntry => ({
      key: item.id,
      label: 'Result',
      workId: item.workId,
      workTitle: item.workTitle,
      authorName: item.authorName,
      detail: item.snippet || item.chapterTitle,
      // Same destination as opening the hit from the collections panel.
      target: item.chapterId
        ? { kind: 'chapter', workId: item.workId, chapterId: searchTargetPath(item) }
        : { kind: 'work', workId: item.workId }
    }))
  }));
  return [...personal, ...saved].filter(shelf => shelf.entries.length > 0);
}
