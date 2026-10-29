import React, { useEffect, useRef, useState } from "react";
import {
  BookMarked,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CreditCard,
  Filter,
  Hourglass,
  Lock,
  Search,
} from "lucide-react";
import { LanguageCode, Work } from "../types/textbase";
import { readerService } from "../services/readerService";
import { appAsset } from "../services/serversideApi";
import { PaymentCheckoutModal } from "./PaymentCheckoutModal";
import { SearchField } from "./SearchField";
import { WorkCoverImage } from "./DefaultWorkCover";

export interface WorksCatalogProps {
  works: Work[];
  page: number;
  totalPages: number;
  query: string;
  language: LanguageCode | "all";
  onQueryChange: (value: string) => void;
  onLanguageChange: (value: LanguageCode | "all") => void;
  onPageChange: (page: number) => void;
  onSelectWork: (id: string) => void;
  /** Enter/Space on a card: straight into the book at the reading
   *  position ("continue reading") - BrowseView resolves the bookmark and
   *  falls back to onSelectWork when there is no position yet. */
  onContinueReading: (id: string) => void;
  onSelectAuthor: (id: string) => void;
  onOpenAddToCollection: (item: {
    type: "work";
    referenceId: string;
    workId: string;
    workTitle: string;
    authorName: string;
  }) => void;
  isLoading?: boolean;
}

// The language filter offers the same curated subset the works toolbar
// The language filter offers the curated subset exposed by the works toolbar.
const LANGUAGE_FILTER_OPTIONS: { value: LanguageCode; label: string }[] = [
  { value: "lat", label: "Latin" },
  { value: "grc", label: "Ancient Greek" },
  { value: "ron", label: "Romanian" },
  { value: "eng", label: "English" },
  { value: "fra", label: "French" },
  { value: "deu", label: "German" },
  { value: "ita", label: "Italian" },
];

const estimatedReadLabel = (wordCount: number): string => {
  const minutes = Math.max(1, Math.ceil(wordCount / 200));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes === 0
    ? `${hours} hr`
    : `${hours} hr ${remainingMinutes} min`;
};

