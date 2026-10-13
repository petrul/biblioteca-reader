// Widened to cover every Languages enum value textbase-server actually
// serves (see textbase-server's Languages.java), not just the 8 the mock
// corpus happened to use - real works span 19 languages.
export type LanguageCode =
  | 'lat'
  | 'grc'
  | 'ron'
  | 'eng'
  | 'fra'
  | 'deu'
  | 'ita'
  | 'spa'
  | 'bul'
  | 'bre'
  | 'cat'
  | 'dan'
  | 'fin'
  | 'hun'
  | 'nld'
  | 'nor'
  | 'por'
  | 'rus'
  | 'zho';

export interface Author {
  id: string;
  name: string;
  canonicalId: string;
  birthYear?: number;
  deathYear?: number;
  birthDate?: string;
  deathDate?: string;
  birthPlace?: string;
  country?: string;
  writingLanguage?: string;
  bioSourceUrl?: string;
  era?: string;
  bio?: string;
  imageHref?: string;
  nationality: string;
  language: LanguageCode;
  worksCount: number;
}

export interface Illustration {
  id: string;
  url: string;
  caption: string;
  position: 'top' | 'inline' | 'bottom';
  source?: string;
}

export interface Footnote {
  id: string;
  mark: string;
  text: string;
}

export interface Chapter {
  id: string;
  workId: string;
  chapterNumber: number;
  title: string;
  /**
   * A non-leaf division (a book, part, volume...): its page is a title page
   * plus any text it holds of its own, loaded without its sub-chapters.
   */
  isSection?: boolean;
  /** Non-leaf divisions between the work and this chapter, in TOC order. */
  ancestors?: Array<{ id: string; title: string; depth: number }>;
  subtitle?: string;
  htmlContent: string;
  plainText: string;
  illustrations?: Illustration[];
  footnotes?: Footnote[];
  wordCount: number;
  /** character count (TeiDiv.size server-side) - undefined until known */
  charCount?: number;
  /** note/footnote count, derived from htmlContent once fetched */
  noteCount?: number;
  /** naive sentence count, derived from plainText once fetched */
  sentenceCount?: number;
}

export type AccessType = 'free' | 'premium';

export interface Work {
  id: string;
  authorId: string;
  authorName: string;
  title: string;
  subtitle?: string;
  origDate?: string;
  detectedLanguage: LanguageCode;
  sizeWords: number;
  sizeBytes: number;
  chapterCount: number;
  license: string;
  sourceRepo: string;
  teiHeaderSummary: {
    titleStmt: string;
    publicationStmt: string;
    sourceDesc: string;
    encodingDesc?: string;
  };
  coverImage?: string;
  /** Original remote/app URL supplied to the cover renderer (not the reader proxy URL). */
  coverArtUrl?: string;
  tags: string[];
  summary: string;
  // Payment & Access fields
  accessType?: AccessType; // 'free' | 'premium'
  priceCents?: number; // e.g. 0 for free, 499 for $4.99
  currency?: string; // 'usd', 'eur', etc.
  isPurchased?: boolean;
  scholarlyPerks?: string[];
  previewChapterCount?: number;
}

export interface BookPurchaseReceipt {
  orderId: string;
  paymentId: string;
  workId: string;
  workTitle: string;
  amountPaid: string;
  status: 'completed' | 'pending' | 'failed';
  accessGranted: boolean;
  unlockedAt: string;
  teiAccessTier: string;
}

export interface PaymentServiceConfig {
  status: string;
  provider: 'stripe';
  isLiveConfigured: boolean;
  publishableKey: string;
  supportedCurrencies: string[];
  acceptedMethods: string[];
  mode: 'live' | 'sandbox';
}

export interface SourceRepository {
  id: string;
  name: string;
  url: string;
  branch: string;
  commitHash: string;
  fileCount: number;
  lastSync: string;
  status: 'active' | 'syncing' | 'error' | 'idle';
  description: string;
}

export interface SystemReadingList {
  id: string;
  type: 'language' | 'author' | 'repo';
  title: string;
  subtitle: string;
  description: string;
  count: number;
  languageCode?: LanguageCode;
  authorId?: string;
  repoId?: string;
  sampleWorkTitles: string[];
}

export type SearchMode = 'author' | 'title' | 'grep' | 'lucene' | 'vector';

export interface SearchResult {
  id: string;
  mode: SearchMode;
  // 'author' results navigate to the author page (onSelectAuthor) - they
  // are NOT works, even though they used to be typed as one, which is how
  // clicking an author hit used to land on "Work not found".
  type: 'work' | 'chapter' | 'snippet' | 'author';
  workId: string;
  workTitle: string;
  authorId?: string;
  authorName: string;
  chapterId?: string;
  chapterTitle?: string;
  chapterNumber?: number;
  snippet: string;
  score?: number;
  matchLine?: number;
  language: LanguageCode;
  matchDetails?: string;
}

