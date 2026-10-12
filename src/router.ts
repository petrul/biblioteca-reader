import {
  AppView,
  CatalogAccessFilter,
  CatalogListType,
  CatalogState,
  CatalogTab,
  LanguageCode,
  SearchMode
} from './types/textbase';

/**
 * Real (pushState) path-based routing, replacing the old #/work/xxx hash
 * scheme. Everything the reader UI serves lives under /app/ so it can
 * share a domain/Caddy instance with textbase-server's own URLs, which
 * live at the root (/{authorId}/{opusId}/{div1}/{div2}/... - see
 * DivController.AUTHOR_REGEX/OPUS_REGEX) without any path collision.
 *
 * workId/chapterId are already textbase-server's own completePath
 * (author/opus[/div...]) - see workFromServerDiv()/chapter id in
 * serversideApi.ts - so routing them as real path segments instead of
 * one encodeURIComponent'd blob avoids the double-encoded %2F that
 * scheme produced (a chapter path nested 3+ divs deep encoded its own
 * slashes into %2F inside a single hash segment).
 *
 * The one deliberate hash use is the browse catalog: the fragment
 * carries the tab AND its query/filter/page state
 * (#authors?q=cicero&page=2, #works?lang=lat&access=premium) - fixed
 * tab tokens plus urlencoded params, no slashes to double-encode, and
 * keeping them out of the path keeps textbase-server's catch-all root
 * routes (/{authorId}/...) completely free of /app-adjacent siblings.
 * The search view is a real path route, so its mode/query state rides
 * the ordinary query string (/app/search?mode=title&q=faust).
 */
export const APP_PREFIX = '/app';

// The catalog state every browse URL implicitly starts from - the
// values a plain /app deep link lands on, and what fragment params
// override. Fields are only serialized when they differ from these
// defaults, so common addresses stay short (#authors, not
// #works?q=&lang=all&access=all&page=1).
export const DEFAULT_CATALOG_STATE: CatalogState = {
  tab: 'works',
  worksQuery: '',
  worksLang: 'all',
  worksAccess: 'all',
  worksPage: 1,
  authorsQuery: '',
  authorsPage: 1,
  listsType: 'all'
};

export interface RouteState {
  view: AppView;
  catalog?: CatalogState;
  authorId?: string;
  workId?: string;
  chapterId?: string;
  quoteId?: string;
  search?: { mode?: SearchMode; query?: string; workSeed?: string };
}

export function parseAppPath(pathname: string, hash = '', search = ''): RouteState {
  const raw = pathname.startsWith(APP_PREFIX) ? pathname.slice(APP_PREFIX.length) : pathname;
  const segments = raw.split('/').filter(Boolean).map(decodeURIComponent);

  if (segments.length === 0) {
    const catalog = parseCatalogFragment(hash);
    return catalog ? { view: 'browse', catalog } : { view: 'browse' };
  }
  const [head, ...rest] = segments;

  if (head === 'search') {
    const params = new URLSearchParams(search);
    const mode = params.get('mode');
    return {
      view: 'search',
      search: {
        mode: mode && ['author', 'title', 'grep', 'lucene', 'vector'].includes(mode) ? (mode as SearchMode) : undefined,
        query: params.get('q') ?? undefined,
        workSeed: params.get('seed') ?? undefined
      }
    };
  }
  if (head === 'admin') return { view: 'admin' };
  if (head === 'collections') return { view: 'collections' };
  if (head === 'author' && rest[0]) return { view: 'author', authorId: rest[0] };
  if (head === 'quote' && rest[0]) return { view: 'quote', quoteId: rest[0] };
  if (head === 'work' && rest.length >= 2) return { view: 'work', workId: rest.slice(0, 2).join('/') };
  // A work with no chapter breakdown at all is its own single readable
  // div (see fetchRealChaptersForWork's "leaves.length ? leaves :
  // [root]" fallback in serversideApi.ts) - its chapter path equals
  // its work path exactly, so rest can be as short as 2 segments, not
  // just 3+.
  if (head === 'reader' && rest.length >= 2) {
    return { view: 'reader', workId: rest.slice(0, 2).join('/'), chapterId: rest.join('/') };
  }
  // A non-empty path that matches none of the above - as opposed to the
  // segments.length === 0 branch above, which is the legitimate plain-/app
  // case and stays 'browse'. A genuinely unrecognized path (truncated
  // work/reader segments, a typo'd head token, ...) is a real 404, not a
  // silent fallback to the catalog.
  return { view: 'notFound' };
}

