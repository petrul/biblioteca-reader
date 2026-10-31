import React, { useEffect, useRef, useState } from 'react';
import { BookOpen, ChevronLeft, ChevronRight, Hourglass, type LucideIcon } from 'lucide-react';
import { WorkCoverImage } from './DefaultWorkCover';

// The home page's horizontal shelves - Featured, Discover, My Books and one
// per stored collection - share this frame and card. Only what goes on a
// card differs: a catalogue work (FeaturedBookCarousel) or a saved
// collection entry (CollectionShelfCarousel).

interface BookShelfProps {
  // Namespaces the shelf's internal ids (icon badge, prev/next buttons) -
  // several shelves are mounted on the same page at once.
  instanceId: string;
  title: string;
  subtitle: string;
  icon: LucideIcon;
  countLabel: string;
  loading?: boolean;
  loadingLabel?: string;
  children: React.ReactNode;
}

/** A titled, horizontally scrolling shelf of ShelfCards with prev/next buttons. */
export const BookShelf: React.FC<BookShelfProps> = ({
  instanceId,
  title,
  subtitle,
  icon: Icon,
  countLabel,
  loading = false,
  loadingLabel = 'Loading…',
  children
}) => {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(true);
  const cardCount = React.Children.count(children);

  const updateScrollButtons = () => {
    const container = scrollContainerRef.current;
    if (!container) return;
    setCanScrollLeft(container.scrollLeft > 10);
    setCanScrollRight(container.scrollLeft + container.clientWidth < container.scrollWidth - 10);
  };

  useEffect(() => {
    updateScrollButtons();
    const container = scrollContainerRef.current;
    container?.addEventListener('scroll', updateScrollButtons);
    window.addEventListener('resize', updateScrollButtons);
    return () => {
      container?.removeEventListener('scroll', updateScrollButtons);
      window.removeEventListener('resize', updateScrollButtons);
    };
  }, [cardCount, loading]);

  const scroll = (direction: 'left' | 'right') =>
    scrollContainerRef.current?.scrollBy({ left: direction === 'left' ? -380 : 380, behavior: 'smooth' });

  const arrowClass = 'p-2 rounded-xl bg-[#0b2921]/90 hover:bg-[#0f3d30] active:scale-90 active:ring-2 active:ring-amber-300 active:bg-amber-500/30 border border-emerald-500/25 text-emerald-200 disabled:opacity-30 disabled:hover:bg-[#0b2921]/90 disabled:cursor-not-allowed transition-all cursor-pointer shadow-sm';

  return (
    <div className="w-full my-6 select-none">
      <div className="flex items-center justify-between mb-3 px-1">
        <div className="flex items-center space-x-2.5 min-w-0">
          <div id={`carousel-icon-badge-${instanceId}`} className="w-7 h-7 rounded-lg bg-[#f59e0b] flex items-center justify-center text-black font-bold shadow-md shadow-amber-950/40 shrink-0">
            <Icon className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <h2 className="font-display-title text-base sm:text-lg font-bold text-white flex items-center space-x-2">
              <span className="truncate">{title}</span>
              <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-[#f59e0b] font-bold shrink-0">
                {countLabel}
              </span>
            </h2>
            <p className="text-[11px] sm:text-xs text-emerald-200/70 font-serif-reading truncate">{subtitle}</p>
          </div>
        </div>

        <div className="flex items-center space-x-1.5 shrink-0">
          <button id={`carousel-btn-prev-${instanceId}`} onClick={() => scroll('left')} disabled={!canScrollLeft} className={arrowClass} title="Previous">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button id={`carousel-btn-next-${instanceId}`} onClick={() => scroll('right')} disabled={!canScrollRight} className={arrowClass} title="Next">
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {loading && cardCount === 0 ? (
        <div className="min-h-48 rounded-2xl border border-white/15 bg-white/8 backdrop-blur-xl flex flex-col items-center justify-center gap-3 text-emerald-100/80">
          <Hourglass className="w-7 h-7 text-amber-300 animate-pulse" aria-hidden="true" />
          <span className="text-xs font-mono uppercase tracking-widest">{loadingLabel}</span>
        </div>
      ) : (
        <div
          ref={scrollContainerRef}
          className="flex items-stretch space-x-4 overflow-x-auto pb-4 pt-1 px-1 scrollbar-thin scrollbar-thumb-emerald-500/30 scrollbar-track-transparent scroll-smooth snap-x snap-mandatory"
          style={{ scrollbarWidth: 'thin' }}
        >
          {children}
        </div>
      )}
    </div>
  );
};

interface ShelfCardProps {
  id: string;
  coverSrc?: string;
  title: string;
  authorName: string;
  // The small amber line above the title on the cover.
  eyebrow: string;
  onOpen: () => void;
  onSelectAuthor?: () => void;
  // Beside the author name (e.g. the Free/price pill).
  badge?: React.ReactNode;
  // Below the author name (a summary, chapter title, quote or snippet).
  detail?: React.ReactNode;
  actionId: string;
  actionLabel: string;
  // After the main action button (e.g. add-to-collection).
  extraAction?: React.ReactNode;
}

/** One card on a BookShelf: the work's cover with title, then author, detail and actions. */
export const ShelfCard: React.FC<ShelfCardProps> = ({
  id,
  coverSrc,
  title,
  authorName,
  eyebrow,
  onOpen,
  onSelectAuthor,
  badge,
  detail,
  actionId,
  actionLabel,
  extraAction
}) => (
  <div
    id={id}
    className="flex-shrink-0 w-64 sm:w-72 snap-start group relative flex flex-col justify-between rounded-2xl overflow-hidden border border-emerald-500/30 hover:border-amber-400/60 bg-[#061d28]/95 hover:bg-[#082b3a] shadow-xl transition-all duration-300 transform hover:-translate-y-1"
  >
    <div className="relative h-48 sm:h-52 w-full overflow-hidden cursor-pointer" onClick={onOpen}>
      <WorkCoverImage src={coverSrc} title={title} author={authorName} alt={title} className="w-full h-full" imgClassName="object-cover object-center group-hover:scale-105 transition-transform duration-500" />
      {/* Cover gradient for the title's legibility */}
      <div className="absolute inset-0 bg-gradient-to-t from-[#061f18] via-[#061f18]/60 to-transparent"></div>
      <div className="absolute bottom-2 left-4 right-3">
        <p className="text-[10px] uppercase font-bold tracking-wider text-amber-400/90 font-mono mb-0.5 line-clamp-1">{eyebrow}</p>
        <h3 className="font-display-title text-base sm:text-lg font-bold text-white leading-snug group-hover:text-[#f59e0b] transition-colors line-clamp-2 drop-shadow-md">
          {title}
        </h3>
      </div>
    </div>

    <div className="p-3.5 bg-[#061d28]/90 border-t border-emerald-500/20 flex flex-col justify-between flex-1">
      <div>
        <div className="flex items-center justify-between mb-1.5 gap-1">
          <button
            onClick={onSelectAuthor}
            className="text-xs font-semibold text-emerald-200/90 hover:text-[#f59e0b] transition-colors truncate max-w-[150px] text-left cursor-pointer"
          >
            {authorName}
          </button>
          {badge}
        </div>
        {detail && (
          <p className="text-[11px] text-emerald-100/70 font-serif-reading line-clamp-2 leading-relaxed mb-3">{detail}</p>
        )}
      </div>

      <div className="flex items-center justify-between gap-2 pt-2 border-t border-emerald-500/15">
        <button
          id={actionId}
          onClick={onOpen}
          className="flex-1 py-1.5 px-2.5 rounded-lg bg-[#0f3d30] hover:bg-[#155443] border border-emerald-500/30 text-white text-[11px] font-bold flex items-center justify-center space-x-1.5 transition-colors cursor-pointer"
        >
          <BookOpen className="w-3.5 h-3.5 text-[#f59e0b]" />
          <span>{actionLabel}</span>
        </button>
        {extraAction}
      </div>
    </div>
  </div>
);
