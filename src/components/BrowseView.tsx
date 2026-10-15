import React, { useState, useEffect, useRef } from 'react';
import {
  BookOpen,
  User as UserIcon,
  Layers,
  Sparkles, ChevronRight
} from 'lucide-react';
import { Work, CatalogState } from '../types/textbase';
import { readerService } from '../services/readerService';
import { getMyBooksShelf } from '../services/identity';
import { preferencesStore } from '../services/preferencesStore';
import { bookmarkStoreFor } from '../services/identity';
import { parseAppPath } from '../router';
import { FeaturedBookCarousel } from './FeaturedBookCarousel';
import { WorksCatalog } from './WorksCatalog';
import { AuthorCatalog } from './AuthorCatalog';
import { ReadingListsCatalog } from './ReadingListsCatalog';

interface BrowseViewProps {
  reallySignedIn: boolean;
  // False while the sign-in check is still running: reallySignedIn is then
  // a provisional false, and a signed-in reader's shelf is not known yet.
  identityKnown?: boolean;
  // Bumped by App.tsx whenever readerService's real catalog data changes
  // (see readerService.subscribe) - the My Books shelf below resolves
  // each touched workId through that catalog, which loads asynchronously
  // after this component's own mount; without this in the effect's
  // dependency array, a shelf fetch that resolves before the real catalog
  // has loaded would fail every lookup and never retry once it arrives.
  dataRevision: number;
  // The entire catalog state (tab plus per-tab query, filters and page)
  // is owned by App.tsx, not local state, because all of it is part of
  // the bookmarkable URL: /app (works, defaults),
  // /app#authors?q=cicero&page=2, /app#works?lang=lat,
  // /app#lists?type=author (see router.ts). Every catalog interaction
  // pushes a history entry except query typing ({ replace: true }, no
  // per-keystroke history entries); the only local decision is the
  // mount-time restore of the remembered tab preference (below), and
  // even that defers to whatever the URL already says.
  catalog: CatalogState;
  onCatalogChange: (next: CatalogState, options?: { replace?: boolean }) => void;
  onSelectWork: (workId: string) => void;
  onSelectAuthor: (authorId: string) => void;
  onSelectChapter: (workId: string, chapterId: string) => void;
  onRandomDiscovery?: () => void;
  onOpenAddToCollection: (item: { type: 'work'; referenceId: string; workId: string; workTitle: string; authorName: string }) => void;
}