export interface Quotation {
  id: string;
  workId: string;
  workTitle: string;
  authorName: string;
  chapterId: string;
  chapterTitle: string;
  chapterNumber: number;
  text: string;
  startOffset: number;
  endOffset: number;
  createdAt: string;
  creatorName?: string;
  note?: string;
  language: LanguageCode;
}

export type CollectionItemType = 'work' | 'chapter' | 'quote';

export interface CollectionItem extends CollectionEntry {
  type: CollectionItemType;
  referenceId: string; // workId, chapterId, or quoteId
  workId: string;
  workTitle: string;
  authorName: string;
  chapterId?: string;
  chapterTitle?: string;
  quoteText?: string;
  note?: string;
}

/** Favourites, user-curated collections and saved searches - mirrors the server's ItemCollection. */
export type CollectionKind = 'favorites' | 'user' | 'search';

export interface CollectionEntry {
  id: string; // UUID
  addedAt: string;
}

export interface Collection<Entry extends CollectionEntry = CollectionEntry> {
  id: string; // UUID
  kind: CollectionKind;
  name: string;
  createdAt: string;
  updatedAt: string;
  items: Entry[];
}

export interface PersonalCollection extends Collection<CollectionItem> {
  kind: 'favorites' | 'user';
  userId: string;
  description?: string;
  isDefaultFavorites: boolean;
}

export interface SavedSearchItem extends CollectionEntry {
  workId: string; // stable authorId/opusId path
  chapterId?: string;
  workTitle: string;
  authorName: string;
  chapterTitle?: string;
  snippet: string;
  score?: number;
}

/** The results of a search, kept as a collection; its name defaults to the query and is editable. */
export interface SavedSearch extends Collection<SavedSearchItem> {
  kind: 'search';
  query: string;
  mode?: SearchMode;
}

export interface User {
  id: string;
  email: string;
  name: string;
  role: 'reader' | 'admin';
  avatar?: string;
  authProvider: 'google' | 'password';
}

export interface AdminStatus {
  serverVersion: string;
  serverBuild: string;
  uptime: string;
  teiEngineStatus: {
    status: 'healthy' | 'degraded' | 'error';
    parserVersion: string;
    schemaValidation: 'strict' | 'lenient';
  };
  luceneIndexStatus: {
    status: 'healthy' | 'rebuilding' | 'empty';
    docsIndexed: number;
    /** Real values come from /api/lucene/status; absent = unknown, not zero. */
    lastRebuilt?: string;
    indexSizeBytes?: number;
  };
  vectorSearchStatus: {
    available: boolean;
    provider: string;
    /** Real values only where a live source exists (the vectorizer's
     * /api/vectorizing job state); absent = unknown, not invented. */
    model?: string;
    dimensions?: number;
    vectorsCount?: number;
    averageLatencyMs?: number;
    state?: string;
    degradationReason?: string;
  };
  repos: SourceRepository[];
  reimportLogs: {
    id: string;
    timestamp: string;
    mode: 'fresher-only' | 'full' | 'single-file' | 'force-full';
    repoId: string;
    status: 'success' | 'running' | 'failed';
    message: string;
    affectedFilesCount: number;
  }[];
}

export type ReaderTheme = 'parch' | 'paper' | 'night';
export type ReaderFontFamily = 'serif' | 'gentium' | 'sans' | 'mono';
export type ReaderWidth = 'narrow' | 'standard' | 'wide';

export type AppView = 'browse' | 'author' | 'work' | 'reader' | 'search' | 'collections' | 'admin' | 'quote' | 'notFound';

// BrowseView's catalog sub-tabs - part of the URL (/app, /app#authors,
// /app#lists) so each tab is a bookmarkable, back-button-addressable page.
export type CatalogTab = 'works' | 'authors' | 'reading-lists';

// The full URL-addressable state of the browse catalog. Everything in
// here round-trips through the fragment (see router.ts): the tab plus
// the per-tab query, filters and page, so any catalog position is a
// bookmarkable address.
export type CatalogAccessFilter = 'all' | 'free' | 'premium' | 'unlocked';
export type CatalogListType = 'all' | 'language' | 'author' | 'repo';
export interface CatalogState {
  tab: CatalogTab;
  worksQuery: string;
  worksLang: LanguageCode | 'all';
  worksAccess: CatalogAccessFilter;
  worksPage: number;
  authorsQuery: string;
  authorsPage: number;
  listsType: CatalogListType;
}
