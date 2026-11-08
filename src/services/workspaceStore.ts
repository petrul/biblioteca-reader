import { fetchReaderState, updateReaderState, type ReaderStatePayload } from './readerGraphql';
import type { SearchResult } from '../types/textbase';

export type SearchScope = 'library' | 'work';
export type ReaderLastSearch = {
  version: 1;
  query: string;
  mode: 'all' | 'author' | 'title' | 'grep' | 'lucene' | 'vector';
  scope: SearchScope;
  workId?: string;
  language?: string;
  options: Record<string, unknown>;
  page: number;
  pageSize: number;
  fetchedPages: number[];
  cursor?: string;
  savedSearchId?: string;
  /** Cached pages let the reader reopen the last search immediately offline. */
  results?: SearchResult[];
  activeResultId?: string;
  updatedAt: string;
};

export type WorkspacePanelRef = { kind: 'collection' | 'search'; id: string };
export type ReaderWorkspace = {
  version: 1;
  active: boolean;
  left?: WorkspacePanelRef;
  right?: WorkspacePanelRef;
  mobile?: WorkspacePanelRef;
  selectedPanel?: 'left' | 'right' | 'mobile';
  filters: Record<string, string>;
};

const STORAGE_KEY = 'biblioteca.reader.workspace.v1';
const defaultWorkspace = (): ReaderWorkspace => ({ version: 1, active: false, filters: {} });
let remoteRevision = 0;
let remoteLastSearch: ReaderLastSearch | null = null;
let remoteWorkspace = defaultWorkspace();
let signedIn = false;
let listeners = new Set<() => void>();
let writeQueue: Promise<void> = Promise.resolve();

function localDocument(): { lastSearch?: ReaderLastSearch; workspace: ReaderWorkspace } {
  try {
    const parsed = JSON.parse(globalThis.localStorage?.getItem(STORAGE_KEY) || '{}') as { lastSearch?: ReaderLastSearch; workspace?: ReaderWorkspace };
    return { lastSearch: parsed.lastSearch, workspace: parsed.workspace ?? defaultWorkspace() };
  } catch { return { workspace: defaultWorkspace() }; }
}

function notify() { listeners.forEach(listener => listener()); }
function persistLocal() { globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify({ lastSearch: remoteLastSearch, workspace: remoteWorkspace })); }

export function subscribeWorkspace(listener: () => void): () => void { listeners.add(listener); return () => listeners.delete(listener); }
export function getLastSearch(): ReaderLastSearch | null { return remoteLastSearch; }
export function getWorkspace(): ReaderWorkspace { return remoteWorkspace; }

export function setLastSearch(search: ReaderLastSearch | null): void {
  remoteLastSearch = search;
  if (!signedIn) persistLocal();
  notify();
}

export function setWorkspace(workspace: ReaderWorkspace): void {
  remoteWorkspace = workspace;
  if (!signedIn) persistLocal();
  notify();
}

export async function loadWorkspaceState(accountSignedIn: boolean): Promise<void> {
  signedIn = accountSignedIn;
  if (!signedIn) {
    const local = localDocument();
    remoteLastSearch = local.lastSearch ?? null;
    remoteWorkspace = local.workspace;
    notify();
    return;
  }
  const remote = await fetchReaderState();
  applyRemote(remote);
  notify();
}

function applyRemote(state: ReaderStatePayload) {
  remoteRevision = state.revision;
  remoteLastSearch = (state.lastSearch as ReaderLastSearch | null) ?? null;
  remoteWorkspace = (state.workspace as ReaderWorkspace | null) ?? defaultWorkspace();
}

export function persistWorkspaceState(): Promise<void> {
  if (!signedIn) { persistLocal(); return Promise.resolve(); }
  const lastSearch = remoteLastSearch as unknown as Record<string, unknown> | null;
  const workspace = remoteWorkspace as unknown as Record<string, unknown>;
  const write = async () => {
    try {
      const updated = await updateReaderState(remoteRevision, lastSearch, workspace);
      applyRemote(updated);
    } catch (error) {
      // A concurrent device wins; reload before the next user change.
      if (String(error).includes('revision conflict')) {
        applyRemote(await fetchReaderState());
        notify();
      }
      throw error;
    }
  };
  const pending = writeQueue.then(write);
  writeQueue = pending.catch(() => {});
  return pending;
}

export function resetWorkspaceForTests(): void {
  remoteRevision = 0; remoteLastSearch = null; remoteWorkspace = defaultWorkspace(); signedIn = false; listeners = new Set(); writeQueue = Promise.resolve();
}
