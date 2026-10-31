import React, { useState, useEffect, useRef } from 'react';
import {
  BookOpen,
  User as UserIcon,
  Layers
} from 'lucide-react';
import { CatalogState } from '../types/textbase';
import { readerService } from '../services/readerService';
import { preferencesStore } from '../services/preferencesStore';
import { bookmarkStoreFor } from '../services/identity';
import { parseAppPath } from '../router';
import { WorksCatalog } from './WorksCatalog';
import { AuthorCatalog } from './AuthorCatalog';
import { ReadingListsCatalog } from './ReadingListsCatalog';

interface CatalogViewProps {
  reallySignedIn: boolean;
  // The entire catalog state (tab plus per-tab query, filters and page)
  // is owned by App.tsx, not local state, because all of it is part of
  // the bookmarkable URL: /app/catalog (works, defaults),
  // /app/catalog#authors?q=cicero&page=2, /app/catalog#works?lang=lat,
  // /app/catalog#lists?type=author (see router.ts). Every catalog
  // interaction pushes a history entry except query typing
  // ({ replace: true }, no per-keystroke history entries); the only local
  // decision is the mount-time restore of the remembered tab preference
  // (below), and even that defers to whatever the URL already says.
  catalog: CatalogState;
  onCatalogChange: (next: CatalogState, options?: { replace?: boolean }) => void;
  onSelectWork: (workId: string) => void;
  onSelectAuthor: (authorId: string) => void;
  onSelectChapter: (workId: string, chapterId: string) => void;
  onOpenAddToCollection: (item: { type: 'work'; referenceId: string; workId: string; workTitle: string; authorName: string }) => void;
}

/** The catalogue page (/app/catalog): works, authors and system reading lists. */
export const CatalogView: React.FC<CatalogViewProps> = ({
  reallySignedIn,
  catalog,
  onCatalogChange,
  onSelectWork,
  onSelectAuthor,
  onSelectChapter,
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

  // Arrow keys page the visible tab's paginated section (works or
  // authors); the lists tab has no pages.
  const subTabRef = useRef<CatalogState['tab'] | null>(null);
  useEffect(() => {
    const handleArrowKey = (event: KeyboardEvent) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      const target = event.target as HTMLElement | null;
      if (target?.matches('input, textarea, select, [contenteditable="true"]')) return;
      const section = subTabRef.current;
      if (section !== 'works' && section !== 'authors') return;
      const direction = event.key === 'ArrowLeft' ? 'prev' : 'next';
      const button = document.querySelector<HTMLButtonElement>(`#btn-${section}-${direction}-page`);
      if (!button || button.disabled) return;
      event.preventDefault();
      button.click();
    };
    window.addEventListener('keydown', handleArrowKey);
    return () => window.removeEventListener('keydown', handleArrowKey);
  }, []);

  // Restores the last-selected tab on mount (see preferencesStore.ts) -
  // CatalogView unmounts entirely while viewing an author/work, so the
  // remembered preference covers coming back without a tab in the URL.
  // The URL is the source of truth: a deep link (#authors?q=...,
  // #lists, ...) or a back-button walk already says which tab to show,
  // and only a fragment-less plain /app/catalog landing falls back to the
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
    worksLang: worksLangFilter,
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

  const [, setPurchaseRefreshKey] = useState(0);

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

  const paginatedWorks = rawWorksData.works;
  const totalWorks = rawWorksData.total;
  const totalWorksPages = rawWorksData.totalPages;
  // A deep link can carry a page past the end (page=99), and the real
  // catalog also loads asynchronously - so the effective page is derived,
  // never clamped back into the URL: early in a load a high page shows
  // the (currently) last page and recovers as more works arrive.
  const worksPageSafe = Math.min(worksPage, totalWorksPages);

  const authorsData = readerService.getAuthors(authorsPage, 12, authorsQuery);
  const readingLists = readerService.getReadingLists(readingListType === 'all' ? undefined : readingListType);

  const tabClass = (active: boolean) =>
    `flex items-center space-x-2 px-3.5 py-2 rounded-lg text-xs uppercase tracking-wider transition-all cursor-pointer ${
      active
        ? 'bg-[#f59e0b] hover:bg-amber-400 text-black font-bold shadow-md shadow-black/20 hover:shadow-amber-500/20'
        : 'text-white/80 hover:text-white hover:bg-white/10 font-semibold'
    }`;
  const tabIconClass = (active: boolean) => `w-5 h-5 ${active ? 'text-black' : 'text-[#f59e0b]'}`;

  return (
    <div id="catalog-view" className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-6">
        <h1 className="font-display-title text-2xl sm:text-3xl font-bold text-white mb-1">Catalogue</h1>
        <p className="text-xs sm:text-sm text-white/85 font-serif-reading">
          Every work, author and reading list in the library
        </p>
      </div>

      {/* Sub-Navigation Tabs */}
      <div className="grid grid-cols-1 sm:grid-cols-3 items-center gap-4 border-b border-white/20 pb-4 mb-6">
        <div className="hidden sm:block" aria-hidden="true" />
        <div id="subnav-tab-toolbar" className="flex items-center justify-center space-x-1.5 bg-white/12 backdrop-blur-xl p-1.5 rounded-xl border border-white/30 shadow-[0_4px_20px_0_rgba(0,0,0,0.15)] justify-self-center">
          <button id="tab-sub-works" onClick={() => setSubTab('works')} className={tabClass(subTab === 'works')}>
            <BookOpen className={tabIconClass(subTab === 'works')} />
            <span>Works</span>
          </button>

          <button id="tab-sub-authors" onClick={() => setSubTab('authors')} className={tabClass(subTab === 'authors')}>
            <UserIcon className={tabIconClass(subTab === 'authors')} />
            <span>Authors</span>
          </button>

          <button id="tab-sub-lists" onClick={() => setSubTab('reading-lists')} className={tabClass(subTab === 'reading-lists')}>
            <Layers className={tabIconClass(subTab === 'reading-lists')} />
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
        onQueryChange={query => onCatalogChange({ ...catalog, worksQuery: query, worksPage: 1 }, { replace: true })}
        onLanguageChange={language => onCatalogChange({ ...catalog, worksLang: language, worksPage: 1 })}
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
