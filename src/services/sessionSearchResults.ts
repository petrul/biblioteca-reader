import type { SearchResult } from '../types/textbase';

/** The latest navbar search's results, for this browser session (tab) only:
 *  reopening the search box, or reloading the page, shows them again instead
 *  of sending the same search over and over. Closing the tab forgets them. */
const KEY = 'biblioteca.reader.navbar-last-results.v1';
let memory: { query: string; results: SearchResult[] } | null = null;

const normalize = (query: string) => query.trim().toLowerCase();

export function sessionResultsFor(query: string): SearchResult[] | null {
  if (!memory) {
    try {
      const raw = globalThis.sessionStorage?.getItem(KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      if (parsed && typeof parsed.query === 'string' && Array.isArray(parsed.results)) memory = parsed;
    } catch { /* storage unavailable or corrupt: search again */ }
  }
  return memory && normalize(memory.query) === normalize(query) ? memory.results : null;
}

export function rememberSessionResults(query: string, results: SearchResult[]): void {
  memory = { query: query.trim(), results };
  try { globalThis.sessionStorage?.setItem(KEY, JSON.stringify(memory)); } catch { /* full or unavailable: memory only */ }
}

/** Forgets the results; `keepStorage` simulates a page reload (memory gone, session storage kept). */
export function resetSessionResultsForTests(keepStorage = false): void {
  memory = null;
  if (keepStorage) return;
  try { globalThis.sessionStorage?.removeItem(KEY); } catch { /* ignore */ }
}