export const WorksCatalog: React.FC<WorksCatalogProps> = (props) => {
  const [checkoutWork, setCheckoutWork] = useState<Work | null>(null);
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
  const worksSignature = props.works.map((work) => work.id).join("|");

  useEffect(() => {
    if (pendingScrollY.current === null) return;
    const y = pendingScrollY.current;
    pendingScrollY.current = null;
    requestAnimationFrame(() => window.scrollTo({ top: y, behavior: "auto" }));
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
      new CustomEvent("reader-pagination-section", { detail: "works" }),
    );
    pendingScrollY.current = window.scrollY;
    setPaginationBusy(true);
    setPaginationBusyDirection(page > props.page ? "next" : "previous");
    paginationBusyTimer.current = window.setTimeout(() => {
      paginationBusyTimer.current = null;
      setPaginationBusy(false);
      setPaginationBusyDirection(null);
    }, 1400);
    props.onPageChange(page);
  };

  return (
    <div className="space-y-6">
      <div
        id="works-search-toolbar"
        className="bg-white/0.12 backdrop-blur-xl p-4 rounded-xl border border-white/30 shadow-[0_8px_32px_0_rgba(0,0,0,0.2)] flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4"
      >
        <SearchField
          id="input-filter-works"
          label="Filter works"
          className="flex-1 max-w-md"
          value={props.query}
          onValueChange={props.onQueryChange}
          placeholder="Filter works by title, author, topic..."
          inputClassName="py-2 rounded-lg bg-black/25 border border-white/25 text-xs text-white placeholder:text-white/60 focus:outline-none focus:ring-1 focus:ring-[#f59e0b]"
        />
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center space-x-1.5">
            <Filter className="w-3.5 h-3.5 text-white/70" />
            <span className="text-xs font-medium text-white/90">Language:</span>
            <select
              id="select-work-language"
              value={props.language}
              onChange={(e) =>
                props.onLanguageChange(e.target.value as LanguageCode | "all")
              }
              className="text-xs bg-black/30 border border-white/25 rounded-lg px-2.5 py-1.5 text-white"
            >
              <option value="all">All Languages</option>
              {LANGUAGE_FILTER_OPTIONS.map(({ value, label }) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {props.isLoading && props.works.length === 0 ? (
        <div className="min-h-56 rounded-2xl border border-white/15 bg-white/8 backdrop-blur-xl flex flex-col items-center justify-center gap-3 text-emerald-100/80">
          <Hourglass
            className="w-7 h-7 text-amber-300 animate-pulse"
            aria-hidden="true"
          />
          <span className="text-xs font-mono uppercase tracking-widest">
            Loading works…
          </span>
        </div>
      ) : (
        <div className="overflow-hidden">
          <div
            key={`works-page-${worksSignature}`}
            className={`grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 works-page-enter-${pageDirection}`}
          >
            {props.works.map((work) => {
              const premium = work.accessType === "premium";
              const unlocked = readerService.isWorkUnlocked(work.id);
              const price = `$${((work.priceCents || 499) / 100).toFixed(2)}`;
              const coverImage = work.coverImage;
              return (
                <div
                  key={work.id}
                  id={`card-work-${work.id}`}
                  role="link"
                  tabIndex={0}
                  aria-label={`Open ${work.title}`}
                  onClick={() => props.onSelectWork(work.id)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      // Keyboard activation continues reading directly -
                      // the mouse click still opens the work card page.
                      props.onContinueReading(work.id);
                    }
                  }}
                  className="bg-[#061d28]/95 rounded-xl border border-emerald-500/20 shadow-md hover:border-amber-500/50 hover:bg-[#082b3a] transition-all flex flex-col justify-between overflow-hidden group cursor-pointer focus:outline-none focus:ring-2 focus:ring-amber-400/80"
                >
                  <div>
                    <div
                      className={`h-2 ${premium ? "bg-linear-to-r from-amber-400 via-amber-600 to-amber-500" : "bg-linear-to-r from-emerald-500 via-teal-600 to-emerald-600"}`}
                    />
                    <div className="flex items-stretch">
                      <div className="min-w-0 flex-1 p-5">
                        <div className="flex items-start justify-between gap-2 mb-2">
                          {premium ? (
                            unlocked ? (
                              <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                                <CheckCircle2 className="w-3 h-3" />
                                <span>Unlocked</span>
                              </span>
                            ) : (
                              <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40 font-mono">
                                <Lock className="w-2.5 h-2.5" />
                                <span>{price} Premium</span>
                              </span>
                            )
                          ) : null}
                        </div>
                        <h3
                          className="font-display-title text-lg font-bold text-white group-hover:text-[#f59e0b] transition-colors cursor-pointer line-clamp-1"
                        >
                          {work.title}
                        </h3>
                        <p
                          onClick={(event) => {
                            event.stopPropagation();
                            props.onSelectAuthor(work.authorId);
                          }}
                          className="text-xs font-semibold text-[#f59e0b] hover:underline cursor-pointer mb-3"
                        >
                          by {work.authorName}
                        </p>
                        {work.summary && (
                          <p className="text-xs text-emerald-100/70 line-clamp-3 mb-4 leading-relaxed font-serif-reading">
                            {work.summary}
                          </p>
                        )}
                        <div className="flex flex-wrap gap-1 mb-4">
                          {work.tags.slice(0, 3).map((tag) => (
                            <span
                              key={tag}
                              className="text-[10px] px-2 py-0.5 rounded bg-emerald-950/50 text-emerald-200/70 border border-emerald-500/20"
                            >
                              #{tag}
                            </span>
                          ))}
                        </div>
                      </div>
                      <div className="w-28 sm:w-32 shrink-0 self-stretch bg-black/20">
                        <WorkCoverImage
                          src={coverImage}
                          title={work.title}
                          author={work.authorName}
                          className="h-full min-h-44 w-full"
                        />
                      </div>
                    </div>
                  </div>
                  <div className="px-5 py-3 bg-black/20 border-t border-emerald-500/15 flex items-center justify-between text-xs">
                    <span className="text-emerald-200/60 font-mono text-[11px]">
                      {work.chapterCount}{" "}
                      {work.chapterCount === 1 ? "chapter" : "chapters"} •{" "}
                      Estimated read: {estimatedReadLabel(work.sizeWords)}
                    </span>
                    <div className="flex items-center space-x-1.5">
                      <button
                        id={`btn-add-col-${work.id}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          props.onOpenAddToCollection({
                            type: "work",
                            referenceId: work.id,
                            workId: work.id,
                            workTitle: work.title,
                            authorName: work.authorName,
                          });
                        }}
                        title="Add work to collection"
                        className="p-1.5 text-emerald-200/60 hover:text-white hover:bg-emerald-500/20 rounded-lg transition-colors cursor-pointer"
                      >
                        <BookMarked className="w-4 h-4" />
                      </button>
                      {premium && !unlocked ? (
                        <div className="flex items-center space-x-1">
                          <button
                            id={`btn-unlock-work-${work.id}`}
                            onClick={(event) => {
                              event.stopPropagation();
                              setCheckoutWork(work);
                            }}
                            title="Unlock Complete Critical Edition"
                            className="flex items-center space-x-1 px-2.5 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-stone-950 font-bold text-xs shadow-xs transition-colors cursor-pointer"
                          >
                            <CreditCard className="w-3.5 h-3.5" />
                            <span>Unlock {price}</span>
                          </button>
                          <button
                            id={`btn-preview-work-${work.id}`}
                            onClick={(event) => {
                              event.stopPropagation();
                              props.onSelectWork(work.id);
                            }}
                            title="Read Free Preview"
                            className="px-2 py-1.5 rounded-lg bg-[#0f3d30] hover:bg-emerald-700/50 text-white font-medium text-xs border border-emerald-500/30 transition-colors cursor-pointer"
                          >
                            <span>Preview</span>
                          </button>
                        </div>
                      ) : (
                        <button
                          id={`btn-open-work-${work.id}`}
                          onClick={(event) => {
                            event.stopPropagation();
                            props.onSelectWork(work.id);
                          }}
                          className="flex items-center space-x-1 px-3 py-1.5 rounded-lg bg-[#0f3d30] hover:bg-emerald-700/50 text-white font-medium text-xs border border-emerald-500/30 transition-colors cursor-pointer"
                        >
                          <span>Read</span>
                          <ChevronRight className="w-3.5 h-3.5 text-[#f59e0b]" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
      {props.totalPages > 1 && (
        <div className="flex items-center justify-between border-t border-emerald-500/20 pt-4">
          <button
            id="btn-works-prev-page"
            disabled={props.page === 1 || paginationBusy}
            aria-busy={paginationBusyDirection === "previous"}
            onClick={() =>
              changePagePreservingPosition(Math.max(1, props.page - 1))
            }
            className={`flex items-center space-x-1 px-3 py-1.5 rounded-lg bg-emerald-950/80 text-xs text-white active:scale-90 active:ring-2 active:ring-amber-300 active:bg-amber-500/30 transition-all disabled:cursor-not-allowed disabled:opacity-30 ${paginationBusyDirection === "previous" ? "ring-2 ring-amber-300/80 bg-amber-500/20 text-amber-100" : ""}`}
          >
            <ChevronLeft className="w-4 h-4" />
            Previous
          </button>
          <span className="text-xs font-mono text-emerald-200/70">
            Page {props.page} of {props.totalPages}
          </span>
          <button
            id="btn-works-next-page"
            disabled={props.page >= props.totalPages || paginationBusy}
            aria-busy={paginationBusyDirection === "next"}
            onClick={() =>
              changePagePreservingPosition(
                Math.min(props.totalPages, props.page + 1),
              )
            }
            className={`flex items-center space-x-1 px-3 py-1.5 rounded-lg bg-emerald-950/80 text-xs text-white active:scale-90 active:ring-2 active:ring-amber-300 active:bg-amber-500/30 transition-all disabled:cursor-not-allowed disabled:opacity-30 ${paginationBusyDirection === "next" ? "ring-2 ring-amber-300/80 bg-amber-500/20 text-amber-100" : ""}`}
          >
            Next
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}

      <PaymentCheckoutModal
        work={checkoutWork}
        isOpen={!!checkoutWork}
        onClose={() => setCheckoutWork(null)}
        onSuccess={() => setCheckoutWork(null)}
      />
    </div>
  );
};
