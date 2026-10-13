import createClient from 'openapi-fetch';
import type { components, paths } from '../generated/same-origin-api';
import type { paths as bibliotecaServerPaths } from '../generated/biblioteca-server-api';
import type { Author, Chapter, LanguageCode, SearchMode, SearchResult, Work } from '../types/textbase';

// Content passthrough only (rawText/proxiedAsset below). Structured API calls
// use the generated same-origin client; raw canonical content has its own
// explicit gateway namespace.
const SERVER_CONTENT = '/api/server-content';
// biblioteca-server ships one neutral portrait for authors without a
// specific image. Keep it behind the reader proxy, just like enriched art.
const GENERIC_AUTHOR_IMAGE = `${SERVER_CONTENT}/img/generic-author.webp`;
// The end-of-text ornament the original server page appends to every
// chapter (teidiv.html's p.deco-end) - same proxy, same reasoning.
export const ENDING_ORNAMENT_IMAGE = `${SERVER_CONTENT}/img/deco/deco-ending-style.svg`;
// openapi-fetch constructs a Request object per call, and Request needs
// an absolute URL: in the browser that means the document's own origin
// (same-origin requests, identical to the relative fetches this client
// replaced); anywhere else (the Node test runner) it gets an inert
// placeholder that only ever matters when a test has stubbed the global
// fetch. globalThis.location, not window.location, on purpose - Node
// test stubs may define a fake `window` without a `location` on it (see
// readerService.catalogCache.test.ts), and this must not depend on
// which shape is present.
const api = createClient<paths>({
  baseUrl: (globalThis as { location?: Location }).location?.origin ?? 'http://localhost',
  // Resolved at call time, not captured here: keeps the browser on the
  // live fetch AND lets tests stub globalThis.fetch after this module has
  // already loaded (the codebase's established mock pattern - see
  // bookmarkStore.test.ts's withFetchMock). Without this, createClient
  // would snapshot the original global fetch at import time and no
  // post-import stub would ever intercept an API call.
  fetch: trackedFetch,
  headers: { Accept: 'application/vnd.hal+json' }
});
const bibliotecaServerApi = createClient<bibliotecaServerPaths>({
  baseUrl: (globalThis as { location?: Location }).location?.origin ?? 'http://localhost',
  fetch: trackedFetch,
  headers: { Accept: 'application/json' }
});

type EntityDiv = components['schemas']['EntityModelTeiDiv'] & { author?: AuthorDto };
type TeiDiv = components['schemas']['TeiDivDto'];
type AuthorDto = components['schemas']['AuthorDto'] & { worksCount?: number };
type Hit = components['schemas']['HitDto'];
export type CatalogPage<T> = { items: T[]; page: number; size: number; totalItems: number; totalPages: number };

export const SERVER_ERROR_EVENT = 'reader:server-error';

export async function trackedFetch(...args: Parameters<typeof globalThis.fetch>): Promise<Response> {
  const response = await globalThis.fetch(...args);
  if (response.status >= 500 && typeof window !== 'undefined'
    && typeof window.dispatchEvent === 'function' && typeof CustomEvent !== 'undefined') {
    window.dispatchEvent(new CustomEvent<number>(SERVER_ERROR_EVENT, { detail: response.status }));
  }
  return response;
}

const SERVER_LANG_TO_CODE: Record<string, LanguageCode> = {
  BG: 'bul', BR: 'bre', CA: 'cat', DA: 'dan', DE: 'deu', EN: 'eng', ES: 'spa',
  FI: 'fin', FR: 'fra', GR: 'grc', HU: 'hun', IT: 'ita', LA: 'lat', NL: 'nld',
  NO: 'nor', PT: 'por', RO: 'ron', RU: 'rus', ZH: 'zho'
};
const CODE_TO_SERVER_LANG: Partial<Record<LanguageCode, string>> = Object.fromEntries(
  Object.entries(SERVER_LANG_TO_CODE).map(([server, code]) => [code, server])
) as Partial<Record<LanguageCode, string>>;

export function mapServerLanguage(serverLang?: string | null): LanguageCode {
  return SERVER_LANG_TO_CODE[(serverLang || '').toUpperCase()] || 'eng';
}

