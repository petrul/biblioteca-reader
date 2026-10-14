import { resolveSelectedQuote } from '../services/serverQuoteApi';
import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  Settings,
  Share2,
  Bookmark,
  Copy,
  Check,
  Sparkles,
  Quote,
  Type,
  Palette,
  Layers,
  ZoomIn,
  X,
  ExternalLink,
  BookOpen,
  Lock,
  CreditCard,
  CheckCircle2,
  ShieldCheck,
  Info,
  Download,
  Facebook,
  Twitter,
  Linkedin,
  Send,
  MessageCircle
} from 'lucide-react';
import {
  Work,
  Chapter,
  ReaderTheme,
  ReaderFontFamily,
  ReaderWidth,
  Quotation,
  LanguageCode
} from '../types/textbase';
import { preferencesStoreFor } from '../services/identity';
import { BookmarkButton } from './BookmarkButton';
import { readerService } from '../services/readerService';
import { alignPoemStanzas } from '../services/poemAlignment';
import { useReadingAttention } from '../hooks/useReadingAttention';
import { useHideHeaderOnScroll } from '../hooks/useHideHeaderOnScroll';
import { useReaderScrollPosition } from '../hooks/useReaderScrollPosition';
import { useSpeechReader } from '../hooks/useSpeechReader';
import { useSwipeNavigate } from '../hooks/useSwipeNavigate';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { FootnoteSheet } from './FootnoteSheet';
import { chapterTransitionClass, type PendingChapterTurn } from '../services/chapterTransition';
import { PaymentCheckoutModal } from './PaymentCheckoutModal';
import { bibliotecaExternalUrl, chapterContentUrl, ENDING_ORNAMENT_IMAGE } from '../services/serversideApi';
import { isTypingBurst, noteLetterKey } from '../services/typingBurst';
import { languageName } from '../services/languageNames';
import { buildShareIntent, type ShareTarget } from '../services/socialShare';
import { ancestorIds, buildTocEntries, isPreviewPage } from '../services/tocTree';
import { copyToClipboard } from '../services/clipboard';
import { NotFoundCard } from './NotFoundCard';
import { SearchField } from './SearchField';
import { ReaderBlockMarker } from './ReaderBlockMarker';
import { matchesSearch } from '../services/collectionSearch';

interface ReaderViewProps {
  workId: string;
  chapterId: string;
  reallySignedIn: boolean;
  /** Header back button: real history back (previous chapter, work card,
   *  search - wherever we came from; see handleReaderBack in App.tsx). */
  onBack: () => void;
  /** Error-state "Return to Work" button only - always the work card. */
  onBackToWork: () => void;
  /** The heading's title opens the book card (WorkView). */
  onSelectWork: (workId: string) => void;
  /** Reading preferences panel's open state - controlled from App, whose
   *  navbar owns the settings button now (see Navbar's reader tools). */
  settingsOpen: boolean;
  onSettingsOpenChange: (open: boolean) => void;
  /** Whose collections the toolbar bookmark icon reflects (the same
   *  id AddToCollectionModal uses: real user, or ANONYMOUS_USER_ID). */
  currentUserId: string;
  onSelectChapter: (workId: string, chapterId: string) => void;
  onMoreLikeThis: (workId: string, title: string) => void;
  onOpenAddToCollection: (item: { 
    type: 'work' | 'chapter' | 'quote'; 
    referenceId: string; 
    workId: string; 
    workTitle: string; 
    authorName: string; 
    chapterId?: string; 
    chapterTitle?: string;
    quoteText?: string;
  }) => void;
  initialHighlightText?: string;
  // App.tsx mutes the global "Refreshing catalogue..." toast while this is
  // true - see WorkView's identical prop for why.
  onNotFoundChange?: (notFound: boolean) => void;
}

const THEME_STYLES: Record<ReaderTheme, { bg: string; text: string; border: string; accent: string; dropCap: string }> = {
  parch: {
    bg: 'bg-[#fcf9f2]',
    text: 'text-[#2b2620]',
    border: 'border-[#ebdccb]',
    accent: 'text-amber-900',
    dropCap: '#78350f'
  },
  paper: {
    bg: 'bg-white',
    text: 'text-stone-900',
    border: 'border-stone-200',
    accent: 'text-stone-900',
    dropCap: '#1c1917'
  },
  night: {
    bg: 'bg-black',
    text: 'text-neutral-300',
    border: 'border-emerald-500/20',
    accent: 'text-emerald-300',
    dropCap: '#10b981'
  }
};

const FONT_CLASSES: Record<ReaderFontFamily, string> = {
  // Alegreya, matching the old Spring MVC reader's teidiv.css (`p { font-family:
  // Alegreya, ... }`) - not the app-wide --font-serif (Newsreader), which is
  // shared by unrelated chrome elsewhere.
  serif: 'font-alegreya-reading',
  gentium: 'font-gentium-reading',
  sans: 'font-fira-reading',
  mono: 'font-mono-tei'
};

// The settings panel's font-size slider range - the default the reader
// text starts at and the largest size offered. A stored preference
// outside this range is clamped back into it on restore.
const FONT_SIZE_MIN = 14;
const FONT_SIZE_MAX = 30;
const FONT_SIZE_DEFAULT = 24;

const WIDTH_CLASSES: Record<ReaderWidth, string> = {
  narrow: 'max-w-xl',
  standard: 'max-w-3xl',
  wide: 'max-w-5xl'
};

