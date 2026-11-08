import { searchTargetPath, sourceTarget } from './searchTargets';
// Saved searches: the results of a search kept as a collection of kind
// 'search'. A signed-in reader's live in biblioteca-server's database (REST
// via the explicit same-origin gateway); an anonymous reader's stay in
// this browser's localStorage. Served synchronously from a cache, like the
// personal collections in readerService.
import { SavedSearch, SavedSearchItem, SearchMode, SearchResult } from '../types/textbase';
import { newId } from './ids';
import { readerGraphql } from './readerGraphql';
import { strToU8, zipSync } from 'fflate';

const STORAGE_KEY = 'biblioteca_reader_saved_searches';
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
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((search): search is SavedSearch => Boolean(search && typeof search === 'object'))
      .map(search => ({
        ...search,
        items: Array.isArray(search.items)
          ? search.items.filter(item => Boolean(item && typeof item === 'object'))
          : [],
      }));
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
  return searchTargetPath(result).replace(/^\//, '');
}

function fromServer(col: ServerCollection): SavedSearch {
  let params: { mode?: SearchMode; scope?: 'library' | 'work'; workId?: string; options?: Record<string, unknown> } = {};
  try { params = JSON.parse(col.searchParams ?? '{}'); } catch { /* no options */ }
  return {
    id: col.id,
    kind: 'search',
    name: col.name,
    query: col.searchQuery ?? col.name,
    mode: params.mode,
    scope: params.scope,
    scopeWorkId: params.workId,
    options: params.options,
    createdAt: col.createdAt,
    updatedAt: col.createdAt,
    items: (col.items ?? []).map((item): SavedSearchItem => {
      const target = sourceTarget(item.divPath);
      const path = target.kind === 'fragment' ? target.reference.sourcePath : item.divPath.replace(/^\//, '').split('?')[0];
      const parts = path.split('/');
      return {
        id: item.id, target,
        workId: parts.slice(0, 2).join('/'),
        chapterId: target.kind === 'fragment' ? target.reference.sourcePath : parts.length > 2 ? path : undefined,
        workTitle: item.divHead ?? item.divPath,
        authorName: parts[0],
        snippet: item.snippet ?? '',
        score: item.score ?? undefined,
        addedAt: item.addedAt,
      };
    }),
  };
}

/** Signed in: serve the saved searches from the account's server-side collections. */
export async function attachSavedSearchesAccount(): Promise<void> {
  const result = await readerGraphql<{ mySavedSearches: ServerCollection[] }>('MySavedSearches',
    'query MySavedSearches { mySavedSearches { id name kind searchQuery searchParams createdAt items { id divPath divHead snippet score addedAt } } }');
  const collections = result.mySavedSearches;
  if (!Array.isArray(collections)) throw new Error('could not load saved searches');
  serverBacked = true;
  cache = collections.filter(col => col.kind === 'SEARCH').map(fromServer);
  emit();
}

/** Signed out: back to this browser's own saved searches. */
export function detachSavedSearchesAccount(): void {
  serverBacked = false;
  cache = null;
  emit();
}

export async function saveSearch(query: string, mode: SearchMode | 'all', results: SearchResult[], name?: string, details?: { scope?: 'library' | 'work'; workId?: string; options?: Record<string, unknown> }): Promise<SavedSearch> {
  const trimmed = query.trim();
  const chosenName = (name ?? '').trim() || defaultSearchName(trimmed);
  const hits = results.filter(r => r.type !== 'author').slice(0, 100);
  let saved: SavedSearch;
  if (serverBacked) {
    const result = await readerGraphql<{ saveMySearch: ServerCollection }>('SaveMySearch',
      'mutation SaveMySearch($name: String, $query: String!, $params: String, $hits: [SavedSearchHitInput!]) { saveMySearch(name: $name, query: $query, params: $params, hits: $hits) { id name kind searchQuery searchParams createdAt items { id divPath divHead snippet score addedAt } } }',
      { name: chosenName, query: trimmed, params: JSON.stringify({ mode, scope: details?.scope, workId: details?.workId, options: details?.options }), hits: hits.map(r => ({ path: itemPath(r), snippet: r.snippet, score: r.score })) });
    const created = result.saveMySearch;
    saved = fromServer(created);
  } else {
    const now = new Date().toISOString();
    const taken = new Set(getSavedSearches().map(s => s.name));
    let unique = chosenName;
    for (let n = 2; taken.has(unique); n++) unique = `${chosenName} (${n})`;
    saved = {
      id: newId(), kind: 'search', name: unique, query: trimmed, mode: mode === 'all' ? undefined : mode, scope: details?.scope, scopeWorkId: details?.workId, options: details?.options,
      createdAt: now, updatedAt: now,
      items: hits.map((r): SavedSearchItem => ({
        id: newId(), target: r.target, workId: r.workId, chapterId: r.chapterId, workTitle: r.workTitle, authorName: r.authorName,
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
  if (serverBacked) await readerGraphql('RenameMyCollection',
    'mutation RenameMyCollection($id: ID!, $name: String!) { renameMyCollection(id: $id, name: $name) { id name } }', { id, name: trimmed });
  cache = getSavedSearches().map(s => (s.id === id ? { ...s, name: trimmed, updatedAt: new Date().toISOString() } : s));
  persist();
  emit();
}

export async function deleteSavedSearch(id: string): Promise<void> {
  if (serverBacked) await readerGraphql('DeleteMyCollection',
    'mutation DeleteMyCollection($id: ID!) { deleteMyCollection(id: $id) }', { id });
  cache = getSavedSearches().filter(s => s.id !== id);
  persist();
  emit();
}

export function exportSavedSearch(id: string, format: 'html' | 'md' | 'odt'): void {
  const saved = getSavedSearches().find(search => search.id === id);
  if (!saved) throw new Error('saved search not found');
  const title = saved.name || saved.query;
  if (format === 'odt') {
    const xml = odtXml(saved);
    const archive = zipSync({
      mimetype: [strToU8('application/vnd.oasis.opendocument.text'), { level: 0 }],
      'content.xml': strToU8(xml.content),
      'styles.xml': strToU8(xml.styles),
      'meta.xml': strToU8(xml.meta),
      'settings.xml': strToU8(xml.settings),
      'META-INF/manifest.xml': strToU8(xml.manifest),
    });
    downloadBlob(new Blob([archive], { type: 'application/vnd.oasis.opendocument.text' }), `${safeFilename(title)}.odt`);
    return;
  }
  const body = format === 'md'
    ? [`# ${title}`, '', `Query: ${saved.query}`, '', ...saved.items.map(item => `- [${item.workTitle}](/${item.chapterId || item.workId})${item.snippet ? ` — ${item.snippet}` : ''}`)].join('\n')
    : `<!doctype html><meta charset="utf-8"><title>${escapeHtml(title)}</title><h1>${escapeHtml(title)}</h1><p>Query: ${escapeHtml(saved.query)}</p><ul>${saved.items.map(item => `<li><a href="/${encodeURI(item.chapterId || item.workId)}">${escapeHtml(item.workTitle)}</a>${item.snippet ? ` — ${escapeHtml(item.snippet)}` : ''}</li>`).join('')}</ul>`;
  const blob = new Blob([body], { type: format === 'md' ? 'text/markdown;charset=utf-8' : 'text/html;charset=utf-8' });
  downloadBlob(blob, `${safeFilename(title)}.${format}`);
}

function safeFilename(value: string): string {
  return value.replace(/[^\p{L}\p{N}._-]+/gu, '-').replace(/^-|-$/g, '') || 'saved-search';
}

function downloadBlob(blob: Blob, filename: string): void {
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[char]!));
}

function odtXml(saved: SavedSearch): { content: string; styles: string; meta: string; settings: string; manifest: string } {
  const paragraphs = saved.items.map(item => `<text:p><text:a xlink:href="/${escapeXml(item.chapterId || item.workId)}">${escapeXml(item.workTitle)}</text:a>${item.snippet ? ` — ${escapeXml(item.snippet)}` : ''}</text:p>`).join('');
  const content = `<?xml version="1.0" encoding="UTF-8"?><office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:xlink="http://www.w3.org/1999/xlink" office:version="1.3"><office:body><office:text><text:h text:outline-level="1">${escapeXml(saved.name || saved.query)}</text:h><text:p>Query: ${escapeXml(saved.query)}</text:p>${paragraphs}</office:text></office:body></office:document-content>`;
  const styles = `<?xml version="1.0" encoding="UTF-8"?><office:document-styles xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" office:version="1.3"><office:styles/></office:document-styles>`;
  const meta = `<?xml version="1.0" encoding="UTF-8"?><office:document-meta xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" office:version="1.3"><office:meta/></office:document-meta>`;
  const settings = `<?xml version="1.0" encoding="UTF-8"?><office:document-settings xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" office:version="1.3"><office:settings/></office:document-settings>`;
  const manifest = `<?xml version="1.0" encoding="UTF-8"?><manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.3"><manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.text"/><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/><manifest:file-entry manifest:full-path="styles.xml" manifest:media-type="text/xml"/><manifest:file-entry manifest:full-path="meta.xml" manifest:media-type="text/xml"/><manifest:file-entry manifest:full-path="settings.xml" manifest:media-type="text/xml"/></manifest:manifest>`;
  return { content, styles, meta, settings, manifest };
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));
}
