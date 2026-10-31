import React, { useEffect, useState } from 'react';
import { Bookmark, Search, Star } from 'lucide-react';
import { readerService } from '../services/readerService';
import { CollectionShelf, ShelfEntry } from '../services/collectionShelves';
import { BookShelf, ShelfCard } from './BookShelf';

interface CollectionShelfCarouselProps {
  shelf: CollectionShelf;
  onOpenEntry: (entry: ShelfEntry) => void;
  onSelectAuthor?: (authorId: string) => void;
}

const SHELF_ICONS = { favorites: Star, user: Bookmark, search: Search };
const SHELF_SUBTITLES = {
  favorites: 'Your favourite works, chapters and passages',
  user: 'Your collection',
  search: 'Saved search'
};
const ACTION_LABELS = { work: 'Open Book', chapter: 'Read', quote: 'Open Quote' };

/**
 * One stored collection as a home-page shelf. A collection holds chapters
 * and quotes as well as whole works, so each card shows its work's cover
 * plus what was actually saved, and opens exactly that.
 */
export const CollectionShelfCarousel: React.FC<CollectionShelfCarouselProps> = ({ shelf, onOpenEntry, onSelectAuthor }) => {
  // Covers come from readerService's work cache, which loads works on
  // demand and notifies when they arrive.
  const [, setDataRevision] = useState(0);
  useEffect(() => readerService.subscribe(() => setDataRevision(value => value + 1)), []);

  const instanceId = `collection-${shelf.id}`;
  const count = shelf.entries.length;

  return (
    <div id={`shelf-${instanceId}`}>
      <BookShelf
        instanceId={instanceId}
        title={shelf.name}
        subtitle={shelf.description || SHELF_SUBTITLES[shelf.kind]}
        icon={SHELF_ICONS[shelf.kind]}
        countLabel={`${count} ${count === 1 ? 'Item' : 'Items'}`}
      >
        {shelf.entries.map(entry => {
          const work = readerService.getWorkById(entry.workId);
          return (
            <ShelfCard
              key={entry.key}
              id={`carousel-entry-${instanceId}-${entry.key}`}
              coverSrc={work?.coverImage}
              title={entry.workTitle}
              authorName={entry.authorName}
              eyebrow={entry.label}
              onOpen={() => onOpenEntry(entry)}
              // Work ids are stable authorId/opusId paths.
              onSelectAuthor={() => onSelectAuthor?.(work?.authorId ?? entry.workId.split('/')[0])}
              detail={entry.detail && (entry.label === 'Quote' ? <i>“{entry.detail}”</i> : entry.detail)}
              actionId={`btn-carousel-open-${instanceId}-${entry.key}`}
              actionLabel={ACTION_LABELS[entry.target.kind]}
            />
          );
        })}
      </BookShelf>
    </div>
  );
};