/**
 * The DAV export's language path segment: the server's Languages enum name
 * in lowercase (ro, en, ... - its getISO639_1Code()), which is what its
 * language/author/work directory tree is keyed by. '' for unmapped codes.
 */
export function davLanguageSegment(language: LanguageCode): string {
  return (CODE_TO_SERVER_LANG[language] || '').toLowerCase();
}

// The app builds with a vite base (BASE_URL, '/app/' behind
// biblioteca.scriptorium.ro's caddy), so public assets must be
// addressed through it: an absolute '/foo.png' resolves against the
// site root, which that origin routes to biblioteca-server, not to the
// reader - every card falls back to a broken-image icon. vite only
// substitutes the exact member expression import.meta.env.BASE_URL at
// build time (optional-chained forms survive to runtime as undefined
// there); plain node (unit tests) has no import.meta.env at all,
// hence the try/catch keeping the bare path.
export function appAsset(path: string): string {
  let base = '/';
  try {
    base = import.meta.env.BASE_URL ?? '/';
  } catch {
    // no import.meta.env outside vite - keep the bare path
  }
  return `${base}${path.replace(/^\//, '')}`;
}

/**
 * biblioteca-server's own advertised URL (pass-store BIBLIOTECA_EXTERNAL_URL,
 * mapped to the VITE_ variable by the rakefile's load_profile!) - for links
 * to the server's own pages, e.g. the reader's stats back face. Vite bakes
 * it at build time; plain node (unit tests) has no import.meta.env at all,
 * hence the same try/catch shape as appAsset.
 */
export function bibliotecaExternalUrl(): string {
  try {
    return import.meta.env.VITE_BIBLIOTECA_EXTERNAL_URL ?? '';
  } catch {
    return '';
  }
}

function proxiedAsset(url?: string): string | undefined {
  if (!url) return undefined;
  try {
    const parsed = new URL(url, window.location.origin);
    return `${SERVER_CONTENT}${parsed.pathname}${parsed.search}`;
  } catch {
    return undefined;
  }
}

function authorName(author?: EntityDiv['author'] | AuthorDto): string {
  if (!author) return 'Anonymous';
  if ('displayName' in author && author.displayName) return author.displayName;
  if ('visualName' in author && typeof author.visualName === 'string' && author.visualName) return author.visualName;
  return [author.firstName, author.lastName].filter(Boolean).join(' ') || 'Anonymous';
}

/** A description that is only BOMs/whitespace is no description. */
export function workSummary(description?: string): string {
  return (description ?? '').replace(/\uFEFF/g, '').replace(/\s+/g, ' ').trim();
}

export function workFromServerDiv(div: EntityDiv | TeiDiv, authorImage?: string, repo = 'textbase-live'): Work {
  const entity = div as EntityDiv;
  const dto = div as TeiDiv;
  const path = entity.completePath || dto.path || '';
  const author = div.author as EntityDiv['author'] | AuthorDto | undefined;
  const name = authorName(author);
  // Root opus DTOs may omit a work-level language while the attached author
  // still carries the edition's writing language (for example Creangă's
  // Romanian works). Preserve that signal before falling back to English.
  const language = mapServerLanguage(entity.lang || dto.language || author?.writingLanguage);
  const wordSize = div.wordSize || 0;
  const generatedCover = (div as TeiDiv & { coverUrl?: string }).coverUrl;
  return {
    id: path,
    authorId: author?.strId || path.split('/')[0] || 'anonymous',
    authorName: name,
    title: div.head || path.split('/').pop() || path,
    detectedLanguage: language,
    sizeWords: wordSize,
    sizeBytes: div.size || 0,
    chapterCount: Math.max(1, Math.round(wordSize / 1800)),
    license: 'As declared by the source TEI edition',
    sourceRepo: repo,
    teiHeaderSummary: {
      titleStmt: `${div.head || path} — ${name}`,
      publicationStmt: 'Served live from textbase-server.',
      sourceDesc: path
    },
    // A generated work cover is distinct from the author's portrait. Use a
    // local fallback so cards never wait on a remote image or renderer.
    // MinIO is the public-read asset store for generated covers; unlike an
    // upstream API it is safe for the browser to fetch the immutable object
    // URL directly. Cover generation itself never happens in the browser.
    coverImage: generatedCover,
    coverArtUrl: generatedCover,
    // 'live' only: the language is displayed as its full name by the
    // language label (languageName), never as a raw-code tag chip.
    tags: ['live'],
    // The work's own description (TEI opening paragraphs, or the enrichment
    // summary when those were blank); empty rather than a generic stand-in.
    summary: workSummary(dto.description),
    accessType: 'free',
    isPurchased: true
  };
}

