import { searchTargetPath } from '../services/searchTargets';
import { createPortal } from 'react-dom';
import { useEffect, useRef, useState } from 'react';
import { Bookmark, ChevronLeft, ChevronRight, Sparkles, X } from 'lucide-react';
import { readerService } from '../services/readerService';
import { saveSearch } from '../services/savedSearches';
import type { SearchResult } from '../types/textbase';

type SearchPage = Awaited<ReturnType<typeof readerService.searchConnected>>;
const PAGE_SIZE = 8;
export function ReaderSimilarityDialog({ query, onClose, onSelect }: {
  query: string; onClose: () => void; onSelect: (result: SearchResult) => void;
}) {
  const [page, setPage] = useState(1);
  const [response, setResponse] = useState<SearchPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle');
  const seen = useRef(new Map<string, SearchResult>());
  const requests = useRef(new Map<string, Promise<SearchPage>>());
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    return () => previous?.focus();
  }, []);
  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(''); setResponse(null);
    const key = JSON.stringify([query, page, attempt]);
    let request = requests.current.get(key);
    if (!request) {
      request = readerService.searchConnected('vector', query, { page, pageSize: PAGE_SIZE, throwOnError: true, probeNextPage: true });
      requests.current.set(key, request);
    }
    request.then(result => {
        if (cancelled) return;
        if (result.vectorUnavailable) { setError(result.degradationNotice || 'Semantic search is temporarily unavailable.'); return; }
        result.results.forEach(hit => seen.current.set(searchTargetPath(hit), hit));
        setResponse(result);
      })
      .catch(() => { if (!cancelled) setError('Semantic search could not be completed. Please retry.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [query, page, attempt]);
  useEffect(() => {
    // A clicked control may be blurred by the application's global focus policy.
    // Keep modal navigation separate from the reader's chapter arrow shortcuts.
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); }
      else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault(); event.stopPropagation();
        if (loading) return;
        if (event.key === 'ArrowLeft' && page > 1) setPage(value => value - 1);
        if (event.key === 'ArrowRight' && response && page < response.totalPages) setPage(value => value + 1);
      } else if (event.key === 'Tab' && !document.activeElement?.closest('#reader-similarity-dialog')) {
        event.preventDefault(); event.stopPropagation(); closeRef.current?.focus();
      }
    };
    document.addEventListener('keydown', key, true);
    return () => document.removeEventListener('keydown', key, true);
  }, [page, response, loading, onClose]);
  const save = async () => {
    setSaveState('saving');
    try { await saveSearch(query, 'vector', [...seen.current.values()]); setSaveState('saved'); }
    catch { setSaveState('failed'); }
  };
  return createPortal(<div id="reader-similarity-dialog" className="fixed inset-0 z-[60] flex items-center justify-center p-4 sm:p-6 bg-black/75 backdrop-blur-md animate-in fade-in duration-200"
    onClick={event => { if (event.target === event.currentTarget) onClose(); }}
    onTouchStart={event => event.stopPropagation()} onTouchMove={event => event.stopPropagation()} onTouchEnd={event => event.stopPropagation()}
    onKeyDownCapture={event => {
      event.stopPropagation();
      if (event.key === 'Escape') { event.preventDefault(); onClose(); }
      if (event.key === 'ArrowRight') { event.preventDefault(); if (!loading && response && page < response.totalPages) setPage(value => value + 1); }
      if (event.key === 'ArrowLeft') { event.preventDefault(); if (!loading && page > 1) setPage(value => value - 1); }
      if (event.key === 'Tab') {
        const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
        const first = buttons[0], last = buttons.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    }}>
    <section role="dialog" aria-modal="true" aria-labelledby="reader-similarity-title"
      className="relative w-full max-w-2xl bg-[#061d28]/95 border border-white/20 rounded-2xl shadow-[0_16px_48px_0_rgba(0,0,0,0.5)] overflow-hidden text-white flex flex-col max-h-[90vh]">
      <header className="flex items-center justify-between px-6 py-4 border-b border-white/15 bg-white/[0.04]">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-[#f59e0b]"><Sparkles className="w-4 h-4" /></div>
          <div><h2 id="reader-similarity-title" className="text-sm font-bold tracking-wide uppercase">Similar passages</h2><p className="text-[11px] text-white/60">Semantic search across the library</p></div>
        </div>
        <button ref={closeRef} aria-label="Close similar passages" onClick={onClose} className="p-1.5 rounded-lg text-white/60 hover:text-white hover:bg-white/10 cursor-pointer"><X className="w-5 h-5" /></button>
      </header>
      <p className="px-6 py-3 text-xs text-white/70 border-b border-white/15 line-clamp-3 shrink-0" title={query}>{query}</p>
      <div className="overflow-y-auto flex-1 min-h-0 divide-y divide-emerald-500/15" aria-busy={loading}>
        {loading && <p role="status" className="p-6 text-sm text-white/70">Finding similar passages…</p>}
        {error && <div className="p-6 space-y-3"><p role="alert">{error}</p><button onClick={() => setAttempt(value => value + 1)} className="text-amber-300 cursor-pointer">Retry search</button></div>}
        {!loading && !error && response?.results.length === 0 && <p className="p-6 text-sm text-white/70">No similar passages found.</p>}
        {!loading && response?.results.map((hit, index) => <button key={hit.id} type="button" data-similarity-result
          onClick={() => onSelect(hit)} className="w-full p-4 sm:p-5 text-left hover:bg-emerald-500/10 transition-colors flex items-start gap-4 group cursor-pointer">
          <span className="w-8 h-8 rounded-lg font-mono font-bold text-xs flex items-center justify-center shrink-0 border bg-amber-500/15 text-[#f59e0b] border-amber-500/30">{(page - 1) * PAGE_SIZE + index + 1}</span>
          <div className="min-w-0 space-y-1"><h3 className="font-display-title text-sm sm:text-base font-bold group-hover:text-[#f59e0b]">{hit.workTitle}</h3><p className="text-xs text-white/60">{hit.authorName}{hit.chapterTitle ? ` — ${hit.chapterTitle}` : ''}</p><p className="text-sm text-white/80 whitespace-pre-line">{hit.snippet}</p></div>
        </button>)}
      </div>
      <footer className="px-4 sm:px-6 py-3 border-t border-white/15 flex flex-wrap items-center justify-between gap-3 text-xs shrink-0">
        <button id="btn-reader-save-similarity" onClick={() => void save()} disabled={loading || !response?.results.length || saveState === 'saving' || saveState === 'saved'} className="flex items-center gap-1.5 text-amber-300 font-bold cursor-pointer disabled:opacity-60"><Bookmark className="w-3.5 h-3.5" /><span>{saveState === 'saved' ? 'Search saved' : saveState === 'saving' ? 'Saving…' : saveState === 'failed' ? 'Could not save — retry' : 'Save search'}</span></button>
        <div className="flex items-center gap-3"><button aria-label="Previous similar results" disabled={loading || page <= 1} onClick={() => setPage(value => value - 1)} className="p-1 cursor-pointer disabled:opacity-30"><ChevronLeft className="w-4 h-4" /></button><span>Page {page} of {response?.totalPages || page}</span><button aria-label="Next similar results" disabled={loading || !response || page >= response.totalPages} onClick={() => setPage(value => value + 1)} className="p-1 cursor-pointer disabled:opacity-30"><ChevronRight className="w-4 h-4" /></button></div>
      </footer>
    </section>
  </div>, document.body);
}
