// Remembers the navbar's last completed quick search (query + results) in
// localStorage, so tapping the search icon again - even after a reload -
// starts pre-populated with what was last searched, instead of a blank
// box every time.

import { SearchResult } from '../types/textbase';

const STORAGE_KEY = 'biblioteca.reader.lastSearch.v1';

interface LastSearch {
  query: string;
  results: SearchResult[];
}

export function getLastSearch(storage: Storage = window.localStorage): LastSearch | null {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return typeof parsed?.query === 'string' && Array.isArray(parsed?.results) ? parsed : null;
  } catch {
    return null;
  }
}

export function setLastSearch(query: string, results: SearchResult[], storage: Storage = window.localStorage): void {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify({ query, results }));
  } catch {
    // Best-effort cache - a full/unavailable localStorage just means no restore next time.
  }
}
