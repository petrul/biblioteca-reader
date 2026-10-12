import React, { useState, useRef, useEffect } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  BookOpen,
  Sparkles,
  Bookmark, Lock,
  CheckCircle2, Hourglass
} from 'lucide-react';
import { Work } from '../types/textbase';
import { readerService } from '../services/readerService';
import { WorkCoverImage } from './DefaultWorkCover';

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
  // Namespaces this instance's internal ids (icon badge, prev/next buttons)
  // - more than one carousel can be mounted on the same page at once (e.g.
  // BrowseView's "My Books" hero plus its "Featured" section),
  // and a plain static id would collide across instances.
  instanceId: string;
}

// Rich graphic cover styling themes for canonical masterpieces
const GRAPHIC_COVER_STYLES: Record<string, {
  bgGradient: string;
  accentColor: string;
  badgeBg: string;
  pattern: string;
  tagline: string;
}> = {
  'work-seneca-brevitate': {
    bgGradient: 'from-[#2c1810] via-[#592c1a] to-[#1a0c06]',
    accentColor: '#f59e0b',
    badgeBg: 'bg-amber-950/80 text-amber-200 border-amber-500/40',
    pattern: 'radial-gradient(circle at 50% 20%, rgba(245, 158, 11, 0.25) 0%, transparent 70%)',
    tagline: 'Stoic Ethics on Finite Human Time'
  },
  'work-marcus-meditations': {
    bgGradient: 'from-[#0f2838] via-[#1a4a68] to-[#081822]',
    accentColor: '#38bdf8',
    badgeBg: 'bg-sky-950/80 text-sky-200 border-sky-500/40',
    pattern: 'radial-gradient(circle at 50% 20%, rgba(56, 189, 248, 0.25) 0%, transparent 70%)',
    tagline: 'Private Reflections of a Roman Emperor'
  },
  'work-plato-apology': {
    bgGradient: 'from-[#1a2e1d] via-[#2d5234] to-[#0c180e]',
    accentColor: '#4ade80',
    badgeBg: 'bg-emerald-950/80 text-emerald-200 border-emerald-500/40',
    pattern: 'radial-gradient(circle at 50% 20%, rgba(74, 222, 128, 0.25) 0%, transparent 70%)',
    tagline: 'The Trial & Speech of Socrates'
  },
  'work-eminescu-luceafarul': {
    bgGradient: 'from-[#1e1035] via-[#3b1d6b] to-[#0d071a]',
    accentColor: '#c084fc',
    badgeBg: 'bg-purple-950/80 text-purple-200 border-purple-500/40',
    pattern: 'radial-gradient(circle at 50% 20%, rgba(192, 132, 252, 0.3) 0%, transparent 70%)',
    tagline: 'Romantic Cosmic Symphonic Poem'
  },
  'work-shakespeare-tempest': {
    bgGradient: 'from-[#14233c] via-[#204374] to-[#0b1424]',
    accentColor: '#60a5fa',
    badgeBg: 'bg-blue-950/80 text-blue-200 border-blue-500/40',
    pattern: 'radial-gradient(circle at 50% 20%, rgba(96, 165, 250, 0.25) 0%, transparent 70%)',
    tagline: 'Elizabethan Romance & Enchantment'
  },
  'work-goethe-faust': {
    bgGradient: 'from-[#331114] via-[#5c1d24] to-[#1c080a]',
    accentColor: '#fb7185',
    badgeBg: 'bg-rose-950/80 text-rose-200 border-rose-500/40',
    pattern: 'radial-gradient(circle at 50% 20%, rgba(251, 113, 133, 0.25) 0%, transparent 70%)',
    tagline: 'The Quest for Transcendent Knowledge'
  },
  'work-dante-inferno': {
    bgGradient: 'from-[#381605] via-[#63290d] to-[#210c02]',
    accentColor: '#f97316',
    badgeBg: 'bg-orange-950/80 text-orange-200 border-orange-500/40',
    pattern: 'radial-gradient(circle at 50% 20%, rgba(249, 115, 22, 0.25) 0%, transparent 70%)',
    tagline: 'Cantica I of The Divine Comedy'
  },
  'work-creanga-amintiri': {
    bgGradient: 'from-[#292211] via-[#4d3f1d] to-[#171308]',
    accentColor: '#eab308',
    badgeBg: 'bg-yellow-950/80 text-yellow-200 border-yellow-500/40',
    pattern: 'radial-gradient(circle at 50% 20%, rgba(234, 179, 8, 0.25) 0%, transparent 70%)',
    tagline: 'Memoirs of Moldavian Boyhood'
  },
  'work-montaigne-essais': {
    bgGradient: 'from-[#231b2d] via-[#433257] to-[#120d18]',
    accentColor: '#d8b4fe',
    badgeBg: 'bg-violet-950/80 text-violet-200 border-violet-500/40',
    pattern: 'radial-gradient(circle at 50% 20%, rgba(216, 180, 254, 0.25) 0%, transparent 70%)',
    tagline: 'Renaissance Philosophical Essays'
  },
  'work-cicero-officiis': {
    bgGradient: 'from-[#1c2430] via-[#2f3e54] to-[#0f141b]',
    accentColor: '#94a3b8',
    badgeBg: 'bg-slate-950/80 text-slate-200 border-slate-500/40',
    pattern: 'radial-gradient(circle at 50% 20%, rgba(148, 163, 184, 0.25) 0%, transparent 70%)',
    tagline: 'Roman Treatises on Moral Duties'
  }
};

