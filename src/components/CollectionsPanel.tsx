import { searchTargetPath } from '../services/searchTargets';
import React, { useEffect, useMemo, useState } from 'react';
import {
  Bookmark,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Pencil,
  Play,
  Search,
  Star,
  Trash2,
} from 'lucide-react';
import { CollectionItemType, PersonalCollection, SavedSearch } from '../types/textbase';
import { readerService } from '../services/readerService';
import {
  deleteSavedSearch,
  getSavedSearches,
  renameSavedSearch,
  subscribeSavedSearches,
} from '../services/savedSearches';
import {
  CollectionsGroup,
  CollectionsTypeFilter,
  GroupItem,
  NavRow,
  buildCollectionsView,
  firstMatchRowKey,
  headerRowKey,
  itemRowKey,
  navRows,
  runRowKey,
} from '../services/collectionSearch';
import { SearchField } from './SearchField';

export interface CollectionsPanelProps {
  userId: string;
  /** Page mode: reorder, remove, rename and delete controls. The modal leaves them out. */
  manage?: boolean;
  autoFocus?: boolean;
  onSelectWork: (workId: string) => void;
  onSelectChapter: (workId: string, chapterId: string) => void;
  onOpenQuote: (quoteId: string) => void;
  onRunSearch: (query: string) => void;
  /** Called after something was opened - the modal closes itself here. */
  onNavigate?: () => void;
  /** Rendered next to the search box (the modal's close button). */
  searchAddon?: React.ReactNode;
  className?: string;
  /** Classes for the scrollable results area. */
  bodyClassName?: string;
}

const TYPE_TABS: Array<{ id: CollectionsTypeFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'work', label: 'Works' },
  { id: 'chapter', label: 'Chapters' },
  { id: 'quote', label: 'Quotations' },
];

const typeBadgeClass = (type: CollectionItemType) =>
  type === 'work' ? 'bg-amber-500/15 text-[#f59e0b] border-amber-500/30'
    : type === 'chapter' ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
      : 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30';

const SECTION_TITLE = 'text-[10px] font-bold uppercase tracking-widest text-emerald-300/60 px-2';
const ICON_BUTTON = 'p-2 rounded-lg text-emerald-200/60 hover:text-white hover:bg-emerald-500/10 transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-default';

/**
 * Favorites, collections and saved searches behind one search box. This is
 * the whole collections experience: the Collections page renders it with
 * `manage`, and the `s` shortcut's modal renders it as a quick jump list.
 *
 * Typing filters every section at once (all words must match, accents and
 * case ignored), expands what matches and highlights the first hit; the
 * arrow keys move the highlight and Enter opens it.
 */