export const ReaderView: React.FC<ReaderViewProps> = ({
  workId,
  chapterId,
  reallySignedIn,
  onBack,
  onBackToWork,
  onSelectWork,
  settingsOpen,
  onSettingsOpenChange,
  currentUserId,
  onSelectChapter,
  onMoreLikeThis,
  onOpenAddToCollection,
  initialHighlightText,
  onNotFoundChange
}) => {
  useReadingAttention(workId, reallySignedIn);
  const [quoteContext, setQuoteContext] = useState<{ context?: string; before?: string }>({});
  const [quoteError, setQuoteError] = useState('');
  const [quoteCreating, setQuoteCreating] = useState(false);
  const work = readerService.getWorkById(workId);
  const chapters = work ? readerService.getChaptersForWork(work.id) : [];
  const chapter = readerService.getChapter(workId, chapterId);
  // React 19's update path compares dangerouslySetInnerHTML by prop OBJECT
  // identity, not by the __html string: a fresh { __html } literal per
  // render made every re-render re-assign innerHTML with the same string,
  // recreating all content DOM and wiping alignPoemStanzas' inline margins
  // (the poem jumped back to left-aligned on the first scroll). Memoizing
  // the object keeps the identity stable while the string is unchanged.
  const contentHtml = useMemo(() => ({ __html: chapter?.htmlContent ?? '' }), [chapter?.htmlContent]);
  // Loading depends only on this work, its TOC and the requested chapter.
  const isLiveLoading = (!work && readerService.isWorkLoading(workId)) ||
    Boolean(work && readerService.isLiveWork(work.id) &&
      ((!chapter && readerService.isWorkLoading(workId)) || (chapter && !chapter.plainText && !chapter.htmlContent && !readerService.isChapterContentFailed(chapter.id))));
  const isGenuinelyNotFound = !isLiveLoading && (!work || !chapter);
  useEffect(() => {
    onNotFoundChange?.(isGenuinelyNotFound);
    return () => onNotFoundChange?.(false);
  }, [isGenuinelyNotFound, onNotFoundChange]);
  useReaderScrollPosition(workId, chapterId, reallySignedIn, !isLiveLoading);
  // Hides this sticky sub-header on scroll down, reappears on scroll up -
  // same behavior/hook as the navbar above it, so both move in lockstep
  // (each independently derives the same show/hide decision from the
  // same window scroll position).
  const headerVisible = useHideHeaderOnScroll();

  // Reader settings state
  const [theme, setTheme] = useState<ReaderTheme>('paper');
  const [fontFamily, setFontFamily] = useState<ReaderFontFamily>('serif');
  // FONT_SIZE_DEFAULT/1.2 default to match the old reader's fixed 16pt body
  // text with no line-height override (i.e. the browser's normal ~1.2) -
  // still adjustable here, unlike the old reader.
  const [fontSize, setFontSize] = useState<number>(FONT_SIZE_DEFAULT);
  const [lineHeight, setLineHeight] = useState<number>(1.2);
  const [columnWidth, setColumnWidth] = useState<ReaderWidth>('standard');
  // Settings panel state is controlled from App (the navbar's settings
  // button owns the toggle) - aliased to the old local names used below.
  const showSettings = settingsOpen;
  const setShowSettings = onSettingsOpenChange;
  const [showDownload, setShowDownload] = useState(false);
  // When checked, the download menu's formats open inline in a new browser
  // window instead of saving to disk. Off by default: the menu's purpose
  // remains downloading; inline is opt-in per dropdown visit.
  const [downloadInline, setDownloadInline] = useState(false);
  // "Share on...": the button BECOMES the last-used target (a preference) -
  // a quick tap shares there directly; a long tap (or no target yet)
  // opens the choice dropdown first. See the pointer handlers below.
  const [showShareMenu, setShowShareMenu] = useState(false);
  const [shareTarget, setShareTarget] = useState<ShareTarget | null>(null);
  const sharePointerDownAtRef = useRef(0);
  const shareLongPressedRef = useRef(false);
  const [showTocMenu, setShowTocMenu] = useState(false);
  const [tocQuery, setTocQuery] = useState('');
  const [tocExpanded, setTocExpanded] = useState<ReadonlySet<string>>(new Set());
  // Reading should show only the text - division/language/word-count and
  // whatever else gets added later live on the "back" of the page instead,
  // reached by flipping it via the small i button, not shown inline.
  const [showStats, setShowStats] = useState(false);
  const speech = useSpeechReader(chapter?.id, chapter?.title, chapter?.plainText, work?.detectedLanguage);

  // Keep the document language aligned with the work being read. This is
  // consumed by browser accessibility/TTS features in addition to our own
  // SpeechSynthesis utterance language. The static shell uses `und` because
  // the catalogue is multilingual.
  useEffect(() => {
    const previous = document.documentElement.lang;
    const languageMap: Record<string, string> = {
      ron: 'ro', rum: 'ro', ro: 'ro',
      eng: 'en', en: 'en',
      deu: 'de', ger: 'de', de: 'de',
      fra: 'fr', fre: 'fr', fr: 'fr',
      ita: 'it', it: 'it',
      spa: 'es', es: 'es',
      lat: 'la', la: 'la'
    };
    document.documentElement.lang = languageMap[(work?.detectedLanguage || '').toLowerCase()] || 'und';
    return () => { document.documentElement.lang = previous || 'und'; };
  }, [work?.detectedLanguage]);

  // Text selection & quotation fragment state
  const [selectedText, setSelectedText] = useState<string>('');
  const [selectionRange, setSelectionRange] = useState<{ start: number; end: number } | null>(null);
  const [selectionCoords, setSelectionCoords] = useState<{ x: number; y: number } | null>(null);
  const [createdQuote, setCreatedQuote] = useState<Quotation | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedCitation, setCopiedCitation] = useState(false);
  const [copiedSelection, setCopiedSelection] = useState(false);
  // Footnote content on tap/click: the TEI note's full text lives in the
  // chip's title attribute (see .note in index.css) - that works as a
  // hover tooltip on desktop but never fires on touch, so tapping a chip
  // did nothing on mobile. This surfaces the same text as a dismissible
  // popover for both input types.
  const [footnote, setFootnote] = useState<{ text: string; x: number; y: number } | null>(null);
  // Phones (below Tailwind's sm) get the footnote as a bottom sheet instead
  // of the popover anchored at its chip - see FootnoteSheet.
  const footnoteAsSheet = useMediaQuery('(max-width: 639px)');
  // Handles notes in the incoming HTML, including its chapter heading.
  const handleNoteClick = (e: React.MouseEvent) => {
    const chip = (e.target as HTMLElement).closest<HTMLElement>('.note');
    if (!chip) return;
    const text = chip.title.trim();
    if (!text) return;
    const rect = chip.getBoundingClientRect();
    setFootnote({ text, x: rect.left + rect.width / 2, y: rect.top });
  };
  const [copiedServerLink, setCopiedServerLink] = useState(false);

  // Illustration modal
  const [previewImage, setPreviewImage] = useState<{ url: string; caption: string } | null>(null);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [purchaseRefreshKey, setPurchaseRefreshKey] = useState(0);

  useEffect(() => {
    const handlePurchasesChanged = () => {
      setPurchaseRefreshKey(prev => prev + 1);
    };
    window.addEventListener('textbase-purchases-changed', handlePurchasesChanged);
    return () => window.removeEventListener('textbase-purchases-changed', handlePurchasesChanged);
  }, []);

  // Whether the chapter being read is saved in any of the user's
  // collections - drives the toolbar bookmark icon's filled state.
  // Recomputed on chapter change and on collections-changed (the
  // same window-event pattern as purchases above).
  const [chapterBookmarked, setChapterBookmarked] = useState(false);
  useEffect(() => {
    const recompute = () => {
      try {
        setChapterBookmarked(chapter != null && readerService.getCollections(currentUserId)
          .some(collection => collection.items.some(
            item => item.type === 'chapter' && item.referenceId === chapter.id)));
      } catch {
        setChapterBookmarked(false);
      }
    };
    recompute();
    window.addEventListener('collections-changed', recompute);
    return () => window.removeEventListener('collections-changed', recompute);
  }, [chapter?.id, currentUserId]);

  const contentRef = useRef<HTMLDivElement>(null);

  // Center each poem stanza as a block (ported from the old Spring MVC
  // reader's teidiv.js) - depends on rendered text metrics, so it re-runs
  // whenever anything that can change line width does (content, font,
  // column width) and on window resize, same as the original.
  useEffect(() => {
    if (!contentRef.current) return;
    const node = contentRef.current;
    const recompute = () => alignPoemStanzas(node);
    const frame = requestAnimationFrame(recompute);
    window.addEventListener('resize', recompute);
    // Self-healing, like the original server page's own alignment: whenever
    // anything recreates the content DOM (React or otherwise), the inline
    // stanza margins are gone with the old nodes - realign immediately.
    // childList only: recompute's own style writes are attribute mutations
    // and must not retrigger it.
    const observer = new MutationObserver(recompute);
    observer.observe(node, { childList: true, subtree: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', recompute);
      observer.disconnect();
    };
  }, [chapter?.htmlContent, fontFamily, fontSize, columnWidth]);

  // Dynamic access check
  const isUnlocked = work ? readerService.isWorkUnlocked(work.id) : false;
  const isPremium = work?.accessType === 'premium';
  const isChapterLocked = isPremium && !isUnlocked && !isPreviewPage(chapters, chapter);
  const priceStr = `$${(((work?.priceCents || 499)) / 100).toFixed(2)}`;

  // Navigation indices
  const currentChapterIndex = chapters.findIndex(c => c.id === chapter?.id);
  const prevChapter = currentChapterIndex > 0 ? chapters[currentChapterIndex - 1] : null;
  const nextChapter = currentChapterIndex < chapters.length - 1 ? chapters[currentChapterIndex + 1] : null;
  const tocFiltering = tocQuery.trim() !== '';
  const tocEntries = buildTocEntries(
    chapters, tocExpanded, tocFiltering ? c => matchesSearch(tocQuery, c.title) : null);

  // Opening the sidebar (or turning to another chapter) re-collapses the tree
  // down to the divisions that lead to the chapter being read.
  useEffect(() => {
    setTocExpanded(new Set(ancestorIds(chapter)));
  }, [showTocMenu, chapter?.id]);
  useEffect(() => {
    if (showTocMenu) document.querySelector('#reader-toc-sidebar [aria-current="true"]')?.scrollIntoView?.({ block: 'center' });
  }, [showTocMenu, chapter?.id]);
  const toggleTocDivision = (id: string) => setTocExpanded(prev => {
    const next = new Set(prev);
    if (!next.delete(id)) next.add(id);
    return next;
  });

  // The four export forms of the chapter being read, offered as file
  // downloads next to the settings gear (the old in-page format switching
  // is gone - the reading surface always renders the formatted HTML).
  const downloadChapter = (fmt: 'xhtml' | 'json' | 'txt' | 'xml') => {
    if (!chapter) return;
    const base = `${workId}/${chapter.id}`.split('/').join('-');
    // Reading fetches only HTML/TXT. Let the browser request XML/JSON
    // on click, preserving the synchronous popup gesture for inline views.
    const isRemoteExport = fmt === 'xml' || fmt === 'json';
    const ext = fmt === 'xml' ? 'tei.xml' : fmt;
    const url = isRemoteExport
      ? chapterContentUrl(chapter.id, fmt, chapter.isSection)
      : URL.createObjectURL(new Blob(
          [fmt === 'xhtml' ? chapter.htmlContent : chapter.plainText],
          { type: `${fmt === 'xhtml' ? 'application/xhtml+xml' : 'text/plain'};charset=utf-8` }
        ));
    if (downloadInline) {
      // Display the format itself in a new window. Locally generated
      // HTML/TXT blob URLs must outlive this function, so revoke late.
      // Popup blocked -> fall back to a normal navigation.
      const win = window.open(url, '_blank');
      if (!win) window.location.href = url;
      if (!isRemoteExport) setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } else {
      const link = document.createElement('a');
      link.href = url;
      link.download = `${base}.${ext}`;
      link.click();
      if (!isRemoteExport) URL.revokeObjectURL(url);
    }
    setShowDownload(false);
  };

  // Flash the prev/next buttons with the same visual tapped effect a real
  // click produces, so keyboard navigation gives identical feedback.
  const flashTapped = (ids: string[]) => {
    for (const id of ids) {
      const btn = document.getElementById(id);
      if (!btn) continue;
      btn.classList.remove('key-tapped');
      // Force a style flush so a re-add within the same frame (rapid key
      // repeats) still restarts the animation instead of being ignored.
      void (btn as HTMLElement).offsetWidth;
      btn.classList.add('key-tapped');
    }
  };

  // Keyboard navigation shortcuts (ArrowLeft / ArrowRight)
  // Page-turn animation: next/previous chapter navigation (buttons, arrow
  // keys, swipes) notes its direction here, and a one-shot chapter-* class
  // (index.css) is applied once the new chapter is shown - the page flip on
  // arriving on a work, the slide for turns within it; chapterTransitionClass
  // decides (and its unit test pins the rule). The toolbar's Back is a
  // history back (App's handleReaderBack): it notes a 'prev' turn too, which
  // plays only if it lands on another chapter shortly after.
  const pendingChapterTurn = useRef<PendingChapterTurn | null>(null);
  const [chapterTurnClass, setChapterTurnClass] = useState('');
  const noteChapterTurn = (direction: 'next' | 'prev') => {
    pendingChapterTurn.current = { direction, at: Date.now() };
  };
  const turnToChapter = (direction: 'next' | 'prev', chapterId: string) => {
    noteChapterTurn(direction);
    onSelectChapter(workId, chapterId);
  };
  // The work last shown: arriving on a different one (or the first) is
  // opening a book, which flips the page instead of sliding it.
  const shownWorkId = useRef<string | null>(null);
  useEffect(() => {
    const pending = pendingChapterTurn.current;
    pendingChapterTurn.current = null;
    const transition = chapterTransitionClass(shownWorkId.current, workId, pending, Date.now());
    shownWorkId.current = workId;
    if (transition) setChapterTurnClass(transition);
  }, [workId, chapter?.id]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Avoid firing if user is typing in an input
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)) return;
      if (e.key === 'ArrowLeft' && prevChapter) {
        // preventDefault: without it the browser ALSO applies the arrows'
        // default page scroll, which can leave the next chapter's page
        // horizontally scrolled (the app gradient showing on the right).
        // scrollTo resets both axes, same as the bottom buttons.
        e.preventDefault();
        flashTapped(['btn-reader-prev-chapter']);
        turnToChapter('prev', prevChapter.id);
        window.scrollTo({ top: 0, left: 0, behavior: 'smooth' });
      } else if (e.key === 'ArrowRight' && nextChapter) {
        e.preventDefault();
        flashTapped(['btn-reader-next-chapter-top', 'btn-reader-next-chapter']);
        turnToChapter('next', nextChapter.id);
        window.scrollTo({ top: 0, left: 0, behavior: 'smooth' });
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [prevChapter, nextChapter, workId, onSelectChapter]);

  // Touch swipe page-turn (mobile): same effect and same visual feedback
  // as the ArrowLeft/ArrowRight keyboard shortcuts above - left = next
  // chapter (content moves left, next page enters from the right, same
  // direction every mobile reader/carousel uses for "forward"), right =
  // previous.
  const swipeHandlers = useSwipeNavigate(
    () => {
      if (!nextChapter) return;
      flashTapped(['btn-reader-next-chapter-top', 'btn-reader-next-chapter']);
      turnToChapter('next', nextChapter.id);
      window.scrollTo({ top: 0, left: 0, behavior: 'smooth' });
    },
    () => {
      if (!prevChapter) return;
      flashTapped(['btn-reader-prev-chapter']);
      turnToChapter('prev', prevChapter.id);
      window.scrollTo({ top: 0, left: 0, behavior: 'smooth' });
    }
  );

  // Keyboard shortcuts for the reading surface: i flips between the text
  // and the statistics back face (identical to the work card's own (i)/(x)
  // toggle), t the ToC sidebar, Shift+S the display-preferences dropdown
  // (the navbar gear button's panel; a bare s opens the collections
  // quick-jump, see App). Escape or x turns back to the text from
  // the stats face. Same editable-control and modifier guards as the
  // navbar's global shortcuts - plus the typing burst guard: a bare letter
  // pressed in the middle of typing a word (no focused input, e.g. the
  // "s" inside "right") must not fire its shortcut.
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
        setShowStats(prev => !prev);
      } else if (event.key === 't') {
        event.preventDefault();
        setShowTocMenu(prev => !prev);
      } else if (event.key === 'S') {
        event.preventDefault();
        setShowSettings(!showSettings);
      } else if ((event.key === 'Escape' || event.key === 'x') && showStats) {
        event.preventDefault();
        setShowStats(false);
      }
    };
    window.addEventListener('keydown', handleFlipKey);
    return () => window.removeEventListener('keydown', handleFlipKey);
  }, [showStats, showSettings]);

  // Escape closes any open dropdown/popover on the reading surface -
  // settings, ToC sidebar, download and share menus. When the card is
  // flipped to its back face, the flip handler above owns Escape (back
  // to reading), so this one stands down; editable controls keep their
  // native Escape behavior.
  useEffect(() => {
    const handleEscapeKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || showStats) return;
      const target = event.target as HTMLElement | null;
      if (target?.matches('input, textarea, select, [contenteditable="true"]') &&
          !(showTocMenu && target.id === 'reader-toc-search')) return;
      if (footnote) setFootnote(null);
      else if (showSettings) setShowSettings(false);
      else if (showTocMenu) setShowTocMenu(false);
      else if (showDownload) setShowDownload(false);
      else if (showShareMenu) setShowShareMenu(false);
      else if (selectedText) {
        setSelectedText('');
        setSelectionCoords(null);
        window.getSelection()?.removeAllRanges();
      }
      else return;
      event.preventDefault();
    };
    window.addEventListener('keydown', handleEscapeKey);
    return () => window.removeEventListener('keydown', handleEscapeKey);
  }, [footnote, showStats, showSettings, showTocMenu, showDownload, showShareMenu, selectedText]);

  // Land back on the reading face when moving to a different chapter, and
  // drop an open footnote popover with the page it belongs to - keyboard
  // page turns (arrow keys) never pass through the outside-click close.
  useEffect(() => { setShowStats(false); setFootnote(null); setSelectedText(''); setSelectionCoords(null); }, [chapter?.id]);

  // The download dropdown lives on the back face: flipping back to reading
  // closes it, so it is not still open on the next flip.
  useEffect(() => { if (!showStats) setShowDownload(false); }, [showStats]);

  // Warm the localStorage chapter cache for both TOC neighbors once the
  // current chapter's own content has landed (readerService.
  // prefetchChapterNeighbors) - Next/Previous then serves from the cache
  // with no network round trip at all, and the prefetches never compete
  // with the text the user is waiting for right now.
  useEffect(() => {
    if (chapter?.plainText) readerService.prefetchChapterNeighbors(workId, chapter.id);
  }, [workId, chapter?.id, chapter?.plainText]);

  // Restore the reader's stored display preferences (palette, share
  // target, font size) - server-backed for signed-in readers (follow the
  // account), localStorage for anonymous ones; one PreferencesStore
  // interface either way (see preferencesStore.ts).
  useEffect(() => {
    void preferencesStoreFor(reallySignedIn).get().then(prefs => {
      // A stored name that no longer exists (removed/renamed palettes, e.g.
      // the old dark/sepia) falls back to the default instead of rendering
      // against a missing THEME_STYLES entry.
      if (prefs.readerTheme && prefs.readerTheme in THEME_STYLES) setTheme(prefs.readerTheme);
      // The remembered share target: the button becomes it; no stored
      // choice yet and every tap opens the dropdown until one is made.
      if (prefs.shareTarget) setShareTarget(prefs.shareTarget);
      // Stored font size, clamped back into the slider's current range -
      // a value from an older build (e.g. its old 26 max) is pulled to the
      // nearest in-range size rather than left applied with no slider
      // position to match it.
      if (prefs.fontSize) setFontSize(Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, prefs.fontSize)));
    }).catch(() => { /* no stored preference: keep the paper default */ });
  }, [reallySignedIn]);

  // "Share on..." - the prepared post: the chapter's first excerpt plus
  // attribution, sized per platform (X: 280 with the URL counted in); the
  // shared URL itself carries the page's og:image (chapter illustration,
  // generic featured image as fallback) for the platforms' link cards.
  const shareTo = (target: ShareTarget) => {
    if (!work || !chapter) return;
    window.open(buildShareIntent(target, {
      excerpt: chapter.plainText,
      title: chapter.title,
      authorName: work.authorName,
      url: window.location.href
    }), '_blank', 'noopener,noreferrer');
  };
  const chooseShareTarget = (target: ShareTarget) => {
    setShareTarget(target);
    setShowShareMenu(false);
    void preferencesStoreFor(reallySignedIn).set({ shareTarget: target });
    shareTo(target);
  };
  // Quick tap = share with the current target (or pick one first); long
  // tap = pick again. contextmenu covers touch devices' long-press.
  const onSharePointerDown = () => {
    sharePointerDownAtRef.current = Date.now();
    shareLongPressedRef.current = false;
  };
  const onSharePointerUp = () => {
    if (Date.now() - sharePointerDownAtRef.current >= 450 || shareLongPressedRef.current) {
      setShowShareMenu(open => !open);
    } else if (shareTarget) {
      shareTo(shareTarget);
    } else {
      setShowShareMenu(true);
    }
  };

  // Handle text selection for Quote Generation
  useEffect(() => {
    const handleSelectionChange = () => {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || !contentRef.current) {
        return;
      }

      const text = selection.toString().trim();
      if (text.length > 5) {
        const range = selection.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        
        // Ensure selection is inside reader container
        if (contentRef.current.contains(range.commonAncestorContainer)) {
          setSelectedText(text);
          const start = range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement;
          const block = start?.closest('p,h1,h2,h3,h4,h5,h6,blockquote,li');
          if (block && contentRef.current.contains(block)) {
            const prefix = document.createRange(); prefix.selectNodeContents(block);
            prefix.setEnd(range.startContainer, range.startOffset);
            setQuoteContext({ context: block.textContent || '', before: prefix.toString() });
          } else setQuoteContext({});
          setQuoteError('');
          setSelectionRange({ start: range.startOffset, end: range.endOffset });
          setSelectionCoords({
            x: Math.max(10, rect.left + rect.width / 2),
            y: rect.top - 10
          });
          setCreatedQuote(null);
        }
      }
    };

    const handlePointerUp = () => {
      setTimeout(handleSelectionChange, 50);
    };

    const handleDocumentClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('#selection-quote-toolbar') && !target.closest('#quote-created-modal')) {
        const selection = window.getSelection();
        if (!selection || selection.isCollapsed) {
          setSelectedText('');
          setSelectionCoords(null);
        }
      }
      if (!target.closest('#footnote-popover') && !target.closest('#footnote-sheet-root') && !target.closest('.note')) {
        setFootnote(null);
      }
      // Settings/download/share dropdowns: close on a genuine tap outside
      // both the panel and its own toggle button. The toggle buttons must
      // stay excluded, or the very click that opens a panel (bubbling to
      // this same document listener) would immediately close it again -
      // the settings button in particular lives in the navbar, outside
      // this component's own DOM subtree entirely, so it needs its own
      // explicit check rather than falling out of the panel's own markup.
      // Matched by id, not its title: the tooltip text changes (it gained
      // the "(Shift+S)" shortcut hint), which silently broke the button.
      if (!target.closest('#settings-dropdown') && !target.closest('#nav-reader-settings-btn')) {
        setShowSettings(false);
      }
      if (!target.closest('#download-dropdown') && !target.closest('#btn-reader-download-toggle')) {
        setShowDownload(false);
      }
      if (!target.closest('#share-dropdown') && !target.closest('#btn-reader-share')) {
        setShowShareMenu(false);
      }
    };

    document.addEventListener('pointerup', handlePointerUp);
    document.addEventListener('click', handleDocumentClick);

    return () => {
      document.removeEventListener('pointerup', handlePointerUp);
      document.removeEventListener('click', handleDocumentClick);
    };
  }, []);

  if (isLiveLoading) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center animate-in fade-in duration-200">
        <span className="w-9 h-9 border-[3px] border-[#f59e0b] border-t-transparent rounded-full animate-spin"></span>
      </div>
    );
  }

  if (!work || !chapter || (!chapter.plainText && readerService.isChapterContentFailed(chapter.id))) {
    return (
      <NotFoundCard
        message="Chapter not available."
        primaryLabel="Return to Work"
        onPrimary={onBackToWork}
      />
    );
  }

  const currentTheme = THEME_STYLES[theme];

  // Action: Create Quote Link
  const handleGenerateQuoteLink = async () => {
    if (!selectedText || quoteCreating) return;
    setQuoteCreating(true); setQuoteError('');
    try {
      const source = await resolveSelectedQuote(chapter.id, selectedText, quoteContext.context, quoteContext.before);
      const quote = readerService.createQuotation({
        workId: work.id, workTitle: work.title, authorName: work.authorName,
        chapterId: chapter.id, chapterTitle: chapter.title, chapterNumber: chapter.chapterNumber,
        text: source.text, startOffset: selectionRange?.start || 0,
        endOffset: selectionRange?.end || selectedText.length, language: work.detectedLanguage
      }, source.id);
      setCreatedQuote(quote);
    } catch (error) { setQuoteError((error as Error).message); }
    finally { setQuoteCreating(false); }
  };

  // Action: Copy Citation
  const handleCopyCitation = () => {
    const citation = `«${selectedText}» — ${work.authorName}, ${work.title} (${chapter.title}). Canonical fragment TEI citation.`;
    void copyToClipboard(citation).then(ok => {
      setCopiedCitation(ok);
      if (ok) setTimeout(() => setCopiedCitation(false), 2000);
    });
  };

  // Action: Native Share
  const handleNativeShare = async (quote?: Quotation) => {
    const shareText = quote ? quote.text : selectedText;
    const shareUrl = quote 
      ? readerService.generateQuoteShareUrl(quote.id) 
      : window.location.href;

    if (navigator.share) {
      try {
        await navigator.share({
          title: `${work.title} - ${work.authorName}`,
          text: `«${shareText}» — ${work.authorName}`,
          url: shareUrl
        });
      } catch {
        // User cancelled or unsupported
      }
    } else {
      void copyToClipboard(shareUrl).then(ok => {
        setCopiedLink(ok);
        if (ok) setTimeout(() => setCopiedLink(false), 2000);
      });
    }
  };

  return (
    <div className={`min-h-screen ${currentTheme.bg} ${currentTheme.text} transition-colors duration-200 pb-24`}>
      {/* Sticky Reader Header Bar - hides on scroll down, reappears on
          scroll up, in lockstep with the navbar above it (see
          useHideHeaderOnScroll). */}
      <div id="reader-chapter-toolbar" className={`sticky top-0 z-30 ${WIDTH_CLASSES[columnWidth]} w-full mx-auto ${currentTheme.bg} border-b ${currentTheme.border} shadow-xs backdrop-blur-md transition-transform duration-300 ${headerVisible ? 'translate-y-0' : '-translate-y-full'}`}>
        <div className="w-full px-4 sm:px-6 lg:px-8 h-14 flex items-center justify-between gap-4">
          {/* Left: Back - real history back (previous chapter after a
              chapter hop, the work card when the chapter was opened from
              it; see handleReaderBack in App.tsx), title/chapter shown in
              the navbar's own wordmark instead (see Navbar's
              pageTitle/pageSubtitle), not duplicated here. */}
          <div className="flex items-center space-x-3">
            <button
              id="btn-reader-back-work"
              onClick={() => { noteChapterTurn('prev'); onBack(); }}
              className="p-2 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 transition-colors shrink-0"
              title="Back"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>

            {/* Keep the table-of-contents control with the left-side page
                navigation, so it is easy to find and remains left-aligned. */}
            <button
              id="btn-reader-toc-menu"
              onClick={() => setShowTocMenu(!showTocMenu)}
              className="p-2 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 transition-colors flex items-center space-x-1 text-xs font-medium cursor-pointer"
              title="Table of Contents"
            >
              <Layers className="w-4 h-4 text-[#f59e0b]" />
              <span className="hidden sm:inline">{chapter.isSection ? 'Section' : 'Ch.'} {chapter.chapterNumber}</span>
            </button>
          </div>

          {/* Right Tools: Vector More-Like-This, Settings, Unlock */}
          <div className="flex items-center space-x-1.5 sm:space-x-2 shrink-0">
            {isPremium && !isUnlocked && (
              <button
                id="btn-reader-unlock-top"
                onClick={() => setShowPaymentModal(true)}
                className="flex items-center space-x-1 px-2.5 py-1 rounded-lg bg-amber-500 hover:bg-amber-400 text-stone-950 text-xs font-bold uppercase tracking-wider shadow-sm transition-colors cursor-pointer"
                title="Unlock Complete Critical Edition"
              >
                <CreditCard className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Unlock Edition</span>
                <span>({priceStr})</span>
              </button>
            )}

            {isPremium && isUnlocked && (
              <span className="hidden sm:inline-flex items-center space-x-1 px-2.5 py-1 rounded-lg bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-[11px] font-bold">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>Scholarly License</span>
              </span>
            )}

            {/* Save this chapter: click opens the save dialog (Favorites
                preselected), long-press/right-click a dropdown of collections. */}
            <BookmarkButton
              userId={currentUserId}
              bookmarked={chapterBookmarked}
              item={{
                type: 'chapter',
                referenceId: chapter.id,
                workId: work.id,
                workTitle: work.title,
                authorName: work.authorName,
                chapterId: chapter.id,
                chapterTitle: chapter.title
              }}
              onOpenDialog={() => onOpenAddToCollection({
                type: 'chapter',
                referenceId: chapter.id,
                workId: work.id,
                workTitle: work.title,
                authorName: work.authorName,
                chapterId: chapter.id,
                chapterTitle: chapter.title
              })}
            />

            {/* Read-aloud controls are intentionally disabled for now. The
                hook remains available for a future, cleaner UI treatment. */}
            {false && speech.supported && (
              <div className="flex items-center gap-0.5">
                <button
                  id="btn-reader-read-aloud"
                  onClick={speech.toggle}
                  disabled={!speech.voiceAvailable}
                  className={`p-2 rounded-lg transition-colors ${!speech.voiceAvailable ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'} ${speech.enabled ? 'bg-[#f59e0b] text-black' : 'hover:bg-black/5 dark:hover:bg-white/10'}`}
                  title={!speech.voiceAvailable ? `No ${speech.requestedLanguage ?? 'matching'} voice is installed. Install/download that language in your browser or operating system speech settings.` : speech.enabled ? 'Read aloud is on; it follows chapter changes' : 'Read this chapter aloud'}
                  aria-label={!speech.voiceAvailable ? 'No voice available for this language' : speech.enabled ? 'Turn off read aloud' : 'Turn on read aloud'}
                  aria-pressed={speech.enabled}
                >
                  <span aria-hidden="true" className="text-sm">{speech.voiceAvailable ? (speech.speaking ? '🔊' : '🔈') : '🔇'}</span>
                </button>
                {!speech.voiceAvailable && (
                  <span className="text-[10px] opacity-70 max-w-[150px] leading-tight">
                    No {speech.requestedLanguage} voice; install/download it in device speech settings.
                  </span>
                )}
                {speech.speaking && (
                  <button
                    id="btn-reader-stop-aloud"
                    onClick={speech.stop}
                    className="px-1.5 py-1 rounded text-[10px] font-bold uppercase tracking-wider opacity-70 hover:opacity-100 cursor-pointer"
                    title="Stop reading aloud"
                  >
                    Stop
                  </button>
                )}
              </div>
            )}

            {/* "More Like This" Similarity Vector search */}
            <button
              id="btn-reader-more-like-this"
              onClick={() => onMoreLikeThis(work.id, work.title)}
              className="hidden sm:flex items-center space-x-1 px-2.5 py-1.5 rounded-lg bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-white/10 text-xs font-semibold uppercase tracking-wider transition-colors cursor-pointer"
              title="Search vector similarity for this work"
            >
              <Sparkles className="w-3.5 h-3.5 text-[#f59e0b]" />
              <span>More Like This</span>
            </button>

            {/* "Share on..." - discrete toolbar button. Shows the LAST-USED
                target's icon once chosen (stored in user prefs); quick tap
                shares there, long tap (or no choice yet) opens the picker.
                The post is the chapter's first excerpt + attribution, sized
                per platform; the shared URL carries the page's og:image. */}
            <div className="relative">
              <button
                id="btn-reader-share"
                onPointerDown={onSharePointerDown}
                onPointerUp={onSharePointerUp}
                onPointerLeave={() => { shareLongPressedRef.current = false; }}
                onContextMenu={event => {
                  event.preventDefault();
                  setShowShareMenu(open => !open);
                }}
                className="p-2 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 transition-colors cursor-pointer active:scale-95 active:brightness-90"
                title={shareTarget ? `Share on ${shareTarget} - long-press to pick another` : 'Share on...'}
                aria-label={shareTarget ? `Share on ${shareTarget}` : 'Share on...'}
                aria-haspopup="menu"
                aria-expanded={showShareMenu}
              >
                {shareTarget === 'facebook' && <Facebook className="w-4 h-4" />}
                {shareTarget === 'x' && <Twitter className="w-4 h-4" />}
                {shareTarget === 'linkedin' && <Linkedin className="w-4 h-4" />}
                {shareTarget === 'whatsapp' && <MessageCircle className="w-4 h-4" />}
                {shareTarget === 'telegram' && <Send className="w-4 h-4" />}
                {!shareTarget && <Share2 className="w-4 h-4" />}
              </button>

              {showShareMenu && (
                <div
                  id="share-dropdown"
                  className="absolute right-0 mt-2 w-40 z-50"
                  onClick={(e) => { if (e.target === e.currentTarget) setShowShareMenu(false); }}
                >
                <div
                  role="menu"
                  className={`${currentTheme.bg} border ${currentTheme.border} rounded-xl shadow-2xl p-1.5 space-y-0.5`}
                >
                  {([
                    { target: 'facebook', label: 'Facebook', Icon: Facebook },
                    { target: 'x', label: 'X', Icon: Twitter },
                    { target: 'linkedin', label: 'LinkedIn', Icon: Linkedin },
                    { target: 'whatsapp', label: 'WhatsApp', Icon: MessageCircle },
                    { target: 'telegram', label: 'Telegram', Icon: Send }
                  ] as const).map(({ target, label, Icon }) => (
                    <button
                      key={target}
                      id={`btn-share-${target}`}
                      role="menuitem"
                      onClick={() => chooseShareTarget(target)}
                      className={`w-full flex items-center space-x-2.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                        shareTarget === target
                          ? 'bg-black/10 dark:bg-white/10'
                          : 'hover:bg-black/5 dark:hover:bg-white/5'
                      }`}
                    >
                      <Icon className="w-3.5 h-3.5 shrink-0" />
                      <span>{label}</span>
                      {shareTarget === target && <Check className="w-3 h-3 ml-auto opacity-60" />}
                    </button>
                  ))}
                </div>
                </div>
              )}
            </div>

            {/* Typography / Theme Settings panel - the toggle BUTTON lives
                on the top navbar now (only while reading); this dropdown is
                its panel, anchored below the toolbar row. */}
            <div className="relative">
              {showSettings && (
                // Plain (unrounded) outer wrapper matching the panel's own
                // footprint exactly. Chrome doesn't hit-test an element's
                // rounded-off corners, so without this, a tap near the
                // panel's corner falls straight through to whatever's
                // underneath on the page (here, the chapter's own Back
                // button - tapping near the settings panel could silently
                // navigate away). e.target===e.currentTarget so only a
                // direct hit on this wrapper's own corners closes it -
                // bubbled clicks from the real controls inside don't.
                <div
                  id="settings-dropdown"
                  className="absolute right-0 mt-2 w-80 z-50"
                  onClick={(e) => { if (e.target === e.currentTarget) setShowSettings(false); }}
                >
                <div className={`${currentTheme.bg} border ${currentTheme.border} rounded-xl shadow-2xl p-4 space-y-4`}>
                  <div className="flex items-center justify-between border-b border-black/10 dark:border-white/10 pb-2">
                    <span className="text-xs font-bold uppercase tracking-wider">Reading Preferences</span>
                    <button onClick={() => setShowSettings(false)} className="opacity-60 hover:opacity-100 cursor-pointer">
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Themes */}
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-widest opacity-70">Theme Palette</label>
                    <div className="grid grid-cols-3 gap-1.5">
                      {(['parch', 'paper', 'night'] as ReaderTheme[]).map((t) => (
                        <button
                          key={t}
                          id={`theme-btn-${t}`}
                          onClick={() => {
                            setTheme(t);
                            void preferencesStoreFor(reallySignedIn).set({ readerTheme: t });
                          }}
                          className={`h-8 rounded-lg border text-[10px] font-sans font-bold capitalize flex items-center justify-center transition-all cursor-pointer ${
                            t === 'parch' ? 'bg-[#fcf9f2] text-stone-900 border-[#ebdccb]' :
                            t === 'paper' ? 'bg-white text-stone-900 border-stone-300' :
                            'bg-black text-neutral-300 border-white/20'
                          } ${theme === t ? 'ring-2 ring-amber-500 scale-105' : ''}`}
                        >
                          {t}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Font Family */}
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-widest opacity-70">Typeface</label>
                    <div className="grid grid-cols-3 gap-1">
                      {(['serif', 'gentium', 'sans'] as ReaderFontFamily[]).map((f) => (
                        <button
                          key={f}
                          id={`font-btn-${f}`}
                          onClick={() => setFontFamily(f)}
                          className={`py-1 rounded text-xs border capitalize cursor-pointer ${
                            fontFamily === f
                              ? 'bg-[#f59e0b] text-black font-bold border-amber-500'
                              : 'border-black/10 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/5'
                          }`}
                        >
                          {f}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Font Size */}
                  <div className="space-y-1.5">
                    <div className="flex justify-between text-[11px] opacity-70 font-semibold">
                      <span>Font Size</span>
                      <span className="font-mono">{fontSize}px</span>
                    </div>
                    <div className="flex items-center space-x-2">
                      <span className="text-xs">A</span>
                      <input
                        type="range"
                        min={14}
                        max={FONT_SIZE_MAX}
                        step={1}
                        value={fontSize}
                        onChange={(e) => {
                          const size = Number(e.target.value);
                          setFontSize(size);
                          // Same persistence path as the theme palette:
                          // localStorage for a guest, the account document
                          // when signed in (see preferencesStore.ts).
                          void preferencesStoreFor(reallySignedIn).set({ fontSize: size });
                        }}
                        className="flex-1 accent-amber-700 cursor-pointer"
                      />
                      <span className="text-base font-bold">A</span>
                    </div>
                  </div>

                  {/* Column Width */}
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-semibold opacity-70">Column Width</label>
                    <div className="grid grid-cols-3 gap-1">
                      {(['narrow', 'standard', 'wide'] as ReaderWidth[]).map((w) => (
                        <button
                          key={w}
                          onClick={() => setColumnWidth(w)}
                          className={`py-1 rounded text-xs border capitalize ${
                            columnWidth === w
                              ? 'bg-amber-700 text-white font-bold border-amber-800'
                              : 'border-black/10 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/5'
                          }`}
                        >
                          {w}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
                </div>
              )}
            </div>

            <button
              id="btn-reader-flip-stats-front"
              type="button"
              onClick={() => setShowStats(previous => !previous)}
              className="p-2 rounded-lg opacity-60 hover:opacity-100 hover:bg-black/5 dark:hover:bg-white/10 transition-colors shrink-0 cursor-pointer"
              title="Division, language, word count… (i)"
              aria-label={showStats ? 'Back to reading' : 'Show chapter statistics'}
              aria-pressed={showStats}
            >
              <Info className="w-4 h-4" />
            </button>

            {/* Next chapter, mirroring btn-reader-back-work at the header's
                opposite corner - same plain icon-only style, just ArrowRight
                instead of ArrowLeft. The bottom nav's own Next/Previous
                buttons (below) remain the primary way to move between
                chapters; this is a same-header shortcut symmetrical to Back. */}
            {nextChapter && (
              <button
                id="btn-reader-next-chapter-top"
                onClick={() => {
                  turnToChapter('next', nextChapter.id);
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
                className="p-2 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 transition-colors shrink-0"
                title={`Next: ${nextChapter.title}`}
              >
                <ArrowRight className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Table of Contents Sidebar */}
      {showTocMenu && (
        <div className="fixed inset-0 z-50">
          {/* Backdrop */}
          <div
            onClick={() => setShowTocMenu(false)}
            className="fixed inset-0 bg-black/40 backdrop-blur-xs"
          />

          {/* Translucent Sidebar */}
          <div id="reader-toc-sidebar" className="fixed inset-y-4 left-0 w-[calc(100%-1rem)] max-w-xs sm:max-w-sm bg-black/40 backdrop-blur-xl border border-white/15 rounded-r-2xl text-white shadow-2xl flex flex-col animate-in slide-in-from-left duration-300 ease-out motion-reduce:animate-none">
            <div className="flex items-center gap-3 p-4 border-b border-white/10">
              <SearchField
                id="reader-toc-search"
                label="Search chapters"
                className="min-w-0 flex-1"
                value={tocQuery}
                onValueChange={setTocQuery}
                placeholder={`Search ${chapters.filter(c => !c.isSection).length} chapters…`}
                clearable
                inputClassName="rounded-lg border border-white/20 bg-black/25 py-2 text-sm text-white placeholder:text-white/55 outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-400"
              />
              <button onClick={() => setShowTocMenu(false)} className="opacity-60 hover:opacity-100 cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {tocEntries.map(entry => {
                const entryChapter = entry.chapter;
                const isCurrent = entryChapter.id === chapter.id;
                const indent = (entryChapter.ancestors?.length ?? 0) * 12;
                const open = () => {
                  onSelectChapter(work.id, entryChapter.id);
                  setShowTocMenu(false);
                };
                if (entry.type === 'section') {
                  return (
                    <div
                      key={`section:${entryChapter.id}`}
                      className="flex items-center gap-0.5 pt-2"
                      style={{ paddingLeft: `${indent}px` }}
                    >
                      {entry.collapsible ? (
                        <button
                          type="button"
                          aria-expanded={entry.expanded}
                          aria-label={`${entry.expanded ? 'Collapse' : 'Expand'} ${entryChapter.title}`}
                          onClick={() => toggleTocDivision(entryChapter.id)}
                          className="shrink-0 p-1.5 rounded-md text-amber-300/90 hover:bg-white/10 cursor-pointer"
                        >
                          <ChevronRight className={`w-3.5 h-3.5 transition-transform motion-reduce:transition-none ${entry.expanded ? 'rotate-90' : ''}`} />
                        </button>
                      ) : <span className="w-[26px] shrink-0" aria-hidden="true" />}
                      <button
                        type="button"
                        onClick={open}
                        aria-current={isCurrent ? 'true' : undefined}
                        className={`min-w-0 flex-1 text-left px-2 py-1.5 rounded-lg text-[11px] font-bold uppercase tracking-widest transition-colors cursor-pointer ${
                          isCurrent ? 'bg-[#f59e0b] text-black' : 'text-amber-300/90 hover:bg-white/10'
                        }`}
                      >
                        <span className="block truncate">{entryChapter.title}</span>
                      </button>
                    </div>
                  );
                }
                return (
                  <button
                    key={`chapter:${entryChapter.id}`}
                    onClick={open}
                    aria-current={isCurrent ? 'true' : undefined}
                    className={`w-full text-left px-3 py-2 rounded-lg text-xs transition-colors flex items-center justify-between cursor-pointer ${
                      isCurrent ? 'bg-[#f59e0b] text-black font-bold' : 'hover:bg-white/10'
                    }`}
                    style={{ paddingLeft: `${24 + indent}px` }}
                  >
                    <span className="truncate pr-2">{entryChapter.title}</span>
                    <span className="text-[10px] font-mono opacity-60 shrink-0">p. {entryChapter.chapterNumber}</span>
                  </button>
                );
              })}
              {tocEntries.length === 0 && (
                <p className="px-3 py-4 text-xs text-white/60">No chapters match “{tocQuery}”.</p>
              )}
            </div>
          </div>
        </div>
      )}


      {/* Sample Banner if Premium & Chapter 1 */}
      {isPremium && !isUnlocked && !isChapterLocked && (
        <div className="bg-amber-500/15 border-b border-amber-500/30 text-amber-950 dark:text-amber-200 px-4 py-2.5 text-xs text-center flex flex-wrap items-center justify-center gap-2">
          <span className="font-mono uppercase font-bold text-[10px] px-2 py-0.5 rounded bg-amber-500/25 border border-amber-500/40">Free Sample</span>
          <span>You are previewing Chapter 1. Unlock the full edition ({priceStr}) to access chapters 2–{chapters.length} and the complete critical apparatus.</span>
          <button
            onClick={() => setShowPaymentModal(true)}
            className="px-3 py-1 bg-amber-500 hover:bg-amber-400 text-stone-950 font-bold rounded-lg text-xs transition-colors cursor-pointer shadow-xs"
          >
            Unlock Now
          </button>
        </div>
      )}

      {/* Main Chapter Content Body. overflow-x-clip: the chapter-turn/slide
          animations translate the content column past the viewport edge
          mid-animation; clip (not hidden, which would create a scroll
          container) keeps that from flashing a horizontal scrollbar. */}
      <main
        className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-10 pb-16 overflow-x-clip"
        {...swipeHandlers}
      >
        <div
          className={`relative mx-auto ${WIDTH_CLASSES[columnWidth]} ${chapterTurnClass}`}
          onAnimationEnd={e => { if (e.target === e.currentTarget) setChapterTurnClass(''); }}
        >
          <div className="[perspective:1500px]">
            <div
              className={`relative transition-transform duration-700 ease-in-out transform-3d ${showStats ? 'rotate-y-180' : ''}`}
            >
              {/* FRONT FACE: the text. The reader navbar's Info button
                  flips to statistics; the back face's X returns to reading
                  (along with the i / Esc / x keyboard shortcuts). */}
              <div className="backface-hidden relative">

          {/* LOCKED CHAPTER PAYWALL CARD */}
          {isChapterLocked ? (
            <div className="my-8 p-8 sm:p-10 rounded-2xl border border-amber-500/40 bg-linear-to-b from-amber-500/10 via-amber-500/5 to-transparent backdrop-blur-md text-center space-y-6 shadow-xl max-w-2xl mx-auto">
              <div className="w-16 h-16 rounded-2xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center mx-auto text-amber-800 dark:text-amber-400">
                <Lock className="w-8 h-8" />
              </div>

              <div className="space-y-2">
                <div className="inline-flex items-center space-x-1.5 px-3 py-1 rounded-full bg-amber-500/20 text-amber-800 dark:text-amber-300 text-xs font-bold uppercase tracking-wider">
                  <ShieldCheck className="w-3.5 h-3.5" />
                  <span>Critical Scholarly Edition Locked</span>
                </div>
                <h3 className="text-2xl font-serif font-bold tracking-tight">
                  Chapter locked
                </h3>
                <p className="text-sm opacity-80 max-w-md mx-auto leading-relaxed">
                  This division is part of the premium scholarly edition of <em>{work.title}</em>. Unlock this volume to gain immediate lifetime access to all {chapters.length} divisions, critical apparatus, and TEI XML source.
                </p>
              </div>

              <div className="p-4 rounded-xl bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 text-left text-xs space-y-2 max-w-md mx-auto">
                <div className="font-bold text-xs uppercase tracking-wider opacity-80 mb-1">What you unlock:</div>
                <div className="flex items-center space-x-2 text-emerald-700 dark:text-emerald-400">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  <span>Complete unabridged text across all {chapters.length} chapters</span>
                </div>
                <div className="flex items-center space-x-2 text-emerald-700 dark:text-emerald-400">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  <span>Full TEI critical apparatus, variants, and footnotes</span>
                </div>
                <div className="flex items-center space-x-2 text-emerald-700 dark:text-emerald-400">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  <span>Direct export in Canonical TEI XML and JSON AST formats</span>
                </div>
              </div>

              <div className="pt-2 flex flex-col sm:flex-row items-center justify-center gap-3">
                <button
                  id="btn-reader-unlock-paywall"
                  onClick={() => setShowPaymentModal(true)}
                  className="w-full sm:w-auto px-6 py-3 rounded-xl bg-amber-500 hover:bg-amber-400 text-stone-950 font-bold text-sm uppercase tracking-wider shadow-lg flex items-center justify-center space-x-2 transition-all cursor-pointer"
                >
                  <CreditCard className="w-4 h-4" />
                  <span>Unlock Full Edition — {priceStr}</span>
                </button>

                {chapters.length > 0 && (
                  <button
                    onClick={() => onSelectChapter(work.id, chapters[0].id)}
                    className="w-full sm:w-auto px-5 py-3 rounded-xl border border-black/15 dark:border-white/15 hover:bg-black/5 dark:hover:bg-white/5 text-xs font-semibold uppercase tracking-wider transition-colors cursor-pointer"
                  >
                    Read Free Sample (Ch. 1)
                  </button>
                )}
              </div>
            </div>
          ) : (
            <>
              {/* FORMATTED HTML - always; the four export formats are file
                  downloads now (btn-reader-download-toggle, on the back
                  face), not views */}
              <div
                ref={contentRef}
                style={{
                  fontSize: `${fontSize}px`,
                  lineHeight: lineHeight,
                  ['--drop-cap-color' as string]: currentTheme.dropCap
                } as React.CSSProperties}
                className={`${FONT_CLASSES[fontFamily]} reader-text-container select-text${chapter.isSection ? ' reader-section-page' : ''}`}
                dangerouslySetInnerHTML={contentHtml}
                onClick={handleNoteClick}
              />
              <ReaderBlockMarker containerRef={contentRef} contentKey={`${chapter.id}:${chapter.htmlContent}`} chapterId={chapter.id} title={work?.title || workId} chapterTitle={chapter.title} />

              {/* End-of-text ornament, the original server page's own
                  p.deco-end (teidiv.css: img.deco-end { max-width: 100px;
                  margin: 30px auto; }) - served through the server-content
                  proxy like every other server-owned asset. */}
              {!chapter.isSection && <img
                src={ENDING_ORNAMENT_IMAGE}
                alt=""
                aria-hidden="true"
                className="block mx-auto max-w-[100px] mt-[30px] mb-[30px]"
              />}

              {/* Footnotes & Apparatus */}
              {chapter.footnotes && chapter.footnotes.length > 0 && (
                <div className="mt-14 pt-8 border-t border-black/15 dark:border-white/15 space-y-3">
                  <h4 className="text-xs font-bold uppercase tracking-wider opacity-60">
                    Scholarly Apparatus & Footnotes
                  </h4>
                  <ul className="space-y-2 text-xs font-serif-reading opacity-85">
                    {chapter.footnotes.map((fn) => (
                      <li key={fn.id} className="flex items-start space-x-2">
                        <span className="font-bold text-amber-800 dark:text-amber-400">[{fn.mark}]</span>
                        <span>{fn.text}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
              </div>

              {/* BACK FACE: statistics, reached only by flipping - this is
                  where any future per-chapter analytics should be added,
                  not inline with the reading text above. */}
              <div
                className={`absolute inset-0 backface-hidden rotate-y-180 rounded-2xl border ${currentTheme.border} ${currentTheme.bg} px-6 py-10 flex flex-col items-center text-center space-y-6 overflow-y-auto`}
              >
                <button
                  id="btn-reader-flip-stats-back"
                  type="button"
                  onClick={() => setShowStats(false)}
                  className="absolute top-1 right-1 z-10 p-1.5 rounded-full transition-colors cursor-pointer"
                  title="Back to reading (Esc)"
                  aria-label="Back to reading"
                >
                  <X className="w-4 h-4" />
                </button>
                <h2 className="font-display-title text-lg sm:text-xl font-bold tracking-tight opacity-90">
                  Chapter statistics
                </h2>
                <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-8 gap-y-5 font-mono text-sm">
                  <div>
                    <dt className="text-[10px] uppercase tracking-widest opacity-60">Division</dt>
                    <dd className="text-lg font-bold">{chapter.chapterNumber} / {chapters.length}</dd>
                  </div>
                  <div>
                    <dt className="text-[10px] uppercase tracking-widest opacity-60">Language</dt>
                    <dd className="text-lg font-bold">{languageName(work.detectedLanguage)}</dd>
                  </div>
                  <div>
                    <dt className="text-[10px] uppercase tracking-widest opacity-60">Word Count</dt>
                    <dd className="text-lg font-bold">{chapter.wordCount.toLocaleString()}</dd>
                  </div>
                  <div>
                    <dt className="text-[10px] uppercase tracking-widest opacity-60">Characters</dt>
                    <dd className="text-lg font-bold">{chapter.charCount != null ? chapter.charCount.toLocaleString() : '—'}</dd>
                  </div>
                  <div>
                    <dt className="text-[10px] uppercase tracking-widest opacity-60">Sentences</dt>
                    <dd className="text-lg font-bold">{chapter.sentenceCount ?? '—'}</dd>
                  </div>
                  <div>
                    <dt className="text-[10px] uppercase tracking-widest opacity-60">Reading Time</dt>
                    <dd className="text-lg font-bold">~{Math.max(1, Math.round(chapter.wordCount / 220))} min</dd>
                  </div>
                  <div>
                    <dt className="text-[10px] uppercase tracking-widest opacity-60">Footnotes</dt>
                    <dd className="text-lg font-bold">{chapter.noteCount ?? chapter.footnotes?.length ?? 0}</dd>
                  </div>
                  <div>
                    <dt className="text-[10px] uppercase tracking-widest opacity-60">Encoding</dt>
                    <dd className="text-lg font-bold">TEI P5</dd>
                  </div>
                </dl>
                {/* Download the chapter being read: the four export formats
                    (the settings popup's old in-page format switchers).
                    On the back face, not the toolbar: advanced and rarely
                    used. */}
                {!isChapterLocked && chapter?.htmlContent && (
                  <div className="relative">
                    <button
                      id="btn-reader-download-toggle"
                      onClick={() => {
                        setShowDownload(!showDownload);
                        setShowSettings(false);
                      }}
                      className={`p-2 rounded-lg transition-colors cursor-pointer ${
                        showDownload ? 'bg-[#f59e0b] text-black' : 'hover:bg-black/5 dark:hover:bg-white/10'
                      }`}
                      title="Download this chapter"
                    >
                      <Download className="w-4 h-4" />
                    </button>

                    {showDownload && (
                      // Plain (unrounded) outer wrapper matching the panel's own
                      // footprint exactly - see the settings panel's own note on
                      // why this exists (border-radius corner fall-through).
                      // e.target===e.currentTarget so only a direct hit on this
                      // wrapper's own corners closes it - bubbled clicks from
                      // the real controls inside don't.
                      <div
                        id="download-dropdown"
                        className="absolute right-0 mt-2 w-56 z-50"
                        onClick={(e) => { if (e.target === e.currentTarget) setShowDownload(false); }}
                      >
                      <div className={`${currentTheme.bg} border ${currentTheme.border} rounded-xl shadow-2xl p-4 space-y-1.5`}>
                        <label className="text-[10px] font-bold uppercase tracking-widest opacity-70">Download chapter</label>
                        {([
                          { key: 'xhtml', label: 'XHTML', file: 'Formatted XHTML' },
                          { key: 'json', label: 'JSON', file: 'JSON AST' },
                          { key: 'txt', label: 'TXT', file: 'Plain text' },
                          { key: 'xml', label: 'TEI XML', file: 'Canonical TEI P5' }
                        ] as const).map((f) => (
                          <button
                            key={f.key}
                            id={`btn-download-${f.key}`}
                            onClick={() => downloadChapter(f.key)}
                            className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg border border-black/10 dark:border-white/10 opacity-80 hover:opacity-100 hover:bg-black/5 dark:hover:bg-white/5 text-xs font-mono font-semibold uppercase tracking-wider transition-all cursor-pointer"
                          >
                            <span>.{f.key === 'xml' ? 'tei.xml' : f.key}</span>
                            <span className="font-sans normal-case opacity-60">{f.file}</span>
                          </button>
                        ))}

                        {/* Inline display instead of saving - off by default.
                            A plain native checkbox keeps it obvious. */}
                        <label
                          id="download-inline-label"
                          className="flex items-center gap-2 pt-2 mt-1 border-t border-black/10 dark:border-white/10 text-xs opacity-80 hover:opacity-100 cursor-pointer select-none"
                        >
                          <input
                            id="download-inline-checkbox"
                            type="checkbox"
                            checked={downloadInline}
                            onChange={e => setDownloadInline(e.target.checked)}
                            className="accent-amber-600 cursor-pointer"
                          />
                          <span className="font-sans">View inline in new window</span>
                        </label>
                      </div>
                      </div>
                    )}
                  </div>
                )}
                {bibliotecaExternalUrl() && (
                  (() => {
                    // The address itself is the link's label - the reader
                    // shows exactly where the server-side page lives - in
                    // a small bordered box with a copy-to-clipboard icon at
                    // its top right (same copy pattern as the cite/share
                    // buttons above).
                    const serverPageUrl = `${bibliotecaExternalUrl().replace(/\/+$/, '')}/${chapter.id}?noredirect=`;
                    // No w-full on the box: the back-face column is
                    // items-center, so children size to their content - it
                    // takes the same fit-content width as the stats grid
                    // above instead of stretching to the card.
                    return (
                      <div className="relative rounded-lg border border-black/15 dark:border-white/15 p-2 pr-9 text-left">
                        <button
                          id="btn-copy-server-page-link"
                          type="button"
                          onClick={() => {
                            // copyToClipboard, not navigator.clipboard
                            // directly: this origin is plain http on the
                            // LAN (insecure context) where the modern
                            // Clipboard API does not exist.
                            void copyToClipboard(serverPageUrl).then(ok => {
                              setCopiedServerLink(ok);
                              if (ok) setTimeout(() => setCopiedServerLink(false), 2000);
                            });
                          }}
                          className="absolute top-1 right-1 p-1 rounded-md hover:bg-black/10 dark:hover:bg-white/10 transition-colors cursor-pointer"
                          title={copiedServerLink ? 'Copied' : 'Copy link'}
                          aria-label="Copy server-side page link"
                        >
                          {copiedServerLink
                            ? <Check className="w-3.5 h-3.5 text-emerald-400" />
                            : <Copy className="w-3.5 h-3.5" />}
                        </button>
                        <a
                          id="link-reader-server-page"
                          href={serverPageUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs font-mono underline decoration-dotted opacity-70 hover:opacity-100 transition-opacity break-all"
                        >
                          {serverPageUrl}
                        </a>
                      </div>
                    );
                  })()
                )}

                {/* Cheatsheet of the keystrokes the reader page answers
                    to - so the back face documents its own flip keys. */}
                <div className="rounded-lg border border-black/15 dark:border-white/15 p-3 text-left space-y-1.5">
                  <p className="text-[10px] uppercase tracking-widest opacity-60 pb-1">Keyboard shortcuts</p>
                  <div className="flex items-center justify-between gap-4 text-xs">
                    <span className="opacity-80">Previous / next chapter</span>
                    <span className="flex gap-1 shrink-0">
                      <kbd className="px-1.5 py-0.5 rounded border border-black/20 dark:border-white/20 bg-black/5 dark:bg-white/5 font-mono text-[10px]">←</kbd>
                      <kbd className="px-1.5 py-0.5 rounded border border-black/20 dark:border-white/20 bg-black/5 dark:bg-white/5 font-mono text-[10px]">→</kbd>
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-4 text-xs">
                    <span className="opacity-80">Flip this card</span>
                    <kbd className="px-1.5 py-0.5 rounded border border-black/20 dark:border-white/20 bg-black/5 dark:bg-white/5 font-mono text-[10px] shrink-0">i</kbd>
                  </div>
                  <div className="flex items-center justify-between gap-4 text-xs">
                    <span className="opacity-80">Collections</span>
                    <kbd className="px-1.5 py-0.5 rounded border border-black/20 dark:border-white/20 bg-black/5 dark:bg-white/5 font-mono text-[10px] shrink-0">s</kbd>
                  </div>
                  <div className="flex items-center justify-between gap-4 text-xs">
                    <span className="opacity-80">Display preferences</span>
                    <span className="flex gap-1 shrink-0">
                      <kbd className="px-1.5 py-0.5 rounded border border-black/20 dark:border-white/20 bg-black/5 dark:bg-white/5 font-mono text-[10px]">Shift</kbd>
                      <kbd className="px-1.5 py-0.5 rounded border border-black/20 dark:border-white/20 bg-black/5 dark:bg-white/5 font-mono text-[10px]">S</kbd>
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-4 text-xs">
                    <span className="opacity-80">Back to reading</span>
                    <span className="flex gap-1 shrink-0">
                      <kbd className="px-1.5 py-0.5 rounded border border-black/20 dark:border-white/20 bg-black/5 dark:bg-white/5 font-mono text-[10px]">Esc</kbd>
                      <kbd className="px-1.5 py-0.5 rounded border border-black/20 dark:border-white/20 bg-black/5 dark:bg-white/5 font-mono text-[10px]">x</kbd>
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Next / Previous Chapter Navigation Bar */}
          <div className="mt-16 pt-8 border-t border-black/10 dark:border-white/10 flex items-center justify-between gap-4">
            {prevChapter ? (
              <button
                id="btn-reader-prev-chapter"
                onClick={() => {
                  turnToChapter('prev', prevChapter.id);
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
                className={`min-w-0 flex items-center space-x-1.5 sm:space-x-2 px-2.5 py-2 sm:px-4 sm:py-2.5 rounded-xl bg-transparent border border-current/30 ${currentTheme.text} hover:border-current/70 font-bold transition-all text-left group cursor-pointer active:scale-95 active:brightness-90`}
              >
                <ChevronLeft className="w-4 h-4 sm:w-5 sm:h-5 shrink-0 group-hover:-translate-x-1 transition-transform" />
                <div className="text-[11px] sm:text-xs md:text-sm font-bold truncate max-w-[26vw] sm:max-w-[170px] md:max-w-[200px]">{prevChapter.title}</div>
              </button>
            ) : <div />}

            {nextChapter ? (
              <button
                id="btn-reader-next-chapter"
                onClick={() => {
                  turnToChapter('next', nextChapter.id);
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
                className={`min-w-0 flex items-center space-x-1.5 sm:space-x-2 px-2.5 py-2 sm:px-4 sm:py-2.5 rounded-xl bg-transparent border border-current/30 ${currentTheme.text} hover:border-current/70 font-bold transition-all text-right group cursor-pointer active:scale-95 active:brightness-90`}
              >
                <div className="text-[11px] sm:text-xs md:text-sm font-bold truncate max-w-[26vw] sm:max-w-[170px] md:max-w-[200px]">{nextChapter.title}</div>
                <ChevronRight className="w-4 h-4 sm:w-5 sm:h-5 shrink-0 group-hover:translate-x-1 transition-transform" />
              </button>
            ) : (
              <div className="text-xs font-mono opacity-60 italic">
                End of {work.title}
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Footnote content on tap/click - see the .note chip's onClick above:
          a bottom sheet on phones, a popover at the chip elsewhere */}
      {footnote && footnoteAsSheet && (
        <FootnoteSheet key={`${footnote.x},${footnote.y},${footnote.text}`} text={footnote.text} onClose={() => setFootnote(null)} />
      )}
      {footnote && !footnoteAsSheet && (
        <div
          id="footnote-popover"
          style={{
            position: 'fixed',
            left: `${footnote.x}px`,
            top: `${Math.max(60, footnote.y - 10)}px`,
            transform: 'translate(-50%, -100%)',
            maxWidth: '20rem'
          }}
          className="z-50 bg-[#08231c] text-emerald-100 px-3 py-2 rounded-xl shadow-2xl border border-emerald-500/30 text-sm animate-in fade-in zoom-in-95 duration-150"
        >
          {footnote.text}
        </div>
      )}

      {/* Floating Selection Toolbar for Quotations */}
      {selectedText && selectionCoords && (
        <div
          id="selection-quote-toolbar"
          style={{
            position: 'fixed',
            left: `${selectionCoords.x}px`,
            top: `${Math.max(60, selectionCoords.y - 45)}px`,
            transform: 'translateX(-50%)'
          }}
          className="z-50 bg-[#08231c] text-emerald-100 px-3 py-1.5 rounded-xl shadow-2xl border border-emerald-500/30 flex items-center space-x-2 animate-in fade-in zoom-in-95 duration-150"
        >
          {quoteError && <p role="alert" className="absolute top-full mt-2 w-72 p-2 rounded bg-[#08231c] text-white">{quoteError}</p>}
          <button
            id="btn-sel-create-quote"
            onClick={() => void handleGenerateQuoteLink()}
            disabled={quoteCreating}
            className="flex items-center space-x-1 text-xs font-medium hover:text-[#f59e0b] px-2 py-1 rounded hover:bg-emerald-500/20 transition-colors cursor-pointer"
            title="Generate Shareable Quote Link"
          >
            <Quote className="w-3.5 h-3.5 text-[#f59e0b]" />
            <span>{quoteCreating ? 'Resolving…' : 'Quote Link'}</span>
          </button>

          <span className="w-px h-4 bg-emerald-500/30" />

          <button
            id="btn-sel-copy"
            onClick={() => {
              void copyToClipboard(selectedText).then(ok => {
                setCopiedSelection(ok);
                if (ok) setTimeout(() => setCopiedSelection(false), 2000);
              });
            }}
            className="flex items-center space-x-1 text-xs font-medium hover:text-[#f59e0b] px-2 py-1 rounded hover:bg-emerald-500/20 transition-colors cursor-pointer"
            title="Copy selected text"
          >
            {copiedSelection ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5 text-[#f59e0b]" />}
            <span>{copiedSelection ? 'Copied' : 'Copy'}</span>
          </button>

          <span className="w-px h-4 bg-emerald-500/30" />

          <button
            id="btn-sel-save-collection"
            onClick={() => onOpenAddToCollection({
              type: 'quote',
              referenceId: `quote-temp-${Date.now()}`,
              workId: work.id,
              workTitle: work.title,
              authorName: work.authorName,
              chapterId: chapter.id,
              chapterTitle: chapter.title,
              quoteText: selectedText
            })}
            className="flex items-center space-x-1 text-xs font-medium hover:text-[#f59e0b] px-2 py-1 rounded hover:bg-emerald-500/20 transition-colors cursor-pointer"
            title="Save selected quote to personal collection"
          >
            <Bookmark className="w-3.5 h-3.5 text-[#f59e0b]" />
            <span>Save</span>
          </button>

          <span className="w-px h-4 bg-emerald-500/30" />

          <button
            id="btn-sel-copy-citation"
            onClick={handleCopyCitation}
            className="flex items-center space-x-1 text-xs font-medium hover:text-[#f59e0b] px-2 py-1 rounded hover:bg-emerald-500/20 transition-colors cursor-pointer"
            title="Copy academic citation"
          >
            {copiedCitation ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5 text-[#f59e0b]" />}
            <span>{copiedCitation ? 'Copied' : 'Cite'}</span>
          </button>

          <span className="w-px h-4 bg-emerald-500/30" />

          <button
            id="btn-sel-native-share"
            onClick={() => handleNativeShare()}
            className="p-1 rounded hover:bg-emerald-500/20 text-emerald-200 hover:text-[#f59e0b] transition-colors cursor-pointer"
            title="Share quotation"
          >
            <Share2 className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Generated Quote Link Modal / Card */}
      {createdQuote && (
        <div id="quote-created-modal" className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-[#0b2921] text-emerald-100 border border-emerald-500/30 rounded-2xl p-6 max-w-lg w-full shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-emerald-500/20 pb-3">
              <div className="flex items-center space-x-2 text-[#f59e0b]">
                <Quote className="w-5 h-5" />
                <span className="font-bold text-sm">Permanent Fragment Quote Created</span>
              </div>
              <button
                onClick={() => setCreatedQuote(null)}
                className="text-emerald-300 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <blockquote className="font-serif-reading text-base italic border-l-2 border-[#f59e0b] pl-4 py-1 text-emerald-50">
              «{createdQuote.text}»
            </blockquote>

            <div className="text-xs text-emerald-200/70 font-mono">
              — {createdQuote.authorName}, <em>{createdQuote.workTitle}</em> ({createdQuote.chapterTitle})
            </div>

            <div className="bg-[#051a14] p-3 rounded-xl border border-emerald-500/20 flex items-center justify-between gap-2">
              <input
                type="text"
                readOnly
                value={readerService.generateQuoteShareUrl(createdQuote.id)}
                className="bg-transparent font-mono text-xs text-[#f59e0b] flex-1 outline-none truncate"
              />
              <button
                onClick={() => {
                  void copyToClipboard(readerService.generateQuoteShareUrl(createdQuote.id)).then(ok => {
                    setCopiedLink(ok);
                    if (ok) setTimeout(() => setCopiedLink(false), 2000);
                  });
                }}
                className="px-3 py-1.5 bg-[#f59e0b] hover:bg-amber-400 text-black rounded-lg text-xs font-bold flex items-center space-x-1 cursor-pointer"
              >
                {copiedLink ? <Check className="w-3.5 h-3.5 text-black" /> : <Copy className="w-3.5 h-3.5 text-black" />}
                <span>{copiedLink ? 'Copied!' : 'Copy Link'}</span>
              </button>
            </div>

            <div className="flex items-center justify-end space-x-2 pt-2">
              <button
                onClick={() => onOpenAddToCollection({
                  type: 'quote',
                  referenceId: createdQuote.id,
                  workId: createdQuote.workId,
                  workTitle: createdQuote.workTitle,
                  authorName: createdQuote.authorName,
                  chapterId: createdQuote.chapterId,
                  chapterTitle: createdQuote.chapterTitle,
                  quoteText: createdQuote.text
                })}
                className="px-4 py-2 bg-[#0f3d30] hover:bg-emerald-700/50 text-white text-xs font-semibold rounded-xl flex items-center space-x-1.5 border border-emerald-500/30 cursor-pointer"
              >
                <Bookmark className="w-3.5 h-3.5 text-[#f59e0b]" />
                <span>Save to Collection</span>
              </button>
              <button
                onClick={() => handleNativeShare(createdQuote)}
                className="px-4 py-2 bg-[#f59e0b] hover:bg-amber-400 text-black text-xs font-bold uppercase tracking-wider rounded-xl flex items-center space-x-1.5 cursor-pointer"
              >
                <Share2 className="w-3.5 h-3.5" />
                <span>Native Share</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Stripe Payment Checkout Modal */}
      {work && (
        <PaymentCheckoutModal
          work={work}
          isOpen={showPaymentModal}
          onClose={() => setShowPaymentModal(false)}
          onSuccess={() => {
            setPurchaseRefreshKey(prev => prev + 1);
          }}
        />
      )}
    </div>
  );
};