export const FeaturedBookCarousel: React.FC<FeaturedBookCarouselProps> = ({
  onSelectWork,
  onSelectAuthor,
  onOpenAddToCollection,
  title = "Featured Classical Editions",
  subtitle = "Graphic covers of canonical TEI P5 texts curated for digital scholarship",
  works,
  instanceId
}) => {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(true);
  const [isHovered, setIsHovered] = useState(false);
  const [, setDataRevision] = useState(0);
  useEffect(() => readerService.subscribe(() => setDataRevision(value => value + 1)), []);

  // Retrieve all works to feature, unless an explicit list was passed in
  // (e.g. the Workspace carousel's recently-viewed works).
  // Explicitly supplied shelves (for example My Books) retain their own
  // contents.  The public featured carousel is backed by the server's
  // curated system collection, never by catalogue/import order.
  const featuredWorks: Work[] = works ?? readerService.getFeaturedWorks();
  const isLoading = !works && readerService.isFeaturedLoading() && featuredWorks.length === 0;

  const updateScrollButtons = () => {
    if (scrollContainerRef.current) {
      const { scrollLeft, scrollWidth, clientWidth } = scrollContainerRef.current;
      setCanScrollLeft(scrollLeft > 10);
      setCanScrollRight(scrollLeft + clientWidth < scrollWidth - 10);
    }
  };

  useEffect(() => {
    updateScrollButtons();
    const container = scrollContainerRef.current;
    if (container) {
      container.addEventListener('scroll', updateScrollButtons);
      window.addEventListener('resize', updateScrollButtons);
    }
    return () => {
      if (container) {
        container.removeEventListener('scroll', updateScrollButtons);
      }
      window.removeEventListener('resize', updateScrollButtons);
    };
  }, [featuredWorks]);

  const scroll = (direction: 'left' | 'right') => {
    if (scrollContainerRef.current) {
      window.dispatchEvent(new CustomEvent('reader-pagination-section', { detail: 'featured' }));
      const scrollAmount = direction === 'left' ? -380 : 380;
      scrollContainerRef.current.scrollBy({
        left: scrollAmount,
        behavior: 'smooth'
      });
    }
  };

  return (
    <div className="w-full my-6 select-none">
      {/* Carousel Header with Controls */}
      <div className="flex items-center justify-between mb-3 px-1">
        <div className="flex items-center space-x-2.5">
          <div id={`carousel-icon-badge-${instanceId}`} className="w-7 h-7 rounded-lg bg-[#f59e0b] flex items-center justify-center text-black font-bold shadow-md shadow-amber-950/40">
            <Sparkles className="w-4 h-4" />
          </div>
          <div>
            <h2 className="font-display-title text-base sm:text-lg font-bold text-white flex items-center space-x-2">
              <span>{title}</span>
              <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-[#f59e0b] font-bold">
                {featuredWorks.length} Volumes
              </span>
            </h2>
            <p className="text-[11px] sm:text-xs text-emerald-200/70 font-serif-reading">
              {subtitle}
            </p>
          </div>
        </div>

        {/* Navigation Arrows */}
        <div className="flex items-center space-x-1.5">
          <button
            id={`carousel-btn-prev-${instanceId}`}
            onClick={() => scroll('left')}
            disabled={!canScrollLeft}
            className="p-2 rounded-xl bg-[#0b2921]/90 hover:bg-[#0f3d30] active:scale-90 active:ring-2 active:ring-amber-300 active:bg-amber-500/30 border border-emerald-500/25 text-emerald-200 disabled:opacity-30 disabled:hover:bg-[#0b2921]/90 disabled:cursor-not-allowed transition-all cursor-pointer shadow-sm"
            title="Previous Books"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            id={`carousel-btn-next-${instanceId}`}
            onClick={() => scroll('right')}
            disabled={!canScrollRight}
            className="p-2 rounded-xl bg-[#0b2921]/90 hover:bg-[#0f3d30] active:scale-90 active:ring-2 active:ring-amber-300 active:bg-amber-500/30 border border-emerald-500/25 text-emerald-200 disabled:opacity-30 disabled:hover:bg-[#0b2921]/90 disabled:cursor-not-allowed transition-all cursor-pointer shadow-sm"
            title="Next Books"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="min-h-48 rounded-2xl border border-white/15 bg-white/8 backdrop-blur-xl flex flex-col items-center justify-center gap-3 text-emerald-100/80">
          <Hourglass className="w-7 h-7 text-amber-300 animate-pulse" aria-hidden="true" />
          <span className="text-xs font-mono uppercase tracking-widest">Loading featured works…</span>
        </div>
      ) : (
      /* Horizontal Scroll Track */
      <div
        ref={scrollContainerRef}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        className="flex items-stretch space-x-4 overflow-x-auto pb-4 pt-1 px-1 scrollbar-thin scrollbar-thumb-emerald-500/30 scrollbar-track-transparent scroll-smooth snap-x snap-mandatory"
        style={{ scrollbarWidth: 'thin' }}
      >
        {featuredWorks.map((work) => {
          const style = GRAPHIC_COVER_STYLES[work.id] || {
            bgGradient: 'from-[#0b2921] via-[#103d32] to-[#061f18]',
            accentColor: '#f59e0b',
            badgeBg: 'bg-emerald-950/80 text-emerald-200 border-emerald-500/40',
            pattern: 'none',
            tagline: work.subtitle || 'Classical Digital Edition'
          };

          return (
            <div
              key={work.id}
              id={`carousel-book-${instanceId}-${work.id}`}
              className="flex-shrink-0 w-64 sm:w-72 snap-start group relative flex flex-col justify-between rounded-2xl overflow-hidden border border-emerald-500/30 hover:border-amber-400/60 bg-[#061f18]/90 hover:bg-[#092b22] shadow-xl transition-all duration-300 transform hover:-translate-y-1"
            >
              {/* Graphic Book Cover Showcase */}
              <div 
                className="relative h-48 sm:h-52 w-full overflow-hidden cursor-pointer"
                onClick={() => onSelectWork(work.id)}
              >
                {/* Book Image Background or Rich Fallback */}
                <WorkCoverImage src={work.coverImage} title={work.title} author={work.authorName} alt={work.title} className="w-full h-full" imgClassName="object-cover object-center group-hover:scale-105 transition-transform duration-500" />

                {/* Cover Gradient Overlay for Typographic Legibility */}
                <div className="absolute inset-0 bg-gradient-to-t from-[#061f18] via-[#061f18]/60 to-transparent"></div>

                {/* Title & Tagline overlay on cover */}
                <div className="absolute bottom-2 left-4 right-3">
                  <p className="text-[10px] uppercase font-bold tracking-wider text-amber-400/90 font-mono mb-0.5 line-clamp-1">
                    {style.tagline}
                  </p>
                  <h3 className="font-display-title text-base sm:text-lg font-bold text-white leading-snug group-hover:text-[#f59e0b] transition-colors line-clamp-2 drop-shadow-md">
                    {work.title}
                  </h3>
                </div>
              </div>

              {/* Card Meta & Action Footer */}
              <div className="p-3.5 bg-[#051a14]/90 border-t border-emerald-500/20 flex flex-col justify-between flex-1">
                <div>
                  {/* Author Name & Pricing Pill */}
                  <div className="flex items-center justify-between mb-1.5 gap-1">
                    <button
                      onClick={() => onSelectAuthor && onSelectAuthor(work.authorId)}
                      className="text-xs font-semibold text-emerald-200/90 hover:text-[#f59e0b] transition-colors truncate max-w-[150px] text-left cursor-pointer"
                    >
                      {work.authorName}
                    </button>
                    {work.accessType === 'premium' ? (
                      readerService.isWorkUnlocked(work.id) ? (
                        <span className="inline-flex items-center space-x-0.5 text-[9px] font-bold px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                          <CheckCircle2 className="w-2.5 h-2.5" />
                          <span>Unlocked</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center space-x-0.5 text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 font-mono">
                          <Lock className="w-2.5 h-2.5" />
                          <span>${((work.priceCents || 499) / 100).toFixed(2)}</span>
                        </span>
                      )
                    ) : (
                      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-emerald-950 text-emerald-300/80 border border-emerald-500/20 font-mono">
                        Free
                      </span>
                    )}
                  </div>

                  {/* Summary Snippet */}
                  {work.summary && (
                    <p className="text-[11px] text-emerald-100/70 font-serif-reading line-clamp-2 leading-relaxed mb-3">
                      {work.summary}
                    </p>
                  )}
                </div>

                {/* Action Buttons Row */}
                <div className="flex items-center justify-between gap-2 pt-2 border-t border-emerald-500/15">
                  <button
                    id={`btn-carousel-read-${instanceId}-${work.id}`}
                    onClick={() => onSelectWork(work.id)}
                    className="flex-1 py-1.5 px-2.5 rounded-lg bg-[#0f3d30] hover:bg-[#155443] border border-emerald-500/30 text-white text-[11px] font-bold flex items-center justify-center space-x-1.5 transition-colors cursor-pointer"
                  >
                    <BookOpen className="w-3.5 h-3.5 text-[#f59e0b]" />
                    <span>Read Book</span>
                  </button>

                  {onOpenAddToCollection && (
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
                </div>
              </div>
            </div>
          );
        })}
      </div>
      )}
    </div>
  );
};
