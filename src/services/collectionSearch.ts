import type { CollectionItem, CollectionItemType, PersonalCollection, SavedSearch, SavedSearchItem } from '../types/textbase';

/** Lower-cased and accent-folded, so "Iliada" finds "Iliadă" and "CAESAR" finds "Caesar". */
export function normalizeForSearch(text: string): string {
  return text.normalize('NFD').replace(/\p{M}+/gu, '').toLocaleLowerCase();
}

/**
 * Whether every whitespace-separated word of the query occurs somewhere in
 * the given fields (any order, any field). An empty query matches all.
 * Shared by the collections panel and the reader's table-of-contents filter.
 */
export function matchesSearch(query: string, ...fields: Array<string | null | undefined>): boolean {
  const words = normalizeForSearch(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = normalizeForSearch(fields.filter(Boolean).join('\n'));
  return words.every(word => haystack.includes(word));
}

export type CollectionsSectionId = 'favorites' | 'collections' | 'searches';
export type CollectionsTypeFilter = 'all' | CollectionItemType;

export type GroupItem =
  | { kind: 'collection'; key: string; item: CollectionItem }
  | { kind: 'search'; key: string; item: SavedSearchItem };

/** One collection or saved search, with the items that survive the current filter. */
export interface CollectionsGroup {
  key: string;
  section: CollectionsSectionId;
  id: string;
  title: string;
  description?: string;
  /** Item count before filtering. */
  total: number;
  items: GroupItem[];
  deletable: boolean;
  /** Saved searches only: the query "Run again" repeats. */
  query?: string;
}

export interface CollectionsView {
  favorites: CollectionsGroup | null;
  collections: CollectionsGroup[];
  searches: CollectionsGroup[];
}

const collectionItemMatches = (query: string, item: CollectionItem) =>
  matchesSearch(query, item.workTitle, item.authorName, item.chapterTitle, item.quoteText, item.note);

const searchItemMatches = (query: string, item: SavedSearchItem) =>
  matchesSearch(query, item.workTitle, item.authorName, item.chapterTitle, item.snippet);

/**
 * The three sections of the collections screen/modal - Favorites, the
 * user's collections and saved searches - narrowed by the query and the
 * item-type filter. A group whose own name matches shows all its items;
 * otherwise only the matching items, and a group with none is dropped.
 * Saved-search items are works/chapters, so any specific type filter hides
 * the searches.
 */
export function buildCollectionsView(
  collections: PersonalCollection[],
  searches: SavedSearch[],
  query: string,
  typeFilter: CollectionsTypeFilter = 'all',
): CollectionsView {
  const filtering = query.trim().length > 0;

  const collectionGroup = (collection: PersonalCollection): CollectionsGroup | null => {
    const nameMatches = filtering && matchesSearch(query, collection.name, collection.description);
    const items: GroupItem[] = collection.items
      .filter(item => typeFilter === 'all' || item.type === typeFilter)
      .filter(item => !filtering || nameMatches || collectionItemMatches(query, item))
      .map(item => ({ kind: 'collection', key: item.id, item }));
    if (filtering && !nameMatches && items.length === 0) return null;
    return {
      key: `col:${collection.id}`,
      section: collection.isDefaultFavorites ? 'favorites' : 'collections',
      id: collection.id,
      title: collection.name,
      description: collection.description,
      total: collection.items.length,
      items,
      deletable: !collection.isDefaultFavorites,
    };
  };

  const searchGroup = (search: SavedSearch): CollectionsGroup | null => {
    const nameMatches = filtering && matchesSearch(query, search.name, search.query);
    const items: GroupItem[] = search.items
      .filter(item => !filtering || nameMatches || searchItemMatches(query, item))
      .map(item => ({ kind: 'search', key: item.id, item }));
    if (filtering && !nameMatches && items.length === 0) return null;
    return {
      key: `search:${search.id}`,
      section: 'searches',
      id: search.id,
      title: search.name,
      total: search.items.length,
      items,
      deletable: true,
      query: search.query,
    };
  };

  const groups = collections.map(collectionGroup).filter((g): g is CollectionsGroup => g !== null);
  return {
    favorites: groups.find(g => g.section === 'favorites') ?? null,
    collections: groups.filter(g => g.section === 'collections'),
    searches: typeFilter === 'all' ? searches.map(searchGroup).filter((g): g is CollectionsGroup => g !== null) : [],
  };
}

/** Every group of a view, in the order the sections are shown. */
export function viewGroups(view: CollectionsView): CollectionsGroup[] {
  return [...(view.favorites ? [view.favorites] : []), ...view.collections, ...view.searches];
}

/** A row the keyboard can land on. */
export type NavRow =
  | { key: string; kind: 'header'; group: CollectionsGroup }
  | { key: string; kind: 'run'; group: CollectionsGroup }
  | { key: string; kind: 'item'; group: CollectionsGroup; item: GroupItem };

export const headerRowKey = (group: CollectionsGroup) => `h:${group.key}`;
export const runRowKey = (group: CollectionsGroup) => `r:${group.key}`;
export const itemRowKey = (group: CollectionsGroup, item: GroupItem) => `i:${group.key}:${item.key}`;

/**
 * The rows on screen, top to bottom, given which groups are expanded.
 * Favorites is the first section itself, so it has no header row.
 */
export function navRows(view: CollectionsView, isOpen: (group: CollectionsGroup) => boolean): NavRow[] {
  const rows: NavRow[] = [];
  for (const group of viewGroups(view)) {
    if (group.section !== 'favorites') rows.push({ key: headerRowKey(group), kind: 'header', group });
    if (!isOpen(group)) continue;
    if (group.query !== undefined) rows.push({ key: runRowKey(group), kind: 'run', group });
    for (const item of group.items) rows.push({ key: itemRowKey(group, item), kind: 'item', group, item });
  }
  return rows;
}

/** Where typing a query should put the highlight: the first item, else the first header. */
export function firstMatchRowKey(rows: NavRow[]): string | null {
  return (rows.find(row => row.kind === 'item') ?? rows.find(row => row.kind === 'header'))?.key ?? null;
}
