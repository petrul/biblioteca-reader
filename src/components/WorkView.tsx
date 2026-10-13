import React, { useState, useEffect } from 'react';
import { 
  ArrowLeft, 
  BookOpen, 
  User as UserIcon, 
  Globe, 
  FileCode, 
  Layers, 
  Bookmark, 
  Sparkles, 
  ChevronRight, 
  Info,
  GitBranch,
  FileText,
  Lock,
  CreditCard,
  CheckCircle2,
  ShieldCheck,
  X
} from 'lucide-react';
import { Work, Chapter, LanguageCode } from '../types/textbase';
import { readerService } from '../services/readerService';
import { bookmarkStoreFor } from '../services/identity';
import { isTypingBurst, noteLetterKey } from '../services/typingBurst';
import { bibliotecaExternalUrl, davLanguageSegment } from '../services/serversideApi';
import { languageName } from '../services/languageNames';
import { PaymentCheckoutModal } from './PaymentCheckoutModal';
import { WorkCoverImage } from './DefaultWorkCover';
import { AdminCoverSection } from './AdminCoverSection';
import { NotFoundCard } from './NotFoundCard';
import { isPreviewPage } from '../services/tocTree';

interface WorkViewProps {
  workId: string;
  // Which BookmarkStore backend to check for a saved reading position -
  // see services/bookmarkStore.ts/identity.ts.
  reallySignedIn: boolean;
  onBack: () => void;
  onSelectAuthor: (authorId: string) => void;
  onSelectChapter: (workId: string, chapterId: string) => void;
  onMoreLikeThis: (workId: string, title: string) => void;
  onOpenAddToCollection: (item: { type: 'work' | 'chapter'; referenceId: string; workId: string; workTitle: string; authorName: string; chapterId?: string; chapterTitle?: string }) => void;
  // App.tsx mutes the global "Refreshing catalogue..." toast while this is
  // true - that background-refresh reminder reads as nonsensical noise
  // layered on top of a page that's explaining the work doesn't exist.
  onNotFoundChange?: (notFound: boolean) => void;
  // Shows the cover admin section on the back face (AdminCoverSection);
  // the server-side proxy enforces it independently.
  isAdmin?: boolean;
}