function requireData<T>(result: { data?: T; error?: unknown; response: Response }, path: string): T {
  if (result.data !== undefined) return result.data;
  throw new ServerHttpError(`textbase-server ${path} -> HTTP ${result.response.status}`, result.response.status);
}

export async function fetchRealAuthorPage(page = 1, size = 12, query = ''): Promise<CatalogPage<AuthorDto>> {
  const result = await api.GET('/api/authors/page', {
    params: { query: { page, size, ...(query.trim() ? { q: query.trim() } : {}) } }
  });
  return requireData(result as any, '/api/authors/page') as CatalogPage<AuthorDto>;
}

export async function fetchRealAuthorById(strId: string): Promise<AuthorDto> {
  const result = await bibliotecaServerApi.GET('/api/authors/{strId}', { params: { path: { strId } } });
  return requireData(result as any, `/api/authors/${strId}`) as AuthorDto;
}

export async function fetchRealWorkPage(page = 1, size = 12, query = '', authors: AuthorDto[] = [], language?: LanguageCode): Promise<CatalogPage<Work>> {
  const lang = language ? (CODE_TO_SERVER_LANG[language] || language) : undefined;
  const apiResult = await api.GET('/api/works', {
    params: { query: { page, size, ...(query.trim() ? { q: query.trim() } : {}), ...(lang ? { lang } : {}) } }
  });
  const result = requireData(apiResult as any, '/api/works') as CatalogPage<TeiDiv>;
  const imageByAuthor = new Map(authors.map(author => [author.strId, author.image_href]));
  return { ...result, items: result.items.map(div => workFromServerDiv(div, imageByAuthor.get(div.author?.strId))) };
}

