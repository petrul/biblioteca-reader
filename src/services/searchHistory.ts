import type { SearchMode } from '../types/textbase';
import type { PreferencesStore } from './preferencesStore';

export type SearchHistoryEntry = {
  id: string;
  query: string;
  mode: SearchMode | 'all';
  scope: 'library' | 'work';
  workId?: string;
  options: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

const STORAGE_KEY = 'biblioteca.reader.search-history.v1';
const MAX_ENTRIES = 20;
let entries: SearchHistoryEntry[] = [];
let loaded = false;
let remoteStore: PreferencesStore | null = null;
let signedIn = false;
const listeners = new Set<() => void>();

function notify() { listeners.forEach(listener => listener()); }

function loadLocal(): SearchHistoryEntry[] {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

function persistLocal() {
  if (!signedIn) globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(entries));
}

function ensureLoaded() {
  if (loaded) return;
  entries = loadLocal();
  loaded = true;
}

function sameSearch(a: Pick<SearchHistoryEntry, 'query' | 'mode' | 'scope' | 'workId' | 'options'>, b: Pick<SearchHistoryEntry, 'query' | 'mode' | 'scope' | 'workId' | 'options'>) {
  return a.query === b.query && a.mode === b.mode && a.scope === b.scope && a.workId === b.workId && JSON.stringify(a.options) === JSON.stringify(b.options);
}

export function subscribeSearchHistory(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getSearchHistory(): SearchHistoryEntry[] {
  ensureLoaded();
  return entries.slice();
}

export function recordSearch(input: Omit<SearchHistoryEntry, 'id' | 'createdAt' | 'updatedAt'>): SearchHistoryEntry {
  ensureLoaded();
  const now = new Date().toISOString();
  const existing = entries.find(item => sameSearch(item, input));
  const entry = existing
    ? { ...existing, ...input, updatedAt: now }
    : { ...input, id: `search-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, createdAt: now, updatedAt: now };
  entries = [entry, ...entries.filter(item => item.id !== entry.id)].slice(0, MAX_ENTRIES);
  persistLocal();
  notify();
  if (signedIn && remoteStore) void remoteStore.set({ searchHistory: entries }).catch(error => console.warn('[search-history] sync failed', error));
  return entry;
}

export function removeSearch(id: string): void {
  ensureLoaded();
  entries = entries.filter(item => item.id !== id);
  persistLocal();
  notify();
  if (signedIn && remoteStore) void remoteStore.set({ searchHistory: entries }).catch(error => console.warn('[search-history] sync failed', error));
}

export function clearSearchHistory(): void {
  entries = [];
  loaded = true;
  persistLocal();
  notify();
  if (signedIn && remoteStore) void remoteStore.set({ searchHistory: [] }).catch(error => console.warn('[search-history] sync failed', error));
}

/** Switches history between browser-local storage and the account preference document. */
export async function attachSearchHistoryAccount(store: PreferencesStore, accountSignedIn: boolean): Promise<void> {
  signedIn = accountSignedIn;
  remoteStore = accountSignedIn ? store : null;
  if (!accountSignedIn) {
    entries = loadLocal();
    loaded = true;
    notify();
    return;
  }
  const preferences = await store.get();
  entries = Array.isArray(preferences.searchHistory) ? preferences.searchHistory.slice(0, MAX_ENTRIES) : [];
  loaded = true;
  notify();
}

export function resetSearchHistoryForTests(): void {
  entries = [];
  loaded = false;
  remoteStore = null;
  signedIn = false;
  listeners.clear();
}
