import React, { useState, useRef, useEffect } from 'react';
import { DragGhost } from './DragGhost';
import {
  BookOpen,
  Search,
  Bookmark,
  Sparkles,
  User as UserIcon,
  LogIn, Compass,
  Menu, X,
  ArrowRight,
  ArrowLeft,
  Settings,
  BookMarked,
  MessageCircle
} from 'lucide-react';
import { AppView, SearchResult } from '../types/textbase';
import { useHideHeaderOnScroll } from '../hooks/useHideHeaderOnScroll';
import { useLongPressDrag } from '../hooks/useLongPressDrag';
import { readerService } from '../services/readerService';
import { isTypingBurst, noteLetterKey } from '../services/typingBurst';

// Waits this long after the last keystroke before actually searching -
// long enough that a fast typist doesn't fire a request per letter, short
// enough to still feel instant once they pause. Matches SearchView's own
// debounce (see there for why the same value).
const SEARCH_DEBOUNCE_MS = 400;

interface NavbarProps {
  currentView?: AppView | string;
  currentTab?: string;
  onNavigate?: (view: AppView) => void;
  onNavigateHome?: () => void;
  onSelectTab?: (tab: string) => void;
  // Real (textbase-server AppUser, via Google) identity - separate from
  // the demo currentUser persona system used elsewhere (Collections, etc).
  // Drives the identity chip itself: a real Google photo when signed in,
  // an explicit "Guest" placeholder when not - never a fake demo
  // name/avatar (e.g. a quick-persona default) as if it were real.
  reallySignedIn: boolean;
  realUsername?: string;
  realAvatarUrl?: string;
  onOpenAuth: () => void;
  onRandomDiscovery?: () => void;
  // "Close the book" - back to the page the book visit began on (NOT a
  // browser-history back). While reading it REPLACES the admin hamburger
  // in the brand slot; the hamburger returns on every other view.
  onCloseBook?: () => void;
  // Opens the reading preferences panel - rendered only while reading a
  // book (the reader view), where the panel itself lives.
  onToggleReaderSettings?: () => void;
  // Opens the collections quick-jump modal (the `s` shortcut's touch/mouse twin).
  onOpenCollectionsQuickFind?: () => void;
  // Undefined (not just a no-op) for a non-admin - see App.tsx's isAdmin -
  // hides the hamburger button entirely rather than showing it disabled.
  onOpenAdminSidebar?: () => void;
  onSearch?: (query: string) => void;
  // Direct navigation from a live dropdown result, bypassing the full
  // Search page entirely.
  onSelectWork?: (workId: string) => void;
  onSelectChapter?: (workId: string, chapterId: string) => void;
  // Author hits in the live dropdown navigate to the author's page the
  // same way the Search page routes them (see SearchView).
  onSelectAuthor?: (authorId: string) => void;
  // On the reader page, the brand wordmark is replaced by the work being
  // read (pageTitle) with the current chapter/subchapter as the subtitle
  // (pageSubtitle) - everywhere else both are unset and the plain
  // "BIBLIOTECA" wordmark shows with no subtitle at all.
  pageTitle?: string;
  pageSubtitle?: string;
  // The subtitle's author id, while reading - turns the subtitle into a
  // link to that author's page.
  pageAuthorId?: string;
  onOpenAuthor?: (authorId: string) => void;
  // While reading: the work whose title the wordmark shows - clicking the
  // title opens that work's card instead of the main page.
  pageWorkId?: string;
  onOpenWork?: (workId: string) => void;
  /** A chat drag (either direction) is in flight: the bar must stay on
      screen (overriding the reader-page auto-hide) so it can receive the
      drop, and shows its drop-ready highlight. */
  forceVisible?: boolean;
  chatDragActive?: boolean;
  chatDragOver?: boolean;
  /** Docked assistant on lg+: the chat bubble traded its corner for this
      bar (below lg the docked chat lives in the bottom nav instead). */
  chatDocked?: boolean;
  chatOpen?: boolean;
  /** Tapping the docked chat button toggles the panel (open ↔ closed, and
      the button's highlight with it). */
  onChatToggle?: () => void;
  onChatUndock?: () => void;
  onChatDragActiveChange?: (active: boolean, overTarget: boolean) => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  currentView,
  currentTab,
  onNavigate,
  onNavigateHome,
  onSelectTab,
  reallySignedIn,
  realUsername,
  realAvatarUrl,
  onOpenAuth,
  onRandomDiscovery,
  onToggleReaderSettings,
  onOpenCollectionsQuickFind,
  onOpenAdminSidebar,
  onCloseBook,
  onSearch,
  onSelectWork,
  onSelectChapter,
  onSelectAuthor,
  pageTitle,
  pageSubtitle,
  pageAuthorId,
  onOpenAuthor,
  pageWorkId,
  onOpenWork,
  forceVisible = false,
  chatDragActive = false,
  chatDragOver = false,
  chatDocked = false,
  chatOpen = false,
  onChatToggle,
  onChatUndock,
  onChatDragActiveChange
}) => {
  const [isSearchExpanded, setIsSearchExpanded] = useState(false);
  const brandSubtitle = pageTitle ? pageSubtitle : 'Your Scriptorium classical readings';
  // Starts empty on every page load: a search runs only when the reader
  // types. (A remembered last query used to be restored here, and the
  // search effect below then re-ran it on every load - a long pasted query
  // made opening any page fail.) The value still persists across the
  // overlay being opened and closed within the session.
  const [searchInputValue, setSearchInputValue] = useState('');
  // Drop what the removed last-search cache left in this browser.
  useEffect(() => {
    try { window.localStorage.removeItem('biblioteca.reader.lastSearch.v1'); } catch { /* storage unavailable */ }
  }, []);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Live-as-you-type combined results (all 5 search modes at once, tiered
  // by confidence - see readerService.searchCombined). Debounced so a
  // fast typist doesn't fire a request per keystroke; superseded requests
  // are dropped via `cancelled` rather than clearTimeout alone, since a
  // request already in flight when the next keystroke lands can't be
  // cancelled, only ignored when it resolves late.
  const [dropdownResults, setDropdownResults] = useState<SearchResult[]>([]);
  const [isDropdownSearching, setIsDropdownSearching] = useState(false);
  const [highlightedDropdownIndex, setHighlightedDropdownIndex] = useState(-1);
  const visibleDropdownResults = dropdownResults.slice(0, 8);

  // Keep the highlighted row valid as incremental search results arrive or
  // disappear while the user is typing.
  useEffect(() => {
    setHighlightedDropdownIndex(index =>
      index >= visibleDropdownResults.length
        ? (visibleDropdownResults.length > 0 ? visibleDropdownResults.length : -1)
        : index
    );
  }, [dropdownResults]);
  useEffect(() => {
    const trimmed = searchInputValue.trim();
    if (trimmed.length < 3) {
      setDropdownResults([]);
      setIsDropdownSearching(false);
      setHighlightedDropdownIndex(-1);
      return;
    }
    let cancelled = false;
    setIsDropdownSearching(true);
    const timer = setTimeout(() => {
      // onUpdate fires after each of the 5 modes lands (each individually
      // bounded - see searchCombined) - fast tiers show immediately
      // instead of the whole dropdown waiting on the slowest one.
      void readerService.searchCombined(trimmed, 5, results => {
        if (cancelled) return;
        setDropdownResults(results);
      }).then(() => {
        if (cancelled) return;
        setIsDropdownSearching(false);
      });
    }, SEARCH_DEBOUNCE_MS);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [searchInputValue]);

  const activeView = (currentView || currentTab || 'browse') as AppView;
  // Auto-hides while scrolling down the reader page, reappears on scroll
  // up - lets the reader keep just the text on screen. Everywhere else
  // (Browse, Search, etc.) the navbar stays always visible.
  const headerVisible = useHideHeaderOnScroll(activeView === 'reader');
  // A chat drag force-shows the bar (even where it auto-hid on scroll) so
  // it is there to receive the bubble - same contract as the bottom nav.
  const barVisible = headerVisible || forceVisible;

  // Long-press the docked chat button and drag it into the page to send the
  // assistant back to its floating corner; dropped back onto the bar it
  // stays docked. The button itself never moves - a ghost bubble follows
  // the pointer instead (same gesture as the bottom nav's chat tab).
  const chatDrag = useLongPressDrag({
    targetId: 'navbar',
    onDropOutside: () => onChatUndock?.(),
    onDropTarget: () => {},
    onDragActiveChange: onChatDragActiveChange,
    enabled: chatDocked,
  });
  const navigate = (view: AppView) => {
    if (onNavigate) onNavigate(view);
    if (onSelectTab) onSelectTab(view);
  };

  const handleOpenSearch = () => {
    setIsSearchExpanded(true);
    setTimeout(() => {
      searchInputRef.current?.focus();
    }, 50);
  };

  // Familiar catalog shortcut: `/` opens the same search control as the
  // navbar button. Do not steal the key while the user is typing in another
  // editable control (or composing a contenteditable selection).
  useEffect(() => {
    const handleGlobalShortcut = (event: KeyboardEvent) => {
      if (event.key !== '/') return;
      const target = event.target as HTMLElement | null;
      if (target?.matches('input, textarea, select, [contenteditable="true"]')) return;
      event.preventDefault();
      handleOpenSearch();
    };
    window.addEventListener('keydown', handleGlobalShortcut);
    return () => window.removeEventListener('keydown', handleGlobalShortcut);
  }, []);

  // Random-discovery shortcut: a bare 'r' taps the navbar's own random
  // discovery button (nav-random-btn) - literally the same click as
  // pressing it, dice-tumble animation included - which works in every
  // view since the navbar button does. Same guards as the reader's
  // single-letter shortcuts: no modifiers, no editable target, and the
  // shared typing-burst guard so letters typed on the page (no focused
  // input) never yank the user away mid-word.
  useEffect(() => {
    const handleDiscoverKey = (event: KeyboardEvent) => {
      if (event.key !== 'r' || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.matches('input, textarea, select, [contenteditable="true"]')) return;
      if (isTypingBurst()) {
        noteLetterKey();
        return;
      }
      const button = document.querySelector<HTMLButtonElement>('#nav-random-btn');
      if (!button) return;
      event.preventDefault();
      button.click();
    };
    window.addEventListener('keydown', handleDiscoverKey);
    return () => window.removeEventListener('keydown', handleDiscoverKey);
  }, []);

  const handleCloseSearch = () => {
    setIsSearchExpanded(false);
  };

  const handleSearchSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (searchInputValue.trim()) {
      if (onSearch) {
        onSearch(searchInputValue.trim());
      } else {
        navigate('search');
      }
      setIsSearchExpanded(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const dropdownItemCount = visibleDropdownResults.length + 1; // rows + “See all”
    if (e.key === 'ArrowDown' && visibleDropdownResults.length > 0) {
      e.preventDefault();
      setHighlightedDropdownIndex(index => (index + 1) % dropdownItemCount);
    } else if (e.key === 'ArrowUp' && visibleDropdownResults.length > 0) {
      e.preventDefault();
      setHighlightedDropdownIndex(index => index <= 0 ? dropdownItemCount - 1 : index - 1);
    } else if (e.key === 'PageDown' && visibleDropdownResults.length > 0) {
      e.preventDefault();
      setHighlightedDropdownIndex(visibleDropdownResults.length);
    } else if (e.key === 'PageUp' && visibleDropdownResults.length > 0) {
      e.preventDefault();
      setHighlightedDropdownIndex(0);
    } else if (e.key === 'Enter' && highlightedDropdownIndex === visibleDropdownResults.length && visibleDropdownResults.length > 0) {
      e.preventDefault();
      handleSearchSubmit();
    } else if (e.key === 'Enter' && highlightedDropdownIndex >= 0 && visibleDropdownResults[highlightedDropdownIndex]) {
      e.preventDefault();
      handleSelectDropdownResult(visibleDropdownResults[highlightedDropdownIndex]);
    } else if (e.key === 'Enter') {
      handleSearchSubmit();
    } else if (e.key === 'Escape') {
      setIsSearchExpanded(false);
    }
  };

  const handleSelectDropdownResult = (result: SearchResult) => {
    if (result.type === 'author' && onSelectAuthor) {
      // An author hit opens the author's page - never a work route with
      // a bogus id (see serversideApi.realSearch).
      onSelectAuthor(result.authorId || result.workId);
    } else if (result.chapterId && onSelectChapter) {
      onSelectChapter(result.workId, result.chapterId);
    } else if (onSelectWork) {
      onSelectWork(result.workId);
    } else {
      return;
    }
    setSearchInputValue('');
    setDropdownResults([]);
    setIsSearchExpanded(false);
  };

  return (
    <header id="navbar" className={`sticky top-0 z-40 bg-[linear-gradient(90deg,rgba(2,64,99,0.96)_0%,rgba(60,168,63,0.92)_22%,rgba(4,74,111,0.96)_100%)] backdrop-blur-md border-b border-emerald-400/25 text-[#e4efe9] shadow-lg shadow-[#021f2d]/50 transition-transform duration-300 ${barVisible ? 'translate-y-0' : '-translate-y-full'} ${chatDragActive ? (chatDragOver ? 'ring-2 ring-inset ring-amber-300/90' : 'ring-2 ring-inset ring-amber-400/50') : ''}`}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="relative flex items-center justify-between h-16 gap-3">

          {/* EXPANDED FULL-BAR SEARCH overlay - covers the whole row (logo/hamburger included) */}
          {isSearchExpanded && (
            <div className="absolute inset-0 z-10 flex items-center bg-[linear-gradient(90deg,rgba(2,64,99,0.98)_0%,rgba(60,168,63,0.95)_22%,rgba(4,74,111,0.98)_100%)] animate-in fade-in zoom-in-95 duration-200 origin-left">
              <form
                onSubmit={handleSearchSubmit}
                className="w-full relative flex items-center"
              >
                <div className="relative w-full flex items-center">
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={handleCloseSearch}
                    aria-label="Close search"
                    title="Close search"
                    className="absolute left-2 p-1.5 rounded-md text-[#f59e0b] hover:text-white hover:bg-emerald-500/20 cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                  <input
                    ref={searchInputRef}
                    type="text"
                    value={searchInputValue}
                    onChange={(e) => setSearchInputValue(e.target.value)}
                    onKeyDown={handleKeyDown}
                    aria-controls="nav-search-dropdown"
                    aria-activedescendant={highlightedDropdownIndex >= 0
                      ? (highlightedDropdownIndex < visibleDropdownResults.length
                        ? `nav-search-dropdown-result-${visibleDropdownResults[highlightedDropdownIndex]?.id}`
                        : 'nav-search-dropdown-see-all')
                      : undefined}
                    onBlur={() => {
                      // Slight timeout to allow clicking the clear or submit button if needed
                      setTimeout(() => {
                        handleCloseSearch();
                      }, 180);
                    }}
                    placeholder="Search classical texts, authors, quotes, concepts..."
                    className="w-full bg-[#022332]/95 border border-amber-500/50 rounded-xl pl-10 pr-20 py-2 text-xs sm:text-sm text-white placeholder:text-emerald-200/50 focus:outline-none focus:ring-2 focus:ring-[#f59e0b] shadow-inner font-serif-reading"
                  />

                  {/* Actions inside search bar */}
                  <div className="absolute right-2 flex items-center space-x-1">
                    {searchInputValue && (
                      <button
                        type="button"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          setSearchInputValue('');
                        }}
                        className="p-1 rounded-md text-emerald-300/70 hover:text-white hover:bg-emerald-500/20"
                        title="Clear input"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                    <button
                      type="submit"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        handleSearchSubmit();
                      }}
                      className="px-2 py-1 rounded-md bg-[#f59e0b] hover:bg-amber-400 text-black text-xs font-bold flex items-center space-x-1 cursor-pointer"
                      title="Search"
                    >
                      <ArrowRight className="w-3 h-3" />
                    </button>
                  </div>

                  {/* Live-as-you-type combined results dropdown - the
                      indexed search modes at once (see searchCombined;
                      grep is excluded from it as an unindexed live
                      scan), no Enter/submit required. onMouseDown+
                      preventDefault on each row so the click registers
                      before the input's onBlur (180ms below) would
                      otherwise close this. */}
                  {searchInputValue.trim().length >= 3 && (
                    <div
                      id="nav-search-dropdown"
                      role="listbox"
                      aria-label="Search results"
                      className="absolute top-full left-0 right-0 mt-2 max-h-[70vh] overflow-y-auto bg-[#022332] border border-amber-500/40 rounded-xl shadow-2xl shadow-black/50 z-20"
                    >
                      {isDropdownSearching && dropdownResults.length === 0 ? (
                        <div className="px-4 py-3 text-xs text-emerald-200/70 flex items-center space-x-2">
                          <span className="w-3.5 h-3.5 border-2 border-[#f59e0b] border-t-transparent rounded-full animate-spin"></span>
                          <span>Searching all 5 modes…</span>
                        </div>
                      ) : !isDropdownSearching && dropdownResults.length === 0 ? (
                        <div className="px-4 py-3 text-xs text-emerald-200/70">
                          No matches for "{searchInputValue.trim()}".
                        </div>
                      ) : (
                        <>
                          {/* Results already in from whichever of the 5 modes
                              have landed so far - shown as-is rather than
                              waiting for every mode, so a slow one (e.g.
                              vector search) never blanks out what's already
                              found. */}
                          {isDropdownSearching && (
                            <div className="px-4 py-1.5 text-[10px] text-emerald-300/60 flex items-center space-x-1.5 border-b border-emerald-500/10">
                              <span className="w-2.5 h-2.5 border-2 border-[#f59e0b] border-t-transparent rounded-full animate-spin"></span>
                              <span>Still searching more modes…</span>
                            </div>
                          )}
                          {visibleDropdownResults.map((result, index) => (
                            <button
                              key={result.id}
                              id={`nav-search-dropdown-result-${result.id}`}
                              type="button"
                              role="option"
                              aria-selected={index === highlightedDropdownIndex}
                              onMouseEnter={() => setHighlightedDropdownIndex(index)}
                              onMouseDown={(e) => {
                                e.preventDefault();
                                handleSelectDropdownResult(result);
                              }}
                              className={`w-full text-left px-4 py-2.5 flex items-start space-x-2.5 hover:bg-emerald-500/15 border-b border-emerald-500/10 last:border-b-0 cursor-pointer ${index === highlightedDropdownIndex ? 'bg-emerald-500/25 ring-inset ring-1 ring-amber-400/60' : ''}`}
                            >
                              {result.mode === 'author' ? (
                                <UserIcon className="w-4 h-4 text-[#f59e0b] shrink-0 mt-0.5" />
                              ) : (
                                <BookOpen className="w-4 h-4 text-[#f59e0b] shrink-0 mt-0.5" />
                              )}
                              <span className="min-w-0">
                                <span className="block text-xs sm:text-sm font-semibold text-white truncate">
                                  {result.workTitle}
                                  {result.chapterTitle && (
                                    <span className="font-normal text-emerald-200/60"> — {result.chapterTitle}</span>
                                  )}
                                </span>
                                <span className="block text-[10px] text-emerald-300/60 truncate">
                                  {result.authorName} · {result.mode}
                                </span>
                              </span>
                            </button>
                          ))}
                          <button
                            type="button"
                            id="nav-search-dropdown-see-all"
                            role="option"
                            aria-selected={highlightedDropdownIndex === visibleDropdownResults.length}
                            onMouseEnter={() => setHighlightedDropdownIndex(visibleDropdownResults.length)}
                            onMouseDown={(e) => {
                              e.preventDefault();
                              handleSearchSubmit();
                            }}
                            className={`w-full text-left px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-[#f59e0b] hover:bg-emerald-500/15 cursor-pointer ${highlightedDropdownIndex === visibleDropdownResults.length ? 'bg-emerald-500/25 ring-inset ring-1 ring-amber-400/60' : ''}`}
                          >
                            See all results on the Search page →
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              </form>
            </div>
          )}

          {/* Logo & Brand - hamburger badge (admins only) triggers the admin sidebar; the title navigates to Browse.
              While reading, the badge is replaced by the close-book arrow:
              back to the page the book visit began on, like closing the book. */}
          <div className="flex-shrink-0 flex items-center space-x-2.5 p-1.5 -ml-2">
            {currentView === 'reader' && onCloseBook ? (
              <button
                id="nav-close-book-btn"
                onClick={onCloseBook}
                title="Close the book - back to where you found it"
                aria-label="Close the book - back to where you found it"
                className="relative rounded-xl hover:bg-emerald-500/10 border border-transparent hover:border-emerald-500/30 transition-all cursor-pointer group"
              >
                <div id="nav-close-book-badge" className="w-9 h-9 rounded-lg bg-[#f59e0b] group-hover:bg-amber-400 flex items-center justify-center text-black shadow-md shadow-amber-950/40 transition-colors">
                  <ArrowLeft className="w-5 h-5 group-hover:-translate-x-0.5 transition-transform" />
                </div>
              </button>
            ) : onOpenAdminSidebar && (
              <button
                id="nav-logo-hamburger-btn"
                onClick={onOpenAdminSidebar}
                title="Open Admin Sidebar & TEI Pipelines"
                className="relative rounded-xl hover:bg-emerald-500/10 border border-transparent hover:border-emerald-500/30 transition-all cursor-pointer group"
              >
                <div id="nav-logo-hamburger-badge" className="w-9 h-9 rounded-lg bg-[#f59e0b] group-hover:bg-amber-400 flex items-center justify-center text-black font-bold font-mono shadow-md shadow-amber-950/40 transition-colors">
                  <Menu className="w-5 h-5 group-hover:scale-110 transition-transform" />
                </div>
                <span className="absolute -bottom-1 -right-1 flex h-3 w-3">
                  <span className="absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-[#f59e0b] border-2 border-[#061f18]"></span>
                </span>
              </button>
            )}

            {/* Title and subtitle stacked. The title goes to the main page -
                except while reading, when it is the work's own title and opens
                that work's card; the subtitle is then the work's author and
                links to the author page - its own button, so it cannot nest
                inside the title button. */}
            <div className="flex flex-col min-w-0">
              <button
                id="nav-logo-title-btn"
                onClick={() => {
                  if (currentView === 'reader' && pageWorkId && onOpenWork) onOpenWork(pageWorkId);
                  else if (onNavigateHome) onNavigateHome();
                  else navigate('browse');
                }}
                title={currentView === 'reader' && pageWorkId && onOpenWork
                  ? `Open ${pageTitle ?? 'the work'}'s page`
                  : 'Biblioteca - go to the main page'}
                className="text-left cursor-pointer group/title min-w-0"
              >
                <div className="flex items-center space-x-1.5">
                  <span className="font-display-title text-base sm:text-lg font-bold tracking-tight text-white group-hover/title:text-[#f59e0b] transition-colors truncate max-w-[34vw] sm:max-w-[55vw] md:max-w-xs">
                    {pageTitle || 'BIBLIOTECA'}
                  </span>
                </div>
              </button>
              {brandSubtitle && (pageAuthorId && onOpenAuthor ? (
                <button
                  id="nav-logo-author-btn"
                  onClick={() => onOpenAuthor(pageAuthorId)}
                  title={`Open ${brandSubtitle}'s page`}
                  className="text-left cursor-pointer min-w-0 group/author"
                >
                  <p className="text-xs sm:text-sm text-white/95 group-hover/author:text-amber-200 transition-colors font-sans -mt-0.5 truncate max-w-[34vw] sm:max-w-[55vw] md:max-w-xs">
                    {brandSubtitle}
                  </p>
                </button>
              ) : (
                <p className="text-xs sm:text-sm text-white/95 font-sans -mt-0.5 truncate max-w-[34vw] sm:max-w-[55vw] md:max-w-xs">
                  {brandSubtitle}
                </p>
              ))}
            </div>
          </div>

            {/* Pure Reader Desktop Navigation Links */}
            <nav className="hidden lg:flex items-center space-x-1.5">
              <button
                id="nav-browse-btn"
                onClick={() => navigate('browse')}
                className={`flex items-center space-x-2 px-3.5 py-2 rounded-lg text-xs uppercase tracking-wider font-semibold transition-all cursor-pointer ${
                  activeView === 'browse' || activeView === 'author' || activeView === 'work'
                    ? 'bg-[#0f3d30] text-white border border-emerald-500/30 shadow-sm'
                    : 'text-emerald-100/70 hover:text-white hover:bg-emerald-500/10'
                }`}
              >
                <Compass className="w-4 h-4 text-[#f59e0b]" />
                <span>Catalog</span>
              </button>

              <button
                id="nav-search-btn"
                onClick={() => navigate('search')}
                className={`flex items-center space-x-2 px-3.5 py-2 rounded-lg text-xs uppercase tracking-wider font-semibold transition-all cursor-pointer ${
                  activeView === 'search'
                    ? 'bg-[#0f3d30] text-white border border-emerald-500/30 shadow-sm'
                    : 'text-emerald-100/70 hover:text-white hover:bg-emerald-500/10'
                }`}
              >
                <Search className="w-4 h-4 text-[#f59e0b]" />
                <span>Search</span>
              </button>

              <button
                id="nav-collections-btn"
                onClick={() => navigate('collections')}
                className={`flex items-center space-x-2 px-3.5 py-2 rounded-lg text-xs uppercase tracking-wider font-semibold transition-all cursor-pointer ${
                  activeView === 'collections'
                    ? 'bg-[#0f3d30] text-white border border-emerald-500/30 shadow-sm'
                    : 'text-emerald-100/70 hover:text-white hover:bg-emerald-500/10'
                }`}
              >
                <Bookmark className="w-4 h-4 text-[#f59e0b]" />
                <span>Collections</span>
              </button>

              {/* Docked assistant on desktop: the bubble traded its corner
                  for this bar. Tap opens the same chat panel; long-press
                  and drag into the page floats it again. */}
              {chatDocked && (
                <button
                  id="nav-chat-btn"
                  onClick={() => { if (chatDrag.justDragged()) return; onChatToggle?.(); }}
                  onPointerDown={chatDrag.onPointerDown}
                  onContextMenu={event => event.preventDefault()}
                  title="Biblioteca Assistant"
                  aria-label="Deschide chatul"
                  className={`flex items-center space-x-2 px-3.5 py-2 rounded-lg text-xs uppercase tracking-wider font-semibold transition-all cursor-pointer touch-none select-none ${chatDrag.dragging ? 'opacity-40' : ''} ${
                    chatOpen
                      ? 'bg-[#0f3d30] text-white border border-emerald-500/30 shadow-sm'
                      : 'text-emerald-100/70 hover:text-white hover:bg-emerald-500/10'
                  }`}
                >
                  <MessageCircle className="w-4 h-4 text-[#f59e0b]" />
                  <span>Chat</span>
                </button>
              )}
            </nav>

            {/* While dragging the docked chat button out, a ghost bubble
                follows the pointer; the button stays put (dimmed) until
                the drop lands. */}
            <DragGhost drag={chatDrag} testId="chat-drag-ghost">
              <MessageCircle className="w-6 h-6" />
            </DragGhost>

            {/* Right Action Tools */}
            <div className="flex items-center space-x-1 sm:space-x-3">
              {/* Search Icon button (at the left of 'Random Discovery').
                  Hidden on the search page itself: the page's own input is
                  the way in there, and it takes focus on arrival. */}
              {currentView !== 'search' && (
              <button
                id="nav-expand-search-btn"
                onClick={handleOpenSearch}
                title="Search corpus"
                className="p-1.5 sm:p-2 rounded-lg text-emerald-200 hover:text-white hover:bg-emerald-500/10 text-xs font-medium transition-all cursor-pointer"
              >
                <Search className="w-4 h-4 text-[#f59e0b]" />
              </button>
              )}

              {/* Collections quick-jump: same panel the `s` shortcut opens.
                  The Collections page has the same search box itself. */}
              {onOpenCollectionsQuickFind && currentView !== 'collections' && (
                <button
                  id="nav-collections-quick-btn"
                  onClick={onOpenCollectionsQuickFind}
                  title="Find in favorites, collections and saved searches (s)"
                  aria-label="Find in favorites, collections and saved searches (s)"
                  className="p-1.5 sm:p-2 rounded-lg text-emerald-200 hover:text-white hover:bg-emerald-500/10 transition-all cursor-pointer active:scale-95 active:brightness-90"
                >
                  <BookMarked className="w-4 h-4 text-[#f59e0b]" />
                </button>
              )}

              {/* Random Discovery Quick Button - the same icon-button shape
                  as the search icon button to its left (p-2 square, no
                  label at any width). */}
              {onRandomDiscovery && (
                <button
                  id="nav-random-btn"
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
                  title="Discover something at random (r)"
                  aria-label="Discover something at random (r)"
                  className="p-1.5 sm:p-2 rounded-lg text-emerald-200 hover:text-white hover:bg-emerald-500/10 transition-all cursor-pointer active:scale-95 active:brightness-90"
                >
                  <Sparkles className="w-4 h-4 text-[#f59e0b]" />
                </button>
              )}

              {/* Reading preferences - only while reading a book. Same
                  icon-button shape as its neighbors; the panel itself
                  renders in the reader view (see App's settings wiring). */}
              {onToggleReaderSettings && currentView === 'reader' && (
                <button
                  id="nav-reader-settings-btn"
                  onClick={onToggleReaderSettings}
                  title="Reader Display Preferences (Shift+S)"
                  aria-label="Reader Display Preferences"
                  className="p-1.5 sm:p-2 rounded-lg text-emerald-200 hover:text-white hover:bg-emerald-500/10 transition-all cursor-pointer active:scale-95 active:brightness-90"
                >
                  <Settings className="w-4 h-4 text-[#f59e0b]" />
                </button>
              )}

              {/* Auth / Account Controls - driven by REAL (Google) auth
                  state, not the demo currentUser persona system, so the
                  identity chip never shows a fake name/avatar (e.g. a
                  quick-persona default) as if it were a real signed-in
                  account. */}
              {reallySignedIn ? (
                <div className="flex items-center space-x-2 pl-0 sm:pl-2 border-l border-emerald-500/20">
                  <div
                    onClick={onOpenAuth}
                    className="flex items-center p-1.5 bg-emerald-950/40 hover:bg-emerald-900/40 border border-emerald-500/20 rounded-lg cursor-pointer transition-all group"
                    title={realUsername ? `Signed in as ${realUsername} - tap for details` : 'Signed in - tap for details'}
                  >
                    {realAvatarUrl ? (
                      <img
                        id="nav-avatar-real"
                        src={realAvatarUrl}
                        alt={realUsername || 'Signed in'}
                        referrerPolicy="no-referrer"
                        className="w-8 h-8 shrink-0 rounded-full border border-amber-500/40 object-cover"
                      />
                    ) : (
                      <div className="w-8 h-8 shrink-0 rounded-full bg-gradient-to-br from-amber-500 to-amber-700 text-black flex items-center justify-center font-bold text-xs">
                        {(realUsername || '?')[0].toUpperCase()}
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="flex items-center space-x-2 pl-0 sm:pl-2 border-l border-emerald-500/20">
                  <button
                    id="btn-nav-signin"
                    onClick={onOpenAuth}
                    title="Not signed in - click to sign in"
                    className="flex items-center space-x-2.5 p-1.5 bg-black/20 hover:bg-black/30 border border-white/15 rounded-lg cursor-pointer transition-all group"
                  >
                    <div className="w-7 h-7 shrink-0 rounded-full bg-white/10 border border-dashed border-white/30 text-white/60 group-hover:text-[#f59e0b] group-hover:border-amber-400/50 flex items-center justify-center transition-colors">
                      <UserIcon className="w-3.5 h-3.5" />
                    </div>
                    <div className="hidden lg:block text-left pr-1">
                      <p className="text-xs font-semibold text-white/80 group-hover:text-[#f59e0b] transition-colors leading-tight">
                        Guest
                      </p>
                      <p className="text-[10px] text-emerald-200/60 leading-none flex items-center space-x-1">
                        <LogIn className="w-2.5 h-2.5" />
                        <span>Sign In</span>
                      </p>
                    </div>
                  </button>
                </div>
              )}
            </div>

      </div>
      </div>
    </header>
  );
};
