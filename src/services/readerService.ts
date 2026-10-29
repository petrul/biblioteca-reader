import { fetchSourceTarget } from './fragmentApi';
import { searchTargetPath } from './searchTargets';
import {
  Author,
  Work,
  Chapter,
  SourceRepository,
  SystemReadingList,
  SearchMode,
  SearchResult,
  Quotation,
  PersonalCollection,
  CollectionItem,
  User,
  AdminStatus,
  LanguageCode,
  BookPurchaseReceipt,
  PaymentServiceConfig
} from '../types/textbase';
import { newId } from './ids';
import { buildAppPath } from '../router';
import { LocalPreferencesStore, PreferencesStore } from './preferencesStore';
import { chapterCache } from './chapterCache';
import {
  ServerHttpError,
  fetchRealAuthorPage,
  fetchRealAuthorById,
  authorFromServer,
  workFromServerDiv,
  fetchRealAuthors,
  fetchRealChapterContent,
  fetchRealChaptersForWork,
  fetchRealRepos,
  fetchRealWorkByPath,
  fetchRealWorkPage,
  fetchRandomServerLocation,
  fetchRealFeaturedWorks,
  realSearch,
  trackedFetch,
  fetchPaymentConfig,
  postPaymentIntent,
  confirmPaymentPurchase,
  fetchLuceneRebuildStatus,
  fetchVectorizingStatus
} from './serversideApi';

// Bounds a single search mode's own call (searchCombined) so one
// slow/stuck mode - e.g. vector search behind a GPU-contended Ollama on
// the server - can never hold up the other 4, or the overall combined
// search. Resolves to `fallback` instead of rejecting/hanging past this
// point; the real request may still be in flight server-side, this just
// stops waiting on it client-side.
const PER_MODE_TIMEOUT_MS = 10_000;

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise<T>(resolve => {
    const timer = setTimeout(() => resolve(fallback), ms);
    promise.then(value => { clearTimeout(timer); resolve(value); });
  });
}

// --- live textbase-server data ---
//
// Only requested pages and individually resolved entities are kept in memory.
// There is no global catalogue download, boot load, or refresh.
let realWorks: Work[] = [];
let realFeaturedWorks: Work[] = [];
let realAuthors: Author[] = [];
const authorLoadInFlight = new Set<string>();
// Authors whose opera were fetched and mapped into realWorks by
// loadAuthorById - the only state that may skip a reload (see the
// guard there). Mere presence in realAuthors is NOT hydration: the
// authors page listing puts authors there without their works.
// Author detail is independent of the visible catalogue page. Replacing a
// works/authors page must not erase the data behind an already hydrated author.
const hydratedAuthors = new Map<string, { author: Author; works: Work[] }>();
let realAuthorsTotal = 0;
let realAuthorsTotalPages = 1;
let realRepoNames: string[] = [];
let realWorksTotal = 0;
let realWorksTotalPages = 1;
let loadedAuthorsPageKey = '';
let loadedWorksPageKey = '';
let worksPageInFlight = false;
const realChapters = new Map<string, Chapter[]>();
// A failed TOC request must not be retried from every React render. This is
// especially important when the server returns a deterministic XML error:
// WorkView calls getChaptersForWork during render, so clearing the in-flight
// marker on failure otherwise creates an endless request/render loop.
const chapterLoadFailures = new Set<string>();
const chapterLoads = new Set<string>();
const contentLoads = new Set<string>();
const contentLoadFailures = new Set<string>();
const missingContent = new Set<string>();
const missingChapterLoads = new Set<string>();
const missingChapterFailures = new Set<string>();
// Deep-link fast path: a work fetched individually before its page arrives
// is kept temporarily alongside the currently visible page.
const pendingWorks = new Map<string, Work>();
const workFetches = new Set<string>();
const workLoadFailures = new Set<string>();
const missingWorks = new Set<string>();
// Neighbor-chapter prefetches already in flight (see prefetchChapterContent).
const contentPrefetches = new Set<string>();

function isLiveWorkId(workId: string): boolean {
  return realWorks.some(work => work.id === workId)
    || realFeaturedWorks.some(work => work.id === workId)
    || pendingWorks.has(workId);
}

// Deep links fetch only the requested work, independently of browse pages.
function ensureWorkById(workId: string): void {
  // The catalogue is paged, so a settled first page does not imply that this
  // canonical work is present. Deep links must still fetch their work directly.
  if (isLiveWorkId(workId) || workFetches.has(workId) || workLoadFailures.has(workId)) return;
  workFetches.add(workId);
  void fetchRealWorkByPath(workId)
    .then(work => {
      if (work) {
        pendingWorks.set(work.id, work);
        notify();
      }
    })
  .catch(error => {
    workLoadFailures.add(workId);
    if (error instanceof ServerHttpError && error.status === 404) missingWorks.add(workId);
    console.warn(`single-work fetch failed for ${workId}`, error);
    recordRequestFailure(error);
  })
    .finally(() => { workFetches.delete(workId); notify(); });
}

// Silently warms the localStorage chapter cache for one chapter: no
// chapter object is touched and nobody is notified - the only observable
// effect is that navigating to this chapter later is a chapterCache hit,
// which loadChapterContent serves with no network round trip at all.
function prefetchChapterContent(chapter: Chapter): void {
  // A section is a tiny skeleton fetched on demand; its bare path would
  // download the whole subtree.
  if (chapter.isSection) return;
  prefetchChapterContentByPath(chapter.workId, chapter.id);
}

// Same cache-warming as prefetchChapterContent, but keyed by the full
// stable paths Random Discovery already knows (author/opus/chapter) - no
// Chapter object needed. Called the moment the pick lands so the fetch
// races the reader's own work + TOC loads; loadChapterContent then finds
// a cache hit instead of paying another serial round trip.
function prefetchChapterContentByPath(workId: string, chapterId: string): void {
  if (chapterCache.get(workId, chapterId) || contentPrefetches.has(chapterId)) return;
  contentPrefetches.add(chapterId);
  void fetchRealChapterContent(chapterId)
    .then(content => {
      if (content) {
        chapterCache.set(workId, chapterId, {
          htmlContent: content.htmlContent,
          plainText: content.plainText,
          noteCount: content.noteCount,
          sentenceCount: content.sentenceCount
        });
      }
    })
    .catch(error => console.warn(`chapter prefetch failed for ${chapterId}`, error))
    .finally(() => { contentPrefetches.delete(chapterId); });
}
const listeners = new Set<() => void>();

function notify(): void {
  listeners.forEach(listener => listener());
}

// Connectivity follows actual requests, never a catalogue re-fetch.
let serverDown = false;
let featuredLoading = false;
let featuredRequested = false;
let reposRequested = false;
let connectionRetry: Promise<void> | undefined;
const failedPageRetries = new Map<string, () => Promise<void>>();

function recordRequestFailure(error?: unknown): void {
  if (error instanceof ServerHttpError && error.status < 500) return;
  serverDown = true;
  notify();
}

function ensureFeaturedWorks(): void {
  if (featuredRequested) return;
  featuredRequested = true;
  featuredLoading = true;
  void fetchRealFeaturedWorks()
    .then(works => { realFeaturedWorks = works; })
    .catch(error => { console.warn('featured works failed', error); recordRequestFailure(error); })
    .finally(() => { featuredLoading = false; notify(); });
}

function ensureRepos(): void {
  if (reposRequested) return;
  reposRequested = true;
  void fetchRealRepos()
    .then(repos => { realRepoNames = repos; })
    .catch(error => { console.warn('repositories failed', error); recordRequestFailure(error); })
    .finally(notify);
}

