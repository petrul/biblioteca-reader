import React, { useState, useEffect } from 'react';
import { Sparkles, Bookmark, Lock, CheckCircle2 } from 'lucide-react';
import { Work } from '../types/textbase';
import { readerService } from '../services/readerService';
import { BookShelf, ShelfCard } from './BookShelf';

interface FeaturedBookCarouselProps {
  onSelectWork: (workId: string) => void;
  onSelectAuthor?: (authorId: string) => void;
  onOpenAddToCollection?: (item: {
    type: 'work';
    referenceId: string;
    workId: string;
    workTitle: string;
    authorName: string;
  }) => void;
  title?: string;
  subtitle?: string;
  works?: Work[];
  // For an explicitly supplied list that is still being fetched (the
  // Discover shelf); the featured shelf tracks its own loading state.
  loading?: boolean;
  loadingLabel?: string;
  // Namespaces this instance's internal ids - more than one shelf is
  // mounted on the home page at once (see BookShelf).
  instanceId: string;
}

/** A shelf of catalogue works: Featured by default, or an explicit list (My Books, Discover). */
export const FeaturedBookCarousel: React.FC<FeaturedBookCarouselProps> = ({
  onSelectWork,
  onSelectAuthor,
  onOpenAddToCollection,
  title = "Featured Classical Editions",
  subtitle = "Graphic covers of canonical TEI P5 texts curated for digital scholarship",
  works,
  loading = false,
  loadingLabel = 'Loading featured works…',
  instanceId
}) => {
  const [, setDataRevision] = useState(0);
  useEffect(() => readerService.subscribe(() => setDataRevision(value => value + 1)), []);

  // Explicitly supplied shelves (for example My Books) retain their own
  // contents.  The public featured carousel is backed by the server's
  // curated system collection, never by catalogue/import order.
  const shelfWorks: Work[] = works ?? readerService.getFeaturedWorks();

  return (
    <BookShelf
      instanceId={instanceId}
      title={title}
      subtitle={subtitle}
      icon={Sparkles}
      countLabel={`${shelfWorks.length} Volumes`}
      loading={works ? loading : readerService.isFeaturedLoading()}
      loadingLabel={loadingLabel}
    >
      {shelfWorks.map(work => (
        <ShelfCard
          key={work.id}
          id={`carousel-book-${instanceId}-${work.id}`}
          coverSrc={work.coverImage}
          title={work.title}
          authorName={work.authorName}
          eyebrow={work.subtitle || 'Classical Digital Edition'}
          onOpen={() => onSelectWork(work.id)}
          onSelectAuthor={() => onSelectAuthor?.(work.authorId)}
          badge={<AccessPill work={work} />}
          detail={work.summary}
          actionId={`btn-carousel-read-${instanceId}-${work.id}`}
          actionLabel="Read Book"
          extraAction={onOpenAddToCollection && (
            <button
              id={`btn-carousel-bookmark-${instanceId}-${work.id}`}
              onClick={() => onOpenAddToCollection({
                type: 'work',
                referenceId: work.id,
                workId: work.id,
                workTitle: work.title,
                authorName: work.authorName
              })}
              className="p-1.5 rounded-lg bg-[#051a14] hover:bg-[#0b2921] border border-emerald-500/25 text-emerald-300/70 hover:text-[#f59e0b] transition-colors cursor-pointer"
              title="Add to Personal Collection"
            >
              <Bookmark className="w-3.5 h-3.5" />
            </button>
          )}
        />
      ))}
    </BookShelf>
  );
};

/** Free, or the premium price / Unlocked state. */
const AccessPill: React.FC<{ work: Work }> = ({ work }) => {
  if (work.accessType !== 'premium') {
    return (
      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-emerald-950 text-emerald-300/80 border border-emerald-500/20 font-mono">
        Free
      </span>
    );
  }
  return readerService.isWorkUnlocked(work.id) ? (
    <span className="inline-flex items-center space-x-0.5 text-[9px] font-bold px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
      <CheckCircle2 className="w-2.5 h-2.5" />
      <span>Unlocked</span>
    </span>
  ) : (
    <span className="inline-flex items-center space-x-0.5 text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 font-mono">
      <Lock className="w-2.5 h-2.5" />
      <span>${((work.priceCents || 499) / 100).toFixed(2)}</span>
    </span>
  );
};
