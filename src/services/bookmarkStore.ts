// Reading-position ("bookmark") storage, behind one interface so callers
// don't care whether it's backed by localStorage (anonymous readers) or
// textbase-server (signed-in readers) - see migrateLocalToRemote below for
// the one moment that distinction actually matters. All server interaction
// goes through serversideApi's typed wrappers - no direct fetch() here.

import {
  addReadingAttention,
  fetchReadingProgress,
  fetchReadingProgressOne,
  saveReadingProgress,
  saveReadingScrollFraction,
  type ReadingProgressRow
} from './serversideApi';

export type BookmarkPosition = {
  divPath: string;
  updatedAt: number; // epoch ms
  // touchCount/read: only ever populated for signed-in readers
  // (RemoteBookmarkStore) - local/anonymous storage never tracked these.
  touchCount?: number;
  read?: boolean;
  // Cumulative tab-visible reading time on this work, in seconds. Tracked
  // for BOTH local and remote readers (see addAttention below) - this one
  // drives whether a reader counts as "real" (see identity.ts's
  // isEngagedReader), which must work before a reader ever signs in.
  attentionSeconds?: number;
  // Scroll position *within* divPath, as a 0-1 fraction of its scrollable
  // height (see setScrollFraction below and hooks/useReaderScrollPosition.ts,
  // its one caller). Meaningful only together with divPath - a stale
  // fraction from a since-abandoned chapter is simply ignored by whichever
  // component would restore it, since divPath itself always changes too.
  scrollFraction?: number;
};

export interface BookmarkStore {
  getAll(): Promise<Record<string, BookmarkPosition>>; // workId -> position
  get(workId: string): Promise<BookmarkPosition | null>;
  set(workId: string, position: BookmarkPosition): Promise<void>;
  // Adds to (not replaces) this work's attentionSeconds. A no-op if no
  // position has been saved for this work yet - mirrors
  // textbase-server's own "no reading progress yet" guard.
  addAttention(workId: string, secondsDelta: number): Promise<void>;
  // Updates just the in-chapter scroll position (0-1 fraction) for a
  // work's currently saved div. A no-op if no position has been saved
  // yet, OR if divPath no longer matches what's saved - the reader has
  // since moved to a different chapter and this is a stale/late update
  // (see hooks/useReaderScrollPosition.ts).
  setScrollFraction(workId: string, divPath: string, fraction: number): Promise<void>;
  clear(): Promise<void>;
}

function clampFraction(fraction: number): number {
  return Math.max(0, Math.min(1, fraction));
}

const STORAGE_KEY = 'biblioteca.reader.bookmarks.v1';

// Real, localStorage-backed implementation for anonymous readers. Storage
// is constructor-injected (defaults to window.localStorage) so tests can
// swap in a fake without touching the browser API.
export class LocalBookmarkStore implements BookmarkStore {
  constructor(private readonly storage: Storage = window.localStorage) {}

