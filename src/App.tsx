import { useState, useEffect, useRef } from 'react';
import {
  AppView,
  CatalogState,
  SearchMode,
  User
} from './types/textbase';
import { readerService, ANONYMOUS_USER_ID } from './services/readerService';
import { buildAppPath, parseAppPath, DEFAULT_CATALOG_STATE } from './router';

// UI Components
import { Navbar } from './components/Navbar';
import { MobileBottomNav } from './components/MobileBottomNav';
import { AdminSidebar } from './components/AdminSidebar';
import { BrowseView } from './components/BrowseView';
import { AuthorView } from './components/AuthorView';
import { WorkView } from './components/WorkView';
import { ReaderView } from './components/ReaderView';
import { SearchView } from './components/SearchView';
import { attachSavedSearchesAccount, detachSavedSearchesAccount, subscribeSavedSearches } from './services/savedSearches';
import { CollectionsView } from './components/CollectionsView';
import { CollectionsModal } from './components/CollectionsModal';
import { useCollectionsShortcut } from './hooks/useCollectionsShortcut';
import { AdminView } from './components/AdminView';
import { QuoteView } from './components/QuoteView';
import { AuthModal } from './components/AuthModal';
import { ServerStatusToast } from './components/ServerStatusToast';
import { NotFoundCard } from './components/NotFoundCard';
import { GoogleOneTapAuto, googleIdentityPresentation } from './components/GoogleOneTap';
import { fetchWhoAmI, submitGoogleCredential, refreshGoogleProfile, cachedGoogleAvatar, restoreStoredGoogleCredential, signOut, bookmarkStoreFor, preferencesStoreFor, WhoAmI } from './services/identity';
import { AddToCollectionModal, AddToCollectionPayload } from './components/AddToCollectionModal';