// BrowseView's catalog fragment: #<tab>[?key=value&...]. Returns the
// full catalog state (defaults overridden by the fragment's params) for
// any non-empty fragment, undefined for a plain /app - App.tsx uses that
// undefined-ness to decide whether the remembered-tab preference may
// apply (a deep link always wins over the preference).
function parseCatalogFragment(hash: string): CatalogState | undefined {
  const fragment = hash.replace(/^#/, '');
  if (!fragment) return undefined;
  const [tabSegment, querySegment] = fragment.split('?');
  const params = new URLSearchParams(querySegment ?? '');
  const tab: CatalogTab =
    tabSegment === 'authors' ? 'authors'
    : tabSegment === 'lists' ? 'reading-lists'
    : 'works';
  const page = (raw: string | null): number => {
    const parsed = Number.parseInt(raw ?? '1', 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
  };
  const lang = params.get('lang');
  const access = params.get('access');
  const type = params.get('type');
  return {
    tab,
    worksQuery: tab === 'works' ? (params.get('q') ?? '') : DEFAULT_CATALOG_STATE.worksQuery,
    worksLang: tab === 'works' && lang ? (lang as LanguageCode) : DEFAULT_CATALOG_STATE.worksLang,
    worksAccess: tab === 'works' && access && ['free', 'premium', 'unlocked'].includes(access)
      ? (access as CatalogAccessFilter)
      : DEFAULT_CATALOG_STATE.worksAccess,
    worksPage: tab === 'works' ? page(params.get('page')) : DEFAULT_CATALOG_STATE.worksPage,
    authorsQuery: tab === 'authors' ? (params.get('q') ?? '') : DEFAULT_CATALOG_STATE.authorsQuery,
    authorsPage: tab === 'authors' ? page(params.get('page')) : DEFAULT_CATALOG_STATE.authorsPage,
    listsType: tab === 'reading-lists' && type && ['language', 'author', 'repo'].includes(type)
      ? (type as CatalogListType)
      : DEFAULT_CATALOG_STATE.listsType
  };
}

// The inverse of parseCatalogFragment: emits #<tab>?params for any state
// that differs from the defaults, and '' (plain /app) for the default
// works tab with no filters - so /app itself stays the canonical home
// address. Only the active tab's own params are serialized; the other
// tabs' filters are not URL state while their tab is hidden.
export function buildCatalogFragment(catalog: CatalogState): string {
  const params = new URLSearchParams();
  if (catalog.tab === 'works') {
    if (catalog.worksQuery) params.set('q', catalog.worksQuery);
    if (catalog.worksLang !== 'all') params.set('lang', catalog.worksLang);
    if (catalog.worksAccess !== 'all') params.set('access', catalog.worksAccess);
    if (catalog.worksPage > 1) params.set('page', String(catalog.worksPage));
  } else if (catalog.tab === 'authors') {
    if (catalog.authorsQuery) params.set('q', catalog.authorsQuery);
    if (catalog.authorsPage > 1) params.set('page', String(catalog.authorsPage));
  } else {
    if (catalog.listsType !== 'all') params.set('type', catalog.listsType);
  }
  const query = params.toString();
  const tabSegment = catalog.tab === 'authors' ? 'authors' : catalog.tab === 'reading-lists' ? 'lists' : 'works';
  if (!query && catalog.tab === 'works') return '';
  return `#${tabSegment}${query ? `?${query}` : ''}`;
}

export function buildAppPath(state: RouteState): string {
  switch (state.view) {
    case 'search': {
      const params = new URLSearchParams();
      if (state.search?.mode && state.search.mode !== 'title') params.set('mode', state.search.mode);
      if (state.search?.query) params.set('q', state.search.query);
      if (state.search?.workSeed) params.set('seed', state.search.workSeed);
      const query = params.toString();
      return `${APP_PREFIX}/search${query ? `?${query}` : ''}`;
    }
    case 'admin':
      return `${APP_PREFIX}/admin`;
    case 'collections':
      return `${APP_PREFIX}/collections`;
    case 'author':
      return state.authorId ? `${APP_PREFIX}/author/${encodeURIComponent(state.authorId)}` : APP_PREFIX;
    case 'quote':
      return state.quoteId ? `${APP_PREFIX}/quote/${encodeURIComponent(state.quoteId)}` : APP_PREFIX;
    case 'work':
      return state.workId
        ? `${APP_PREFIX}/work/${state.workId.split('/').map(encodeURIComponent).join('/')}`
        : APP_PREFIX;
    case 'reader':
      return state.chapterId
        ? `${APP_PREFIX}/reader/${state.chapterId.split('/').map(encodeURIComponent).join('/')}`
        : APP_PREFIX;
    case 'browse':
      return APP_PREFIX + buildCatalogFragment(state.catalog ?? DEFAULT_CATALOG_STATE);
    default:
      return APP_PREFIX;
  }
}