  private readAll(): Record<string, BookmarkPosition> {
    try {
      const raw = this.storage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }

  private writeAll(all: Record<string, BookmarkPosition>): void {
    this.storage.setItem(STORAGE_KEY, JSON.stringify(all));
  }

  async getAll(): Promise<Record<string, BookmarkPosition>> {
    return this.readAll();
  }

  async get(workId: string): Promise<BookmarkPosition | null> {
    return this.readAll()[workId] ?? null;
  }

  async set(workId: string, position: BookmarkPosition): Promise<void> {
    const all = this.readAll();
    const existing = all[workId];
    // Merge, don't replace - callers only ever pass {divPath, updatedAt}
    // (see App.tsx), so a plain overwrite would silently wipe any
    // attentionSeconds already accumulated for this work on every page turn.
    // scrollFraction is the one field NOT carried through the merge as-is:
    // a genuinely new div starts at its own top, so it only survives when
    // divPath is unchanged (e.g. "Continue Reading" resuming exactly where
    // a reader left off) - mirrors ReadingProgressService.save() server-side.
    const scrollFraction = existing?.divPath === position.divPath ? existing.scrollFraction : 0;
    all[workId] = { ...existing, ...position, scrollFraction };
    this.writeAll(all);
  }

  async addAttention(workId: string, secondsDelta: number): Promise<void> {
    if (secondsDelta <= 0) return;
    const all = this.readAll();
    const existing = all[workId];
    if (!existing) return;
    existing.attentionSeconds = (existing.attentionSeconds ?? 0) + secondsDelta;
    this.writeAll(all);
  }

  async setScrollFraction(workId: string, divPath: string, fraction: number): Promise<void> {
    const all = this.readAll();
    const existing = all[workId];
    if (!existing || existing.divPath !== divPath) return;
    existing.scrollFraction = clampFraction(fraction);
    this.writeAll(all);
  }

  async clear(): Promise<void> {
    this.storage.removeItem(STORAGE_KEY);
  }
}

// Maps one server row onto a BookmarkPosition. The generated spec
// annotates updatedAt as a date-time string, but biblioteca-server's
// ReadingProgressDto actually carries an epoch-millis Timestamp - the
// cast keeps the number this store (and its tests) have always worked
// with. A row without opusPath/divPath is malformed and maps to null.
function positionFromRow(row: ReadingProgressRow): BookmarkPosition | null {
  if (!row.opusPath || !row.divPath) return null;
  return {
    divPath: row.divPath,
    updatedAt: row.updatedAt as unknown as number,
    touchCount: row.touchCount,
    read: row.read,
    attentionSeconds: row.attentionSeconds,
    scrollFraction: row.scrollFraction
  };
}

// textbase-server-backed implementation for signed-in readers, via the
// /api/reading-progress endpoints (server.ts's proxy relays the session
// cookie both ways - see forwardedHeaders/relaySetCookie there).
export class RemoteBookmarkStore implements BookmarkStore {
  async getAll(): Promise<Record<string, BookmarkPosition>> {
    const all: Record<string, BookmarkPosition> = {};
    for (const row of await fetchReadingProgress()) {
      const position = positionFromRow(row);
      if (position) all[row.opusPath!] = position;
    }
    return all;
  }

  async get(workId: string): Promise<BookmarkPosition | null> {
    const row = await fetchReadingProgressOne(workId);
    return row ? positionFromRow(row) : null;
  }

  async set(workId: string, position: BookmarkPosition): Promise<void> {
    // workId itself isn't sent - textbase-server derives the work from
    // divPath server-side (TeiElem.getOpus()), so there's no way for this
    // to disagree with the workId the caller thinks it's saving under.
    await saveReadingProgress(position.divPath);
  }

  async addAttention(workId: string, secondsDelta: number): Promise<void> {
    if (secondsDelta <= 0) return;
    await addReadingAttention(workId, secondsDelta).catch(() => {});
  }

  async setScrollFraction(workId: string, divPath: string, fraction: number): Promise<void> {
    await saveReadingScrollFraction(workId, divPath, clampFraction(fraction)).catch(() => {});
  }

  async clear(): Promise<void> {
    // Deliberately a no-op: nothing in this app ever calls clear() on the
    // REMOTE store (migrateLocalToRemote only clears local, by design -
    // remote is the durable copy) and textbase-server has no bulk-delete
    // endpoint for reading progress. Only implemented to satisfy
    // BookmarkStore's shape.
  }
}

/**
 * Moves every bookmark out of `local` and into `remote` (one `set` per
 * work, plus any accumulated attentionSeconds), then wipes `local`
 * entirely - called once, right after a reader signs in. Merges into
 * whatever `remote` already has rather than replacing it: only the
 * workIds present locally are touched, so any progress the account
 * already had server-side (from a previous session, another device) for
 * OTHER works is left alone.
 */
export async function migrateLocalToRemote(local: BookmarkStore, remote: BookmarkStore): Promise<void> {
  const localEntries = await local.getAll();
  for (const [workId, position] of Object.entries(localEntries)) {
    await remote.set(workId, position);
    if (position.attentionSeconds) {
      await remote.addAttention(workId, position.attentionSeconds);
    }
  }
  await local.clear();
}
