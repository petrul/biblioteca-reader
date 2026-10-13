import React, { useState, useEffect, useRef } from 'react';
import { 
  Search, 
  User as UserIcon, 
  BookOpen, 
  Code, 
  Cpu, 
  Sparkles, 
  AlertTriangle, 
  ChevronRight, 
  ChevronLeft,
  Filter, 
  Bookmark, 
  FileText,
  Clock,
  Layers,
  HelpCircle,
  ToggleLeft,
  ToggleRight,
  Info,
  X
} from 'lucide-react';
import { SearchMode, SearchResult, LanguageCode, PersonalCollection } from '../types/textbase';
import { languageName } from '../services/languageNames';
import { readerService, ANONYMOUS_USER_ID } from '../services/readerService';
import { saveSearch } from '../services/savedSearches';

interface SearchViewProps {
  initialMode?: SearchMode;
  initialQuery?: string;
  initialWorkSeed?: string;
  onSelectWork: (workId: string) => void;
  onSelectChapter: (workId: string, chapterId: string) => void;
  onSelectAuthor: (authorId: string) => void;
  /** Whose collections decide which results show as saved. */
  currentUserId?: string;
  onOpenAddToCollection: (item: { type: 'work' | 'chapter'; referenceId: string; workId: string; workTitle: string; authorName: string; chapterId?: string; chapterTitle?: string }) => void;
}

const SEARCH_MODES: {
  id: SearchMode;
  title: string;
  shortDesc: string;
  placeholder: string;
  icon: React.ReactNode;
}[] = [
  {
    id: 'author',
    title: '1. Author Search',
    shortDesc: 'Catalog matching on canonical IDs, names, era and biographies',
    placeholder: 'e.g. Seneca, Plato, Eminescu, Shakespeare, phi1017...',
    icon: <UserIcon className="w-4 h-4" />
  },
  {
    id: 'title',
    title: '2. Title Search',
    shortDesc: 'Work titles, subtitles, alternate latin/greek names, and tags',
    placeholder: 'e.g. De Brevitate Vitae, Apologia, Luceafărul, Tempest...',
    icon: <BookOpen className="w-4 h-4" />
  },
  {
    id: 'grep',
    title: '3. Literal (Grep)',
    shortDesc: 'Exact character sequences and regex expressions across all lines',
    placeholder: 'e.g. brev.*vit|mortalium|«vitam brevem»...',
    icon: <Code className="w-4 h-4" />
  },
  {
    id: 'lucene',
    title: '4. Full-Text (Lucene)',
    shortDesc: 'BM25 token inverted-index, boolean clauses (AND, OR), fuzzy (~)',
    placeholder: 'e.g. title:brevitate AND philosopher, "longam artem"~2...',
    icon: <FileText className="w-4 h-4" />
  },
  {
    id: 'vector',
    title: '5. Similarity (Vector)',
    shortDesc: 'Semantic embedding distance in 3072-dimensional space',
    placeholder: 'e.g. meditations on fleeting time, stoic tranquility, mortality...',
    icon: <Sparkles className="w-4 h-4" />
  }
];

function highlightExcerpt(text: string, query: string): React.ReactNode {
  const trimmed = query.trim();
  if (!trimmed || !text) return text;
  const escaped = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const normalized = trimmed.toLowerCase();
  const terms = text.toLowerCase().includes(normalized)
    ? [trimmed]
    : trimmed.split(/\s+/).filter(term => term.length > 1 && !/^(and|or|not)$/i.test(term));
  if (!terms.length) return text;
  const matcher = new RegExp(`(${terms.sort((a, b) => b.length - a.length).map(escaped).join('|')})`, 'gi');
  return text.split(matcher).map((part, index) => {
    const isMatch = terms.some(term => part.toLowerCase() === term.toLowerCase());
    return isMatch
      ? <mark key={index} className="rounded bg-amber-400/80 px-0.5 text-[#071b14] font-semibold">{part}</mark>
      : <React.Fragment key={index}>{part}</React.Fragment>;
  });
}

/** Every referenceId held by any of the collections. */
export function savedReferenceIds(collections: PersonalCollection[]): Set<string> {
  return new Set(collections.flatMap(c => c.items.map(i => i.referenceId)));
}

