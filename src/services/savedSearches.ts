// Saved searches: the results of a search kept as a collection of kind
// 'search'. A signed-in reader's live in biblioteca-server's database (REST
// to write, the same-origin /graphql to read); an anonymous reader's stay in
// this browser's localStorage. Served synchronously from a cache, like the
// personal collections in readerService.
import { SavedSearch, SavedSearchItem, SearchMode, SearchResult } from '../types/textbase';
import { newId } from './ids';
import { trackedFetch } from './serversideApi';

const STORAGE_KEY = 'biblioteca_reader_saved_searches';
const MY_COLLECTIONS_QUERY = `{ myCollections { id name kind searchQuery searchParams createdAt
  items { id divPath divHead snippet score addedAt } } }`;

type ServerItem = { id: string; divPath: string; divHead?: string | null; snippet?: string | null; score?: number | null; addedAt: string };
type ServerCollection = {
  id: string; name: string; kind: string; searchQuery?: string | null; searchParams?: string | null;
  createdAt: string; items?: ServerItem[] | null;
};

let cache: SavedSearch[] | null = null;
let serverBacked = false;
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach(listener => listener());
}

export function subscribeSavedSearches(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Exposed for tests only. */
export function resetSavedSearchesForTests(): void {
  cache = null;
  serverBacked = false;
  listeners.clear();
}

function readLocal(): SavedSearch[] {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) as SavedSearch[] : [];
  } catch {
    return [];
  }
}

function persist(): void {
  if (serverBacked) return;
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(cache ?? []));
  } catch (error) {
    console.error('Failed to store saved searches', error);
  }
}

export function getSavedSearches(): SavedSearch[] {
  if (!cache) cache = readLocal();
  return cache;
}

/** The name a search gets unless the reader edits it. */
export function defaultSearchName(query: string): string {
  return query.trim().replace(/\s+/g, ' ').slice(0, 200);
}

function itemPath(result: SearchResult): string {
  return result.chapterId || result.workId;
}

function fromServer(col: ServerCollection): SavedSearch {
  let mode: SearchMode | undefined;
  try { mode = (JSON.parse(col.searchParams ?? '{}') as { mode?: SearchMode }).mode; } catch { /* no options */ }
  return {
    id: col.id,
    kind: 'search',
    name: col.name,
    query: col.searchQuery ?? col.name,
    mode,
    createdAt: col.createdAt,
    updatedAt: col.createdAt,
    items: (col.items ?? []).map((item): SavedSearchItem => {
      const parts = item.divPath.split('/');
      return {
        id: item.id,
        workId: parts.slice(0, 2).join('/'),
        chapterId: parts.length > 2 ? item.divPath : undefined,
        workTitle: item.divHead ?? item.divPath,
        authorName: parts[0],
        snippet: item.snippet ?? '',
        score: item.score ?? undefined,
        addedAt: item.addedAt,
      };
    }),
  };
}

async function serverJson(path: string, init: RequestInit): Promise<unknown> {
  const response = await trackedFetch(path, {
    ...init,
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
  });
  if (!response.ok) throw new Error(`${init.method ?? 'GET'} ${path} -> ${response.status}`);
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

/** Signed in: serve the saved searches from the account's server-side collections. */
export async function attachSavedSearchesAccount(): Promise<void> {
  const body = await serverJson('/graphql', { method: 'POST', body: JSON.stringify({ query: MY_COLLECTIONS_QUERY }) }) as
    { data?: { myCollections?: ServerCollection[] }; errors?: unknown[] };
  if (!body.data?.myCollections) throw new Error('could not load collections: ' + JSON.stringify(body.errors ?? body));
  serverBacked = true;
  cache = body.data.myCollections.filter(col => col.kind === 'SEARCH').map(fromServer);
  emit();
}

/** Signed out: back to this browser's own saved searches. */
export function detachSavedSearchesAccount(): void {
  serverBacked = false;
  cache = null;
  emit();
}

export async function saveSearch(query: string, mode: SearchMode | 'all', results: SearchResult[], name?: string): Promise<SavedSearch> {
  const trimmed = query.trim();
  const chosenName = (name ?? '').trim() || defaultSearchName(trimmed);
  const hits = results.filter(r => r.type !== 'author').slice(0, 100);
  let saved: SavedSearch;
  if (serverBacked) {
    const created = await serverJson('/api/collections/mine/searches', {
      method: 'POST',
      body: JSON.stringify({
        name: chosenName,
        query: trimmed,
        params: JSON.stringify({ mode }),
        hits: hits.map(r => ({ path: itemPath(r), snippet: r.snippet, score: r.score })),
      }),
    }) as ServerCollection;
    saved = fromServer(created);
  } else {
    const now = new Date().toISOString();
    const taken = new Set(getSavedSearches().map(s => s.name));
    let unique = chosenName;
    for (let n = 2; taken.has(unique); n++) unique = `${chosenName} (${n})`;
    saved = {
      id: newId(), kind: 'search', name: unique, query: trimmed, mode: mode === 'all' ? undefined : mode,
      createdAt: now, updatedAt: now,
      items: hits.map((r): SavedSearchItem => ({
        id: newId(), workId: r.workId, chapterId: r.chapterId, workTitle: r.workTitle, authorName: r.authorName,
        chapterTitle: r.chapterTitle, snippet: r.snippet, score: r.score, addedAt: now,
      })),
    };
  }
  cache = [saved, ...getSavedSearches()];
  persist();
  emit();
  return saved;
}

export async function renameSavedSearch(id: string, name: string): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('a saved search needs a name');
  if (serverBacked) await serverJson(`/api/collections/mine/${id}`, { method: 'PATCH', body: JSON.stringify({ name: trimmed }) });
  cache = getSavedSearches().map(s => (s.id === id ? { ...s, name: trimmed, updatedAt: new Date().toISOString() } : s));
  persist();
  emit();
}

export async function deleteSavedSearch(id: string): Promise<void> {
  if (serverBacked) await serverJson(`/api/collections/mine/${id}`, { method: 'DELETE' });
  cache = getSavedSearches().filter(s => s.id !== id);
  persist();
  emit();
}
