// Personal UI customizations (which tab was last selected, display
// toggles, etc.) - as opposed to reading data like bookmarks/collections.
// Kept behind one interface, same reasoning as BookmarkStore
// (services/bookmarkStore.ts): today every preference here is
// local-only, but some future ones may need to follow a signed-in reader
// across devices via textbase-server instead - callers shouldn't need to
// change when a given preference's storage moves from one to the other.

import { PersonalCollection, ReaderTheme } from '../types/textbase';
import { fetchUserPreferences, saveUserPreferences } from './serversideApi';

export interface UserPreferences {
  // Which of the Browse page's Works/Authors/Lists tabs was last active -
  // restored on return so navigating to an author/work and back doesn't
  // reset the toolbar to "Works" every time.
  catalogSubTab?: 'works' | 'authors' | 'reading-lists';
  // The reader's chosen display palette - see ReaderView's THEME_STYLES.
  readerTheme?: ReaderTheme;
  // The reader text's font size in px - clamped to ReaderView's
  // FONT_SIZE_MIN..FONT_SIZE_MAX when restored (a stale stored value
  // outside that range, e.g. from an older build, falls back inside it).
  fontSize?: number;
  // The reader toolbar's last-used share target - the button becomes that
  // target on subsequent pages; only a long tap reopens the choice.
  shareTarget?: 'facebook' | 'x' | 'linkedin' | 'whatsapp' | 'telegram';
  // The reader's personal collections, items in their chosen order - kept
  // in readerService's cache and persisted here (see attachCollectionsStore):
  // this browser's localStorage when anonymous, the account when signed in.
  collections?: PersonalCollection[];
}

export interface PreferencesStore {
  get(): Promise<UserPreferences>;
  // Merges into whatever's already stored - never overwrites preferences
  // this call doesn't mention.
  set(patch: Partial<UserPreferences>): Promise<void>;
}

const STORAGE_KEY = 'biblioteca.reader.preferences.v1';

// Storage is constructor-injected (defaults to window.localStorage) so
// tests can swap in a fake without touching the browser API - mirrors
// LocalBookmarkStore.
export class LocalPreferencesStore implements PreferencesStore {
  constructor(private readonly storage: Storage = window.localStorage) {}

  async get(): Promise<UserPreferences> {
    return this.getSync();
  }

  /** Same as get(), synchronously - localStorage is synchronous anyway. */
  getSync(): UserPreferences {
    try {
      const raw = this.storage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }

  async set(patch: Partial<UserPreferences>): Promise<void> {
    const current = this.getSync();
    this.storage.setItem(STORAGE_KEY, JSON.stringify({ ...current, ...patch }));
  }
}

// All store instances share the same write queue: theme/position controls
// create their own instances, but each updates the same account document.
// Web Locks also keep cooperating tabs from interleaving GET/merge/PUT.
let remoteWrites: Promise<void> = Promise.resolve();

function updateRemotePreferences(update: (current: UserPreferences) => UserPreferences): Promise<void> {
  const write = async () => {
    const current = await fetchUserPreferences() as UserPreferences;
    await saveUserPreferences({ ...update(current) });
  };
  const pending = remoteWrites.then(() =>
    typeof navigator !== 'undefined' && navigator.locks
      ? navigator.locks.request('biblioteca.reader.preferences', write)
      : write());
  // A failed write rejects its caller, but must not poison later retries.
  remoteWrites = pending.catch(() => {});
  return pending;
}

// textbase-server-backed implementation for signed-in readers: the
// server stores ONE arbitrary JSON document per reader, verbatim
// (biblioteca-server's UserPreference - its shape may grow over time
// without any schema change), so the merge-not-overwrite contract that
// LocalPreferencesStore gets from localStorage lives here instead:
// get, merge, put the whole document.
export class RemotePreferencesStore implements PreferencesStore {
  async get(): Promise<UserPreferences> {
    await remoteWrites;
    return fetchUserPreferences() as Promise<UserPreferences>;
  }

  async set(patch: Partial<UserPreferences>): Promise<void> {
    const snapshot = structuredClone(patch);
    await updateRemotePreferences(current => ({ ...current, ...snapshot }));
  }
}

/**
 * Moves whatever an anonymous reader had stored locally up to their
 * account, right after sign-in. Existing account collections are authoritative:
 * this browser may have an old or empty anonymous copy, retained after a
 * previous sign-in. Only seed collections when the account has none yet.
 * Other local UI preferences are merged. The local copy is NOT cleared
 * (PreferencesStore has no clear, on purpose): signing out simply
 * resumes serving the local store again - see identity.ts.
 */
export async function migrateLocalPreferencesToRemote(): Promise<void> {
  const local = await new LocalPreferencesStore().get();
  if (Object.keys(local).length === 0) return;
  await updateRemotePreferences(current => {
    const { collections, ...uiPreferences } = local;
    return {
      ...current,
      ...uiPreferences,
      ...(current.collections === undefined && collections !== undefined ? { collections } : {}),
    };
  });
}

export const preferencesStore: PreferencesStore = new LocalPreferencesStore();