export const WorkView: React.FC<WorkViewProps> = ({
  workId,
  reallySignedIn,
  onBack,
  onSelectAuthor,
  onSelectChapter,
  onMoreLikeThis,
  onOpenAddToCollection,
  onNotFoundChange,
  isAdmin = false
}) => {
  const [showCheckoutModal, setShowCheckoutModal] = useState(false);
  const [showTocModal, setShowTocModal] = useState(false);
  const [purchaseRefreshKey, setPurchaseRefreshKey] = useState(0);
  // Flips the header card to reveal TEI/storage technical metadata -
  // deliberately kept off the front face (see the Info-icon toggle
  // below), same rotate-y-180 pattern as ReaderView's chapter stats flip.
  const [showTechnicalData, setShowTechnicalData] = useState(false);
  // Which serializations the back face's DAV mount links expose - one
  // mountable dav:// directory per checked format (the DAV export's format
  // is a path segment, so a book in two formats is two mounts, not one).
  const [davFormats, setDavFormats] = useState<Record<'txt' | 'json' | 'xml', boolean>>({ txt: true, json: false, xml: false });
  // "resume where you left off" - see services/bookmarkStore.ts. null while
  // still checking, '' once checked and found nothing (distinct from "still
  // checking" so the button doesn't flash between labels).
  const [resumeChapterId, setResumeChapterId] = useState<string | null | ''>(null);

  useEffect(() => {
    const handlePurchasesChanged = () => {
      setPurchaseRefreshKey(prev => prev + 1);
    };
    window.addEventListener('textbase-purchases-changed', handlePurchasesChanged);
    return () => window.removeEventListener('textbase-purchases-changed', handlePurchasesChanged);
  }, []);

  // Keyboard flip for the header card, mirroring its Info/X icon buttons:
  // i toggles between the faces, Escape or x turns back to the overview.
  // Do not steal the keys while the user is typing in an editable control
  // (same guard as the navbar's global / shortcut) - or in the middle of
  // typing a word with no focused input at all (typingBurst guard: 'i'
  // inside "right" must not flip the card).
  useEffect(() => {
    const handleFlipKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.matches('input, textarea, select, [contenteditable="true"]')) return;
      if (event.key.length === 1 && /[a-z]/i.test(event.key)) {
        if (isTypingBurst()) return;
        noteLetterKey();
      }
      if (event.key === 'i') {
        event.preventDefault();
        setShowTechnicalData(prev => !prev);
      } else if ((event.key === 'Escape' || event.key === 'x') && showTechnicalData) {
        event.preventDefault();
        setShowTechnicalData(false);
      }
    };
    window.addEventListener('keydown', handleFlipKey);
    return () => window.removeEventListener('keydown', handleFlipKey);
  }, [showTechnicalData]);

  const work = readerService.getWorkById(workId);
  // Not found = no work AND nothing in flight for it (the deep-link fetch
  // concluded - 404 or terminal failure), mirroring ReaderView's
  // isGenuinelyNotFound. The old isRealCatalogSettled() gate is gone with
  // the once-loaded catalog: deep-linked works fetch independently now.
  const isGenuinelyNotFound = !work && !readerService.isWorkLoading(workId);
  useEffect(() => {
    onNotFoundChange?.(isGenuinelyNotFound);
    return () => onNotFoundChange?.(false);
  }, [isGenuinelyNotFound, onNotFoundChange]);
  const chapters = work ? readerService.getChaptersForWork(work.id) : [];
  const isUnlocked = work ? readerService.isWorkUnlocked(work.id) : false;
  const isPremium = work?.accessType === 'premium';
  const priceStr = `$${(((work?.priceCents || 499)) / 100).toFixed(2)}`;

  // Mountable dav:// directories for this book, one per checked format:
  // the server's DAV export in its path-configured form (mount-safe - no
  // query strings), fragmentation 1.1 so the book opens as a directory of
  // chapter files. Clicking hands the URL to the platform's DAV mounter
  // (GNOME Files/GVfs and friends).
  const davExternal = bibliotecaExternalUrl();
  const davLinks = (() => {
    if (!davExternal || !work) return [] as Array<{ format: 'txt' | 'json' | 'xml'; url: string }>;
    let host: string;
    try { host = new URL(davExternal).host; } catch { return []; }
    const [authorId, opusId] = work.id.split('/');
    const lang = davLanguageSegment(work.detectedLanguage);
    if (!authorId || !opusId || !lang) return [];
    return (['txt', 'json', 'xml'] as const)
      .filter(format => davFormats[format])
      .map(format => ({
        format,
        url: `dav://${host}/dav/_export/${format}/1.1/all/all/${encodeURIComponent(lang)}/${encodeURIComponent(authorId)}/${encodeURIComponent(opusId)}/`
      }));
  })();

  useEffect(() => {
    setResumeChapterId(null);
    let cancelled = false;
    void bookmarkStoreFor(reallySignedIn).get(workId).then((position) => {
      if (!cancelled) setResumeChapterId(position?.divPath ?? '');
    });
    return () => { cancelled = true; };
  }, [workId, reallySignedIn]);

  // Only actually resume-worthy if that chapter still exists in this
  // work's current TOC (content can be re-imported/restructured).
  const resumeChapter = resumeChapterId ? chapters.find(c => c.id === resumeChapterId) : undefined;

  if (!work) {
    // Wait only for this work's targeted request before showing not found.
    if (readerService.isWorkLoading(workId)) {
      return (
        <div className="fixed inset-0 z-50 flex items-center justify-center animate-in fade-in duration-200">
          <span className="w-9 h-9 border-[3px] border-[#f59e0b] border-t-transparent rounded-full animate-spin"></span>
        </div>
      );
    }
    return (
      <NotFoundCard
        message="Whatever you were looking for isn't where this link said it would be — moved, renamed, or never catalogued here at all."
        primaryLabel="Back"
        onPrimary={onBack}
      />
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Back button */}
      <button
        id="btn-work-back"
        onClick={onBack}
        className="inline-flex items-center space-x-1.5 text-xs font-semibold text-white hover:text-amber-300 transition-colors mb-6 group cursor-pointer"
      >
        <ArrowLeft className="w-4 h-4 transition-transform group-hover:-translate-x-1" />
        <span>Back</span>
      </button>

      {/* Main Work Header Card - flips to reveal TEI/storage technical
          metadata on the back, kept off the front face on purpose. */}
      <div className="relative mb-8">
        <div className="[perspective:1500px]">
          <div className={`relative transition-transform duration-700 ease-in-out transform-3d ${showTechnicalData ? 'rotate-y-180' : ''}`}>
            {/* FRONT FACE: title, author, actions, synopsis - no technical data */}
            <div className="relative backface-hidden bg-scriptorium-blue rounded-2xl border border-emerald-500/20 p-6 sm:p-8 shadow-xl">
              <button
                id="btn-work-flip-technical-front"
                type="button"
                onClick={() => setShowTechnicalData(true)}
                className="absolute top-1 right-1 z-10 p-1.5 rounded-full text-emerald-200/70 hover:text-white hover:bg-black/20 transition-colors cursor-pointer"
                title="TEI corpus & storage metadata (i)"
                aria-label="Show technical metadata"
              >
                <Info className="w-4 h-4" />
              </button>
              <div className="flex flex-col md:flex-row items-start justify-between gap-6 pb-6 border-b border-emerald-500/15">
          <div className="w-full md:w-36 shrink-0 order-2 md:order-1">
            <div className="aspect-[5/8] overflow-hidden rounded-xl border border-amber-500/25 bg-black/20 shadow-lg">
              <WorkCoverImage src={work.coverImage} title={work.title} author={work.authorName} alt={`Cover for ${work.title}`} className="h-full w-full" imgClassName="object-cover" />
            </div>
          </div>
          <div className="space-y-2 max-w-2xl">
            <div className="flex flex-wrap items-center gap-2">
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-950/60 text-[#f59e0b] border border-amber-500/25">
                {languageName(work.detectedLanguage)}
              </span>
              <span className="text-[10px] font-mono text-emerald-200/70 bg-emerald-950/60 px-2 py-0.5 rounded border border-emerald-500/20">
                {work.origDate || 'Classical Era'}
              </span>

              {isPremium ? (
                isUnlocked ? (
                  <span className="inline-flex items-center space-x-1 text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                    <CheckCircle2 className="w-3 h-3" />
                    <span>Unlocked Critical Edition</span>
                  </span>
                ) : (
                  <span className="inline-flex items-center space-x-1 text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40 font-mono">
                    <Lock className="w-2.5 h-2.5" />
                    <span>{priceStr} Premium Edition</span>
                  </span>
                )
              ) : (
                <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-300/80 border border-emerald-500/20 font-mono">
                  Free Public Domain
                </span>
              )}
            </div>

            <h1 className="font-display-title text-2xl sm:text-3xl font-bold text-white leading-tight">
              {work.title}
            </h1>

            {work.subtitle && (
              <p className="text-sm font-serif-reading italic text-emerald-200/60">
                {work.subtitle}
              </p>
            )}

            <div className="pt-1">
              <span className="text-xs text-emerald-100/70">Authored by </span>
              <button
                id="btn-work-author-link"
                onClick={() => onSelectAuthor(work.authorId)}
                className="text-sm font-bold text-[#f59e0b] hover:underline inline-flex items-center space-x-1 cursor-pointer"
              >
                <span>{work.authorName}</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Quick Action Buttons */}
          <div className="flex flex-col sm:flex-row md:flex-col gap-2 w-full md:w-auto">
            {isPremium && !isUnlocked ? (
              <button
                id="btn-work-unlock-stripe"
                onClick={() => setShowCheckoutModal(true)}
                className="flex items-center justify-center space-x-2 px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-stone-950 font-bold text-xs uppercase tracking-wider shadow-lg shadow-amber-950/40 transition-all cursor-pointer"
              >
                <CreditCard className="w-4 h-4 text-black" />
                <span>Unlock Edition ({priceStr})</span>
              </button>
            ) : null}

            {work && (
              <button
                id="btn-read-first-chapter"
                disabled={chapters.length === 0}
                onClick={() => {
                  if (chapters.length === 0) return;
                  onSelectChapter(work.id, (resumeChapter && !(isPremium && !isUnlocked)) ? resumeChapter.id : chapters[0].id);
                }}
                className="flex items-center justify-center space-x-2 px-5 py-2.5 rounded-xl bg-[#f59e0b] hover:bg-amber-400 disabled:opacity-70 disabled:cursor-wait text-black font-bold text-xs uppercase tracking-wider shadow-md shadow-amber-950/30 transition-all cursor-pointer"
              >
                <BookOpen className="w-4 h-4 text-black" />
                <span>
                  {chapters.length === 0
                    ? 'Loading chapters…'
                    : isPremium && !isUnlocked
                    ? 'Read Free Preview (Ch. 1)'
                    : resumeChapter ? `Continue Reading (${resumeChapter.title})` : 'Read First Chapter'}
                </span>
              </button>
            )}

            {chapters.length > 0 && (
              <button
                id="btn-open-toc-modal"
                onClick={() => setShowTocModal(true)}
                className="flex items-center justify-center space-x-2 px-5 py-2.5 rounded-xl bg-[#f59e0b] hover:bg-amber-400 text-black font-bold text-xs uppercase tracking-wider shadow-md shadow-amber-950/30 transition-all cursor-pointer"
              >
                <Layers className="w-4 h-4 text-black" />
                <span>Table of Contents</span>
              </button>
            )}

            <button
              id="btn-more-like-this-work"
              onClick={() => onMoreLikeThis(work.id, work.title)}
              className="flex items-center justify-center space-x-2 px-4 py-2 rounded-xl bg-[#0f3d30] hover:bg-emerald-700/50 text-emerald-100 font-semibold text-xs border border-emerald-500/30 transition-colors cursor-pointer"
            >
              <Sparkles className="w-3.5 h-3.5 text-[#f59e0b]" />
              <span>More Like This (Vector)</span>
            </button>

            <button
              id="btn-save-work-collection"
              onClick={() => onOpenAddToCollection({
                type: 'work',
                referenceId: work.id,
                workId: work.id,
                workTitle: work.title,
                authorName: work.authorName
              })}
              className="flex items-center justify-center space-x-2 px-4 py-2 rounded-xl bg-emerald-950/40 hover:bg-emerald-500/20 text-emerald-200 font-semibold text-xs border border-emerald-500/20 transition-colors cursor-pointer"
            >
              <Bookmark className="w-3.5 h-3.5 text-[#f59e0b]" />
              <span>Add to Collection</span>
            </button>
          </div>
        </div>

        {/* Premium Edition Banner if unpurchased */}
        {isPremium && !isUnlocked && (
          <div className="mt-6 p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-center space-x-3 text-xs text-amber-200">
              <Lock className="w-5 h-5 text-amber-400 shrink-0" />
              <div>
                <p className="font-bold text-white">Scholarly Critical Edition with TEI Apparatus ({priceStr})</p>
                <p className="text-amber-200/80 text-[11px]">Chapter 1 is free to preview. Chapters 2–{chapters.length} and the complete variant apparatus require an edition unlock.</p>
              </div>
            </div>
            <button
              onClick={() => setShowCheckoutModal(true)}
              className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-stone-950 rounded-lg text-xs font-bold uppercase tracking-wider shrink-0 cursor-pointer shadow-sm"
            >
              Unlock with Stripe
            </button>
          </div>
        )}

        {/* Work Description - technical/TEI metadata lives on the back
            face instead (see the Info-icon flip toggle above). */}
        <div className="pt-6 space-y-4">
          {work.summary && (
            <div>
              <h3 className="text-[10px] font-bold text-emerald-300/60 uppercase tracking-widest mb-2">
                Synopsis & Context
              </h3>
              <p className="text-emerald-100/90 text-sm leading-relaxed font-serif-reading">
                {work.summary}
              </p>
            </div>
          )}

          <div className="flex flex-wrap gap-1.5">
            {work.tags.map((tag, idx) => (
              <span key={idx} className="text-xs px-2.5 py-1 rounded-md bg-emerald-950/60 text-emerald-200/80 border border-emerald-500/20 font-medium">
                #{tag}
              </span>
            ))}
          </div>
        </div>
            </div>

            {/* BACK FACE: TEI/storage technical metadata, reached only by
                tapping the Info icon - not shown on the front overview. */}
            <div className="absolute inset-0 backface-hidden rotate-y-180 bg-scriptorium-blue rounded-2xl border border-emerald-500/20 p-6 sm:p-8 shadow-xl overflow-y-auto flex flex-col justify-start">
              <button
                id="btn-work-flip-technical-back"
                type="button"
                onClick={() => setShowTechnicalData(false)}
                className="absolute top-1 right-1 z-10 p-1.5 rounded-full text-emerald-200/70 hover:text-white hover:bg-black/20 transition-colors cursor-pointer"
                title="Back to overview (Esc)"
                aria-label="Back to overview"
              >
                <X className="w-4 h-4" />
              </button>
              <div className="bg-[#051a14] rounded-xl p-4 border border-emerald-500/20 space-y-3 text-xs max-w-md mx-auto w-full">
                <h4 className="font-bold text-white uppercase tracking-wider text-[11px] flex items-center space-x-1.5">
                  <FileCode className="w-3.5 h-3.5 text-[#f59e0b]" />
                  <span>TEI Corpus Metadata</span>
                </h4>

                <div className="space-y-1.5 text-emerald-200/60 font-mono text-[11px]">
                  <div className="flex justify-between">
                    <span>Access Tier:</span>
                    <span className={`font-bold ${isPremium ? 'text-amber-300' : 'text-emerald-300'}`}>
                      {isPremium ? (isUnlocked ? 'Unlocked Scholarly' : 'Premium ($)') : 'Free Public'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>Total Words:</span>
                    <span className="font-bold text-white">{work.sizeWords.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Payload Size:</span>
                    <span className="font-bold text-white">{(work.sizeBytes / 1024).toFixed(1)} KB</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Chapters/Divs:</span>
                    <span className="font-bold text-white">{work.chapterCount}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>License:</span>
                    <span className="font-bold text-white truncate max-w-[140px]" title={work.license}>{work.license}</span>
                  </div>
                </div>

                <div className="pt-2 border-t border-emerald-500/20 text-[10px] text-emerald-200/60 leading-relaxed">
                  <p className="font-semibold text-emerald-200/90 mb-0.5">TEI Source Desc:</p>
                  <p className="italic font-serif-reading">{work.teiHeaderSummary.sourceDesc}</p>
                </div>

                {/* DAV mounts: one dav:// directory per checked format; the
                    address itself is each link's label, and the OS's DAV
                    mounter opens it. */}
                {davLinks.length > 0 && (
                  <div className="pt-2 border-t border-emerald-500/20 text-[10px] leading-relaxed">
                    <p className="font-semibold text-emerald-200/90 mb-1">Open as DAV folder:</p>
                    <div className="flex items-center gap-3 mb-1.5">
                      {(['txt', 'json', 'xml'] as const).map(format => (
                        <label key={format} className="inline-flex items-center gap-1 cursor-pointer text-emerald-200/80">
                          <input
                            type="checkbox"
                            checked={davFormats[format]}
                            onChange={event => setDavFormats(prev => ({ ...prev, [format]: event.target.checked }))}
                            className="accent-amber-500"
                          />
                          {format}
                        </label>
                      ))}
                    </div>
                    {davLinks.map(link => (
                      <a
                        key={link.format}
                        href={link.url}
                        className="block font-mono underline decoration-dotted text-emerald-200/70 hover:text-white break-all"
                      >
                        {link.url}
                      </a>
                    ))}
                  </div>
                )}
              </div>
              {isAdmin && <AdminCoverSection workId={workId} />}
            </div>
          </div>
        </div>
      </div>

      {/* Table of Contents modal - opened via btn-open-toc-modal, right
          under Continue Reading (same styling), not shown inline. */}
      {showTocModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-black/75 backdrop-blur-md animate-in fade-in duration-200">
          <div
            className="relative w-full max-w-2xl bg-[#061d28]/95 border border-white/20 rounded-2xl shadow-[0_16px_48px_0_rgba(0,0,0,0.5)] overflow-hidden text-white flex flex-col max-h-[90vh]"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-white/15 bg-white/[0.04]">
              <div className="flex items-center space-x-2.5">
                <div className="w-8 h-8 rounded-lg bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-[#f59e0b]">
                  <Layers className="w-4 h-4" />
                </div>
                <div>
                  <h2 className="text-sm font-bold tracking-wide uppercase text-white">
                    Table of Contents ({chapters.length} Divisions)
                  </h2>
                  <p className="text-[11px] text-white/60">
                    {isPremium && !isUnlocked ? 'Chapter 1 Free • Chapters 2+ Locked' : 'Select a chapter to begin reading'}
                  </p>
                </div>
              </div>
              <button
                id="btn-close-toc-modal"
                onClick={() => setShowTocModal(false)}
                className="p-1.5 rounded-lg text-white/60 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                aria-label="Close Table of Contents"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="overflow-y-auto divide-y divide-emerald-500/15">
          {chapters.length === 0 && readerService.isLiveWork(work.id) && (
            <p className="p-5 text-sm text-emerald-100/70">
              {readerService.chapterLoadFailed(work.id)
                ? 'The table of contents could not be loaded. Please try again after the server is available.'
                : 'Loading the canonical table of contents…'}
            </p>
          )}
          {chapters.map((chapter) => {
            const isChapterLocked = isPremium && !isUnlocked && !isPreviewPage(chapters, chapter);

            return (
              <div
                key={chapter.id}
                id={`toc-chapter-${chapter.id}`}
                className="p-4 sm:p-5 hover:bg-emerald-500/10 transition-colors flex items-center justify-between gap-4 group"
                style={{ paddingLeft: `${20 + (chapter.ancestors?.length ?? 0) * 16}px` }}
              >
                <div className="flex items-start space-x-4">
                  <span className={`w-8 h-8 rounded-lg font-mono font-bold text-xs flex items-center justify-center shrink-0 border ${
                    isChapterLocked 
                      ? 'bg-amber-500/10 text-amber-400/80 border-amber-500/20' 
                      : 'bg-amber-500/15 text-[#f59e0b] border-amber-500/30'
                  }`}>
                    {isChapterLocked ? <Lock className="w-3.5 h-3.5" /> : chapter.chapterNumber}
                  </span>

                  <div>
                    <div className="flex items-center space-x-2">
                      <h4 
                        onClick={() => {
                          if (isChapterLocked) {
                            setShowCheckoutModal(true);
                          } else {
                            onSelectChapter(work.id, chapter.id);
                          }
                        }}
                        className={`font-display-title text-sm sm:text-base font-bold group-hover:text-[#f59e0b] transition-colors cursor-pointer ${
                          chapter.isSection ? 'text-amber-200 uppercase tracking-wide' : 'text-white'
                        }`}
                      >
                        {chapter.title}
                      </h4>
                      {isPremium && !isUnlocked && !isChapterLocked && chapter.id === chapters.find(c => !c.isSection)?.id && (
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                          Free Preview
                        </span>
                      )}
                      {isChapterLocked && (
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 font-mono">
                          Locked
                        </span>
                      )}
                    </div>

                    {chapter.subtitle && (
                      <p className="text-xs text-emerald-200/60 font-serif-reading italic mt-0.5">
                        {chapter.subtitle}
                      </p>
                    )}
                    <div className="flex items-center space-x-3 text-[11px] text-emerald-200/50 font-mono mt-1">
                      {!chapter.isSection && <span>{chapter.wordCount} words</span>}
                      {chapter.illustrations && chapter.illustrations.length > 0 && (
                        <span className="text-[#f59e0b] font-semibold">• {chapter.illustrations.length} illustration</span>
                      )}
                      {chapter.footnotes && chapter.footnotes.length > 0 && (
                        <span>• {chapter.footnotes.length} apparatus notes</span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center space-x-2">
                  <button
                    id={`btn-col-chap-${chapter.id}`}
                    onClick={() => onOpenAddToCollection({
                      type: 'chapter',
                      referenceId: chapter.id,
                      workId: work.id,
                      workTitle: work.title,
                      authorName: work.authorName,
                      chapterId: chapter.id,
                      chapterTitle: chapter.title
                    })}
                    title="Bookmark Chapter"
                    className="p-2 text-emerald-200/60 hover:text-white hover:bg-emerald-500/20 rounded-lg transition-colors cursor-pointer"
                  >
                    <Bookmark className="w-4 h-4 text-[#f59e0b]" />
                  </button>

                  {isChapterLocked ? (
                    <button
                      id={`btn-unlock-chap-${chapter.id}`}
                      onClick={() => setShowCheckoutModal(true)}
                      className="flex items-center space-x-1 px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-stone-950 text-xs font-bold uppercase tracking-wider shadow-xs transition-colors cursor-pointer"
                    >
                      <Lock className="w-3.5 h-3.5" />
                      <span>Unlock</span>
                    </button>
                  ) : (
                    <button
                      id={`btn-read-chap-${chapter.id}`}
                      onClick={() => onSelectChapter(work.id, chapter.id)}
                      className="flex items-center space-x-1 px-3 py-1.5 rounded-lg bg-[#0f3d30] hover:bg-emerald-700/50 text-white text-xs font-semibold uppercase tracking-wider border border-emerald-500/30 transition-colors cursor-pointer"
                    >
                      <span>Read</span>
                      <ChevronRight className="w-3.5 h-3.5 text-[#f59e0b]" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
            </div>
          </div>
        </div>
      )}

      {/* Payment Modal */}
      <PaymentCheckoutModal
        work={work}
        isOpen={showCheckoutModal}
        onClose={() => setShowCheckoutModal(false)}
        onSuccess={() => {
          setPurchaseRefreshKey(k => k + 1);
        }}
      />
    </div>
  );
};