export async function fetchRealWorks(limit = 5000, authors: AuthorDto[] = []): Promise<Work[]> {
  const pageSize = Math.min(500, limit);
  // Use the server's DTO endpoint rather than Spring Data REST's entity
  // endpoint. The latter serializes JPA entities directly and can ask Derby
  // for an expired CLOB locator when an enriched author is attached.
  //
  // Stays on raw fetch rather than the generated client: /api/divs/ is
  // Spring Data REST's own Pageable-bound collection endpoint, and its
  // page/size params aren't springdoc-documented, so both generated specs
  // type this path's query as `never` - there's nothing for openapi-fetch
  // to type-check a call against.
  const divs: Array<EntityDiv | TeiDiv> = [];
  for (let page = 0; divs.length < limit; page += 1) {
    const response = await trackedFetch(`/api/divs/?page=${page}&size=${pageSize}`, { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`textbase-server /api/divs/ -> HTTP ${response.status}`);
    const batch = await response.json() as TeiDiv[];
    divs.push(...batch);
    if (batch.length < pageSize) break;
  }
  divs.splice(limit);
  const imageByAuthor = new Map(authors.map(author => [author.strId, author.image_href]));
  return divs
    // /api/divs/ is deliberately an all-divisions endpoint. Only root
    // divisions represent catalogue works; chapters are loaded separately
    // from /api/divs/{id}/toc and must never become standalone works.
    .filter(div => (div as TeiDiv).opus === true)
    .filter(div => Boolean((div as EntityDiv).completePath || (div as TeiDiv).path))
    .map(div => workFromServerDiv(div, imageByAuthor.get(div.author?.strId)));
}
/** The server-owned featured system collection, never inferred from import order. */
export async function fetchRealFeaturedWorks(authors: AuthorDto[] = []): Promise<Work[]> {
  const result = await api.GET('/api/collections/system/featured');
  const divs = requireData(result as any, '/api/collections/system/featured') as TeiDiv[];
  const imageByAuthor = new Map(authors.map(author => [author.strId, author.image_href]));
  return divs.map(div => workFromServerDiv(div, imageByAuthor.get(div.author?.strId)));
}

export function authorFromServer(author: AuthorDto, works: Work[] = []): Author {
  const authorWorks = works.filter(work => work.authorId === author.strId);
  const year = (value?: string) => {
    const match = value?.match(/-?\d{1,4}/);
    return match ? Number(match[0]) : undefined;
  };
  return {
    id: author.strId || 'anonymous',
    name: authorName(author),
    canonicalId: author.strId || 'anonymous',
    bio: author.bio || author.description,
    birthDate: author.birthDate,
    deathDate: author.deathDate,
    birthYear: year(author.birthDate),
    deathYear: year(author.deathDate),
    birthPlace: author.birthPlace,
    country: author.country,
    writingLanguage: author.writingLanguage,
    bioSourceUrl: author.bioSourceUrl,
    // Route remote/relative enrichment assets through the reader's same-
    // origin proxy, just like work cover images, so browser CSP/CORS rules
    // do not hide valid production author photos.
    imageHref: proxiedAsset(author.image_href) || GENERIC_AUTHOR_IMAGE,
    nationality: '',
    language: authorWorks[0]?.detectedLanguage || 'eng',
    worksCount: author.worksCount ?? author.opera?.length ?? authorWorks.length
  };
}

export async function fetchRealAuthors(works: Work[], dtos: AuthorDto[]): Promise<Author[]> {
  return dtos.map(author => authorFromServer(author, works));
}

// Single-work fetch for deep links: renders a work/reader page directly
// without fetching any author/work listing (see ensureWorkById in
// readerService). The typed response is the TeiElemDto supertype, but an
// opus path answers with the full div shape at runtime (head/author/size/
// wordSize - the very fields workFromServerDiv reads off the catalog's
// findOpera divs), hence the cast.
export async function fetchRealWorkByPath(workPath: string): Promise<Work | null> {
  const result = await api.GET('/api/divs', { params: { query: { path: workPath } } });
  const div = requireData(result, `/api/divs?path=${workPath}`);
  if (!div.id) return null;
  return workFromServerDiv(div as unknown as TeiDiv);
}

export async function fetchRealChaptersForWork(workPath: string): Promise<Chapter[]> {
  const rootResult = await api.GET('/api/divs', { params: { query: { path: workPath } } });
  const root = requireData(rootResult, `/api/divs?path=${workPath}`);
  if (!root.id) return [];
  const tocResult = await api.GET('/api/divs/{id}/toc', {
    params: { path: { id: root.id }, query: { page: 0, size: 2000 } }
  });
  const toc = requireData(tocResult, `/api/divs/${root.id}/toc`);
  const leaves = toc.filter(div => div.leaf && div.path);
  // Every division is a page, in document order: leaves are chapters, the
  // rest are section title pages (which may carry text of their own). A work
  // the server reports without any leaf is just its root, read whole.
  const readable = leaves.length ? toc.filter(div => div.path) : toc.filter(div => div.path === workPath);
  const divisionsByPath = new Map(
    toc.filter(div => div.path).map(div => [div.path!, div])
  );
  return readable.map((div, index) => ({
    id: div.path!,
    workId: workPath,
    chapterNumber: index + 1,
    title: div.head || `Section ${index + 1}`,
    ancestors: div.path
      ? div.path.split('/').slice(workPath.split('/').length, -1)
        .map((_, index, segments) => {
          const path = [...workPath.split('/'), ...segments.slice(0, index + 1)].join('/');
          const ancestor = divisionsByPath.get(path);
          return ancestor?.head && !ancestor.leaf
            ? { id: path, title: ancestor.head, depth: ancestor.depth ?? index + 1 }
            : null;
        })
        .filter((ancestor): ancestor is { id: string; title: string; depth: number } => ancestor !== null)
      : [],
    wordCount: div.wordSize || 0,
    charCount: div.size,
    ...(leaves.length && !div.leaf ? { isSection: true } : {}),
    htmlContent: '',
    plainText: '',
    illustrations: [],
    footnotes: []
  }));
}

export class ServerHttpError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

/**
 * `skeleton` asks for a non-leaf division without its sub-chapters
 * (?depth=0): its own heading and text only, never the whole book.
 */
export function chapterContentUrl(path: string, extension: 'txt' | 'xml' | 'json' | 'html', skeleton = false): string {
  const encoded = path.split('/').map(encodeURIComponent).join('/');
  return `${SERVER_CONTENT}/${encoded}.${extension}${skeleton ? '?depth=0' : ''}`;
}

async function rawText(path: string, extension: 'txt' | 'xml' | 'json' | 'html', skeleton = false): Promise<string> {
  const response = await trackedFetch(chapterContentUrl(path, extension, skeleton));
  if (!response.ok) throw new ServerHttpError(`textbase-server ${path}.${extension} -> HTTP ${response.status}`, response.status);
  return response.text();
}

// teidiv2html.xsl renders each tei:note as <button class="btn note" ...> -
// counting them client-side from the already-fetched htmlContent is free
// (no extra request), unlike parsing the TEI XML server-side would be.
function countNotes(html: string): number {
  return new DOMParser().parseFromString(html, 'text/html').querySelectorAll('.note').length;
}

// Naive but good enough for a stat, not a linguistic analysis: count
// run of characters ending in ./!/? (one or more, for "…" / "?!") followed
// by whitespace or end-of-text.
function countSentences(plainText: string): number {
  const matches = plainText.trim().match(/[.!?]+(?=\s|$)/g);
  return matches ? matches.length : (plainText.trim() ? 1 : 0);
}

// biblioteca-server's chapter HTML embeds its binary assets (illustrations,
// plates) as root-absolute URLs on the SERVER's origin -
// /{author}/{opus}/.../{div}.html/_binary/{xml:id}. On the server-rendered
// pages those resolve same-origin; in this SPA they would hit the reader's
// own routes (and its HTML fallback), yielding broken images. Rewrite them
// to the same-origin /api/server-content/* proxy, which forwards the path
// after that prefix to the biblioteca-server verbatim.
export function rewriteServerBinaryUrls(html: string): string {
  return html.replace(
    /(\s(?:src|href)=["'])(\/[^"']*?\/_binary\/[^"']+)(["'])/g,
    (_match, before: string, path: string, after: string) =>
      // Idempotent guard: content that already went through this rewrite
      // (fresh fetches, healed cache entries) keeps its proxy prefix.
      path.startsWith('/api/server-content')
        ? `${before}${path}${after}`
        : `${before}/api/server-content${path}${after}`
  );
}

export async function fetchRealChapterContent(chapterPath: string, onNotFound?: () => void, skeleton = false): Promise<Pick<Chapter, 'plainText' | 'htmlContent' | 'noteCount' | 'sentenceCount'> | null> {
  try {
    // 'html' (not 'xhtml' - textbase-server has no such route) is the
    // UNDECORATED content endpoint: clean, transformed markup with no site
    // chrome. Any other extension/no-extension request falls through to the
    // full decorated reader page (nav, breadcrumbs, share buttons, GA) -
    // which is what this used to fetch by mistake, dumping that whole page
    // into the reader's own content area via dangerouslySetInnerHTML.
    // XML and JSON are requested only by the explicit export links.
    const [plainText, htmlContent] = await Promise.all([
      rawText(chapterPath, 'txt', skeleton), rawText(chapterPath, 'html', skeleton)
    ]);
    return { plainText, htmlContent: rewriteServerBinaryUrls(htmlContent), noteCount: countNotes(htmlContent), sentenceCount: countSentences(plainText) };
  } catch (error) {
    if (error instanceof ServerHttpError && error.status === 404) onNotFound?.();
    console.warn(`failed to load chapter ${chapterPath}`, error);
    return null;
  }
}

/** Ask biblioteca-server for a random readable leaf through the generated same-origin client. */
export async function fetchRandomServerLocation(): Promise<string | null> {
  const result = await api.GET('/api/util/random', {});
  const payload = result.data as unknown;
  if (typeof payload === 'string') return payload;
  if (payload && typeof payload === 'object' && 'location' in payload) {
    const location = (payload as { location?: unknown }).location;
    return typeof location === 'string' ? location : null;
  }
  return result.response.headers.get('location');
}

export async function fetchRealRepos(): Promise<string[]> {
  const result = await api.GET('/api/collections/system/repos');
  return requireData(result, '/api/collections/system/repos');
}

function pathFromUrl(url?: string): string {
  if (!url) return '';
  try { return new URL(url, 'http://textbase.local').pathname.replace(/^\//, '').replace(/\.(txt|xml|json|xhtml)$/, ''); }
  catch { return url.replace(/^https?:\/\/[^/]+\//, ''); }
}

function hitData(hit: Hit): Record<string, unknown> {
  return hit.data && typeof hit.data === 'object' ? hit.data as Record<string, unknown> : {};
}

async function fetchSearchHits(mode: SearchMode, q: string, limit: number): Promise<Hit[]> {
  const options = { params: { query: { q, limit } } } as const;
  switch (mode) {
    case 'author': return requireData(await api.GET('/api/search/authors', options), '/api/search/authors');
    case 'title': return requireData(await api.GET('/api/search/divHeads', options), '/api/search/divHeads');
    case 'grep': return requireData(await api.GET('/api/search/grep', options), '/api/search/grep');
    case 'lucene': return requireData(await api.GET('/api/search/lucene', options), '/api/search/lucene');
    case 'vector': return requireData(await api.GET('/api/search/vector', options), '/api/search/vector');
  }
}

/** Return a readable Lucene excerpt instead of the complete indexed payload. */
export function luceneSnippet(content: string, query: string, maxChars = 760): string {
  const text = content.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  if (text.length <= maxChars) return text;

  const normalizedQuery = query.trim().toLowerCase();
  const lower = text.toLowerCase();
  let matchAt = normalizedQuery ? lower.indexOf(normalizedQuery) : -1;
  if (matchAt < 0) {
    const token = normalizedQuery.split(/\s+/).filter(Boolean).sort((a, b) => b.length - a.length)[0];
    matchAt = token ? lower.indexOf(token) : -1;
  }
  if (matchAt < 0) matchAt = 0;

  let start = Math.max(0, matchAt - Math.floor(maxChars / 2));
  let end = Math.min(text.length, start + maxChars);
  if (start > 0) {
    const boundary = text.indexOf(' ', start);
    if (boundary >= 0 && boundary < end) start = boundary + 1;
  }
  if (end < text.length) {
    const boundary = text.lastIndexOf(' ', end);
    if (boundary > start) end = boundary;
  }
  return `${start > 0 ? '… ' : ''}${text.slice(start, end).trim()}${end < text.length ? ' …' : ''}`;
}

export async function realSearch(mode: SearchMode, q: string, limit: number, works: Work[]): Promise<SearchResult[]> {
  if (q.trim().length < 3) return [];
  const hits = await fetchSearchHits(mode, q, limit);
  const byPath = new Map(works.map(work => [work.id, work]));
  // Search results commonly point at works outside the currently loaded
  // catalogue page. Resolve those roots in parallel so their language (and
  // author metadata) is not silently replaced by the old ENG fallback.
  const hitWorkPaths = [...new Set(hits.map(hit => {
    const data = hitData(hit);
    const hitPath = String(data.path || pathFromUrl(hit.url));
    return hitPath.split('/').slice(0, 2).join('/');
  }).filter(Boolean))];
  await Promise.all(hitWorkPaths.map(async workPath => {
    if (byPath.has(workPath)) return;
    try {
      const work = await fetchRealWorkByPath(workPath);
      if (work) byPath.set(workPath, work);
    } catch {
      // The search hit remains usable even if its root metadata request fails.
    }
  }));
  const normalizedQuery = q.trim().toLowerCase();

  const scored = hits.map((hit, index) => {
    const data = hitData(hit);
    const hitPath = String(data.path || pathFromUrl(hit.url));
    const workPath = hitPath.split('/').slice(0, 2).join('/');
    const work = byPath.get(workPath);
    const authorId = String(data.strId || work?.authorId || workPath.split('/')[0] || '');
    const author = String(data.displayName || work?.authorName || authorId);
    const workTitle = String(data.head || work?.title || data.displayName || hitPath);
    const result: SearchResult = {
      id: `live-${mode}-${index}-${hitPath || authorId}`,
      mode,
      // An author hit is an AUTHOR result: clicking it must open the
      // author page, not be misrouted as a work (which, with a paged
      // catalog, regularly meant a bogus workId and a "Work not found"
      // dead end).
      type: mode === 'author' ? 'author' : mode === 'title' ? 'work' : 'snippet',
      // Lucene/grep/vector hits often identify a leaf division. The reader
      // must load the root opus as workId and the full hit path as chapterId;
      // using hitPath as workId makes a leaf look like an opus and results in
      // "Chapter not available" whenever that work is outside the current
      // catalog page.
      workId: mode === 'author' ? (works.find(item => item.authorId === authorId)?.id || authorId) : (work?.id || workPath),
      workTitle,
      authorId,
      authorName: author,
      chapterId: mode === 'grep' || mode === 'lucene' || mode === 'vector' ? hitPath : undefined,
      chapterTitle: mode === 'grep' || mode === 'lucene' || mode === 'vector' ? hitPath.split('/').pop() : undefined,
      snippet: mode === 'lucene'
        ? luceneSnippet(hit.content || String(data.description || data.head || data.displayName || ''), q)
        : hit.content || String(data.description || data.head || data.displayName || ''),
      score: hit.score,
      language: mapServerLanguage(String(data.lang || data.language || '')) === 'eng'
        ? (work?.detectedLanguage || 'eng')
        : mapServerLanguage(String(data.lang || data.language)),
      matchDetails: `Live textbase-server ${mode} result`
    };
    return { result, wordSize: Number(data.wordSize) || 0, isTitlePrefixMatch: workTitle.trim().toLowerCase().startsWith(normalizedQuery) };
  });

  if (mode === 'title') {
    // Among results whose title literally starts with the query (e.g.
    // searching "Biblia" against both the complete "Biblia ortodoxă" and
    // the much shorter "Biblia necunoscută"), put the substantially
    // larger/more complete work first - the backend's own relevance
    // ranking doesn't otherwise distinguish "the real, complete work"
    // from a partial or unusual edition that happens to share the same
    // opening word. Everything else keeps the backend's own order.
    const prefixMatches = scored.filter(s => s.isTitlePrefixMatch).sort((a, b) => b.wordSize - a.wordSize);
    const rest = scored.filter(s => !s.isTitlePrefixMatch);
    return [...prefixMatches, ...rest].map(s => s.result);
  }

  return scored.map(s => s.result);
}

// ==========================================================================
// The API's non-catalog surface - identity, reading progress, payments,
// indexing-progress polls. Same origin, same generated client, same
// requireData discipline as the catalog calls above: every browser HTTP
// call goes through this one typed module, so call sites never touch
// fetch() themselves.
// ==========================================================================

// --- identity (server.ts's own auth bridges) ---

// biblioteca-server's /api/users/me answers a loose HAL object - the
// generated spec (operations["me"]) types it as an open record, so the
// WhoAmI-shaped fields are identity.ts's mapping business, not the spec's.
export async function fetchCurrentUser(): Promise<Record<string, unknown>> {
  const result = await api.GET('/api/users/me');
  return requireData(result, '/api/users/me');
}

export type GoogleSignInResponse = { success?: boolean; error?: string };

// server.ts answers both success (200) and failure (502, upstream
// unreachable) with the same {success, error} JSON shape - openapi-fetch
// surfaces the latter as `error` rather than `data`, so merge them back
// into the single response shape the raw fetch this replaced produced.
export async function postGoogleCredential(credential: string): Promise<GoogleSignInResponse> {
  const result = await api.POST('/api/auth/google', { body: { credential } });
  return result.data
    ?? (result.error as unknown as GoogleSignInResponse | undefined)
    ?? { success: false, error: 'invalid response from sign-in' };
}

export async function postGoogleProfileAccessToken(accessToken: string): Promise<GoogleSignInResponse> {
  const result = await bibliotecaServerApi.POST('/api/auth/google/profile', {
    body: { access_token: accessToken },
  });
  return result.data
    ?? (result.error as unknown as GoogleSignInResponse | undefined)
    ?? { success: false, error: 'invalid response from profile refresh' };
}

export async function postLogout(): Promise<void> {
  await api.POST('/api/auth/logout');
}

// --- reading progress (RemoteBookmarkStore's server-backed storage) ---

export type ReadingProgressRow = components['schemas']['ReadingProgressDto'];

export async function fetchReadingProgress(): Promise<ReadingProgressRow[]> {
  const result = await api.GET('/api/reading-progress');
  return requireData(result, '/api/reading-progress');
}

// A 404 (nothing saved for this work yet) lands in `error` - null, same
// as the !response.ok -> null of the raw fetch this replaced.
export async function fetchReadingProgressOne(opusPath: string): Promise<ReadingProgressRow | null> {
  const result = await api.GET('/api/reading-progress/one', { params: { query: { opusPath } } });
  return result.data ?? null;
}

export async function saveReadingProgress(divPath: string): Promise<void> {
  await api.PUT('/api/reading-progress', { body: { divPath } });
}

export async function addReadingAttention(opusPath: string, secondsDelta: number): Promise<void> {
  await api.PUT('/api/reading-progress/attention', { body: { opusPath, secondsDelta } });
}

export async function saveReadingScrollFraction(opusPath: string, divPath: string, scrollFraction: number): Promise<void> {
  await api.PUT('/api/reading-progress/scroll', { body: { opusPath, divPath, scrollFraction } });
}

// --- user preferences (biblioteca-server's one per-reader JSON document) ---

export async function fetchUserPreferences(): Promise<Record<string, unknown>> {
  const result = await api.GET('/api/users/me/preferences');
  return requireData(result, '/api/users/me/preferences');
}

// Stores the whole document as-is server-side; the merge-not-overwrite
// contract lives in RemotePreferencesStore (see preferencesStore.ts).
export async function saveUserPreferences(preferences: Record<string, unknown>): Promise<void> {
  await api.PUT('/api/users/me/preferences', { body: preferences });
}

// --- payments (server.ts's own Stripe/sandbox handlers) ---

export type PaymentConfig = paths['/api/payment/config']['get']['responses']['200']['content']['application/json'];
export type PaymentIntent = paths['/api/payment/create-intent']['post']['responses']['200']['content']['application/json'];
export type PaymentReceipt = paths['/api/payment/confirm']['post']['responses']['200']['content']['application/json']['receipt'];

export async function fetchPaymentConfig(): Promise<PaymentConfig> {
  const result = await api.GET('/api/payment/config');
  return requireData(result, '/api/payment/config');
}

// Non-200 answers carry {error} (400 validation, 500 upstream failure) -
// surfaced as an Error with the server's own message, exactly the shape
// the raw fetch's errData.error || status handling produced.
export async function postPaymentIntent(request: {
  workId: string;
  workTitle?: string;
  amountCents: number;
  currency?: string;
  userEmail?: string;
  userId?: string;
}): Promise<PaymentIntent> {
  const result = await api.POST('/api/payment/create-intent', { body: request });
  if (!result.data) {
    const error = result.error && typeof result.error === 'object' ? (result.error as { error?: string }).error : undefined;
    throw new Error(error || `Payment service returned status ${result.response.status}`);
  }
  return result.data;
}

// null for any non-200 (402 not verified, 400/500) rather than an
// exception - the caller's sandbox-receipt fallback, not a crash, same
// as the raw fetch's silent !res.ok -> no receipt.
export async function confirmPaymentPurchase(request: {
  paymentId: string;
  workId: string;
  workTitle?: string;
  amountCents?: number;
  currency?: string;
  userId?: string;
  customerEmail?: string;
}): Promise<PaymentReceipt | null> {
  const result = await api.POST('/api/payment/confirm', { body: request });
  return result.data?.receipt ?? null;
}

// --- indexing progress (admin card polls) ---

export async function fetchLuceneRebuildStatus(): Promise<components['schemas']['RebuildStatus']> {
  const result = await api.GET('/api/lucene/status');
  return requireData(result, '/api/lucene/status');
}

export type VectorizingJobStatus = paths['/api/vectorizing']['get']['responses']['200']['content']['application/json'];

export async function fetchVectorizingStatus(): Promise<VectorizingJobStatus> {
  const result = await api.GET('/api/vectorizing');
  return requireData(result, '/api/vectorizing');
}

// Fire-and-forget like the route itself (server.ts's /api/vectorizing/:action
// passthrough returns as soon as it kicked the upstream POST off) - any
// non-2xx surfaces as an Error carrying the HTTP status, the same string
// the raw fetch's throw new Error(String(res.status)) produced.
export async function postVectorizingAction(action: 'start' | 'pause' | 'resume'): Promise<void> {
  const result = await api.POST('/api/vectorizing/{action}', { params: { path: { action } } });
  if (!result.response.ok) throw new Error(String(result.response.status));
}
