import React, { useState, useEffect } from 'react';
import {
  Sparkles, ChevronRight, LogIn, Library
} from 'lucide-react';
import { Work } from '../types/textbase';
import { readerService } from '../services/readerService';
import { getMyBooksShelf } from '../services/identity';
import { getSavedSearches } from '../services/savedSearches';
import { collectionShelves, ShelfEntry } from '../services/collectionShelves';
import { FeaturedBookCarousel } from './FeaturedBookCarousel';
import { CollectionShelfCarousel } from './CollectionShelfCarousel';
import { heroCard, personalShelves } from '../services/heroCard';

interface BrowseViewProps {
  reallySignedIn: boolean;
  // False while the sign-in check is still running: reallySignedIn is then
  // a provisional false, and a signed-in reader's shelf is not known yet.
  identityKnown?: boolean;
  // Bumped by App.tsx whenever readerService's real catalog data changes
  // (see readerService.subscribe) or a saved search changes - the My Books
  // shelf below resolves each touched workId through that catalog, which
  // loads asynchronously after this component's own mount; without this
  // in the effect's dependency array, a shelf fetch that resolves before
  // the real catalog has loaded would fail every lookup and never retry
  // once it arrives. The collection shelves are re-read on it too.
  dataRevision: number;
  // Whose stored collections get a shelf each - the signed-in reader's;
  // undefined for guests, who get the Discover shelf instead.
  collectionsUserId?: string;
  onSelectWork: (workId: string) => void;
  onSelectAuthor: (authorId: string) => void;
  onSelectChapter: (workId: string, chapterId: string) => void;
  onOpenQuote: (quoteId: string) => void;
  onOpenCatalog: () => void;
  onRandomDiscovery?: () => void;
  // Opens the sign-in modal - the explore card invites signed-out visitors.
  onOpenAuth: () => void;
  onOpenAddToCollection: (item: { type: 'work'; referenceId: string; workId: string; workTitle: string; authorName: string }) => void;
}

/**
 * The home page (/app): the hero, the Featured shelf, then a Discover
 * shelf for guests or one shelf per stored collection for a signed-in
 * reader. The full catalogue has its own page (CatalogView), reached
 * from the button below the hero.
 */