export const CollectionsPanel: React.FC<CollectionsPanelProps> = ({
  userId,
  manage = false,
  autoFocus = false,
  onSelectWork,
  onSelectChapter,
  onOpenQuote,
  onRunSearch,
  onNavigate,
  searchAddon,
  className = '',
  bodyClassName = '',
}) => {
  const [, setRevision] = useState(0);
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<CollectionsTypeFilter>('all');
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Read on every render, never copied into state: the stores notify on
  // change and a copy would go stale (a chapter bookmarked in the reader
  // must show up here without reopening anything).
  useEffect(() => {
    const bump = () => setRevision(n => n + 1);
    const stopCollections = readerService.subscribe(bump);
    const stopSearches = subscribeSavedSearches(bump);
    return () => { stopCollections(); stopSearches(); };
  }, []);

  const collections: PersonalCollection[] = readerService.getCollections(userId);
  const searches: SavedSearch[] = getSavedSearches();
  const filtering = query.trim().length > 0;

  const view = useMemo(
    () => buildCollectionsView(collections, searches, query, typeFilter),
    // The arrays are re-read each render; their contents are what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [collections, searches, query, typeFilter],
  );

  // A filter opens everything it matched; without one the user's own
  // expansion applies (Favorites always lists its items).
  const isOpen = (group: CollectionsGroup) =>
    group.section === 'favorites' || filtering || (openGroups[group.key] ?? false);
  const rows = navRows(view, isOpen);
  const activeRow: NavRow | undefined = rows.find(row => row.key === activeKey);

  useEffect(() => {
    setActiveKey(filtering ? firstMatchRowKey(rows) : null);
    // Only a changed query/filter moves the highlight, not data updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, typeFilter]);

  useEffect(() => {
    if (!activeKey) return;
    document.getElementById(`cp-row-${activeKey}`)?.scrollIntoView?.({ block: 'nearest' });
  }, [activeKey]);

  const allItems = collections.flatMap(c => c.items);
  const countOfType = (type: CollectionsTypeFilter) =>
    type === 'all' ? allItems.length : allItems.filter(i => i.type === type).length;
  const canReorder = manage && typeFilter === 'all' && !filtering;

  const toggleGroup = (group: CollectionsGroup) =>
    setOpenGroups(prev => ({ ...prev, [group.key]: !isOpen(group) }));

  const openItem = (gi: GroupItem) => {
    if (gi.kind === 'collection') {
      const item = gi.item;
      if (item.type === 'quote') onOpenQuote(item.referenceId);
      else if (item.type === 'chapter' && item.chapterId) onSelectChapter(item.workId, item.chapterId);
      else onSelectWork(item.workId);
    } else if (gi.item.chapterId) {
      onSelectChapter(gi.item.workId, searchTargetPath(gi.item));
    } else {
      onSelectWork(gi.item.workId);
    }
    onNavigate?.();
  };

  const runSearch = (group: CollectionsGroup) => {
    if (group.query === undefined) return;
    onRunSearch(group.query);
    onNavigate?.();
  };

  const activate = (row: NavRow) => {
    if (row.kind === 'header') toggleGroup(row.group);
    else if (row.kind === 'run') runSearch(row.group);
    else openItem(row.item);
  };

  const moveHighlight = (delta: 1 | -1) => {
    if (rows.length === 0) return;
    const index = activeRow ? rows.indexOf(activeRow) : -1;
    const next = index === -1 ? (delta === 1 ? 0 : rows.length - 1) : (index + delta + rows.length) % rows.length;
    setActiveKey(rows[next].key);
  };

  const onSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      moveHighlight(1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      moveHighlight(-1);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (activeRow) activate(activeRow);
    } else if (event.key === 'Escape' && query) {
      // First Escape clears the query; only an empty box lets it close the modal.
      event.preventDefault();
      event.stopPropagation();
      setQuery('');
    }
  };

  const confirmDeleteCollection = (group: CollectionsGroup) => {
    if (confirm(`Delete the collection “${group.title}”?`)) readerService.deleteCollection(userId, group.id);
  };

  const confirmDeleteSearch = (group: CollectionsGroup) => {
    if (confirm(`Delete the saved search “${group.title}”?`)) {
      deleteSavedSearch(group.id).catch(e => setError(`Could not delete: ${e.message}`));
    }
  };

  const commitRename = (group: CollectionsGroup) => {
    setEditingId(null);
    if (!draftName.trim() || draftName.trim() === group.title) return;
    renameSavedSearch(group.id, draftName).catch(e => setError(`Could not rename: ${e.message}`));
  };

  const rowClass = (key: string) =>
    `rounded-xl border transition-colors ${
      activeKey === key
        ? 'bg-emerald-500/15 border-[#f59e0b]/70 ring-1 ring-[#f59e0b]/50'
        : 'bg-black/20 border-emerald-500/20 hover:border-emerald-400/40 hover:bg-black/30'
    }`;

  const renderItemContent = (gi: GroupItem) => {
    if (gi.kind === 'collection') {
      const item = gi.item;
      return (
        <div className="space-y-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className={`text-[10px] font-bold uppercase font-mono px-2 py-0.5 rounded border ${typeBadgeClass(item.type)}`}>
              {item.type}
            </span>
            <span className="text-xs font-semibold text-emerald-200/70 truncate">{item.authorName}</span>
          </div>
          <h4 className="font-display-title text-sm font-bold text-white">
            {item.workTitle}
            {item.chapterTitle && <span className="font-normal font-serif-reading text-emerald-200/60 text-xs ml-2">— {item.chapterTitle}</span>}
          </h4>
          {item.quoteText && (
            <blockquote className="font-serif-reading text-xs italic text-emerald-100 border-l-2 border-[#f59e0b] pl-3 py-0.5 line-clamp-3">
              «{item.quoteText}»
            </blockquote>
          )}
          {item.note && <p className="text-[11px] text-emerald-200/60 italic">Note: {item.note}</p>}
        </div>
      );
    }
    const item = gi.item;
    return (
      <div className="space-y-0.5 min-w-0">
        <span className="block text-[11px] font-bold text-white truncate">
          {item.workTitle}
          {item.chapterTitle && <span className="font-normal text-emerald-200/60"> — {item.chapterTitle}</span>}
        </span>
        {item.snippet && <span className="block text-[11px] text-emerald-200/70 line-clamp-2">«{item.snippet}»</span>}
      </div>
    );
  };

  const renderItem = (group: CollectionsGroup, gi: GroupItem, index: number) => {
    const key = itemRowKey(group, gi);
    const isCollectionItem = gi.kind === 'collection';
    return (
      <div
        key={key}
        id={isCollectionItem ? `col-item-${gi.key}` : undefined}
        className={`${rowClass(key)} flex items-center gap-1 pr-2`}
      >
        <button
          type="button"
          id={`cp-row-${key}`}
          onClick={() => openItem(gi)}
          className="flex-1 min-w-0 text-left p-3 cursor-pointer"
        >
          {renderItemContent(gi)}
        </button>
        {manage && isCollectionItem && (
          <div className="flex items-center shrink-0">
            {canReorder && (
              <div className="flex items-center" role="group" aria-label={`Move ${gi.item.workTitle}`}>
                <button type="button" aria-label="Move up" title="Move up" disabled={index === 0} className={ICON_BUTTON}
                        onClick={() => readerService.moveItemInCollection(userId, group.id, gi.key, -1)}>
                  <ChevronUp className="w-4 h-4" />
                </button>
                <button type="button" aria-label="Move down" title="Move down" disabled={index === group.items.length - 1} className={ICON_BUTTON}
                        onClick={() => readerService.moveItemInCollection(userId, group.id, gi.key, 1)}>
                  <ChevronDown className="w-4 h-4" />
                </button>
              </div>
            )}
            <button type="button" aria-label="Remove from collection" title="Remove from collection"
                    className={`${ICON_BUTTON} hover:!text-red-400`}
                    onClick={() => readerService.removeItemFromCollection(userId, group.id, gi.key)}>
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        )}
        <ChevronRight className="w-4 h-4 text-[#f59e0b] shrink-0" aria-hidden="true" />
      </div>
    );
  };

  const emptyHint = (group: CollectionsGroup) => {
    if (group.total === 0) {
      return group.query !== undefined
        ? 'This search has no saved results.'
        : 'Nothing here yet — add works, chapters or quotations from anywhere in the app.';
    }
    return 'No items of this type.';
  };

  const renderGroupBody = (group: CollectionsGroup) => (
    <div className="space-y-2">
      {group.query !== undefined && (
        <button
          type="button"
          id={`cp-row-${runRowKey(group)}`}
          onClick={() => runSearch(group)}
          className={`${rowClass(runRowKey(group))} w-full flex items-center gap-2 px-3 py-2.5 text-left text-[11px] text-emerald-200/80 cursor-pointer`}
        >
          <Play className="w-3.5 h-3.5 text-[#f59e0b] shrink-0" />
          <span className="truncate">Run again: “{group.query}”</span>
        </button>
      )}
      {group.items.length === 0 && <p className="px-2 py-3 text-[11px] text-emerald-300/50">{emptyHint(group)}</p>}
      {group.items.map((gi, index) => renderItem(group, gi, index))}
    </div>
  );

  const renderGroupHeader = (group: CollectionsGroup) => {
    const open = isOpen(group);
    const key = headerRowKey(group);
    const isSearch = group.query !== undefined;
    const Icon = isSearch ? Search : Bookmark;
    const countText = filtering && group.items.length !== group.total
      ? `${group.items.length} of ${group.total}`
      : `${group.total} ${group.total === 1 ? (isSearch ? 'result' : 'item') : (isSearch ? 'results' : 'items')}`;
    return (
      <div className={`${rowClass(key)} flex items-center gap-1 pr-2`}>
        <button
          type="button"
          id={`cp-row-${key}`}
          aria-expanded={open}
          onClick={() => toggleGroup(group)}
          className="flex-1 min-w-0 flex items-center gap-2.5 p-3 text-left cursor-pointer min-h-[44px]"
        >
          {open ? <ChevronDown className="w-4 h-4 shrink-0 text-emerald-300/70" /> : <ChevronRight className="w-4 h-4 shrink-0 text-emerald-300/70" />}
          <Icon className="w-4 h-4 shrink-0 text-[#f59e0b]" />
          <span className="min-w-0">
            {manage && isSearch && editingId === group.id ? (
              <input
                autoFocus
                value={draftName}
                onClick={e => e.stopPropagation()}
                onChange={e => setDraftName(e.target.value)}
                onBlur={() => commitRename(group)}
                onKeyDown={e => {
                  e.stopPropagation();
                  if (e.key === 'Enter') commitRename(group);
                  if (e.key === 'Escape') setEditingId(null);
                }}
                className="w-full px-1 rounded bg-[#051a14] text-xs text-white border border-emerald-500/30"
              />
            ) : (
              <>
                <span className="block text-xs font-bold text-white truncate">{group.title}</span>
                <span className="block text-[10px] text-emerald-300/60">{countText}</span>
              </>
            )}
          </span>
        </button>
        {manage && (
          <div className="flex items-center shrink-0">
            {isSearch && (
              <>
                <button type="button" title="Run this search again" aria-label="Run this search again" className={ICON_BUTTON}
                        onClick={() => runSearch(group)}>
                  <Play className="w-3.5 h-3.5" />
                </button>
                <button type="button" title="Rename" aria-label="Rename" className={ICON_BUTTON}
                        onClick={() => { setDraftName(group.title); setEditingId(group.id); }}>
                  <Pencil className="w-3.5 h-3.5" />
                </button>
              </>
            )}
            {group.deletable && (
              <button type="button" title={isSearch ? 'Delete saved search' : 'Delete collection'}
                      aria-label={isSearch ? 'Delete saved search' : 'Delete collection'}
                      className={`${ICON_BUTTON} hover:!text-red-400`}
                      onClick={() => (isSearch ? confirmDeleteSearch(group) : confirmDeleteCollection(group))}>
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        )}
      </div>
    );
  };

  const renderGroups = (groups: CollectionsGroup[]) => (
    <div className="space-y-2">
      {groups.map(group => (
        <div key={group.key} id={group.query !== undefined ? `saved-search-${group.id}` : `collection-tab-${group.id}`} className="space-y-2">
          {renderGroupHeader(group)}
          {isOpen(group) && <div className="pl-3 sm:pl-5">{renderGroupBody(group)}</div>}
        </div>
      ))}
    </div>
  );

  const favoritesCount = view.favorites?.items.length ?? 0;
  const nothingMatches = filtering && rows.length === 0;

  return (
    <div className={`flex flex-col min-h-0 ${className}`}>
      <div className="shrink-0 space-y-3">
        <div className="flex items-center gap-2">
          <SearchField
            id="collections-search"
            label="Search favorites, collections and saved searches"
            className="flex-1"
            value={query}
            onValueChange={setQuery}
            onKeyDown={onSearchKeyDown}
            placeholder="Search your library…"
            autoFocus={autoFocus}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="go"
            aria-controls="collections-results"
            aria-activedescendant={activeKey ? `cp-row-${activeKey}` : undefined}
            clearable
            iconClassName="text-emerald-400/60"
            inputClassName="py-2.5 rounded-xl border border-emerald-500/20 text-sm text-white placeholder:text-emerald-300/40 focus:outline-none focus:ring-1 focus:ring-[#f59e0b] bg-[#051a14]"
          />
          {searchAddon}
        </div>
        <div className="flex items-center gap-1 bg-[#051a14] p-1 rounded-lg border border-emerald-500/20 overflow-x-auto" role="group" aria-label="Filter by type">
          {TYPE_TABS.map(tab => (
            <button
              key={tab.id}
              type="button"
              aria-pressed={typeFilter === tab.id}
              onClick={() => setTypeFilter(tab.id)}
              className={`px-3 py-1 rounded text-xs font-medium whitespace-nowrap transition-colors cursor-pointer ${
                typeFilter === tab.id ? 'bg-[#0f3d30] text-white shadow-xs font-bold border border-emerald-500/30' : 'text-emerald-200/60 hover:text-white'
              }`}
            >
              {tab.label} ({countOfType(tab.id)})
            </button>
          ))}
        </div>
      </div>

      <div id="collections-results" className={`mt-4 space-y-6 ${bodyClassName}`}>
        {error && <p className="px-2 text-[11px] text-red-300">{error}</p>}
        {nothingMatches && (
          <p className="py-10 text-center text-xs text-emerald-200/60">Nothing matches “{query.trim()}”.</p>
        )}

        {view.favorites && (
          <section id="collections-section-favorites" className="space-y-2">
            <h3 className={`${SECTION_TITLE} flex items-center gap-1.5`}>
              <Star className="w-3 h-3 text-[#f59e0b] fill-[#f59e0b]" /> Favorites ({favoritesCount})
            </h3>
            {renderGroupBody(view.favorites)}
          </section>
        )}

        {(view.collections.length > 0 || !filtering) && (
          <section id="collections-section-collections" className="space-y-2">
            <h3 className={SECTION_TITLE}>Collections ({view.collections.length})</h3>
            {view.collections.length === 0
              ? <p className="px-2 text-[11px] text-emerald-300/50">No collections yet.</p>
              : renderGroups(view.collections)}
          </section>
        )}

        {(view.searches.length > 0 || (!filtering && typeFilter === 'all')) && (
          <section id="saved-searches-section" className="space-y-2">
            <h3 className={SECTION_TITLE}>Saved searches ({view.searches.length})</h3>
            {view.searches.length === 0
              ? <p className="px-2 text-[11px] text-emerald-300/50">Use “Save search” on a search page to keep its results here.</p>
              : renderGroups(view.searches)}
          </section>
        )}
      </div>
    </div>
  );
};