export const BrowseView: React.FC<BrowseViewProps> = ({
  reallySignedIn,
  identityKnown = true,
  dataRevision,
  catalog,
  onCatalogChange,
  onSelectWork,
  onSelectAuthor,
  onSelectChapter,
  onRandomDiscovery,
  onOpenAddToCollection
}) => {

  // Enter on a catalog work card: jump straight INTO the book at the
  // reading position ("continue reading"), instead of opening the work
  // card page first. No position yet (or the store fails) falls back to
  // the work card, where Read/Continue Reading live.
  const handleContinueReadingWork = (workId: string) => {
    bookmarkStoreFor(reallySignedIn).get(workId)
      .then(position => {
        if (position?.divPath) onSelectChapter(workId, position.divPath);
        else onSelectWork(workId);
      })
      .catch(() => onSelectWork(workId));
  };
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
  // Neither hero card until the shelf is known: the Explore card used to
  // flash for long-engaged signed-in readers while the sign-in check and
  // the shelf's works were still loading. An engaged reader whose works
  // have not resolved yet still gets no Explore card - the shelf follows.
  const showWorkspace = shelfKnown && isEngagedReader && myBooks.length > 0;
  const showExplore = shelfKnown && !isEngagedReader;

  // Arrow keys follow the last catalog section the reader used. This keeps
  // keyboard navigation unambiguous when Featured and Works are both
  // visible. The authors tab overrides that tracking outright: it is the
  // only paginated section visible there, so arrows must never page a
  // works section hidden behind the tab - stale tracking used to make
  // "next" do exactly that, invisibly.
  const activePaginationSection = useRef<'featured' | 'works' | 'authors'>('works');
  const subTabRef = useRef<CatalogState['tab'] | null>(null);
  useEffect(() => {
    const markSection = (event: Event) => {
      const section = (event as CustomEvent<'featured' | 'works' | 'authors'>).detail;
      if (section === 'featured' || section === 'works' || section === 'authors') activePaginationSection.current = section;
    };
    const handleArrowKey = (event: KeyboardEvent) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      const target = event.target as HTMLElement | null;
      if (target?.matches('input, textarea, select, [contenteditable="true"]')) return;
      const section = subTabRef.current === 'authors' ? 'authors' : activePaginationSection.current;
      const direction = event.key === 'ArrowLeft' ? 'prev' : 'next';
      const selector = section === 'featured'
        ? `#carousel-btn-${direction}-featured-works`
        : section === 'authors'
          ? `#btn-authors-${direction}-page`
          : `#btn-works-${direction}-page`;
      const button = document.querySelector<HTMLButtonElement>(selector);
      if (!button || button.disabled) return;
      event.preventDefault();
      button.click();
    };
    window.addEventListener('reader-pagination-section', markSection);
    window.addEventListener('keydown', handleArrowKey);
    return () => {
      window.removeEventListener('reader-pagination-section', markSection);
      window.removeEventListener('keydown', handleArrowKey);
    };
  }, []);

  // Restores the last-selected tab on mount (see preferencesStore.ts) -
  // BrowseView unmounts entirely while viewing an author/work, so the
  // remembered preference covers coming back without a tab in the URL.
  // The URL is the source of truth: a deep link (#authors?q=...,
  // #lists, ...) or a back-button walk already says which tab to show,
  // and only a fragment-less plain /app landing falls back to the
  // preference - silently, with { replace: true }, so the restore
  // doesn't add a history entry. didRestoreSubTabRef guards the persist
  // effect below from firing on this same initial mount, before the
  // restored value (if any) has actually landed - same race as App.tsx's
  // URL-push effect.
  const didRestoreSubTabRef = useRef(false);
  useEffect(() => {
    let cancelled = false;
    void preferencesStore.get().then(prefs => {
      if (cancelled) return;
      if (prefs.catalogSubTab && !parseAppPath(window.location.pathname, window.location.hash).catalog) {
        onCatalogChange({ ...catalog, tab: prefs.catalogSubTab }, { replace: true });
      }
      didRestoreSubTabRef.current = true;
    });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    if (!didRestoreSubTabRef.current) return;
    void preferencesStore.set({ catalogSubTab: catalog.tab });
  }, [catalog.tab]);

  // Works/authors/lists catalog state - all of it URL-backed (see the
  // props comment). The values are derived straight from the catalog
  // prop; the setters below are thin single-change wrappers so the JSX
  // below (and its call sites) reads like the local state it replaced.
  // Query typing replaces history instead of pushing it; everything
  // else (tab, filter, page) pushes, so Back walks between catalog
  // positions.
  const {
    tab: subTab,
    worksQuery,
    worksLang: worksLangFilter,    worksAccess: worksAccessFilter,
    worksPage,
    authorsQuery,
    authorsPage,
    listsType: readingListType
  } = catalog;
  // Kept current on every render for the arrow-key routing above (the
  // listener mounts once, so it reads the ref, not the state).
  subTabRef.current = subTab;
  const setSubTab = (tab: CatalogState['tab']) => onCatalogChange({ ...catalog, tab });
  const setWorksPage = (page: number | ((prev: number) => number)) =>
    onCatalogChange({ ...catalog, worksPage: typeof page === 'function' ? page(worksPage) : page });
  const setAuthorsPage = (page: number | ((prev: number) => number)) =>
    onCatalogChange({ ...catalog, authorsPage: typeof page === 'function' ? page(authorsPage) : page });
  const setReadingListType = (type: 'all' | 'language' | 'author' | 'repo') => onCatalogChange({ ...catalog, listsType: type });

  const [purchaseRefreshKey, setPurchaseRefreshKey] = useState(0);

  // Purchase/unlock state lives in readerService, not React state, so a
  // purchase made in WorksCatalog's checkout modal would otherwise not
  // re-render this component - the bumped counter is never read, it only
  // forces the access filter and works-grid recomputation below.
  useEffect(() => {
    const handlePurchasesChanged = () => {
      setPurchaseRefreshKey(prev => prev + 1);
    };
    window.addEventListener('textbase-purchases-changed', handlePurchasesChanged);
    return () => window.removeEventListener('textbase-purchases-changed', handlePurchasesChanged);
  }, []);

  // The server owns filtering and pagination. The reader keeps only the
  // currently visible page in memory, so new imports are visible on the next
  // request and a large catalogue never has to be downloaded at startup.
  const rawWorksData = readerService.getWorks(
    1,
    Number.MAX_SAFE_INTEGER,
    {
      language: worksLangFilter === 'all' ? undefined : worksLangFilter,
      query: worksQuery
    }
  );

  useEffect(() => {
    if (subTab !== 'works') return;
    void readerService.loadWorksPage(worksPage, worksQuery, worksLangFilter === 'all' ? undefined : worksLangFilter);
  }, [subTab, worksPage, worksQuery, worksLangFilter]);

  useEffect(() => {
    if (subTab !== 'authors') return;
    void readerService.loadAuthorsPage(authorsPage, authorsQuery);
  }, [subTab, authorsPage, authorsQuery]);

  // Apply access filter
  const filteredWorks = rawWorksData.works.filter(work => {
    const isUnlocked = readerService.isWorkUnlocked(work.id);
    if (worksAccessFilter === 'free') {
      return work.accessType !== 'premium';
    }
    if (worksAccessFilter === 'premium') {
      return work.accessType === 'premium';
    }
    if (worksAccessFilter === 'unlocked') {
      return isUnlocked;
    }
    return true;
  });

  const pageSize = 12;
  const totalWorks = rawWorksData.total;
  const totalWorksPages = rawWorksData.totalPages;
  // A deep link can carry a page past the end (page=99), and the real
  // catalog also loads asynchronously - so the effective page is derived,
  // never clamped back into the URL: early in a load a high page shows
  // the (currently) last page and recovers as more works arrive.
  const worksPageSafe = Math.min(worksPage, totalWorksPages);
  const paginatedWorks = filteredWorks;

  const authorsData = readerService.getAuthors(authorsPage, 12, authorsQuery);
  const readingLists = readerService.getReadingLists(readingListType === 'all' ? undefined : readingListType);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Hero: "Explore..." card for new/logged-out visitors, or a
          "Workspace" carousel of recently consulted works for returning
          logged-in users. */}
      {showExplore ? (
        <div id="hero-explore-card" className="relative overflow-hidden rounded-2xl bg-white/12 backdrop-blur-xl border border-white/30 p-6 sm:p-8 text-white shadow-[0_8px_32px_0_rgba(0,0,0,0.25)] mb-8 transition-all">
          <div className="absolute top-0 right-0 w-96 h-96 bg-white/10 rounded-full blur-3xl pointer-events-none -mr-20 -mt-20"></div>
          <div className="absolute bottom-0 left-1/3 w-64 h-64 bg-amber-400/10 rounded-full blur-2xl pointer-events-none"></div>
          <div className="relative z-10 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
            <div className="max-w-2xl">
              <h1 className="font-display-title text-3xl sm:text-4xl md:text-5xl font-bold tracking-tight text-white mb-2 drop-shadow-sm">
                Explore Classical & Philosophical Texts
              </h1>
              <p className="text-white/90 text-sm sm:text-base leading-relaxed font-serif-reading drop-shadow-xs">
                Your Scriptorium classical readings
              </p>
            </div>

            <div className="flex items-center justify-end">
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
            </div>
          </div>
        </div>
      ) : showWorkspace ? (
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

      {/* The site's featured shelf, above the works/authors/lists
          toolbar on every tab - where the reader's eye lands before the
          filters (it used to live inside the works sub-view, below the
          toolbar, and only on the works tab). */}
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

      {/* Sub-Navigation Tabs */}
      <div className="grid grid-cols-1 sm:grid-cols-3 items-center gap-4 border-b border-white/20 pb-4 mb-6">
        <div className="hidden sm:block" aria-hidden="true" />
        <div id="subnav-tab-toolbar" className="flex items-center justify-center space-x-1.5 bg-white/12 backdrop-blur-xl p-1.5 rounded-xl border border-white/30 shadow-[0_4px_20px_0_rgba(0,0,0,0.15)] justify-self-center">
          <button
            id="tab-sub-works"
            onClick={() => setSubTab('works')}
            className={`flex items-center space-x-2 px-3.5 py-2 rounded-lg text-xs uppercase tracking-wider transition-all cursor-pointer ${
              subTab === 'works'
                ? 'bg-[#f59e0b] hover:bg-amber-400 text-black font-bold shadow-md shadow-black/20 hover:shadow-amber-500/20'
                : 'text-white/80 hover:text-white hover:bg-white/10 font-semibold'
            }`}
          >
            <BookOpen className={`w-5 h-5 ${subTab === 'works' ? 'text-black' : 'text-[#f59e0b]'}`} />
            <span>Works</span>
          </button>

          <button
            id="tab-sub-authors"
            onClick={() => setSubTab('authors')}
            className={`flex items-center space-x-2 px-3.5 py-2 rounded-lg text-xs uppercase tracking-wider transition-all cursor-pointer ${
              subTab === 'authors'
                ? 'bg-[#f59e0b] hover:bg-amber-400 text-black font-bold shadow-md shadow-black/20 hover:shadow-amber-500/20'
                : 'text-white/80 hover:text-white hover:bg-white/10 font-semibold'
            }`}
          >
            <UserIcon className={`w-5 h-5 ${subTab === 'authors' ? 'text-black' : 'text-[#f59e0b]'}`} />
            <span>Authors</span>
          </button>

          <button
            id="tab-sub-lists"
            onClick={() => setSubTab('reading-lists')}
            className={`flex items-center space-x-2 px-3.5 py-2 rounded-lg text-xs uppercase tracking-wider transition-all cursor-pointer ${
              subTab === 'reading-lists'
                ? 'bg-[#f59e0b] hover:bg-amber-400 text-black font-bold shadow-md shadow-black/20 hover:shadow-amber-500/20'
                : 'text-white/80 hover:text-white hover:bg-white/10 font-semibold'
            }`}
          >
            <Layers className={`w-5 h-5 ${subTab === 'reading-lists' ? 'text-black' : 'text-[#f59e0b]'}`} />
            <span>Lists</span>
          </button>
        </div>

        {/* Dynamic Count summary */}
        <div className="text-[11px] text-white/80 font-mono text-center sm:text-right">
          {subTab === 'works' && `Showing ${paginatedWorks.length} of ${totalWorks} works`}
          {subTab === 'authors' && `Showing ${authorsData.authors.length} of ${authorsData.total} authors`}
          {subTab === 'reading-lists' && `${readingLists.length} Curated system lists`}
        </div>
      </div>

      {/* SUB-VIEW 1: WORKS CATALOG */}
      {subTab === 'works' && <WorksCatalog
        works={paginatedWorks}
        isLoading={readerService.isWorksLoading()}
        page={worksPageSafe}
        totalPages={totalWorksPages}
        query={worksQuery}
        language={worksLangFilter}
        access={worksAccessFilter}
        onQueryChange={query => onCatalogChange({ ...catalog, worksQuery: query, worksPage: 1 }, { replace: true })}
        onLanguageChange={language => onCatalogChange({ ...catalog, worksLang: language, worksPage: 1 })}
        onAccessChange={access => onCatalogChange({ ...catalog, worksAccess: access, worksPage: 1 })}
        onPageChange={setWorksPage}
        onSelectWork={onSelectWork}
        onContinueReading={handleContinueReadingWork}
        onSelectAuthor={onSelectAuthor}
        onOpenAddToCollection={onOpenAddToCollection}
      />}

      {/* SUB-VIEW 2: AUTHORS CATALOG */}
      {subTab === 'authors' && <AuthorCatalog
        authorsData={authorsData}
        query={authorsQuery}
        page={Math.min(authorsPage, Math.max(1, authorsData.totalPages))}
        onQueryChange={query => onCatalogChange({ ...catalog, authorsQuery: query, authorsPage: 1 }, { replace: true })}
        onPageChange={setAuthorsPage}
        onSelectAuthor={onSelectAuthor}
      />}

      {/* SUB-VIEW 3: SYSTEM READING LISTS */}
      {subTab === 'reading-lists' && <ReadingListsCatalog
        lists={readingLists}
        selectedType={readingListType}
        onTypeChange={setReadingListType}
        onSelectAuthor={onSelectAuthor}
        onSelectWorks={language => onCatalogChange({ ...catalog, tab: 'works', worksLang: language ?? catalog.worksLang, worksPage: 1 })}
      />}

    </div>
  );
};