export const SearchView: React.FC<SearchViewProps> = ({
  initialMode = 'lucene',
  initialQuery = '',
  initialWorkSeed,
  onSelectWork,
  onSelectChapter,
  onSelectAuthor,
  currentUserId = ANONYMOUS_USER_ID,
  onOpenAddToCollection
}) => {
  // The referenceIds saved in any of the user's collections - fills a
  // result's bookmark icon. Recomputed on collections-changed, as the
  // reader toolbar does, so a save made in the dialog shows at once.
  const [savedIds, setSavedIds] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    const recompute = () => {
      try { setSavedIds(savedReferenceIds(readerService.getCollections(currentUserId))); }
      catch { setSavedIds(new Set()); }
    };
    recompute();
    window.addEventListener('collections-changed', recompute);
    return () => window.removeEventListener('collections-changed', recompute);
  }, [currentUserId]);
  const [activeMode, setActiveMode] = useState<SearchMode>(initialMode);
  // By default a query searches the 4 indexed modes at once (see
  // readerService.searchCombined - grep is excluded from the combined
  // default as the one mode with no index, a live corpus scan, so it
  // only runs when its tab is explicitly picked), tiered by confidence
  // exactly like the navbar's own live dropdown - picking a specific
  // mode tab below is the only way out of that, a deliberate manual
  // override. The one exception: "More Like This" (initialWorkSeed set)
  // is already an explicit single-mode (vector) request made on the
  // reader's behalf, so it starts single-mode rather than combined.
  const [combinedMode, setCombinedMode] = useState(!initialWorkSeed);
  const [query, setQuery] = useState(initialQuery);
  // The query input owns the caret the moment the page opens - the search
  // entry point is typing, not clicking (the navbar's own search icon
  // hides while this view is active). autoFocus covers the initial mount;
  // the effect makes it unconditional regardless of mount order.
  const queryInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { queryInputRef.current?.focus(); }, []);
  const [page, setPage] = useState(1);
  // Saving applies to the query/results shown - any change of query or mode makes it saveable again.
  const [searchSaveState, setSearchSaveState] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle');
  useEffect(() => setSearchSaveState('idle'), [query, activeMode, combinedMode]);
  // Flips the header card to reveal the 5 search-mode explanation boxes
  // on the back - same rotate-y-180 mechanism as WorkView's technical
  // metadata and ReaderView's chapter stats. The front keeps a compact
  // mode selector so switching modes never requires flipping.
  const [showModeInfo, setShowModeInfo] = useState(false);

  // Grep options
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [useRegex, setUseRegex] = useState(true);

  // Lucene options
  const [fuzzySearch, setFuzzySearch] = useState(false);

  // Language filter
  const [langFilter, setLangFilter] = useState<LanguageCode | 'all'>('all');
  const [searchResponse, setSearchResponse] = useState(() => readerService.search(activeMode, query, {
    page: 1,
    pageSize: 6
  }));

  // Page through result sets with the horizontal arrow keys. Keep the keys
  // available for normal cursor movement while the query field is focused.
  useEffect(() => {
    const handlePageKey = (event: KeyboardEvent) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      const target = event.target as HTMLElement | null;
      if (target?.matches('input, textarea, select, [contenteditable="true"]')) return;
      if (searchResponse.totalPages <= 1) return;
      event.preventDefault();
      setPage(current => event.key === 'ArrowLeft'
        ? Math.max(1, current - 1)
        : Math.min(searchResponse.totalPages, current + 1));
    };
    window.addEventListener('keydown', handlePageKey);
    return () => window.removeEventListener('keydown', handlePageKey);
  }, [searchResponse.totalPages]);

  // Sync when initial props change (e.g. a fresh navbar search lands here
  // while SearchView is already mounted) - a bare new query defaults back
  // to combined mode, same reasoning as the initial state above; only an
  // incoming workSeed (More Like This) forces single vector mode.
  useEffect(() => {
    if (initialMode) setActiveMode(initialMode);
    if (initialQuery !== undefined) setQuery(initialQuery);
    setCombinedMode(!initialWorkSeed);
  }, [initialMode, initialQuery, initialWorkSeed]);

  // Debounced query - waits for a pause in typing before actually
  // searching, same reasoning/value as the navbar's own live dropdown
  // (see Navbar.tsx's SEARCH_DEBOUNCE_MS) - this used to search on every
  // single keystroke.
  const [debouncedQuery, setDebouncedQuery] = useState(query);
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), 400);
    return () => clearTimeout(timer);
  }, [query]);

  // Execute the search: combined (the 4 indexed modes at once, see
  // readerService.searchCombined) by default, or the single active mode
  // once a reader manually picks one of the 5 tabs (grep, the unindexed
  // live scan, is only reachable that way).
  useEffect(() => {
    let current = true;
    if (combinedMode) {
      const perModeLimit = page * 6;
      const applyResults = (results: SearchResult[]) => {
        if (!current) return;
        const filtered = langFilter === 'all' ? results : results.filter(r => r.language === langFilter);
        const start = (page - 1) * 6;
        setSearchResponse({
          results: filtered.slice(start, start + 6),
          total: filtered.length,
          totalPages: Math.max(1, Math.ceil(filtered.length / 6)),
          // Unused placeholder - every place that renders search-mode
          // text below branches on the `combinedMode` flag directly
          // instead, since there's no single SearchMode that honestly
          // describes a combined result set.
          mode: 'title',
          tookMs: 0
        });
      };
      // onUpdate fires after each of the 5 modes lands (each individually
      // bounded - see searchCombined) - results from fast modes populate
      // the page immediately instead of the whole search waiting on the
      // slowest one (e.g. vector search behind a contended Ollama).
      void readerService.searchCombined(debouncedQuery, perModeLimit, applyResults).then(applyResults);
      return () => { current = false; };
    }
    void readerService.searchConnected(activeMode, debouncedQuery, {
      page,
      pageSize: 6,
      language: langFilter === 'all' ? undefined : langFilter,
      caseSensitive,
      useRegex,
      fuzzy: fuzzySearch,
      workIdSeed: initialWorkSeed
    }).then(response => { if (current) setSearchResponse(response); });
    return () => { current = false; };
  }, [combinedMode, activeMode, debouncedQuery, page, langFilter, caseSensitive, useRegex, fuzzySearch, initialWorkSeed]);

  const adminStatus = readerService.getAdminStatus();
  const vectorAvailable = adminStatus.vectorSearchStatus.available;

  const handleToggleVectorService = () => {
    readerService.setVectorSearchAvailability(!vectorAvailable);
    // Force re-render with page reset
    setPage(1);
  };

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header + mode selector card - flips to reveal the full pretty
          per-mode explanation boxes on the back, kept off the front so
          they don't compete with the (still fully functional) compact
          selector for space. */}
      <div className="relative mb-6">
        <button
          id="btn-search-flip-info"
          onClick={() => setShowModeInfo(!showModeInfo)}
          className={`absolute -top-2 right-0 z-20 p-1.5 rounded-full transition-all cursor-pointer ${
            showModeInfo ? 'opacity-100 bg-black/20 text-white' : 'opacity-50 hover:opacity-90 text-white'
          }`}
          title={showModeInfo ? 'Back to search' : 'Search'}
          aria-label={showModeInfo ? 'Back to search' : 'Show search mode explanations'}
        >
          <Info className="w-4 h-4" />
        </button>

        <div className="[perspective:1500px]">
          <div className={`relative transition-transform duration-700 ease-in-out transform-3d ${showModeInfo ? 'rotate-y-180' : ''}`}>
            {/* FRONT FACE: title + a compact, still fully functional mode selector */}
            <div className="backface-hidden">
              <div className="mb-4">
                <h1 className="font-display-title text-2xl sm:text-3xl font-bold text-white mb-1">
                  5 Distinct Search Engines
                </h1>
                <p className="text-xs sm:text-sm text-white">
                  Author, title, head, Lucene, and vector search.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-1.5 bg-white/[0.12] backdrop-blur-xl p-1.5 rounded-xl border border-white/30">
                {/* Combined is the default - the 4 indexed modes at
                    once, tiered by confidence (see
                    readerService.searchCombined; grep, the unindexed
                    live scan, is excluded from it). Picking one of the 5
                    below is a manual override; this is the way back. */}
                <button
                  id="search-tab-combined"
                  onClick={() => { setCombinedMode(true); setPage(1); }}
                  className={`flex items-center space-x-2 px-3.5 py-2 rounded-lg text-xs uppercase tracking-wider font-semibold transition-all cursor-pointer ${
                    combinedMode
                      ? 'bg-[#f59e0b] hover:bg-amber-400 text-black shadow-md shadow-black/20'
                      : 'text-white/80 hover:text-white hover:bg-white/10'
                  }`}
                  title="Search the indexed modes at once (grep needs its own tab)"
                >
                  <Layers className={`w-4 h-4 ${combinedMode ? 'text-black' : 'text-[#f59e0b]'}`} />
                  <span>All 4</span>
                </button>
                {SEARCH_MODES.map((m) => {
                  const isSelected = !combinedMode && activeMode === m.id;
                  return (
                    <button
                      key={m.id}
                      id={`search-tab-${m.id}`}
                      onClick={() => {
                        setActiveMode(m.id);
                        setCombinedMode(false);
                        setPage(1);
                      }}
                      className={`flex items-center space-x-2 px-3.5 py-2 rounded-lg text-xs uppercase tracking-wider font-semibold transition-all cursor-pointer ${
                        isSelected
                          ? 'bg-[#f59e0b] hover:bg-amber-400 text-black shadow-md shadow-black/20'
                          : 'text-white/80 hover:text-white hover:bg-white/10'
                      }`}
                    >
                      <span className={isSelected ? 'text-black' : 'text-[#f59e0b]'}>{m.icon}</span>
                      <span>{m.title.replace(/^\d+\.\s*/, '')}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* BACK FACE: the full pretty explanation boxes - tapping one
                also selects that mode and flips back to the search input. */}
            <div className="absolute inset-0 backface-hidden rotate-y-180 overflow-y-auto">
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
                {SEARCH_MODES.map((m) => {
                  const isSelected = !combinedMode && activeMode === m.id;
                  return (
                    <button
                      key={m.id}
                      id={`search-mode-info-${m.id}`}
                      onClick={() => {
                        setActiveMode(m.id);
                        setCombinedMode(false);
                        setPage(1);
                        setShowModeInfo(false);
                      }}
                      className={`flex flex-col p-3 rounded-xl border text-left transition-all cursor-pointer backdrop-blur-xl ${
                        isSelected
                          ? 'bg-white/25 text-white border-white/50 shadow-md ring-1 ring-amber-400/50'
                          : 'bg-white/[0.08] text-white/75 border-white/20 hover:bg-white/[0.15] hover:text-white hover:border-white/35'
                      }`}
                    >
                      <div className="flex items-center space-x-2 mb-1">
                        <span className={isSelected ? 'text-[#f59e0b]' : 'text-amber-300/80'}>
                          {m.icon}
                        </span>
                        <span className="font-bold text-xs truncate">
                          {m.title}
                        </span>
                      </div>
                      <p className={`text-[10px] line-clamp-2 leading-tight ${isSelected ? 'text-white' : 'text-white/60'}`}>
                        {m.shortDesc}
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Search Input Box with Mode-Specific Controls (Translucent White Matte Glass) */}
      <div className="bg-white/[0.12] backdrop-blur-xl rounded-2xl border border-white/30 p-5 shadow-[0_8px_32px_0_rgba(0,0,0,0.25)] mb-8 space-y-4">
        <form
          className="relative flex items-center"
          onSubmit={(event) => {
            event.preventDefault();
            setPage(1);
            setDebouncedQuery(query);
          }}
        >
          <button
            type="submit"
            aria-label="Search"
            title="Search"
            className="absolute left-2.5 p-1.5 rounded-md text-white/60 hover:text-white hover:bg-white/15 cursor-pointer transition-all"
          >
            <Search className="w-5 h-5" />
          </button>
          <input
            id="input-search-query"
            type="text"
            autoFocus
            ref={queryInputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(1);
            }}
            placeholder={SEARCH_MODES.find(m => m.id === activeMode)?.placeholder}
            className="w-full pl-12 pr-28 py-3.5 rounded-xl border border-white/25 text-sm text-white placeholder:text-white/50 focus:outline-none focus:ring-2 focus:ring-[#f59e0b] focus:border-[#f59e0b] bg-black/25"
          />
          {query && (
            <button
              id="btn-search-clear-query"
              type="button"
              onClick={() => {
                setQuery('');
                setPage(1);
              }}
              title="Clear input"
              className="absolute right-4 p-1.5 rounded-md text-white/70 hover:text-white hover:bg-white/15 cursor-pointer transition-all"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </form>

        {/* Mode-Specific Fine-tuning Toggles */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-white/15 text-xs">
          <div className="flex flex-wrap items-center gap-3">
            {/* Grep Mode Controls */}
            {!combinedMode && activeMode === 'grep' && (
              <>
                <label className="flex items-center space-x-1.5 cursor-pointer text-white font-medium">
                  <input
                    type="checkbox"
                    checked={useRegex}
                    onChange={(e) => setUseRegex(e.target.checked)}
                    className="accent-[#f59e0b] rounded"
                  />
                  <span>Regular Expressions (Regex)</span>
                </label>
                <label className="flex items-center space-x-1.5 cursor-pointer text-white font-medium">
                  <input
                    type="checkbox"
                    checked={caseSensitive}
                    onChange={(e) => setCaseSensitive(e.target.checked)}
                    className="accent-[#f59e0b] rounded"
                  />
                  <span>Case Sensitive</span>
                </label>
              </>
            )}

            {/* Lucene Mode Controls */}
            {!combinedMode && activeMode === 'lucene' && (
              <>
                <label className="flex items-center space-x-1.5 cursor-pointer text-white font-medium">
                  <input
                    type="checkbox"
                    checked={fuzzySearch}
                    onChange={(e) => setFuzzySearch(e.target.checked)}
                    className="accent-[#f59e0b] rounded"
                  />
                  <span>Fuzzy Query (~Distance)</span>
                </label>
                <span className="text-white/70 font-mono text-[11px] hidden sm:inline">
                  Prefix syntax: <code className="bg-black/30 px-1 py-0.5 rounded border border-white/20 text-amber-300">title:...</code>, <code className="bg-black/30 px-1 py-0.5 rounded border border-white/20 text-amber-300">author:...</code>
                </span>
              </>
            )}

            {/* Vector Mode Status & Simulator */}
            {!combinedMode && activeMode === 'vector' && (
              <div className="flex items-center space-x-3">
                <span className="font-mono text-[11px] text-white/80">
                  Model: textbase-vector-3072
                </span>
                <button
                  onClick={handleToggleVectorService}
                  title="Simulate vector service availability for degradation testing"
                  className="flex items-center space-x-1.5 px-2.5 py-1 rounded-lg bg-white/15 hover:bg-white/25 border border-white/25 text-[11px] font-medium text-white cursor-pointer backdrop-blur-md transition-all"
                >
                  <span>Simulate Service:</span>
                  <span className={`font-bold ${vectorAvailable ? 'text-emerald-300' : 'text-rose-300'}`}>
                    {vectorAvailable ? 'ONLINE' : 'OFFLINE'}
                  </span>
                </button>
              </div>
            )}
          </div>

          {/* Search Metrics and Language Selector */}
          <div className="flex items-center space-x-3">
            <span className="text-[11px] font-mono text-white/70">
              {searchResponse.tookMs}ms latency
            </span>
          </div>
        </div>
      </div>

      {/* RESULTS VIEWPORT */}

      {/* Case 1: VECTOR SEARCH TEMPORARILY UNAVAILABLE (Principle 4: Degrade, don't break) */}
      {!combinedMode && activeMode === 'vector' && searchResponse.vectorUnavailable ? (
        <div 
          id="vector-unavailable-banner"
          className="bg-amber-500/10 border-2 border-dashed border-amber-500/30 rounded-2xl p-8 text-center space-y-4 my-6"
        >
          <div className="w-12 h-12 rounded-full bg-amber-500/20 text-[#f59e0b] flex items-center justify-center mx-auto border border-amber-500/30">
            <AlertTriangle className="w-6 h-6" />
          </div>

          <div className="max-w-md mx-auto space-y-1">
            <h3 className="font-display-title text-lg font-bold text-white">
              Vector Similarity Search Temporarily Unavailable
            </h3>
            <p className="text-xs text-amber-200 leading-relaxed">
              {searchResponse.degradationNotice || 'The vector embedding sidecar is currently offline or uninitialized on textbase-server.'}
            </p>
          </div>

          <div className="bg-[#0b2921] rounded-xl p-4 max-w-lg mx-auto border border-emerald-500/20 text-left text-xs space-y-2 text-emerald-100">
            <p className="font-semibold text-white flex items-center space-x-1.5">
              <HelpCircle className="w-3.5 h-3.5 text-[#f59e0b]" />
              <span>Degradation Specification Note (Principle 4):</span>
            </p>
            <p className="text-emerald-100/80 leading-relaxed">
              Per specification, the client distinguishes vector offline state from "0 search matches" so users are never misled. 
              You can use Lucene, Grep, Title, or Author search in the meantime.
            </p>
            <div className="pt-2 flex justify-between items-center">
              <button
                onClick={() => setActiveMode('lucene')}
                className="px-3 py-1.5 bg-[#0f3d30] hover:bg-emerald-700/50 text-white rounded-lg text-xs font-semibold uppercase tracking-wider border border-emerald-500/30 cursor-pointer"
              >
                Switch to Full-Text (Lucene)
              </button>
              <button
                onClick={handleToggleVectorService}
                className="px-3 py-1.5 bg-[#f59e0b] hover:bg-amber-400 text-black rounded-lg text-xs font-bold uppercase tracking-wider cursor-pointer"
              >
                Reconnect Vector Sidecar
              </button>
            </div>
          </div>
        </div>
      ) : searchResponse.results.length === 0 ? (
        /* Case 2: Zero actual matches */
        <div className="bg-[#0b2921]/80 rounded-2xl border border-emerald-500/20 p-12 text-center space-y-3">
          <p className="text-emerald-200/80 text-sm">
            No matches found for "{query}"{combinedMode ? ' across all search modes' : ` under ${activeMode.toUpperCase()} search mode`}.
          </p>
          <p className="text-xs text-emerald-300/60">Try broadening your query, checking spelling, or switching search modes above.</p>
        </div>
      ) : (
        /* Case 3: Display Search Results */
        <div className="space-y-4">
          <div className="flex items-center justify-between text-xs text-emerald-200/60 font-mono">
            <span>Total results: {searchResponse.total} {searchResponse.total === 1 ? 'match' : 'matches'} {combinedMode ? 'across all 5 modes' : `in ${activeMode.toUpperCase()} mode`}</span>
            <div className="flex items-center gap-4">
              <button
                id="btn-save-search"
                type="button"
                disabled={searchSaveState === 'saving'}
                onClick={() => {
                  setSearchSaveState('saving');
                  saveSearch(query, combinedMode ? 'all' : activeMode, searchResponse.results)
                    .then(() => setSearchSaveState('saved'))
                    .catch(error => { console.warn('[saved-search] could not save', error); setSearchSaveState('failed'); });
                }}
                className="flex items-center space-x-1 text-xs font-sans font-bold text-amber-300 hover:text-white transition-colors cursor-pointer disabled:opacity-60"
              >
                <Bookmark className="w-3.5 h-3.5" fill={searchSaveState === 'saved' ? 'currentColor' : 'none'} />
                <span>{searchSaveState === 'saved' ? 'Search saved' : searchSaveState === 'failed' ? 'Could not save - retry' : 'Save search'}</span>
              </button>
              <span>Page {page} of {searchResponse.totalPages}</span>
            </div>
          </div>

          <div className="space-y-3">
            {searchResponse.results.map((item) => (
              <div
                key={item.id}
                id={`search-result-${item.id}`}
                className="bg-[#0b2921]/90 rounded-xl border border-emerald-500/20 p-5 shadow-sm hover:border-emerald-400/40 hover:bg-[#0d3329] transition-all flex flex-col justify-between group"
              >
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center space-x-2">
                      <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-emerald-950/60 text-[#f59e0b] border border-amber-500/25 font-bold">
                        {languageName(item.language)}
                      </span>
                      {item.type === 'author' && (
                        <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-amber-500/15 text-[#f59e0b] border border-amber-500/40 font-bold">
                          Author
                        </span>
                      )}
                      <span className="text-xs font-semibold text-emerald-200/70">
                        {item.authorName}
                      </span>
                    </div>

                    {item.score !== undefined && (
                      <span className="font-mono text-[10px] px-2 py-0.5 rounded bg-emerald-950/60 text-emerald-200/70 border border-emerald-500/20 font-bold">
                        Score: {item.score}
                      </span>
                    )}
                  </div>

                  <h3 
                    onClick={() => {
                      if (item.type === 'author') {
                        // An author hit opens the author's page - never a
                        // work route with a bogus id.
                        onSelectAuthor(item.authorId || item.workId);
                      } else if (item.chapterId) {
                        onSelectChapter(item.workId, item.chapterId);
                      } else {
                        onSelectWork(item.workId);
                      }
                    }}
                    className="font-display-title text-base sm:text-lg font-bold text-white group-hover:text-[#f59e0b] transition-colors cursor-pointer"
                  >
                    {item.workTitle}
                    {item.chapterTitle && <span className="font-normal text-emerald-200/60 font-serif-reading text-sm ml-2">— {item.chapterTitle}</span>}
                  </h3>

                  {/* Snippet representation */}
                  <div className="p-3 bg-[#051a14] rounded-lg border border-emerald-500/20 font-serif-reading text-sm text-emerald-100/90 leading-relaxed">
                    {item.matchLine && (
                      <span className="font-mono text-xs text-[#f59e0b] font-bold mr-2">
                        Line {item.matchLine}:
                      </span>
                    )}
                    «{highlightExcerpt(item.snippet, query)}»
                  </div>

                  {item.matchDetails && (
                    <p className="text-[11px] font-mono text-emerald-200/60">
                      {item.matchDetails}
                    </p>
                  )}
                </div>

                <div className="pt-3 mt-3 border-t border-emerald-500/15 flex items-center justify-between">
                  {item.type !== 'author' && (
                  <button
                    onClick={() => onOpenAddToCollection({
                      type: item.chapterId ? 'chapter' : 'work',
                      referenceId: item.chapterId || item.workId,
                      workId: item.workId,
                      workTitle: item.workTitle,
                      authorName: item.authorName,
                      chapterId: item.chapterId,
                      chapterTitle: item.chapterTitle
                    })}
                    aria-pressed={savedIds.has(item.chapterId || item.workId)}
                    className="text-xs text-emerald-200/70 hover:text-white flex items-center space-x-1 transition-colors cursor-pointer"
                  >
                    <Bookmark className="w-3.5 h-3.5 text-[#f59e0b]"
                      fill={savedIds.has(item.chapterId || item.workId) ? 'currentColor' : 'none'} />
                    <span>{savedIds.has(item.chapterId || item.workId) ? 'Saved' : 'Save Result'}</span>
                  </button>
                  )}

                  <button
                    onClick={() => {
                      if (item.type === 'author') {
                        // An author hit opens the author's page - never a
                        // work route with a bogus id.
                        onSelectAuthor(item.authorId || item.workId);
                      } else if (item.chapterId) {
                        onSelectChapter(item.workId, item.chapterId);
                      } else {
                        onSelectWork(item.workId);
                      }
                    }}
                    className="flex items-center space-x-1 px-3 py-1.5 rounded-lg bg-[#0f3d30] hover:bg-emerald-700/50 text-white border border-emerald-500/30 text-xs font-semibold uppercase tracking-wider transition-colors cursor-pointer"
                  >
                    <span>Read in Context</span>
                    <ChevronRight className="w-3.5 h-3.5 text-[#f59e0b]" />
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Pagination */}
          {searchResponse.totalPages > 1 && (
            <div className="flex items-center justify-between border-t border-emerald-500/20 pt-4">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                className="flex items-center space-x-1 px-3 py-1.5 rounded-lg border border-emerald-500/20 text-xs font-semibold text-emerald-200 hover:bg-emerald-500/15 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
              >
                <ChevronLeft className="w-4 h-4" />
                <span>Previous</span>
              </button>
              <span className="text-xs text-emerald-200/60 font-mono">
                Page {page} of {searchResponse.totalPages}
              </span>
              <button
                onClick={() => setPage(p => Math.min(searchResponse.totalPages, p + 1))}
                disabled={page === searchResponse.totalPages}
                className="flex items-center space-x-1 px-3 py-1.5 rounded-lg border border-emerald-500/20 text-xs font-semibold text-emerald-200 hover:bg-emerald-500/15 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
              >
                <span>Next</span>
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