export const BrowseView: React.FC<BrowseViewProps> = ({
  reallySignedIn,
  identityKnown = true,
  dataRevision,
  collectionsUserId,
  onSelectWork,
  onSelectAuthor,
  onSelectChapter,
  onOpenQuote,
  onOpenCatalog,
  onRandomDiscovery,
  onOpenAuth,
  onOpenAddToCollection
}) => {
  // "My Books" shelf - every work this reader has actually opened, the
  // one they've spent the most time on first (see identity.ts's
  // getMyBooksShelf). Works for anonymous readers too (local bookmarks),
  // not just signed-in ones. Only shown once the reader has demonstrated
  // real engagement (isEngagedReader - genuinely spent time on a work,
  // not just clicked around); until then, and for every brand-new
  // visitor, the "Explore..." hero card below is shown instead - that's
  // the pitch that has to earn a first-time visitor's interest, on purpose.
  const [myBooks, setMyBooks] = useState<Work[]>([]);
  const [isEngagedReader, setIsEngagedReader] = useState(false);
  // Whether the shelf has been read for the reader's actual identity.
  const [shelfKnown, setShelfKnown] = useState(false);
  useEffect(() => {
    if (!identityKnown) return; // a signed-in reader would read the wrong (local) store
    let cancelled = false;
    void getMyBooksShelf(reallySignedIn).then(({ works, isEngagedReader }) => {
      if (!cancelled) { setMyBooks(works); setIsEngagedReader(isEngagedReader); setShelfKnown(true); }
    });
    return () => { cancelled = true; };
  }, [reallySignedIn, identityKnown, dataRevision]);
  // Neither hero until the shelf is known for the reader's real identity -
  // see heroCard (and its unit test) for the rule.
  const hero = heroCard({ shelfKnown, isEngagedReader, shelfWorks: myBooks.length });
  // Only once identity is known - never flash the invitation at a reader
  // whose sign-in check is still running.
  const showSignInInvitation = identityKnown && !reallySignedIn;

  const lowerShelves = personalShelves({ identityKnown, reallySignedIn });
  // Read on every render (dataRevision re-renders this view on any
  // collection or saved-search change), never copied into state.
  const shelves = lowerShelves === 'collections' && collectionsUserId
    ? collectionShelves(readerService.getCollections(collectionsUserId), getSavedSearches())
    : [];
  const openShelfEntry = (entry: ShelfEntry) => {
    const target = entry.target;
    if (target.kind === 'quote') onOpenQuote(target.quoteId);
    else if (target.kind === 'chapter') onSelectChapter(target.workId, target.chapterId);
    else onSelectWork(target.workId);
  };

  // Arrow keys page the Featured shelf, as they did when it sat above the
  // catalogue on this page.
  useEffect(() => {
    const handleArrowKey = (event: KeyboardEvent) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      const target = event.target as HTMLElement | null;
      if (target?.matches('input, textarea, select, [contenteditable="true"]')) return;
      const direction = event.key === 'ArrowLeft' ? 'prev' : 'next';
      const button = document.querySelector<HTMLButtonElement>(`#carousel-btn-${direction}-featured-works`);
      if (!button || button.disabled) return;
      event.preventDefault();
      button.click();
    };
    window.addEventListener('keydown', handleArrowKey);
    return () => window.removeEventListener('keydown', handleArrowKey);
  }, []);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Hero: "Explore..." card for new/logged-out visitors, or a
          "Workspace" carousel of recently consulted works for returning
          logged-in users. */}
      {hero === 'explore' ? (
        <div id="hero-explore-card" className="relative overflow-hidden rounded-2xl bg-white/12 backdrop-blur-xl border border-white/30 p-6 sm:p-8 text-white shadow-[0_8px_32px_0_rgba(0,0,0,0.25)] mb-8 transition-all">
          <div className="absolute top-0 right-0 w-96 h-96 bg-white/10 rounded-full blur-3xl pointer-events-none -mr-20 -mt-20"></div>
          <div className="absolute bottom-0 left-1/3 w-64 h-64 bg-amber-400/10 rounded-full blur-2xl pointer-events-none"></div>
          <div className="relative z-10 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
            <div className="max-w-2xl">
              <h1 className="font-display-title text-3xl sm:text-4xl md:text-5xl font-bold tracking-tight text-white mb-2 drop-shadow-sm">
                Explore Classical & Philosophical Texts
              </h1>
              <p className="text-white/90 text-sm sm:text-base leading-relaxed font-serif-reading drop-shadow-xs">
                Your Scriptorium classical readings. 

                {/* The explore card also greets signed-in readers who are not
                  yet engaged - invite only visitors known to be signed out
                  (the Sign In button beside Discover follows the same rule). */}
                {showSignInInvitation && (
                <span id="hero-sign-in-invitation" className="mt-3 text-white/80 text-sm sm:text-base font-serif-reading drop-shadow-xs">
                  &nbsp;Sign in to sync your collections across devices.
                </span>
              )}
              
              </p>
              

             
            </div>

            <div className="flex flex-row flex-wrap items-center justify-center gap-3">
              {onRandomDiscovery && (
                <button
                  id="btn-hero-random"
                  onClick={event => {
                    // Dice-tumble the Sparkles icon (see .shuffle-tumble in
                    // index.css) - restart it if the previous tumble is
                    // still mid-flight.
                    const icon = event.currentTarget.querySelector('svg');
                    icon?.classList.remove('shuffle-tumble');
                    void icon?.getBoundingClientRect();
                    icon?.classList.add('shuffle-tumble');
                    onRandomDiscovery();
                  }}
                  className="flex items-center justify-center space-x-2 px-5 py-3 rounded-xl bg-[#f59e0b] hover:bg-amber-400 text-black font-bold text-xs uppercase tracking-wider shadow-lg shadow-black/30 hover:shadow-amber-500/20 transition-all cursor-pointer shrink-0 active:scale-95 active:brightness-90"
                >
                  <Sparkles className="w-4 h-4 text-black" />
                  <span>Discover</span>
                  <ChevronRight className="w-3.5 h-3.5 text-black" />
                </button>
              )}
              {showSignInInvitation && (
                <button
                  id="btn-hero-sign-in"
                  onClick={onOpenAuth}
                  className="flex items-center justify-center space-x-2 px-5 py-3 rounded-xl bg-[#f59e0b] hover:bg-amber-400 text-black font-bold text-xs uppercase tracking-wider shadow-lg shadow-black/30 hover:shadow-amber-500/20 transition-all cursor-pointer shrink-0 active:scale-95 active:brightness-90"
                >
                  <LogIn className="w-4 h-4 text-black" />
                  <span>Sign In</span>
                  <ChevronRight className="w-3.5 h-3.5 text-black" />
                </button>
              )}
            </div>
          </div>
        </div>
      ) : hero === 'workspace' ? (
        <div id="hero-workspace-carousel" className="mb-8">
          <FeaturedBookCarousel
            instanceId="my-books"
            works={myBooks}
            onSelectWork={onSelectWork}
            onSelectAuthor={onSelectAuthor}
            onOpenAddToCollection={onOpenAddToCollection}
            title="My Books"
            subtitle="Your Scriptorium classical readings"
          />
        </div>
      ) : null}

      {/* The dedicated way into the full catalogue (its own page since the
          home page became shelves). */}
      <button
        id="btn-open-catalog"
        onClick={onOpenCatalog}
        className="w-full mb-8 group flex items-center justify-between gap-4 rounded-2xl bg-white/12 hover:bg-white/18 backdrop-blur-xl border border-white/30 hover:border-amber-400/60 px-5 py-4 text-left shadow-[0_4px_20px_0_rgba(0,0,0,0.15)] transition-all cursor-pointer active:scale-[0.99]"
      >
        <span className="flex items-center gap-3 min-w-0">
          <span className="w-9 h-9 rounded-xl bg-[#f59e0b] flex items-center justify-center shrink-0 shadow-md shadow-amber-950/40">
            <Library className="w-5 h-5 text-black" />
          </span>
          <span className="min-w-0">
            <span className="block font-display-title text-base sm:text-lg font-bold text-white group-hover:text-[#f59e0b] transition-colors">Browse the catalogue</span>
            <span className="block text-[11px] sm:text-xs text-white/80 font-serif-reading truncate">All works, authors and reading lists in the library</span>
          </span>
        </span>
        <ChevronRight className="w-5 h-5 text-[#f59e0b] shrink-0 group-hover:translate-x-0.5 transition-transform" />
      </button>

      {/* The site's featured shelf, the first one on the home page. */}
      <div id="hero-featured-carousel" className="mb-8">
        <FeaturedBookCarousel
          instanceId="featured-works"
          onSelectWork={onSelectWork}
          onSelectAuthor={onSelectAuthor}
          onOpenAddToCollection={onOpenAddToCollection}
          title="Featured"
          subtitle="Highlighted editions with critical apparatus"
        />
      </div>

      {/* Guests also get a Discover shelf: 20 random works from the whole
          catalog, a new sample on every page load (see personalShelves). */}
      {lowerShelves === 'discover' && (
        <div id="hero-discover-carousel" className="mb-8">
          <FeaturedBookCarousel
            instanceId="discover-works"
            works={readerService.getDiscoverWorks()}
            loading={readerService.isDiscoverLoading()}
            loadingLabel="Loading discoveries…"
            onSelectWork={onSelectWork}
            onSelectAuthor={onSelectAuthor}
            onOpenAddToCollection={onOpenAddToCollection}
            title="Discover"
            subtitle="A random selection from the whole library"
          />
        </div>
      )}

      {/* A signed-in reader's stored collections, one shelf each. */}
      {shelves.map(shelf => (
        <div key={shelf.id} className="mb-8">
          <CollectionShelfCarousel shelf={shelf} onOpenEntry={openShelfEntry} onSelectAuthor={onSelectAuthor} />
        </div>
      ))}
    </div>
  );
};
