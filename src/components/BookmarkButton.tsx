import React, { useEffect, useRef, useState } from 'react';
import { Bookmark, Check, FolderPlus } from 'lucide-react';
import { readerService } from '../services/readerService';
import type { CollectionItem, PersonalCollection } from '../types/textbase';

export type BookmarkPayload = Omit<CollectionItem, 'id' | 'addedAt'>;

const LONG_PRESS_MS = 450;

/** The menu rows: every collection, and whether it already holds this reference. */
export function bookmarkTargets(collections: PersonalCollection[], referenceId: string): { id: string; name: string; contains: boolean }[] {
  return collections.map(c => ({ id: c.id, name: c.name, contains: c.items.some(i => i.referenceId === referenceId) }));
}

/** Saves the item into an existing collection, or into a new one created from `newName`. */
export function bookmarkInto(userId: string, target: { collectionId: string } | { newName: string }, item: BookmarkPayload): string | null {
  const collectionId = 'collectionId' in target
    ? target.collectionId
    : readerService.createCollection(userId, target.newName.trim()).id;
  return readerService.addItemToCollection(userId, collectionId, item) ? collectionId : null;
}

/**
 * Picking a collection in the menu toggles membership: saves the item there,
 * or removes it when that collection already holds it. Returns whether the
 * item is in the collection afterwards.
 */
export function toggleBookmark(userId: string, collectionId: string, item: BookmarkPayload): boolean {
  const existing = readerService.getCollections(userId).find(c => c.id === collectionId)
    ?.items.find(i => i.type === item.type && i.referenceId === item.referenceId);
  if (existing) {
    readerService.removeItemFromCollection(userId, collectionId, existing.id);
    return false;
  }
  return bookmarkInto(userId, { collectionId }, item) !== null;
}

/** The dropdown itself: the user's collections, then a "New collection…" box. */
export function BookmarkMenuList({ targets, onPick, onCreate }: {
  targets: ReturnType<typeof bookmarkTargets>;
  onPick: (collectionId: string) => void;
  onCreate: (name: string) => void;
}) {
  const [name, setName] = useState('');
  return (
    <div role="menu" aria-label="Bookmark into a collection"
      className="absolute right-0 top-full mt-2 z-50 w-64 rounded-xl border border-emerald-500/30 bg-[#0b2a22] p-1.5 shadow-xl text-sm">
      {targets.map(t => (
        <button key={t.id} type="button" role="menuitemcheckbox" aria-checked={t.contains} onClick={() => onPick(t.id)}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left text-emerald-50 hover:bg-emerald-500/15 cursor-pointer">
          <Bookmark className="w-4 h-4 text-[#f59e0b] shrink-0" fill={t.contains ? 'currentColor' : 'none'} />
          <span className="flex-1 truncate">{t.name}</span>
          {t.contains && <Check className="w-4 h-4 text-emerald-300 shrink-0" aria-label="saved here (pick again to remove)" />}
        </button>
      ))}
      <form className="flex items-center gap-2 px-3 py-2 mt-1 border-t border-emerald-500/20"
        onSubmit={e => { e.preventDefault(); if (name.trim()) { onCreate(name.trim()); setName(''); } }}>
        <FolderPlus className="w-4 h-4 text-emerald-300 shrink-0" />
        <input aria-label="New collection" placeholder="New collection…" value={name} onChange={e => setName(e.target.value)}
          className="flex-1 min-w-0 bg-transparent text-emerald-50 placeholder:text-emerald-200/50 outline-none" />
      </form>
    </div>
  );
}

/**
 * The reader's bookmark button. A click opens the full save dialog (as
 * before); a long press - or a right-click - opens a dropdown to save
 * straight into an existing collection or a new one.
 */
export function BookmarkButton({ userId, item, bookmarked, onOpenDialog }: {
  userId: string;
  item: BookmarkPayload;
  bookmarked: boolean;
  onOpenDialog: () => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const longPressed = useRef(false);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('pointerdown', onPointer); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const startPress = () => {
    longPressed.current = false;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => { longPressed.current = true; setOpen(true); }, LONG_PRESS_MS);
  };
  const cancelPress = () => window.clearTimeout(timer.current);
  const save = (target: { collectionId: string } | { newName: string }) => {
    bookmarkInto(userId, target, item);
    setOpen(false);
  };

  return (
    <div ref={root} className="relative">
      <button
        id="btn-reader-save-chapter"
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onPointerDown={startPress}
        onPointerUp={cancelPress}
        onPointerLeave={cancelPress}
        onPointerCancel={cancelPress}
        onContextMenu={e => { e.preventDefault(); cancelPress(); setOpen(true); }}
        onClick={() => {
          // The click that ends a long press must not also open the dialog.
          if (longPressed.current) { longPressed.current = false; return; }
          onOpenDialog();
        }}
        style={{ WebkitTouchCallout: 'none', userSelect: 'none', touchAction: 'manipulation' }}
        className="p-2 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 transition-colors cursor-pointer"
        title={bookmarked ? 'Bookmarked - click to save elsewhere, long-press for your collections' : 'Save to a collection (long-press: pick one directly)'}
      >
        <Bookmark className="w-4 h-4 text-[#f59e0b]" fill={bookmarked ? 'currentColor' : 'none'} />
      </button>
      {open && (
        <BookmarkMenuList
          targets={bookmarkTargets(readerService.getCollections(userId), item.referenceId)}
          onPick={collectionId => { toggleBookmark(userId, collectionId, item); setOpen(false); }}
          onCreate={newName => save({ newName })}
        />
      )}
    </div>
  );
}
