// Local, offline-capable cache of chapter text - localStorage-backed, LRU
// by BOOK (not by chapter): at most MAX_BOOKS distinct works are kept at
// once, and touching a chapter of any of them refreshes that whole book's
// recency, evicting the least-recently-touched book once a new one would
// exceed the cap. This is the storage foundation for offline reading
// later (a "download this book" action would just populate the same
// cache ahead of time); today it's purely a speed/resilience win - a
// cached chapter loads instantly and needs no network round trip at all.
//
// Deliberately NOT behind the same local-vs-remote interface as
// preferencesStore.ts/bookmarkStore.ts - this caches immutable published
// content (the same chapter text is identical for every reader), not a
// personal choice or reading-position fact, so there's no "might live on
// the server instead" axis to abstract over.

import { rewriteServerBinaryUrls } from './serversideApi';

export interface CachedChapterContent {
  htmlContent: string;
  plainText: string;
  noteCount?: number;
  sentenceCount?: number;
}

interface CachedBook {
  workId: string;
  lastAccessed: number; // epoch ms - drives LRU eviction
  chapters: Record<string, CachedChapterContent>; // chapterId -> content
}

interface CacheShape {
  books: CachedBook[]; // ordered oldest-touched first isn't required - lastAccessed is authoritative
}

const STORAGE_KEY = 'biblioteca.reader.chapterCache.v2';
// Books, not chapters or bytes - simple and matches how a reader thinks
// about "how much is cached" ("my last 3 books"), and naturally caps
// total size too since no single classical text is large enough on its
// own to threaten localStorage's ~5-10MB per-origin quota.
const MAX_BOOKS = 3;

function readCache(storage: Storage): CacheShape {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return { books: [] };
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed?.books) ? parsed : { books: [] };
  } catch {
    return { books: [] };
  }
}

function writeCache(storage: Storage, cache: CacheShape): void {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(cache));
  } catch {
    // Quota exceeded (or storage otherwise unavailable) - drop the
    // single oldest book and try once more before giving up silently.
    // This is a cache, not a durable store, so losing an entry is never
    // more than a slower reload next time, not data loss.
    if (cache.books.length > 1) {
      const withoutOldest = { books: [...cache.books].sort((a, b) => b.lastAccessed - a.lastAccessed).slice(0, -1) };
      try {
        storage.setItem(STORAGE_KEY, JSON.stringify(withoutOldest));
      } catch {
        // Still failing - leave the cache as whatever was last written successfully.
      }
    }
  }
}

export class ChapterCache {
  constructor(private readonly storage: Storage = window.localStorage) {}

  get(workId: string, chapterId: string): CachedChapterContent | null {
    const cache = readCache(this.storage);
    const book = cache.books.find(b => b.workId === workId);
    const cached = book?.chapters[chapterId];
    // Heal entries cached before the server-binary URL rewrite existed:
    // they carry biblioteca-server's root-absolute /_binary/ image links,
    // which 404 as assets on the reader's own origin. The rewrite is
    // idempotent, so already-rewritten entries pass through untouched -
    // this is not written back, the entry heals again on every read.
    return cached ? { ...cached, htmlContent: rewriteServerBinaryUrls(cached.htmlContent) } : null;
  }

  set(workId: string, chapterId: string, content: CachedChapterContent): void {
    const cache = readCache(this.storage);
    const now = Date.now();
    let book = cache.books.find(b => b.workId === workId);
    if (!book) {
      book = { workId, lastAccessed: now, chapters: {} };
      cache.books.push(book);
    }
    book.lastAccessed = now;
    book.chapters[chapterId] = content;

    if (cache.books.length > MAX_BOOKS) {
      cache.books.sort((a, b) => b.lastAccessed - a.lastAccessed);
      cache.books.length = MAX_BOOKS;
    }
    writeCache(this.storage, cache);
  }

  /** Which works currently have cached content - the "offline books" list once that UI exists. */
  cachedWorkIds(): string[] {
    return readCache(this.storage).books
      .sort((a, b) => b.lastAccessed - a.lastAccessed)
      .map(b => b.workId);
  }

  clear(): void {
    this.storage.removeItem(STORAGE_KEY);
  }
}

export const chapterCache = new ChapterCache();