async function retryServerConnection(): Promise<void> {
  if (connectionRetry) return connectionRetry;
  // Existing lightweight server status route; no author/work pages are fetched.
  connectionRetry = (async () => {
    try {
      const response = await trackedFetch('/api/lucene/status', { signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new ServerHttpError('server status request failed', response.status);
      serverDown = false;
      for (const id of contentLoadFailures) if (!missingContent.has(id)) contentLoadFailures.delete(id);
      for (const id of missingChapterFailures) if (!missingContent.has(id)) missingChapterFailures.delete(id);
      for (const id of workLoadFailures) if (!missingWorks.has(id)) workLoadFailures.delete(id);
      await Promise.all([...failedPageRetries.values()].map(retry => retry()));
    } catch (error) {
      recordRequestFailure(error);
    } finally {
      connectionRetry = undefined;
      notify();
    }
  })();
  return connectionRetry;
}

async function loadAuthorsPage(page: number, query: string): Promise<void> {
  const key = `${page}|${query.trim()}`;
  if (key === loadedAuthorsPageKey) return;
  loadedAuthorsPageKey = key;
  failedPageRetries.delete('authors');
  try {
    const result = await fetchRealAuthorPage(page, 12, query);
    realAuthors = await fetchRealAuthors([], result.items);
    realAuthorsTotal = result.totalItems;
    realAuthorsTotalPages = result.totalPages;
    serverDown = false;
    notify();
  } catch (error) {
    loadedAuthorsPageKey = '';
    failedPageRetries.set('authors', () => loadAuthorsPage(page, query));
    serverDown = true;
    console.warn('author page failed', error);
    notify();
  }
}

async function loadWorksPage(page: number, query: string, language?: LanguageCode): Promise<void> {
  const key = `${page}|${query.trim()}|${language || ''}`;
  if (key === loadedWorksPageKey) return;
  loadedWorksPageKey = key;
  failedPageRetries.delete('works');
  worksPageInFlight = true;
  try {
    const result = await fetchRealWorkPage(page, 12, query, [], language);
    realWorks = result.items;
    realWorksTotal = result.totalItems;
    realWorksTotalPages = result.totalPages;
    serverDown = false;
    notify();
  } catch (error) {
    loadedWorksPageKey = '';
    failedPageRetries.set('works', () => loadWorksPage(page, query, language));
    serverDown = true;
    console.warn('work page failed', error);
    notify();
  } finally {
    worksPageInFlight = false;
    notify();
  }
}

function loadChapters(workId: string): void {
  if (chapterLoads.has(workId) || realChapters.has(workId) || chapterLoadFailures.has(workId)) return;
  chapterLoads.add(workId);
  void fetchRealChaptersForWork(workId)
    .then(chapters => realChapters.set(workId, chapters))
    .catch(error => {
      chapterLoadFailures.add(workId);
      console.warn(`failed to load TOC for ${workId}; automatic retries stopped`, error);
      recordRequestFailure(error);
    })
    .finally(() => { chapterLoads.delete(workId); notify(); });
}

function loadChapterContent(chapter: Chapter): void {
  // The failure set is part of the guard: without it every later render's
  // getChapter() re-fired the load, turning one server 500 into an endless
  // retry storm (observed as the same chapter warning dozens of times).
  if (contentLoads.has(chapter.id) || chapter.plainText || chapter.htmlContent || contentLoadFailures.has(chapter.id)) return;

  // Published chapter text never changes underneath a given chapterId -
  // a cache hit is used as-is, no network round trip at all. See
  // chapterCache.ts for the LRU-by-book eviction (foundation for future
  // offline reading, not just a speed win).
  // A section is only its heading and own text - tiny, and always fetched
  // fresh so a cached whole-subtree page can never stand in for it.
  const cached = chapter.isSection ? null : chapterCache.get(chapter.workId, chapter.id);
  if (cached) {
    Object.assign(chapter, cached);
    // Not notify() right away: this runs inside getChapter(), which
    // ReaderView calls while rendering, and a synchronous notify sets App's
    // state mid-render (React's "Cannot update a component while rendering
    // a different component" on every page turn to a prefetched chapter).
    // The current render already sees the content assigned above.
    queueMicrotask(notify);
    return;
  }

  contentLoads.add(chapter.id);
  void fetchRealChapterContent(chapter.id, () => missingContent.add(chapter.id), chapter.isSection)
    .then(content => {
      if (content) {
        contentLoadFailures.delete(chapter.id);
        Object.assign(chapter, content);
        if (!chapter.isSection) chapterCache.set(chapter.workId, chapter.id, {
          htmlContent: content.htmlContent,
          plainText: content.plainText,
          noteCount: content.noteCount,
          sentenceCount: content.sentenceCount
        });
      } else {
        // Stop the spinner on failure; a confirmed 404 is not a server outage.
        contentLoadFailures.add(chapter.id);
        if (!missingContent.has(chapter.id)) recordRequestFailure();
      }
    })
    .finally(() => { contentLoads.delete(chapter.id); notify(); });
}

// Resolve exceptional genuine divisions omitted from a loaded TOC.
// A paragraph/fragment must never be appended as a synthetic chapter.
function loadMissingChapter(workId: string, chapterId: string, chapters: Chapter[]): void {
  if (missingChapterLoads.has(chapterId) || missingChapterFailures.has(chapterId)) return;
  missingChapterLoads.add(chapterId);
  const parent = chapters
    .filter(chapter => chapterId.startsWith(`${chapter.id}/`))
    .sort((a, b) => b.id.length - a.id.length)[0];
  void fetchSourceTarget(chapterId).then(target => {
    if (target.kind !== 'page') throw new Error('A fragment is not a reading chapter');
    return fetchRealChapterContent(chapterId, () => missingContent.add(chapterId));
  }).then(content => {
      if (!content) {
        missingChapterFailures.add(chapterId);
        if (!missingContent.has(chapterId)) recordRequestFailure();
        return;
      }
      const chapter: Chapter = {
        id: chapterId,
        workId,
        chapterNumber: (parent?.chapterNumber ?? chapters.length) + 1,
        title: parent?.title ?? chapterId.split('/').at(-1) ?? 'Chapter',
        wordCount: content.plainText.trim() ? content.plainText.trim().split(/\s+/).length : 0,
        htmlContent: content.htmlContent,
        plainText: content.plainText,
        noteCount: content.noteCount,
        sentenceCount: content.sentenceCount,
        illustrations: [],
        footnotes: []
      };
      const current = realChapters.get(workId) ?? chapters;
      if (!current.some(existing => existing.id === chapterId)) current.push(chapter);
      realChapters.set(workId, current);
      chapterCache.set(workId, chapterId, {
        htmlContent: content.htmlContent,
        plainText: content.plainText,
        noteCount: content.noteCount,
        sentenceCount: content.sentenceCount
      });
    })
    .catch(error => {
      missingChapterFailures.add(chapterId);
      console.warn(`failed to load deep-linked chapter ${chapterId}`, error);
    })
    .finally(() => { missingChapterLoads.delete(chapterId); notify(); });
}

function liveReadingLists(): SystemReadingList[] {
  const lists: SystemReadingList[] = [];
  const addGroups = <T extends string>(
    type: SystemReadingList['type'],
    groups: Map<T, Work[]>,
    title: (key: T) => string
  ) => groups.forEach((works, key) => lists.push({
    id: `live-${type}-${key}`,
    type,
    title: title(key),
    subtitle: 'Live textbase-server collection',
    description: `Generated from the current textbase-server ${type} index.`,
    count: works.length,
    languageCode: type === 'language' ? key as LanguageCode : undefined,
    authorId: type === 'author' ? key : undefined,
    repoId: type === 'repo' ? key : undefined,
    sampleWorkTitles: works.slice(0, 4).map(work => work.title)
  }));
  const languages = new Map<LanguageCode, Work[]>();
  const authors = new Map<string, Work[]>();
  const repos = new Map<string, Work[]>();
  realWorks.forEach(work => {
    languages.set(work.detectedLanguage, [...(languages.get(work.detectedLanguage) || []), work]);
    authors.set(work.authorId, [...(authors.get(work.authorId) || []), work]);
    repos.set(work.sourceRepo, [...(repos.get(work.sourceRepo) || []), work]);
  });
  addGroups('language', languages, key => `${key.toUpperCase()} works`);
  addGroups('author', authors, key => realAuthors.find(author => author.id === key)?.name || key);
  addGroups('repo', repos, key => key);
  return lists;
}

// Storage keys
const STORAGE_COLLECTIONS_KEY = 'biblioteca_reader_collections';
const STORAGE_QUOTES_KEY = 'biblioteca_reader_quotations';
const STORAGE_USER_KEY = 'biblioteca_reader_user';
const STORAGE_ADMIN_STATE_KEY = 'biblioteca_reader_admin_state';
const STORAGE_PURCHASES_KEY = 'biblioteca_reader_purchased_receipts';
const STORAGE_RECENT_WORKS_KEY = 'biblioteca_reader_recent_works';

// The localStorage scope for a browser with no signed-in user - a bucket,
// not an identity: demo-scope features (collections, purchases, recent
// works) key their storage off this instead of a fabricated persona.
export const ANONYMOUS_USER_ID = 'anonymous';
const PAYMENT_ENTITLEMENTS_ENABLED = false;

// Persona ids the app's pre-populating steps used to auto-create and
// persist (getCurrentUser's old auto-default, plus AuthModal's
// quick-persona selection) - i.e. fabricated identities, never real
// sign-ins.
const DEMO_PERSONA_IDS = ['usr-scholar-1', 'usr-admin-root', 'usr-admin-demo', 'usr-scholar-reader'];

// Demo personas are in-memory-only (see DEFAULT_DEMO_USER): no code path
// may persist anything scoped to them - loadStoredCollections and
// saveStoredCollections skip localStorage for exactly these ids.
const isDemoPersona = (userId: string): boolean => DEMO_PERSONA_IDS.includes(userId);

// Drops one demo persona's seeded collections key, but only when the reader
// never actually added anything to it - pristine demo shape goes, real
// accumulated content stays.
function dropPristineDemoCollections(id: string): void {
  const colsRaw = localStorage.getItem(`${STORAGE_COLLECTIONS_KEY}_${id}`);
  if (!colsRaw) return;
  try {
    const cols = JSON.parse(colsRaw) as PersonalCollection[];
    const hasRealItems = cols.some(c => (c.items?.length ?? 0) > 0);
    if (!hasRealItems) localStorage.removeItem(`${STORAGE_COLLECTIONS_KEY}_${id}`);
  } catch {
    localStorage.removeItem(`${STORAGE_COLLECTIONS_KEY}_${id}`);
  }
}

// One-time-per-load cleanup for browsers that still carry pre-populated
// demo data from before the no-auto-persist rule: drops the persisted
// fake persona and the demo-persona-scoped keys it seeded. The persona
// itself is no longer persisted (getCurrentUser's in-memory default), so
// the collections sweep must run even with no STORAGE_USER_KEY at all -
// otherwise a seeded key just sits there forever, and deleting it by
// hand only lasted until the next collections read re-seeded it.
function purgeStaleDemoPersonaStorage() {
  try {
    for (const id of DEMO_PERSONA_IDS) dropPristineDemoCollections(id);
    const raw = localStorage.getItem(STORAGE_USER_KEY);
    if (raw === null) return;
    // An empty/garbage value (older sessions left one behind) is stale
    // by definition.
    if (raw.trim() === '') {
      localStorage.removeItem(STORAGE_USER_KEY);
      return;
    }
    const stored = JSON.parse(raw) as User | null;
    const id = stored?.id;
    if (!id || !DEMO_PERSONA_IDS.includes(id)) return;
    localStorage.removeItem(STORAGE_USER_KEY);
    // Fake purchase receipts under a demo persona are pure demo data.
    localStorage.removeItem(`${STORAGE_PURCHASES_KEY}_${id}`);
  } catch (e) {
    // Unreadable persona storage is stale by definition - drop the key.
    try { localStorage.removeItem(STORAGE_USER_KEY); } catch { /* nothing more to do */ }
  }
}

// Seconds -> "3 days, 4 hours" / "5 hours, 12 min" / "7 min", for the admin
// cards' uptime display (source: the server's process.uptime metric).
function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days} days, ${hours} hours`;
  if (hours > 0) return `${hours} hours, ${minutes} min`;
  return `${minutes} min`;
}

// State holder for admin toggles
let adminState: {
  vectorSearchAvailable: boolean;
  /** The admin "Simulate Disconnect / Reconnect Sidecar" toggle: null
   * = no override, the live vectorizer job state decides; a value
   * wins over it (both directions) until toggled back. */
  vectorSearchOverride: boolean | null;
  isReindexing: boolean;
  docsIndexed: number;
  reimportLogs: AdminStatus['reimportLogs'];
} = {
  vectorSearchAvailable: true,
  vectorSearchOverride: null,
  isReindexing: false,
  // Never a plausible number or an invented log here - getAdminStatus()'s
  // own rule: plausible fakes go stale and misreport the deployed
  // services (the 14280-doc seed and the two made-up "Ingested 4 TEI
  // files" re-import logs did exactly that on the admin drawer's first
  // paint). The placeholder is zeros and no logs; fetchAdminStatus()
  // overlays the real values.
  docsIndexed: 0,
  reimportLogs: []
};

// Initialize localStorage if needed
// Collections are served synchronously from this cache (every view reads
// them during render) and persisted through ONE interface, PreferencesStore
// (its `collections` key): this browser's localStorage for an anonymous
// reader, the account (biblioteca-server's per-reader preferences document)
// once attachCollectionsStore() is called for a signed-in reader.
const collectionsCache = new Map<string, PersonalCollection[]>();
const collectionsStores = new Map<string, PreferencesStore>();
const collectionWrites = new Map<string, Promise<void>>();
const collectionSaveErrors = new Map<string, string>();
let localPreferences: LocalPreferencesStore | undefined;
function localPreferencesStore(): LocalPreferencesStore {
  return localPreferences ??= new LocalPreferencesStore(localStorage);
}

/** Exposed for tests only: forget every cached collection and attached store. */
export function resetCollectionsForTests(): void {
  collectionsCache.clear();
  collectionsStores.clear();
  collectionWrites.clear();
  collectionSaveErrors.clear();
  localPreferences = undefined;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Brings stored collections up to the current shape: a `kind` on each, and
 * UUID ids in place of the old `col-...` / `item-...` ones.
 */
export function normalizeCollections(cols: unknown): PersonalCollection[] {
  if (!Array.isArray(cols)) return [];
  return cols
    .filter((col): col is PersonalCollection => Boolean(col && typeof col === 'object'))
    .map(col => {
      const items = Array.isArray(col.items)
        ? col.items.filter(item => Boolean(item && typeof item === 'object'))
        : [];
      return {
        ...col,
        id: typeof col.id === 'string' && UUID_PATTERN.test(col.id) ? col.id : newId(),
        kind: col.isDefaultFavorites ? 'favorites' : 'user',
        items: items.map(item => (
          typeof item.id === 'string' && UUID_PATTERN.test(item.id) ? item : { ...item, id: newId() }
        ))
      };
    });
}

function defaultCollections(userId: string): PersonalCollection[] {
  return [
    {
      id: newId(),
      kind: 'favorites',
      userId,
      name: 'Favorites',
      description: 'Your primary bookmarked works, chapters, and notable quotations.',
      isDefaultFavorites: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      // Intentionally empty: the old seeded Favorites entries and the
      // Classical Philosophy demo collection are retained in git history as
      // design inspiration, but must not appear as user data.
      items: []
    }
  ];
}

// The pre-PreferencesStore per-user localStorage key, read once to migrate.
function readLegacyCollections(userId: string): PersonalCollection[] | null {
  try {
    const raw = localStorage.getItem(`${STORAGE_COLLECTIONS_KEY}_${userId}`);
    if (!raw) return null;
    const stored = JSON.parse(raw) as PersonalCollection[];
    // Remove the legacy seeded demo records.
    return stored
      .filter(collection => collection.id !== 'col-classical-philosophy')
      .map(collection => ({
        ...collection,
        items: collection.items.filter(item => !['fav-item-1', 'fav-item-2', 'item-phil-1', 'item-phil-2'].includes(item.id))
      }));
  } catch (e) {
    console.error('Failed to read legacy collections', e);
    return null;
  }
}

const copyCollections = (cols: PersonalCollection[]): PersonalCollection[] => JSON.parse(JSON.stringify(cols));

function loadStoredCollections(userId: string): PersonalCollection[] {
  const cached = collectionsCache.get(userId);
  if (cached) return copyCollections(cached);
  // Not attached to an account store: this browser's local preferences,
  // else the legacy per-user key (migrated into them), else the defaults.
  // Written quietly - this runs during render, where a notify() must not fire.
  let cols = localPreferencesStore().getSync().collections ?? null;
  const migrated = cols ? normalizeCollections(cols) : null;
  if (cols && JSON.stringify(migrated) !== JSON.stringify(cols)) {
    cols = migrated;
    if (!collectionsStores.has(userId)) void localPreferencesStore().set({ collections: cols }).catch(e => console.error(e));
  }
  if (!cols) {
    cols = normalizeCollections(readLegacyCollections(userId) ?? defaultCollections(userId));
    if (!collectionsStores.has(userId)) void localPreferencesStore().set({ collections: cols }).catch(e => console.error(e));
  }
  collectionsCache.set(userId, cols);
  return copyCollections(cols);
}

// Every collection change notifies subscribers (App re-renders on it), so
// views reading collections - CollectionsView, the reader's bookmark icon -
// show a chapter saved anywhere else at once. Loading never writes through
// here, so no notification fires while a component renders.
function saveStoredCollections(userId: string, cols: PersonalCollection[]) {
  collectionsCache.set(userId, copyCollections(cols));
  const store = collectionsStores.get(userId) ?? localPreferencesStore();
  const pending = store.set({ collections: copyCollections(cols) });
  collectionWrites.set(userId, pending);
  void pending.then(() => {
    if (collectionWrites.get(userId) === pending) collectionSaveErrors.delete(userId);
    notify();
  }, error => {
    if (collectionWrites.get(userId) === pending) {
      collectionSaveErrors.set(userId, 'Your collections could not be saved. Keep this page open and retry.');
    }
    console.error('Failed to store collections', error);
    notify();
  });
  notify();
}

function loadStoredQuotes(): Quotation[] {
  try {
    const raw = localStorage.getItem(STORAGE_QUOTES_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) {
    console.error(e);
  }
  // First run: seed with an empty list - quotations are the reader's own,
  // never demo content.
  try {
    localStorage.setItem(STORAGE_QUOTES_KEY, JSON.stringify([]));
  } catch (e) {
    console.error(e);
  }
  return [];
}

function saveStoredQuotes(quotes: Quotation[]) {
  try {
    localStorage.setItem(STORAGE_QUOTES_KEY, JSON.stringify(quotes));
  } catch (e) {
    console.error(e);
  }
}

export const readerService = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  isLiveWork(workId: string): boolean {
    return isLiveWorkId(workId);
  },

  /** True while a deep-linked work, its TOC, or its chapter text is loading. */
  isWorkLoading(workId: string): boolean {
    const missingChapterLoading = [...missingChapterLoads].some(path => path === workId || path.startsWith(`${workId}/`));
    return workFetches.has(workId) || chapterLoads.has(workId) || contentLoads.has(workId)
      || missingChapterLoading;
  },

  // See serverDown's own doc comment above.
  isServerDown(): boolean {
    return serverDown;
  },

  // True when the chapter's content load failed (404 or unreachable server)
  // after having been requested - the difference between "still streaming"
  // and "will never arrive", so the reader stops spinning and can show its
  // not-available state.
  isChapterContentFailed(chapterId: string): boolean {
    return contentLoadFailures.has(chapterId);
  },

  isFeaturedLoading(): boolean {
    return featuredLoading;
  },

  isWorksLoading(): boolean {
    return worksPageInFlight;
  },

  retryServerConnection(): Promise<void> {
    return retryServerConnection();
  },

  // --- AUTHORS ---
  getAuthors(page = 1, pageSize = 8, query = ''): { authors: Author[]; total: number; totalPages: number } {
    const authors = [...realAuthors];
    return {
      authors,
      total: realAuthorsTotal || authors.length,
      totalPages: realAuthorsTotalPages || 1
    };
  },

  loadAuthorsPage(page: number, query = ''): Promise<void> {
    return loadAuthorsPage(page, query);
  },

  loadAuthorById(id: string): Promise<void> {
    // Only a FULLY HYDRATED author (opera fetched and mapped into
    // realWorks) may skip the load. realAuthors alone is not enough:
    // the authors PAGE listing also puts authors there, without their
    // works - and with the old "already in realAuthors" guard a click
    // on such an author no-op'ed and the page showed 0 works
    // (/app/author/adler after browsing the catalog).
    if (hydratedAuthors.has(id) || authorLoadInFlight.has(id)) return Promise.resolve();
    authorLoadInFlight.add(id);
    notify();
    return fetchRealAuthorById(id)
      .then(async dto => {
        const author = authorFromServer(dto, realWorks);
        // The author endpoint's opera projection intentionally contains only
        // lightweight catalogue fields and does not include TeiOpus metadata
        // such as coverUrl. Hydrate each canonical work through /api/divs so
        // generated covers are shown on author pages too; workFromServerDiv
        // still supplies the default-cover fallback when no URL exists.
        const authorWorks = await Promise.all((dto.opera || []).map(async opus => {
          const path = (opus as any).completePath || (opus as any).path;
          // fetchRealWorkByPath already maps its div through
          // workFromServerDiv - it RETURNS a Work. Mapping that Work
          // through workFromServerDiv AGAIN produced empty works (a
          // Work carries no head/path/author, so the second mapping
          // fell through every fallback: empty titles, 1 chapter,
          // 'Anonymous'). The opus DTO is mapped here only as the
          // fallback when the hydration call failed.
          const detailed = path ? await fetchRealWorkByPath(path).catch(() => null) : null;
          const work = detailed || workFromServerDiv(opus as any, author.imageHref);
          return { ...work, authorId: author.id, authorName: author.name };
        }));
        realWorks = [...realWorks.filter(work => work.authorId !== author.id), ...authorWorks];
        realAuthors = [...realAuthors.filter(item => item.id !== author.id), author];
        // only after the works landed is the author fully loaded -
        // the skip-guard's currency (a failure below keeps it unset,
        // so the next visit retries the hydration)
        const detail = { author, works: authorWorks };
        hydratedAuthors.set(author.id, detail);
        hydratedAuthors.set(id, detail);
      })
      .finally(() => {
        authorLoadInFlight.delete(id);
        notify();
      });
  },

  isAuthorLoading(id: string): boolean {
    return authorLoadInFlight.has(id);
  },

  getAuthorById(id: string): Author | undefined {
    return hydratedAuthors.get(id)?.author ?? realAuthors.find(a => a.id === id || a.canonicalId === id);
  },

  getAuthorWorks(authorId: string): Work[] {
    return hydratedAuthors.get(authorId)?.works ?? realWorks.filter(w => w.authorId === authorId);
  },

  // --- WORKS ---
  getWorks(
    page = 1, 
    pageSize = 6, 
    options?: { language?: LanguageCode; repo?: string; authorId?: string; query?: string }
  ): { works: Work[]; total: number; totalPages: number } {
    let list = [...realWorks];
    if (options?.language) {
      list = list.filter(w => w.detectedLanguage === options.language);
    }
    if (options?.repo) {
      list = list.filter(w => w.sourceRepo === options.repo);
    }
    if (options?.authorId) {
      list = list.filter(w => w.authorId === options.authorId);
    }
    if (options?.query && options.query.trim()) {
      const q = options.query.toLowerCase();
      list = list.filter(w =>
        w.title.toLowerCase().includes(q) ||
        (w.subtitle && w.subtitle.toLowerCase().includes(q)) ||
        w.authorName.toLowerCase().includes(q) ||
        w.tags.some(t => t.toLowerCase().includes(q)) ||
        w.summary.toLowerCase().includes(q)
      );
    }
    const works = list.map(w => ({
      ...w,
      isPurchased: this.isWorkUnlocked(w.id)
    }));
    return {
      works,
      total: realWorksTotal || works.length,
      totalPages: realWorksTotalPages || 1
    };
  },

  loadWorksPage(page: number, query = '', language?: LanguageCode): Promise<void> {
    return loadWorksPage(page, query, language);
  },

  getFeaturedWorks(): Work[] {
    ensureFeaturedWorks();
    return realFeaturedWorks.map(work => ({
      ...work,
      isPurchased: this.isWorkUnlocked(work.id)
    }));
  },

  /**
   * A work's cover changed (the admin's "Generate cover"): every copy of it
   * held here - the loaded catalog page, the featured shelf, single-work
   * loads, author pages - shows the new one at once. Without this, going
   * back to an already-loaded catalog page kept the old cover: the page is
   * not fetched again. (Each render has a new object URL, so no HTTP cache
   * is involved.)
   */
  setWorkCover(workId: string, coverUrl: string): void {
    const withCover = (work: Work): Work =>
      work.id === workId ? { ...work, coverImage: coverUrl, coverArtUrl: coverUrl } : work;
    realWorks = realWorks.map(withCover);
    realFeaturedWorks = realFeaturedWorks.map(withCover);
    const pending = pendingWorks.get(workId);
    if (pending) pendingWorks.set(workId, withCover(pending));
    for (const [authorId, entry] of hydratedAuthors) {
      if (entry.works.some(work => work.id === workId))
        hydratedAuthors.set(authorId, { ...entry, works: entry.works.map(withCover) });
    }
    notify();
  },

  getWorkById(id: string): Work | undefined {
    const work = realWorks.find(w => w.id === id)
      || realFeaturedWorks.find(w => w.id === id)
      || pendingWorks.get(id);
    if (!work) {
      // Resolve the canonical work directly, without loading browse pages.
      ensureWorkById(id);
      return undefined;
    }
    return {
      ...work,
      isPurchased: this.isWorkUnlocked(work.id)
    };
  },

  // --- WORKSPACE (recently consulted works) ---
  recordWorkViewed(userId: string, workId: string) {
    try {
      const key = `${STORAGE_RECENT_WORKS_KEY}_${userId}`;
      const raw = localStorage.getItem(key);
      const ids: string[] = raw ? JSON.parse(raw) : [];
      const next = [workId, ...ids.filter(id => id !== workId)].slice(0, 12);
      localStorage.setItem(key, JSON.stringify(next));
    } catch (e) {
      console.error(e);
    }
  },

  getRecentlyViewedWorks(userId: string, limit = 12): Work[] {
    try {
      const raw = localStorage.getItem(`${STORAGE_RECENT_WORKS_KEY}_${userId}`);
      const ids: string[] = raw ? JSON.parse(raw) : [];
      return ids
        .map(id => this.getWorkById(id))
        .filter((w): w is Work => Boolean(w))
        .slice(0, limit);
    } catch (e) {
      console.error(e);
      return [];
    }
  },

  getRandomWork(): Work {
    const allWorks = [...realWorks];
    const randomIndex = Math.floor(Math.random() * allWorks.length);
    return allWorks[randomIndex];
  },

  getRandomChapter(): { work: Work; chapter: Chapter } {
    const work = this.getRandomWork();
    const chapters = this.getChaptersForWork(work.id);
    const readable = chapters.filter(c => !c.isSection);
    const chapter = (readable.length ? readable : chapters)[Math.floor(Math.random() * (readable.length || chapters.length))];
    return { work, chapter };
  },

  // --- CHAPTERS ---
  getChaptersForWork(workId: string): Chapter[] {
    if (isLiveWorkId(workId)) {
      const cached = realChapters.get(workId);
      if (!cached) loadChapters(workId);
      return cached || [];
    }
    // Unknown work: no fabricated chapters - a TOC exists only once
    // textbase-server provides it (see loadChapters).
    return [];
  },

  chapterLoadFailed(workId: string): boolean {
    return chapterLoadFailures.has(workId);
  },


  getChapter(workId: string, chapterId: string): Chapter | undefined {
    const chapters = this.getChaptersForWork(workId);
    // Never substitute the first chapter for an explicitly requested one.
    // During a deep link the TOC is initially empty; falling back here made
    // the reader show the wrong chapter (or briefly report it unavailable).
    const chapter = chapters.find(c => c.id === chapterId);
    if (!chapter && isLiveWorkId(workId) && realChapters.has(workId)) {
      loadMissingChapter(workId, chapterId, chapters);
    }
    if (chapter && isLiveWorkId(workId)) loadChapterContent(chapter);
    return chapter;
  },

  // Warms the localStorage chapter cache for the given chapter's two TOC
  // neighbors (see prefetchChapterContent) - called by ReaderView once
  // the current chapter's own content has landed, so the prefetches never
  // compete with the text the user is waiting for right now. Next/Previous
  // then reads like an offline book: instant, no network at all.
  prefetchChapterNeighbors(workId: string, chapterId: string): void {
    const chapters = this.getChaptersForWork(workId);
    const index = chapters.findIndex(c => c.id === chapterId);
    if (index > 0) prefetchChapterContent(chapters[index - 1]);
    if (index >= 0 && index < chapters.length - 1) prefetchChapterContent(chapters[index + 1]);
  },

  // --- SYSTEM READING LISTS & REPOSITORIES ---
  getReadingLists(type?: 'language' | 'author' | 'repo'): SystemReadingList[] {
    const lists = [...liveReadingLists()];
    if (type) {
      return lists.filter(l => l.type === type);
    }
    return lists;
  },

  getReadingListById(id: string): SystemReadingList | undefined {
    return liveReadingLists().find(l => l.id === id);
  },

  getRepositories(): SourceRepository[] {
    ensureRepos();
    const liveRepos: SourceRepository[] = realRepoNames.map((repo, index) => {
      const id = repo.split('/').filter(Boolean).pop() || `textbase-live-${index + 1}`;
      return {
        id,
        name: id,
        url: repo,
        branch: 'server-managed',
        commitHash: 'live',
        fileCount: realWorks.filter(work => work.sourceRepo === id).length,
        lastSync: new Date().toISOString(),
        status: 'active',
        description: 'Repository reported by the connected textbase-server.'
      };
    });
    return liveRepos;
  },

  // --- FIVE SEARCH MODES ---
  search(mode: SearchMode, query: string, options?: {
    page?: number;
    pageSize?: number;
    language?: LanguageCode;
    caseSensitive?: boolean;
    useRegex?: boolean;
    fuzzy?: boolean;
    workIdSeed?: string;
    throwOnError?: boolean;
    probeNextPage?: boolean;
  }): {
    results: SearchResult[];
    total: number;
    totalPages: number;
    mode: SearchMode;
    vectorUnavailable?: boolean;
    degradationNotice?: string;
    tookMs: number;
  } {
    // All five modes are served live by textbase-server (see searchConnected/
    // searchCombined -> realSearch). The old offline search over the mock
    // corpus is gone - there is no local fallback, so this returns only the
    // empty page shape (plus the vector-unavailable signal) until the live
    // results land.
    if (mode === 'vector' && !adminState.vectorSearchAvailable) {
      return {
        results: [],
        total: 0,
        totalPages: 1,
        mode: 'vector',
        vectorUnavailable: true,
        degradationNotice: 'Vector similarity search is temporarily unavailable. The embedding model endpoint is disconnected or degraded on textbase-server.',
        tookMs: 0
      };
    }
    return { results: [], total: 0, totalPages: 1, mode, tookMs: 0 };
  },

  async searchConnected(mode: SearchMode, query: string, options?: {
    page?: number;
    pageSize?: number;
    language?: LanguageCode;
    caseSensitive?: boolean;
    useRegex?: boolean;
    fuzzy?: boolean;
    workIdSeed?: string;
    throwOnError?: boolean;
    probeNextPage?: boolean;
  }): Promise<{
    results: SearchResult[];
    total: number;
    totalPages: number;
    mode: SearchMode;
    vectorUnavailable?: boolean;
    degradationNotice?: string;
    tookMs: number;
  }> {
    const started = performance.now();
    const page = options?.page || 1;
    const pageSize = options?.pageSize || 6;
    if (mode === 'vector' && !adminState.vectorSearchAvailable) {
      return {
        results: [],
        total: 0,
        totalPages: 1,
        mode: 'vector',
        vectorUnavailable: true,
        degradationNotice: 'Vector similarity search is temporarily unavailable. The embedding model endpoint is disconnected or degraded on textbase-server.',
        tookMs: Math.round(performance.now() - started)
      };
    }
    let live: SearchResult[] = [];
    try {
      live = await realSearch(mode, query, Math.max(50, page * pageSize + (options?.probeNextPage ? 1 : 0)), realWorks);
    } catch (error) {
      if (options?.throwOnError) throw error;
      console.warn(`live ${mode} search unavailable`, error);
    }
    if (options?.language) live = live.filter(result => result.language === options.language);
    const total = live.length;
    const start = (page - 1) * pageSize;
    return {
      results: live.slice(start, start + pageSize),
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
      mode,
      tookMs: Math.round(performance.now() - started)
    };
  },

  // Runs all 5 search modes at once and merges them into one ranked list,
  // for the navbar's live-as-you-type dropdown (see Navbar.tsx) and the
  // Search page's own combined-by-default mode (see SearchView.tsx) - no
  // mode picker in either by default, so a single query has to stand in
  // for all of them. Tiered by confidence, per the user's own stated
  // rule: a title/author hit is the most literal/confident kind of
  // match, so it comes first; lucene (indexed full-text) next; then grep
  // (raw substring, less smart than lucene's indexing but still
  // literal); vector (semantic/fuzzy) last, since it's the least literal
  // kind of match. Within a tier, each mode's own existing ranking (e.g.
  // title's prefix/wordSize sort) is preserved. Same work/chapter hit by
  // more than one mode keeps only its first (highest-tier) occurrence.
  //
  // Each mode is independently bounded (PER_MODE_TIMEOUT_MS) and NEVER
  // gates the others - a slow/stuck mode (e.g. vector search behind a
  // GPU-contended Ollama) used to make the combined search wait on a
  // single Promise.all across every mode, so one stuck mode meant the
  // whole search - and the UI spinner showing it - never finished, even
  // though the other 4 modes had already come back instantly. Now every
  // mode resolves (with real results or, on timeout/error, an empty
  // one) within the bound, and onUpdate (optional) fires after EACH
  // mode lands with the best merged list so far, so fast tiers appear
  // immediately instead of waiting for the slowest one.
  async searchCombined(query: string, perModeLimit: number = 5, onUpdate?: (results: SearchResult[]) => void): Promise<SearchResult[]> {
    // Grep is deliberately NOT part of the combined default: it's by far the
    // most expensive mode (a live substring scan that re-derives paragraph
    // text from the TEI on every call, bounded only by the server-side
    // MAX_PARAGRAPHS_SCANNED), so it would tax every casual query for a
    // feature aimed at technically-minded users. It stays fully available
    // via its explicit mode tab, which is the manual-override path anyway.
    // Within the first tier, author hits come BEFORE title hits: typing an
    // author's name means you are looking for the author - the author
    // card is the most direct answer and must not be pushed under
    // incidental title matches ("papini" -> Giovanni Papini first).
    const tiers: SearchMode[][] = [
      ['author', 'title'],
      ['lucene'],
      ['vector']
    ];
    const resultsByMode = new Map<SearchMode, SearchResult[]>();

    const mergeAndDedupe = (): SearchResult[] => {
      const seen = new Set<string>();
      const combined: SearchResult[] = [];
      for (const tier of tiers) {
        for (const mode of tier) {
          for (const result of resultsByMode.get(mode) ?? []) {
            const key = result.chapterId ? `${result.workId}::${searchTargetPath(result)}` : result.workId;
            if (seen.has(key)) continue;
            seen.add(key);
            combined.push(result);
          }
        }
      }
      return combined;
    };

    const modePromises = tiers.flat().map(mode =>
      withTimeout(
        this.searchConnected(mode, query, { page: 1, pageSize: perModeLimit }).catch(() => ({ results: [] as SearchResult[] })),
        PER_MODE_TIMEOUT_MS,
        { results: [] as SearchResult[] }
      ).then(response => {
        resultsByMode.set(mode, response.results);
        onUpdate?.(mergeAndDedupe());
      })
    );

    await Promise.all(modePromises);
    return mergeAndDedupe();
  },

  // --- QUOTATIONS (FRAGMENTS) ---
  createQuotation(data: Omit<Quotation, 'id' | 'createdAt'>, sourceId?: string): Quotation {
    const quotes = loadStoredQuotes();
    const newQuote: Quotation = {
      ...data,
      id: sourceId || `quote-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      createdAt: new Date().toISOString()
    };
    quotes.unshift(newQuote);
    saveStoredQuotes(quotes);
    return newQuote;
  },

  getQuotationById(id: string): Quotation | undefined {
    const quotes = loadStoredQuotes();
    return quotes.find(q => q.id === id);
  },

  getAllQuotations(): Quotation[] {
    return loadStoredQuotes();
  },

  generateQuoteShareUrl(quoteId: string): string {
    return window.location.origin + (quoteId.startsWith('/') ? quoteId : buildAppPath({ view: 'quote', quoteId }));
  },

  // --- PERSONAL COLLECTIONS ---
  getCollections(userId: string): PersonalCollection[] {
    return loadStoredCollections(userId);
  },

  getCollectionsSaveError(userId: string): string | undefined {
    return collectionSaveErrors.get(userId);
  },

  async flushCollections(userId: string): Promise<void> {
    await collectionWrites.get(userId);
  },

  async retryCollectionsSave(userId: string): Promise<void> {
    saveStoredCollections(userId, loadStoredCollections(userId));
    await this.flushCollections(userId);
  },

  /** The (UUID) id of the user's non-deletable Favorites collection. */
  getFavoritesId(userId: string): string {
    return loadStoredCollections(userId).find(c => c.isDefaultFavorites)!.id;
  },

  createCollection(userId: string, name: string, description?: string): PersonalCollection {
    const cols = loadStoredCollections(userId);
    const newCol: PersonalCollection = {
      id: newId(),
      kind: 'user',
      userId,
      name,
      description,
      isDefaultFavorites: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      items: []
    };
    cols.push(newCol);
    saveStoredCollections(userId, cols);
    return newCol;
  },

  deleteCollection(userId: string, collectionId: string): boolean {
    const cols = loadStoredCollections(userId);
    const col = cols.find(c => c.id === collectionId);
    if (!col || col.isDefaultFavorites) {
      return false; // Non-deletable Favorites collection
    }
    const filtered = cols.filter(c => c.id !== collectionId);
    saveStoredCollections(userId, filtered);
    return true;
  },

  addItemToCollection(
    userId: string,
    collectionId: string,
    item: Omit<CollectionItem, 'id' | 'addedAt'>
  ): PersonalCollection | null {
    const cols = loadStoredCollections(userId);
    const colIndex = cols.findIndex(c => c.id === collectionId);
    if (colIndex === -1) return null;

    const newItem: CollectionItem = {
      ...item,
      id: newId(),
      addedAt: new Date().toISOString()
    };

    // Avoid duplicate reference if already in collection
    const exists = cols[colIndex].items.some(
      i => i.type === item.type && i.referenceId === item.referenceId
    );
    if (!exists) {
      cols[colIndex].items.unshift(newItem);
      cols[colIndex].updatedAt = new Date().toISOString();
      saveStoredCollections(userId, cols);
      // ReaderView's bookmark icon fills when the read chapter is in a
      // collection - same window-event pattern as textbase-purchases-changed.
      // Optional-chained: plain node (unit tests) has no window.
      (globalThis as { window?: Window }).window?.dispatchEvent(new Event('collections-changed'));
    }
    return cols[colIndex];
  },

  removeItemFromCollection(userId: string, collectionId: string, itemId: string): PersonalCollection | null {
    const cols = loadStoredCollections(userId);
    const colIndex = cols.findIndex(c => c.id === collectionId);
    if (colIndex === -1) return null;

    cols[colIndex].items = cols[colIndex].items.filter(i => i.id !== itemId);
    cols[colIndex].updatedAt = new Date().toISOString();
    saveStoredCollections(userId, cols);
    // Same event as addItemToCollection, so the reader's bookmark icon empties.
    (globalThis as { window?: Window }).window?.dispatchEvent(new Event('collections-changed'));
    return cols[colIndex];
  },

  /** Moves an item one place up (-1) or down (+1) within its collection. */
  moveItemInCollection(userId: string, collectionId: string, itemId: string, delta: -1 | 1): PersonalCollection | null {
    const cols = loadStoredCollections(userId);
    const col = cols.find(c => c.id === collectionId);
    if (!col) return null;
    const from = col.items.findIndex(i => i.id === itemId);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= col.items.length) return col;
    const [item] = col.items.splice(from, 1);
    col.items.splice(to, 0, item);
    col.updatedAt = new Date().toISOString();
    saveStoredCollections(userId, cols);
    return col;
  },

  /**
   * A signed-in reader's collections live in their account: load them from
   * `store` (RemotePreferencesStore) into the cache, or - an account with
   * none yet - seed it from what this browser held for them, then persist
   * every later change there.
   */
  async attachCollectionsStore(userId: string, store: PreferencesStore): Promise<void> {
    collectionsStores.set(userId, store);
    const remote = (await store.get()).collections;
    if (collectionsStores.get(userId) !== store) return;
    if (remote !== undefined) {
      const migrated = normalizeCollections(remote.length ? remote : defaultCollections(userId));
      collectionsCache.set(userId, copyCollections(migrated));
      if (JSON.stringify(migrated) !== JSON.stringify(remote)) await store.set({ collections: migrated });
    } else {
      const seed = normalizeCollections(readLegacyCollections(userId) ?? collectionsCache.get(userId) ?? defaultCollections(userId));
      collectionsCache.set(userId, copyCollections(seed));
      await store.set({ collections: seed });
    }
    notify();
  },

  /** Signed out: that account's collections stop being served from its store. */
  detachCollectionsStore(userId: string): void {
    collectionsStores.delete(userId);
    collectionsCache.delete(userId);
    collectionWrites.delete(userId);
    collectionSaveErrors.delete(userId);
  },

  // --- AUTH ---

  // The active local user bridge: whatever a real sign-in persisted via
  // setUser, or null. No fabricated persona anymore - a browser that
  // hasn't signed in has no user, and features that need a storage scope
  // key off ANONYMOUS_USER_ID instead (a bucket, not an identity).
  getCurrentUser(): User | null {
    purgeStaleDemoPersonaStorage();
    try {
      const raw = localStorage.getItem(STORAGE_USER_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) {
      console.error(e);
    }
    return null;
  },

  setUser(user: User | null) {
    if (!user) {
      localStorage.removeItem(STORAGE_USER_KEY);
    } else {
      localStorage.setItem(STORAGE_USER_KEY, JSON.stringify(user));
    }
  },

  // --- ADMIN OPERATIONS ---
  // Placeholder shape only - the drawer's initial paint before
  // fetchAdminStatus() resolves. Never a version literal or a plausible
  // number here: those go stale and misreport the deployed services (as
  // the old '0.9.12-SNAPSHOT' / fake index-size mocks did on prod).
  getAdminStatus(): AdminStatus {
    return {
      serverVersion: '…',
      serverBuild: '…',
      uptime: '…',
      teiEngineStatus: {
        status: 'healthy',
        parserVersion: '5 (Saxon-pinned)',
        schemaValidation: 'strict'
      },
      luceneIndexStatus: {
        status: adminState.isReindexing ? 'rebuilding' : 'healthy',
        docsIndexed: adminState.docsIndexed
      },
      vectorSearchStatus: {
        available: adminState.vectorSearchAvailable,
        provider: 'biblioteca-nestjs (Ollama embeddings)',
        degradationReason: 'checking…'
      },
      repos: this.getRepositories(),
      reimportLogs: adminState.reimportLogs
    };
  },

  // The real admin status, assembled from the live services: the server's
  // build identity + Actuator uptime (relayed same-origin by server.ts's
  // /api/server-info), the Lucene rebuild state (/api/lucene/status) and
  // the vectorizer job state (/api/vectorizing). Whatever can't be
  // fetched keeps its placeholder value - nothing is invented.
  async fetchAdminStatus(): Promise<AdminStatus> {
    const base = this.getAdminStatus();
    // server-info is not on the springdoc allowlist yet (no generated
    // path for it), so it keeps its raw fetch; the other two go through
    // the generated same-origin client.
    const [infoP, luceneP, vectorizingP] = await Promise.allSettled([
      trackedFetch('/api/server-info').then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))),
      fetchLuceneRebuildStatus(),
      fetchVectorizingStatus()
    ]);
    const info = infoP.status === 'fulfilled'
      ? infoP.value as { appName?: string; version?: string; buildNumber?: string; buildDate?: string; git_latest_commit?: string; git_branch?: string; buildMachine?: string; uptimeSeconds?: number }
      : undefined;
    const lucene = luceneP.status === 'fulfilled' ? luceneP.value : undefined;
    const vectorizing = vectorizingP.status === 'fulfilled' ? vectorizingP.value : undefined;

    const uptime = typeof info?.uptimeSeconds === 'number'
      ? formatUptime(info.uptimeSeconds)
      : base.uptime;

    return {
      ...base,
      serverVersion: info?.version ?? base.serverVersion,
      serverBuild: info
        ? `${info.git_branch ?? '?'}@${info.git_latest_commit ?? '?'} · built ${info.buildDate ?? '?'}`
        : base.serverBuild,
      uptime,
      luceneIndexStatus: lucene
        ? {
            status: lucene.running ? 'rebuilding' : (lucene.indexExists ? 'healthy' : 'empty'),
            docsIndexed: lucene.indexedDocs ?? base.luceneIndexStatus.docsIndexed,
            ...((lucene.startedAtMillis ?? 0) > 0 ? { lastRebuilt: new Date(lucene.startedAtMillis!).toISOString() } : {})
          }
        : base.luceneIndexStatus,
      vectorSearchStatus: {
        ...base.vectorSearchStatus,
        // the admin toggle override wins over the live job state
        available: adminState.vectorSearchOverride ?? Boolean(vectorizing),
        ...(vectorizing
          ? { state: vectorizing.state, degradationReason: undefined }
          : { degradationReason: 'vectorizer unreachable (/api/vectorizing)' })
      }
    };
  },

  // The admin drawer's "Simulate Disconnect / Reconnect Sidecar"
  // button: a manual override of the vectorizer's fetched availability,
  // for exercising the degraded (vector-unavailable) UI at will. It
  // wins over the live job state until toggled back; the vector search
  // gates read it through adminState.vectorSearchAvailable, and the
  // notification re-renders every listener (SearchView's toggle, the
  // admin badge).
  setVectorSearchAvailability(available: boolean): void {
    adminState.vectorSearchOverride = available;
    adminState.vectorSearchAvailable = available;
    notify();
  },

  triggerReimport(mode: 'fresher-only' | 'full' | 'single-file' | 'force-full', repoId: string, filePath?: string): { success: boolean; message: string } {
    const repo = this.getRepositories().find(r => r.id === repoId);
    const repoName = repo?.name || repoId;
    
    let count = mode === 'force-full' || mode === 'full' ? (repo?.fileCount || 100) : 6;
    if (mode === 'single-file') count = 1;

    const newLog = {
      id: `log-${Date.now()}`,
      timestamp: new Date().toISOString(),
      mode,
      repoId,
      status: 'success' as const,
      message: `Triggered ${mode} re-import on ${repoName}${filePath ? ` (file: ${filePath})` : ''}. Processed ${count} TEI XML documents.`,
      affectedFilesCount: count
    };

    adminState.reimportLogs.unshift(newLog);
    return {
      success: true,
      message: newLog.message
    };
  },

  triggerLuceneReindex(): Promise<{ docsIndexed: number }> {
    adminState.isReindexing = true;
    return new Promise((resolve) => {
      setTimeout(() => {
        adminState.isReindexing = false;
        adminState.docsIndexed += 45;
        resolve({ docsIndexed: adminState.docsIndexed });
      }, 1400);
    });
  },

  // --- PAYMENT & SCHOLARLY LICENSING ---
  getPurchasedReceipts(userId?: string): BookPurchaseReceipt[] {
    const activeUserId = userId || this.getCurrentUser()?.id || ANONYMOUS_USER_ID;
    try {
      const raw = localStorage.getItem(`${STORAGE_PURCHASES_KEY}_${activeUserId}`);
      if (raw) {
        return JSON.parse(raw);
      }
      // Check legacy non-scoped storage key
      const legacyRaw = localStorage.getItem(STORAGE_PURCHASES_KEY);
      if (legacyRaw) {
        return JSON.parse(legacyRaw);
      }
    } catch (e) {
      console.error('Failed to load purchases from storage', e);
    }
    return [];
  },

  savePurchaseReceipt(receipt: BookPurchaseReceipt, userId?: string) {
    const activeUserId = userId || this.getCurrentUser()?.id || ANONYMOUS_USER_ID;
    const existing = this.getPurchasedReceipts(activeUserId);
    const updated = [receipt, ...existing.filter(r => r.workId !== receipt.workId)];
    try {
      localStorage.setItem(`${STORAGE_PURCHASES_KEY}_${activeUserId}`, JSON.stringify(updated));
      localStorage.setItem(STORAGE_PURCHASES_KEY, JSON.stringify(updated));
      window.dispatchEvent(new CustomEvent('textbase-purchases-changed', { detail: { receipt } }));
    } catch (e) {
      console.error('Failed to save purchase receipt', e);
    }
  },

  isWorkUnlocked(workId: string, userId?: string): boolean {
    const work = realWorks.find(w => w.id === workId);
    if (!work || work.accessType !== 'premium') {
      return true; // Free works are instantly accessible
    }
    if (!PAYMENT_ENTITLEMENTS_ENABLED) return false;
    const receipts = this.getPurchasedReceipts(userId);
    return receipts.some(r => !r.paymentId.startsWith('pi_sandbox_')
      && r.workId === workId && (r.status === 'completed' || r.accessGranted));
  },

  async getPaymentConfig(): Promise<PaymentServiceConfig> {
    try {
      return await fetchPaymentConfig();
    } catch (e) {
      console.warn('Backend payment config fetch failed; payments remain disabled', e);
    }
    return {
      status: 'disabled',
      enabled: false,
      provider: 'stripe',
      isLiveConfigured: false,
      publishableKey: '',
      supportedCurrencies: [],
      acceptedMethods: [],
      mode: 'disabled'
    };
  },

  async createPaymentIntent(work: Work) {
    if (!(await this.getPaymentConfig()).enabled) throw new Error('Payments are temporarily disabled');

    try {
      return await postPaymentIntent({
        workId: work.id,
        workTitle: work.title
      });
    } catch (e: any) {
      console.warn('Payment intent creation via API failed', e);
      throw e;
    }
  },

  async confirmBookPurchase(
    paymentId: string,
    work: Work,
    userId?: string
  ): Promise<BookPurchaseReceipt> {
    if (!(await this.getPaymentConfig()).enabled) throw new Error('Payments are temporarily disabled');
    const currentUser = this.getCurrentUser();
    const uid = userId || currentUser?.id || ANONYMOUS_USER_ID;

    let receipt: BookPurchaseReceipt | null = null;

    try {
      receipt = await confirmPaymentPurchase({
        paymentId,
        workId: work.id,
        workTitle: work.title
      }) as BookPurchaseReceipt | null;
    } catch (e) {
      console.warn('Payment confirmation API call failed', e);
    }

    if (!receipt) throw new Error('Payment could not be verified');

    this.savePurchaseReceipt(receipt, uid);
    return receipt;
  },

  // --- RANDOM DISCOVERY ---
  // Cache-warm the picked chapter by its full stable paths, so the content
  // fetch races the reader's own work + TOC loads instead of chaining
  // after them. Fire-and-forget: a failure only costs the later
  // loadChapterContent its normal network round trip.
  prefetchChapterContentByPath(workId: string, chapterId: string): void {
    prefetchChapterContentByPath(workId, chapterId);
  },

  async getRandomDiscovery(): Promise<{ type: 'chapter' | 'work'; workId: string; chapterId?: string }> {
    const location = await fetchRandomServerLocation();
    if (!location) return { type: 'work', workId: '' };
    const path = new URL(location, globalThis.location?.origin || 'http://localhost').pathname
      .replace(/^\/+|\/+$/g, '');
    const parts = path.split('/').filter(Boolean).map(part => decodeURIComponent(part));
    if (parts.length < 2) return { type: 'work', workId: '' };
    const workId = `${parts[0]}/${parts[1]}`;
    // chapterId is the COMPLETE stable path - author and opus included -
    // matching both parseAppPath's /app/reader deep links and the div.path
    // chapter ids from fetchRealChaptersForWork. An opus-relative slice
    // (parts.slice(2)) builds URLs missing the author and never matches a
    // chapter id, so the reader reports "chapter not available".
    const chapterId = parts.join('/');
    return { type: 'chapter', workId, chapterId };
  }
};