export default function App() {
  const [dataRevision, setDataRevision] = useState(0);
  // Initialize from the URL so StrictMode's repeated effects cannot erase a deep link.
  const initialRoute = useRef(parseAppPath(window.location.pathname, window.location.hash, window.location.search)).current;
  const [currentView, setCurrentView] = useState<AppView>(initialRoute.view);
  // Set by WorkView/ReaderView when the work/chapter id in the current URL
  // doesn't exist - the not-found card below explains it.
  const [contentNotFound, setContentNotFound] = useState(false);
  // BrowseView's entire catalog state (tab plus per-tab query, filters
  // and page), held here (not inside BrowseView) because all of it is
  // part of the bookmarkable route: /app (works, defaults),
  // /app#authors?q=cicero&page=2, /app#works?lang=lat, /app#lists?type=author
  // (see router.ts). BrowseView remembers the last tab across sessions
  // via preferencesStore, but the URL wins - a deep link or a history
  // walk lands on exactly what the address says.
  const [catalog, setCatalog] = useState<CatalogState>(initialRoute.catalog || DEFAULT_CATALOG_STATE);
  // Reading preferences panel's open state - the navbar's settings button
  // owns the toggle; ReaderView's panel is the controlled consumer. Reset
  // on leaving the reader so a return to a book starts closed.
  const [readerSettingsOpen, setReaderSettingsOpen] = useState(false);
  // Where the current book visit STARTED - the page the user came from
  // when the reader opened (main catalog, work card, author page, search).
  // "Closing the book" (the reader heading's arrow and the navbar badge
  // while reading) returns there; chapter-to-chapter hops inside the same
  // book never change it. Deep links default to the main catalog.
  const [readerOrigin, setReaderOrigin] = useState<'browse' | 'work' | 'author' | 'search'>('browse');
  const [selectedAuthorId, setSelectedAuthorId] = useState<string | null>(initialRoute.authorId || null);
  const [selectedWorkId, setSelectedWorkId] = useState<string | null>(initialRoute.workId || null);
  const [selectedChapterId, setSelectedChapterId] = useState<string | null>(initialRoute.chapterId || null);
  const [selectedQuoteId, setSelectedQuoteId] = useState<string | null>(initialRoute.quoteId || null);

  // Admin Hamburger Sidebar State
  const [isAdminSidebarOpen, setIsAdminSidebarOpen] = useState(false);

  // Search initializers - title search is the right default for the
  // navbar's quick search box: someone typing a work's name there (e.g.
  // "Biblia") wants matching titles, not lucene's full-text body search,
  // which can come back completely empty for a title that never happens
  // to appear verbatim inside any paragraph's own text.
  const [searchMode, setSearchMode] = useState<SearchMode>('title');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [searchWorkSeed, setSearchWorkSeed] = useState<string | undefined>(undefined);

  // Auth & User State
  const [currentUser, setCurrentUser] = useState<User | null>(() => readerService.getCurrentUser());
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);

  // Real (textbase-server AppUser, via Google) sign-in state - separate
  // from the demo persona above (currentUser/readerService). This is
  // what governs whether reading position is saved locally or remotely
  // (see services/bookmarkStore.ts, services/identity.ts) and whether the
  // Google One Tap auto-prompt below is shown. null while unknown (still
  // asking textbase-server), so the prompt doesn't flash on briefly for a
  // reader who's actually already signed in.
  const [whoAmI, setWhoAmI] = useState<WhoAmI | null>(null);
  const reallySignedIn = whoAmI ? whoAmI.authenticated : null;
  const googleIdentity = googleIdentityPresentation(reallySignedIn);
  // Server-reported ADMIN_USERS membership (see identity.ts's WhoAmI) -
  // gates the admin page and every entry point that reaches it (the
  // navbar/mobile-nav hamburger buttons, the sidebar, the 'admin' route
  // itself). Purely a display concern - /api/admin/** enforces the same
  // allow-list server-side regardless of what the UI shows.
  const isAdmin = Boolean(whoAmI?.isAdmin);
  // The local user bridge mirrors the REAL session - readerService's
  // persisted User is not an identity of its own: signed in -> bridged to
  // the server's account, so demo-scope features (collections, recent
  // works, purchases) key their storage off the real username; not signed
  // in -> null, never a fabricated persona. Runs on boot too, not just on
  // sign-in events: a session that survives a localStorage clear gets its
  // scope back without waiting for the next fresh sign-in.
  // Whose collections are currently served from their account (see
  // readerService.attachCollectionsStore) - detached again on sign-out.
  const collectionsAccountRef = useRef<string | null>(null);
  const bridgeSignedInUser = (who: WhoAmI) => {
    const account = who.authenticated && who.username ? who.username : null;
    if (collectionsAccountRef.current && collectionsAccountRef.current !== account) {
      readerService.detachCollectionsStore(collectionsAccountRef.current);
      detachSavedSearchesAccount();
      collectionsAccountRef.current = null;
    }
    if (account && collectionsAccountRef.current !== account) {
      collectionsAccountRef.current = account;
      void readerService.attachCollectionsStore(account, preferencesStoreFor(true))
        .catch(error => console.warn('[collections] could not load the account\'s collections', error));
      void attachSavedSearchesAccount()
        .catch(error => console.warn('[saved-search] could not load the account\'s saved searches', error));
    }
    if (who.authenticated && who.username) {
      const user: User = {
        id: who.username,
        email: who.username,
        name: who.username,
        role: 'reader',
        authProvider: 'google',
        avatar: who.avatarUrl,
      };
      readerService.setUser(user);
      setCurrentUser(user);
    } else {
      readerService.setUser(null);
      setCurrentUser(null);
    }
  };

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      let who = await fetchWhoAmI();
      const cachedAvatar = cachedGoogleAvatar();
      if (!who.avatarUrl && cachedAvatar) who = { ...who, avatarUrl: cachedAvatar };
      const credential = restoreStoredGoogleCredential();
      // Older sessions may predate avatar persistence. Re-exchange the
      // stored Google credential once when the session is authenticated but
      // the server has no avatar yet; GoogleAuthService then refreshes the
      // standard picture claim without requiring a manual sign-out.
      if (credential && (!who.authenticated || !who.avatarUrl)) {
        const restored = await submitGoogleCredential(credential).catch(() => ({ success: false }));
        if (restored.success) {
          who = await fetchWhoAmI();
          const restoredAvatar = cachedGoogleAvatar();
          if (!who.avatarUrl && restoredAvatar) who = { ...who, avatarUrl: restoredAvatar };
        }
      }
      if (!cancelled) {
        setWhoAmI(who);
        bridgeSignedInUser(who);
        // One Tap authenticates with an ID token. If the account has no
        // stored photo, request the separately-approved profile scope once
        // GIS is ready; failure is deliberately non-fatal to sign-in.
      }
    })();
    return () => { cancelled = true; };
  }, []);
  // THE single real-auth-exchange handler - shared by GoogleOneTapAuto
  // (below) and AuthModal's own explicit Google button, so a sign-in via
  // either path updates whoAmI here. They used to be two separate
  // handlers - GoogleOneTapAuto's called this one, but AuthModal had its
  // OWN copy that only bridged into the demo currentUser system and never
  // told App this real session existed, so signing in via the button
  // inside the modal left the navbar stuck on Guest until a page reload
  // happened to re-run the mount-time whoAmI check below.
  const handleGoogleCredential = async (credential: string): Promise<WhoAmI> => {
    console.debug('[App] handleGoogleCredential invoked');
    const result = await submitGoogleCredential(credential);
    if (!result.success) throw new Error(result.error || 'Google sign-in failed.');
    let who = await fetchWhoAmI();
    let refreshedWho = who;
    if (!who.avatarUrl) {
      const refreshed = await refreshGoogleProfile();
      refreshedWho = refreshed.avatarUrl ? { ...who, avatarUrl: refreshed.avatarUrl } : await fetchWhoAmI();
    }
    console.debug('[App] setWhoAmI after sign-in', refreshedWho);
    setWhoAmI(refreshedWho);
    bridgeSignedInUser(refreshedWho);
    return refreshedWho;
  };
  const handleRealSignOut = async () => {
    await signOut();
    const who = await fetchWhoAmI();
    setWhoAmI(who);
    // The local user bridge follows the real session out.
    bridgeSignedInUser(who);
  };

  // Add-to-Collection Modal State
  const [collectionModalPayload, setCollectionModalPayload] = useState<AddToCollectionPayload | null>(null);

  useEffect(() => readerService.subscribe(() => setDataRevision(value => value + 1)), []);
  useEffect(() => subscribeSavedSearches(() => setDataRevision(value => value + 1)), []);

  // Skips the path-push effect below on its very first run: that first
  // run's closure still sees the default ('browse') state captured at
  // the initial render, not whatever the URL-parse effect below is about
  // to set - both effects run on the same initial mount, so without this
  // a deep link (e.g. /app/reader/seneca/de-beneficiis/1) gets its
  // address bar clobbered back to /app for one tick before the parsed
  // state's own re-render lands and the push effect runs again with it.
  const isFirstPathSyncRef = useRef(true);

  // One-shot flag for the next path sync to use history.replaceState
  // instead of pushState - set by the BrowseView preference-restore path
  // (via handleCatalogTabChange), so landing on plain /app and silently
  // jumping to a remembered tab doesn't add a history entry the back
  // button then has to walk through.
  const replaceNextPathSyncRef = useRef(false);

  // Depth marker pushed into every history entry this app creates (see the
  // push effect below): the reader's back button uses it to tell "there is
  // a real in-app entry behind us" (walk the browser history, handleReaderBack)
  // from "we were deep-linked straight into the reader with nothing behind"
  // (fall back to the work card). Never a count of anything meaningful -
  // strictly "was this entry pushed by the app, in order".
  const appPathDepthRef = useRef(0);

  // Parse the real URL path for permanent links (e.g. /app/quote/quote-seneca-time-1
  // or /app/work/seneca/de-beneficiis) - see router.ts for why these are
  // real path segments instead of a #/-prefixed hash.
  useEffect(() => {
    const applyRoute = () => {
      const route = parseAppPath(window.location.pathname, window.location.hash, window.location.search);
      if (route.view === 'quote' && route.quoteId) {
        setSelectedQuoteId(route.quoteId);
        setCurrentView('quote');
      } else if (route.view === 'work' && route.workId) {
        setSelectedWorkId(route.workId);
        setCurrentView('work');
      } else if (route.view === 'reader' && route.workId && route.chapterId) {
        setSelectedWorkId(route.workId);
        setSelectedChapterId(route.chapterId);
        setCurrentView('reader');
      } else if (route.view === 'author' && route.authorId) {
        setSelectedAuthorId(route.authorId);
        setCurrentView('author');
      } else if (route.view === 'search') {
        setSearchMode(route.search?.mode ?? 'title');
        setSearchQuery(route.search?.query ?? '');
        setSearchWorkSeed(route.search?.workSeed);
        setCurrentView('search');
      } else if (route.view === 'admin' || route.view === 'collections') {
        setCurrentView(route.view);
      } else if (route.view === 'notFound') {
        setCurrentView('notFound');
      } else if (route.catalog) {
        setCatalog(route.catalog);
        setCurrentView('browse');
      } else {
        setCatalog(DEFAULT_CATALOG_STATE);
        setCurrentView('browse');
      }
    };

    applyRoute();
    window.addEventListener('popstate', applyRoute);
    return () => window.removeEventListener('popstate', applyRoute);
  }, []);

  // Leaving the reader closes its preferences panel (whose toggle lives on
  // the navbar, only rendered while reading) so returning to a book starts
  // closed.
  useEffect(() => {
    if (currentView !== 'reader') setReaderSettingsOpen(false);
  }, [currentView]);

  // A not-found verdict is only true while the page that produced it is
  // still shown; leaving it clears the flag.
  useEffect(() => {
    if (currentView !== 'work' && currentView !== 'reader') setContentNotFound(false);
  }, [currentView]);

  // Gentle page logging: one console.debug line per page actually shown,
  // whatever navigation path got there (route parse, back button, sidebar,
  // bottom bar, TOC click) - the debug console reads like a reading
  // session trace. The last-line guard keeps it gentle: re-renders and
  // selection changes elsewhere in the tree never repeat an entry.
  const lastLoggedViewRef = useRef<string>('');
  useEffect(() => {
    const detail =
      (currentView === 'work' && selectedWorkId) ? ` work=${selectedWorkId}` :
      (currentView === 'reader' && selectedChapterId) ? ` chapter=${selectedChapterId}` :
      (currentView === 'author' && selectedAuthorId) ? ` author=${selectedAuthorId}` :
      (currentView === 'quote' && selectedQuoteId) ? ` quote=${selectedQuoteId}` :
      '';
    const line = `showing ${currentView}${detail}`;
    if (line === lastLoggedViewRef.current) return;
    lastLoggedViewRef.current = line;
    console.info(`[App] ${line}`);
  }, [currentView, selectedWorkId, selectedChapterId, selectedAuthorId, selectedQuoteId]);

  // Push the real URL path when navigating to a bookmarkable view.
  useEffect(() => {
    if (isFirstPathSyncRef.current) {
      isFirstPathSyncRef.current = false;
      return;
    }
    let path: string | null = null;
    if (currentView === 'browse') path = buildAppPath({ view: 'browse', catalog });
    else if (currentView === 'work' && selectedWorkId) path = buildAppPath({ view: 'work', workId: selectedWorkId });
    else if (currentView === 'reader' && selectedChapterId) {
      const existing = parseAppPath(window.location.pathname, window.location.hash, window.location.search);
      path = buildAppPath({ view: 'reader', chapterId: selectedChapterId, block: existing.chapterId === selectedChapterId ? existing.block : undefined });
    }
    else if (currentView === 'quote' && selectedQuoteId) path = buildAppPath({ view: 'quote', quoteId: selectedQuoteId });
    else if (currentView === 'author' && selectedAuthorId) path = buildAppPath({ view: 'author', authorId: selectedAuthorId });
    else if (currentView === 'search') {
      path = buildAppPath({ view: 'search', search: { mode: searchMode, query: searchQuery, workSeed: searchWorkSeed } });
    } else if (currentView === 'admin' || currentView === 'collections') path = buildAppPath({ view: currentView });

    const replace = replaceNextPathSyncRef.current;
    replaceNextPathSyncRef.current = false;
    if (path && window.location.pathname + window.location.search + window.location.hash !== path) {
      if (replace) {
        window.history.replaceState(window.history.state, '', path);
      } else {
        window.history.pushState({ appDepth: ++appPathDepthRef.current }, '', path);
      }
    }
    // Do not reset the viewport on navigation. Opening a work or author from
    // a catalogue should preserve the reader's current place; individual
    // reader pagination/position hooks manage their own scroll state.
  }, [currentView, catalog, searchMode, searchQuery, searchWorkSeed, selectedWorkId, selectedChapterId, selectedQuoteId, selectedAuthorId]);

  // Navigation handlers
  // The reader's back button walks the same browser history the push
  // effect above builds, so it returns to the real previous position -
  // the previous chapter after a chapter-to-chapter hop, the work card
  // after opening a chapter from it, search after opening from a result.
  // Only a deep link straight into the reader (no app-pushed entry behind
  // the current one) falls back to the work card, the old behavior.
  const handleReaderBack = () => {
    const state = window.history.state as { appDepth?: number } | null;
    if (state && typeof state.appDepth === 'number' && state.appDepth >= 1) {
      window.history.back();
    } else {
      setCurrentView('work');
    }
  };

  const handleAppBack = () => {
    const state = window.history.state as { appDepth?: number } | null;
    if (state && typeof state.appDepth === 'number' && state.appDepth >= 1) {
      window.history.back();
    } else {
      setCurrentView('browse');
    }
  };

  const handleSelectWork = (workId: string) => {
    setSelectedWorkId(workId);
    setCurrentView('work');
    if (currentUser) readerService.recordWorkViewed(currentUser.id, workId);
  };

  const handleSelectAuthor = (authorId: string) => {
    setSelectedAuthorId(authorId);
    setCurrentView('author');
    void readerService.loadAuthorById(authorId).catch(() => undefined);
  };

  useEffect(() => {
    if (currentView === 'author' && selectedAuthorId) {
      void readerService.loadAuthorById(selectedAuthorId).catch(() => undefined);
    }
  }, [currentView, selectedAuthorId]);

  // BrowseView's catalog interactions (tab clicks, filters, pagination)
  // push their own history entries, so Back walks between catalog
  // positions; query typing asks for a silent replaceState instead (see
  // replaceNextPathSyncRef above) so keystrokes don't flood the history.
  const handleCatalogChange = (next: CatalogState, options?: { replace?: boolean }) => {
    replaceNextPathSyncRef.current = Boolean(options?.replace);
    setCatalog(next);
  };

  const handleSelectChapter = (workId: string, chapterId: string) => {
    console.info(`[App] navigate reader work=${workId} chapter=${chapterId}`);
    // Remember where this book visit began - only when ENTERING the reader,
    // never on chapter-to-chapter hops inside the same book (closing the
    // book must return to the original entry point, not the last page).
    if (currentView !== 'reader') {
      setReaderOrigin(currentView === 'work' || currentView === 'author' || currentView === 'search'
        ? currentView
        : 'browse');
    }
    setSelectedWorkId(workId);
    setSelectedChapterId(chapterId);
    setCurrentView('reader');
    if (currentUser) readerService.recordWorkViewed(currentUser.id, workId);
    // Reading position ("bookmark") - fire-and-forget, every chapter view
    // updates it. Local until signed in, textbase-server after (see
    // services/bookmarkStore.ts/identity.ts); reallySignedIn is only null
    // for the brief moment whoami hasn't answered yet, treated as
    // not-signed-in here rather than blocking navigation on it.
    void bookmarkStoreFor(Boolean(reallySignedIn)).set(workId, { divPath: chapterId, updatedAt: Date.now() });
  };

  // "Closing the book": return to the page the book visit began on - the
  // main catalog, the work card, the author page or the search it was
  // opened from - NOT a browser-history back.
  const handleCloseBook = () => {
    setCurrentView(readerOrigin);
    setSelectedChapterId(null);
  };

  const handleOpenQuote = (quoteId: string) => {
    setSelectedQuoteId(quoteId);
    setCurrentView('quote');
  };

  // `s` brings up the collections quick-jump over whatever is on screen.
  // On the Collections page itself it focuses that page's search box
  // instead, and it stands down while the sign-in or add-to-collection
  // dialogs are up.
  const [collectionsModalOpen, setCollectionsModalOpen] = useState(false);
  useCollectionsShortcut(() => {
    if (currentView === 'collections') document.getElementById('collections-search')?.focus();
    else setCollectionsModalOpen(true);
  }, !isAuthModalOpen && collectionModalPayload === null);

  const handleMoreLikeThis = (workId: string, title: string) => {
    setSearchMode('vector');
    setSearchQuery(title);
    setSearchWorkSeed(workId);
    setCurrentView('search');
  };

  const handleOpenAddToCollection = (item: AddToCollectionPayload) => {
    setCollectionModalPayload(item);
  };

  const handleRandomDiscovery = async () => {
    const discovery = await readerService.getRandomDiscovery();
    if (!discovery.workId) return;
    if (discovery.type === 'chapter' && discovery.chapterId) {
      // Warm the chapter cache the moment the pick lands: the content
      // fetch then races the reader's own work + TOC loads, and
      // loadChapterContent finds a cache hit instead of adding another
      // serial round trip to the first paint of the new page.
      readerService.prefetchChapterContentByPath(discovery.workId, discovery.chapterId);
      setSelectedWorkId(discovery.workId);
      setSelectedChapterId(discovery.chapterId);
      setCurrentView('reader');
    } else {
      setSelectedWorkId(discovery.workId);
      setCurrentView('work');
    }
  };

  // While actually reading, the navbar wordmark becomes the work's own
  // title instead of the generic "BIBLIOTECA" brand. The chapter heading
  // remains in ReaderView, where it is shown exactly once.
  const readerNavWork = currentView === 'reader' && selectedWorkId
    ? readerService.getWorkById(selectedWorkId)
    : undefined;

  return (
    <div className="min-h-screen bg-[linear-gradient(90deg,rgba(2,64,99,1)_0%,rgba(60,168,63,1)_22%,rgba(4,74,111,1)_100%)] text-[#e4efe9] flex flex-col font-sans selection:bg-emerald-500/30 selection:text-emerald-100">
      {/* Top Main Navigation Bar */}
      {/* While reading, the navbar's own subtitle slot (pageSubtitle)
          carries the work's author right beneath the work title. */}
      <Navbar
        currentView={currentView}
        pageTitle={readerNavWork?.title}
        pageSubtitle={readerNavWork?.authorName}
        pageAuthorId={readerNavWork?.authorId}
        onOpenAuthor={handleSelectAuthor}
        pageWorkId={readerNavWork?.id}
        onOpenWork={handleSelectWork}
        onNavigateHome={() => {
          setCatalog(DEFAULT_CATALOG_STATE);
          setCurrentView('browse');
        }}
        onNavigate={(view) => {
          if (view === 'search' && currentView !== 'search') {
            setSearchQuery('');
            setSearchWorkSeed(undefined);
          }
          setCurrentView(view);
        }}
        reallySignedIn={Boolean(reallySignedIn)}
        realUsername={whoAmI?.username}
        realAvatarUrl={whoAmI?.avatarUrl}
        onOpenAuth={() => setIsAuthModalOpen(true)}
        onRandomDiscovery={handleRandomDiscovery}
        onToggleReaderSettings={() => setReaderSettingsOpen(open => !open)}
        onOpenCollectionsQuickFind={() => setCollectionsModalOpen(true)}
        onCloseBook={handleCloseBook}
        onOpenAdminSidebar={() => setIsAdminSidebarOpen(true)}
        onSearch={(query) => {
          setSearchQuery(query);
          setCurrentView('search');
        }}
        onSelectWork={handleSelectWork}
        onSelectChapter={handleSelectChapter}
        onSelectAuthor={handleSelectAuthor}
      />

      {/* Main View Area */}
      <div className="flex-1 pb-16 lg:pb-8">
        {currentView === 'browse' && (
          <BrowseView
            reallySignedIn={Boolean(reallySignedIn)}
            dataRevision={dataRevision}
            catalog={catalog}
            onCatalogChange={handleCatalogChange}
            onSelectWork={handleSelectWork}
            onSelectAuthor={handleSelectAuthor}
            onSelectChapter={handleSelectChapter}
            onRandomDiscovery={handleRandomDiscovery}
            onOpenAddToCollection={handleOpenAddToCollection}
          />
        )}

        {currentView === 'author' && selectedAuthorId && (
          <AuthorView
            authorId={selectedAuthorId}
            onBack={handleAppBack}
            onSelectWork={handleSelectWork}
            onSelectChapter={handleSelectChapter}
            onOpenAddToCollection={handleOpenAddToCollection}
          />
        )}

        {currentView === 'work' && selectedWorkId && (
          <WorkView
            workId={selectedWorkId}
            reallySignedIn={Boolean(reallySignedIn)}
            onBack={handleAppBack}
            onSelectAuthor={handleSelectAuthor}
            onSelectChapter={handleSelectChapter}
            onMoreLikeThis={handleMoreLikeThis}
            onOpenAddToCollection={handleOpenAddToCollection}
            onNotFoundChange={setContentNotFound}
            isAdmin={isAdmin}
          />
        )}

        {currentView === 'reader' && selectedWorkId && selectedChapterId && (
          <ReaderView
            workId={selectedWorkId}
            chapterId={selectedChapterId}
            reallySignedIn={Boolean(reallySignedIn)}
            onBack={handleReaderBack}
            onBackToWork={() => setCurrentView('work')}
            onSelectWork={handleSelectWork}
            settingsOpen={readerSettingsOpen}
            onSettingsOpenChange={setReaderSettingsOpen}
            currentUserId={currentUser?.id || ANONYMOUS_USER_ID}
            onSelectChapter={handleSelectChapter}
            onMoreLikeThis={handleMoreLikeThis}
            onOpenAddToCollection={handleOpenAddToCollection}
            onNotFoundChange={setContentNotFound}
          />
        )}

        {currentView === 'search' && (
          <SearchView
            key={`${searchMode}|${searchQuery}|${searchWorkSeed ?? ''}`}
            initialMode={searchMode}
            initialQuery={searchQuery}
            initialWorkSeed={searchWorkSeed}
            onSelectWork={handleSelectWork}
            onSelectChapter={handleSelectChapter}
            onSelectAuthor={handleSelectAuthor}
            currentUserId={currentUser?.id || ANONYMOUS_USER_ID}
            onOpenAddToCollection={handleOpenAddToCollection}
          />
        )}

        <CollectionsView
          isOpen={currentView === 'collections'}
          currentUser={currentUser}
          onOpenAuth={() => setIsAuthModalOpen(true)}
          onSelectWork={handleSelectWork}
          onSelectChapter={handleSelectChapter}
          onOpenQuote={handleOpenQuote}
          onRunSearch={query => {
            setSearchQuery(query);
            setCurrentView('search');
          }}
          onBack={handleAppBack}
        />

        {currentView === 'admin' && isAdmin && (
          <AdminView />
        )}

        {currentView === 'quote' && selectedQuoteId && (
          <QuoteView
            quoteId={selectedQuoteId}
          onBack={handleAppBack}
            onOpenWork={handleSelectWork}
            onOpenChapter={handleSelectChapter}
            onOpenAddToCollection={handleOpenAddToCollection}
          />
        )}

        {currentView === 'notFound' && (
          <NotFoundCard
            message="Whatever you were looking for isn't where this link said it would be — moved, renamed, or never catalogued here at all."
            primaryLabel="Back to the library"
            onPrimary={() => {
              setCatalog(DEFAULT_CATALOG_STATE);
              setCurrentView('browse');
            }}
            secondaryLabel="Search the catalog"
            onSecondary={() => {
              setSearchQuery('');
              setSearchWorkSeed(undefined);
              setCurrentView('search');
            }}
          />
        )}
      </div>

      {/* Hamburger Admin Sidebar (accessible via the navbar's hamburger badge) */}
      <AdminSidebar
        isOpen={isAdminSidebarOpen}
        isAdmin={isAdmin}
        onClose={() => setIsAdminSidebarOpen(false)}
        currentUser={currentUser}
        onOpenAuth={() => setIsAuthModalOpen(true)}
        onNavigateToFullAdmin={() => setCurrentView('admin')}
        onNavigateView={(view) => setCurrentView(view)}
        onRandomDiscovery={handleRandomDiscovery}
      />

      {/* Mobile Floating Bottom Bar */}
      <MobileBottomNav
        currentView={currentView}
        onNavigate={(view) => setCurrentView(view)}
        currentUser={currentUser}
        isAdmin={isAdmin}
        onOpenAdminSidebar={() => setIsAdminSidebarOpen(true)}
      />

      {/* Google One Tap - auto-prompts whenever we're not really signed in yet.
          Sign-in stays entirely optional (see App's reallySignedIn state doc) -
          this only ever offers it, dismissing/ignoring it changes nothing. */}
      {googleIdentity.rendered && (
        <GoogleOneTapAuto
          onCredential={handleGoogleCredential}
          onError={(message) => console.warn('Google sign-in:', message)}
          presentPrompt={googleIdentity.presentPrompt}
          onReady={() => {
            if (whoAmI?.authenticated && !whoAmI.avatarUrl) {
              void refreshGoogleProfile().then(async result => {
                if (result.success) {
                  const refreshed = await fetchWhoAmI();
                  const localAvatar = refreshed.avatarUrl || result.avatarUrl || cachedGoogleAvatar();
                  const withAvatar = localAvatar ? { ...refreshed, avatarUrl: localAvatar } : refreshed;
                  setWhoAmI(withAvatar);
                  bridgeSignedInUser(withAvatar);
                }
              });
            }
          }}
        />
      )}

      {/* Auth Modal */}
      <AuthModal
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
        onSuccess={(user) => setCurrentUser(user)}
        reallySignedIn={Boolean(reallySignedIn)}
        realUsername={whoAmI?.username}
        realAvatarUrl={whoAmI?.avatarUrl}
        onRealSignOut={handleRealSignOut}
        onRealGoogleCredential={handleGoogleCredential}
      />

      {/* Add To Collection Modal */}
      <AddToCollectionModal
        isOpen={collectionModalPayload !== null}
        onClose={() => setCollectionModalPayload(null)}
        currentUser={currentUser}
        payload={collectionModalPayload}
        onSuccess={() => {}}
      />

      {/* Collections quick-jump (the `s` shortcut): same panel as the Collections page. */}
      <CollectionsModal
        isOpen={collectionsModalOpen}
        userId={currentUser?.id || ANONYMOUS_USER_ID}
        onClose={() => setCollectionsModalOpen(false)}
        onSelectWork={handleSelectWork}
        onSelectChapter={handleSelectChapter}
        onOpenQuote={handleOpenQuote}
        onRunSearch={query => {
          setSearchQuery(query);
          setCurrentView('search');
        }}
        onManage={() => setCurrentView('collections')}
      />

      {/* Connectivity status for online requests. */}
      <ServerStatusToast />
    </div>
  );
}
