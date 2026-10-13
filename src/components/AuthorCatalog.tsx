import React, { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { SearchField } from './SearchField';
import { Author } from '../types/textbase';

export interface AuthorCatalogProps {
  authorsData: { authors: Author[]; total: number; totalPages: number };
  query: string;
  page: number;
  onQueryChange: (query: string) => void;
  onPageChange: (page: number) => void;
  onSelectAuthor: (authorId: string) => void;
}

export const AuthorCatalog: React.FC<AuthorCatalogProps> = props => {
  // The works catalog's own pagination machinery, copied here wholesale:
  // a busy latch with a cooldown matching the page-enter animation, so a
  // rapid double-click cannot race the URL-backed page state (the stale
  // page arithmetic was exactly the "next jumps somewhere strange" bug),
  // a direction-aware enter animation on the grid, and the
  // reader-pagination-section event BrowseView's arrow keys route by.
  const [paginationBusy, setPaginationBusy] = useState(false);
  const [paginationBusyDirection, setPaginationBusyDirection] = useState<
    "next" | "previous" | null
  >(null);
  const pendingScrollY = useRef<number | null>(null);
  const paginationBusyTimer = useRef<number | null>(null);
  const previousPage = useRef(props.page);
  const pageDirection =
    props.page >= previousPage.current ? "next" : "previous";
  if (props.page !== previousPage.current) previousPage.current = props.page;

  // Pagination is URL-backed and therefore causes a render of the catalog.
  // Restore the position captured by the button click after the new page is
  // painted, so advancing through authors does not throw the reader back to
  // the top of the catalog.
  useEffect(() => {
    if (pendingScrollY.current === null) return;
    const y = pendingScrollY.current;
    pendingScrollY.current = null;
    requestAnimationFrame(() => window.scrollTo({ top: y, behavior: 'auto' }));
  }, [props.page]);

  useEffect(
    () => () => {
      if (paginationBusyTimer.current !== null)
        window.clearTimeout(paginationBusyTimer.current);
    },
    [],
  );

  const changePagePreservingPosition = (page: number) => {
    if (paginationBusy || page === props.page) return;
    window.dispatchEvent(
      new CustomEvent('reader-pagination-section', { detail: 'authors' }),
    );
    pendingScrollY.current = window.scrollY;
    setPaginationBusy(true);
    setPaginationBusyDirection(page > props.page ? 'next' : 'previous');
    paginationBusyTimer.current = window.setTimeout(() => {
      paginationBusyTimer.current = null;
      setPaginationBusy(false);
      setPaginationBusyDirection(null);
    }, 1400);
    props.onPageChange(page);
  };

  const { authorsData, query, page, onSelectAuthor } = props;
  return <div className="space-y-6">
    <div className="bg-white/12 backdrop-blur-xl p-4 rounded-xl border border-white/30 shadow-[0_8px_32px_0_rgba(0,0,0,0.2)] flex items-center justify-between">
        <SearchField
          id="input-filter-authors"
          label="Search authors"
          className="flex-1 max-w-md"
          placeholder="Search author catalog by name, canonical ID, era..."
          value={query}
          onValueChange={props.onQueryChange}
          inputClassName="py-2 rounded-lg bg-black/25 border border-white/25 text-xs text-white placeholder:text-white/60 focus:outline-none focus:ring-1 focus:ring-[#f59e0b]"
        />
    </div>


    <div className={`grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 works-page-enter-${pageDirection}`}>
      {authorsData.authors.map(author => {
        const dates = [author.birthDate || author.birthYear, author.deathDate || author.deathYear].filter(Boolean).join(' – ');
        const facts = [
          dates,
          author.birthPlace && `Born ${author.birthPlace}`,
          author.country,
          author.writingLanguage && `Writes in ${author.writingLanguage}`
        ].filter(Boolean).join(' • ');
        return (
        <div key={author.id} id={`card-author-${author.id}`} onClick={() => onSelectAuthor(author.id)}
          className="bg-[#0b2921]/80 rounded-xl border border-emerald-500/20 shadow-md hover:border-amber-500/50 hover:bg-[#0e332a] transition-all cursor-pointer flex flex-col justify-between group overflow-hidden">
          <div>
            <div className="relative w-full aspect-4/3 overflow-hidden border-b border-emerald-500/20">
              {author.imageHref ? <img src={author.imageHref} alt="" className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-300" /> :
                <span className="w-full h-full bg-amber-500/15 text-[#f59e0b] flex items-center justify-center font-display-title font-bold text-4xl">{author.name.slice(0, 2).toUpperCase()}</span>}
              <span className="absolute bottom-3 left-3 font-mono text-[10px] px-2 py-0.5 rounded bg-black/60 text-emerald-100 border border-white/20">{author.canonicalId}</span>
            </div>
            <div className="p-5">
              <h3 className="font-display-title text-base font-bold text-white group-hover:text-[#f59e0b] transition-colors mb-1">{author.name}</h3>
              {facts && <p className="text-xs text-emerald-200/60 mb-2 font-serif-reading italic">{facts}</p>}
              {author.bio && <p className="text-xs text-emerald-100/70 line-clamp-3 leading-relaxed mb-3 font-serif-reading">{author.bio}</p>}
            </div>
          </div>
          <div className="mx-5 pt-3 pb-5 border-t border-emerald-500/15 flex items-center justify-between text-xs">
            <span className="text-[#f59e0b] font-medium text-[11px] font-mono">{author.worksCount} {author.worksCount === 1 ? 'Work' : 'Works'} in TEI</span>
            <ChevronRight className="w-4 h-4 text-emerald-300/50 group-hover:text-white transition-transform group-hover:translate-x-1" />
          </div>
        </div>
        );
      })}
    </div>


    {authorsData.totalPages > 1 && <div className="flex items-center justify-between border-t border-emerald-500/20 pt-4">
      <button id="btn-authors-prev-page" onClick={() => changePagePreservingPosition(Math.max(1, page - 1))}
        disabled={page === 1 || paginationBusy} aria-busy={paginationBusyDirection === 'previous'}
        className={`flex items-center space-x-1 px-3 py-1.5 rounded-lg bg-emerald-950/80 text-xs text-white active:scale-90 active:ring-2 active:ring-amber-300 active:bg-amber-500/30 transition-all disabled:cursor-not-allowed disabled:opacity-30 ${paginationBusyDirection === 'previous' ? 'ring-2 ring-amber-300/80 bg-amber-500/20 text-amber-100' : ''}`}>
        <ChevronLeft className="w-4 h-4" /><span>Previous</span></button>
      <span className="text-xs text-emerald-200/60 font-mono">Page {page} of {authorsData.totalPages}</span>
      <button id="btn-authors-next-page" onClick={() => changePagePreservingPosition(Math.min(authorsData.totalPages, page + 1))}
        disabled={page === authorsData.totalPages || paginationBusy} aria-busy={paginationBusyDirection === 'next'}
        className={`flex items-center space-x-1 px-3 py-1.5 rounded-lg bg-emerald-950/80 text-xs text-white active:scale-90 active:ring-2 active:ring-amber-300 active:bg-amber-500/30 transition-all disabled:cursor-not-allowed disabled:opacity-30 ${paginationBusyDirection === 'next' ? 'ring-2 ring-amber-300/80 bg-amber-500/20 text-amber-100' : ''}`}>
        <span>Next</span><ChevronRight className="w-4 h-4" /></button>
    </div>}
  </div>;
};
