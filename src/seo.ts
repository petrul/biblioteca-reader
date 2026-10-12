// Server-side-only SEO/social-card support for the SPA shell. This app
// renders one index.html for every route (see server.ts), and crawlers
// that matter most for link previews - Facebook's, Twitter's, Slack's,
// iMessage's - never execute the client bundle, so whatever this module
// produces IS the page as far as they're concerned. Everything here talks
// to biblioteca-server directly (not through this app's own /api/* proxy
// routes) since it runs before Express has even decided how to serve the
// request.
import { parseAppPath, type RouteState } from './router';

export { parseAppPath };
export type { RouteState };

const DEFAULT_TITLE = 'Biblioteca — a digital library of classics';
const DEFAULT_DESCRIPTION = 'Read the classics free, cover to cover — searchable critical editions with five search modes, chapter bookmarks, quotable passages, and personal collections, from Scriptorium\u2019s digital library.';
const DEFAULT_IMAGE_ALT = 'The Biblioteca shelf: live digital editions, reading progress and free classics';

export interface PageSeo {
  /** BCP-47 language for the initial HTML document shell. */
  language: string;
  title: string;
  description: string;
  image: string;
  imageType: string;
  imageAlt: string;
  canonicalUrl: string;
  robots: string;
  jsonLd: string | null;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function truncate(value: string, max: number): string {
  const clean = value.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}

interface DivAuthor {
  displayName?: string;
  visualName?: string;
  firstName?: string;
  lastName?: string;
  writingLanguage?: string;
}

interface Div {
  id?: number;
  head?: string;
  /** The work's stored cover (MinIO), set by biblioteca-nestjs; absent until one is generated. */
  coverUrl?: string;
  path?: string;
  completePath?: string;
  lang?: string;
  language?: string;
  author?: DivAuthor;
}

interface AuthorDetail {
  strId?: string;
  displayName?: string;
  firstName?: string;
  lastName?: string;
  bio?: string;
  birthDate?: string;
  deathDate?: string;
  birthPlace?: string;
  image_href?: string;
}

function authorDisplayName(author?: DivAuthor): string {
  if (!author) return 'Anonymous';
  if (author.displayName) return author.displayName;
  if (author.visualName) return author.visualName;
  return [author.firstName, author.lastName].filter(Boolean).join(' ') || 'Anonymous';
}

// A div path (work root or chapter) doubles as both ID and lookup key -
// see "Stable work identity" in biblioteca-server's AGENTS.md. Returns
// null on any failure (missing, unreachable, malformed) so callers fall
// back to the generic page meta rather than ever failing the page load.
async function fetchDiv(bibliotecaServerUrl: string, path: string): Promise<Div | null> {
  try {
    const res = await fetch(`${bibliotecaServerUrl}/api/divs?path=${encodeURIComponent(path)}`, {
      headers: { Accept: 'application/json' }
    });
    if (!res.ok) return null;
    const data = await res.json() as Div;
    return data?.id ? data : null;
  } catch {
    return null;
  }
}

async function fetchAuthor(bibliotecaServerUrl: string, strId: string): Promise<AuthorDetail | null> {
  try {
    const res = await fetch(`${bibliotecaServerUrl}/api/authors/${encodeURIComponent(strId)}`, {
      headers: { Accept: 'application/json' }
    });
    if (!res.ok) return null;
    return await res.json() as AuthorDetail;
  } catch {
    return null;
  }
}

// The og:image is whatever cover the work already has (its stored MinIO
// cover), else the site default - SEO never asks for a cover to be rendered;
// biblioteca-server requests missing covers when readers browse.
function coverImage(div: Div | null | undefined, defaultImage: string): { image: string; imageType: string } {
  return div?.coverUrl
    ? { image: div.coverUrl, imageType: 'image/png' }
    : { image: defaultImage, imageType: 'image/jpeg' };
}

// Mirrors DivController.getFeaturedImage on the biblioteca-server side
// (same TEI markup, same first-image-wins rule, same /_binary/{id} URL
// shape) - biblioteca-server's own server-rendered pages (teidiv.html)
// already use exactly this image as their own og:image for this div, so
// a reader chapter page that embeds one or more <binaryObject> images
// (figures, plates, illustrations) gets a real, page-specific preview
// instead of the generic work cover. Returns null when the chapter has
// no inline image at all, so the caller can fall back to the cover.
async function fetchFirstIllustrationUrl(bibliotecaServerUrl: string, origin: string, workId: string, divPath: string): Promise<string | null> {
  try {
    const res = await fetch(`${bibliotecaServerUrl}/${divPath.split('/').map(encodeURIComponent).join('/')}.xml`, {
      headers: { Accept: 'application/xml' }
    });
    if (!res.ok) return null;
    const xml = await res.text();
    const match = xml.match(/<binaryObject\b[^>]*\bxml:id\s*=\s*"([^"]+)"/);
    if (!match) return null;
    return `${origin}/api/server-content/${workId.split('/').map(encodeURIComponent).join('/')}/_binary/${encodeURIComponent(match[1])}`;
  } catch {
    return null;
  }
}

// Mirrors the client's proxiedAsset() (serversideApi.ts): biblioteca-server
// may report an absolute URL on its own host/port, but the browser (and
// any crawler) can only ever reach it through this app's same-origin
// /api/server-content passthrough.
function proxiedAssetUrl(origin: string, href?: string): string | null {
  if (!href) return null;
  try {
    const parsed = new URL(href, origin);
    return `${origin}/api/server-content${parsed.pathname}${parsed.search}`;
  } catch {
    return null;
  }
}

function bookJsonLd(opts: { title: string; author: string; url: string; image: string; language?: string }): string {
  const data: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Book',
    name: opts.title,
    author: { '@type': 'Person', name: opts.author },
    url: opts.url,
    image: opts.image,
    isAccessibleForFree: true
  };
  if (opts.language) data.inLanguage = opts.language;
  return JSON.stringify(data);
}

function personJsonLd(opts: {
  name: string; description?: string; url: string; image?: string;
  birthDate?: string; deathDate?: string; birthPlace?: string;
}): string {
  const data: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Person',
    name: opts.name,
    url: opts.url
  };
  if (opts.description) data.description = opts.description;
  if (opts.image) data.image = opts.image;
  if (opts.birthDate) data.birthDate = opts.birthDate;
  if (opts.deathDate) data.deathDate = opts.deathDate;
  if (opts.birthPlace) data.birthPlace = opts.birthPlace;
  return JSON.stringify(data);
}

function websiteJsonLd(origin: string): string {
  return JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: 'Biblioteca',
    url: origin,
    potentialAction: {
      '@type': 'SearchAction',
      target: `${origin}/app/search?mode=title&q={search_term_string}`,
      'query-input': 'required name=search_term_string'
    }
  });
}

export async function buildPageSeo(opts: {
  route: RouteState;
  origin: string;
  path: string;
  searchParams: URLSearchParams;
  bibliotecaServerUrl: string;
  defaultImage: string;
}): Promise<PageSeo> {
  const { route, origin, path, searchParams, bibliotecaServerUrl, defaultImage } = opts;
  const canonicalUrl = `${origin}${path}`;

  const fallback: PageSeo = {
    language: 'und',
    title: DEFAULT_TITLE,
    description: DEFAULT_DESCRIPTION,
    image: defaultImage,
    imageType: 'image/jpeg',
    imageAlt: DEFAULT_IMAGE_ALT,
    canonicalUrl,
    robots: 'index, follow',
    jsonLd: null
  };

  switch (route.view) {
    case 'work': {
      if (!route.workId) return fallback;
      const div = await fetchDiv(bibliotecaServerUrl, route.workId);
      if (!div) return fallback;
      const author = authorDisplayName(div.author);
      const title = div.head || route.workId;
      const { image, imageType } = coverImage(div, defaultImage);
      return {
        language: div.lang || div.language || div.author?.writingLanguage || 'und',
        title: `${title} by ${author} | Biblioteca`,
        description: truncate(`Read "${title}" by ${author} free online at Biblioteca — a living, searchable TEI critical edition.`, 200),
        image,
        imageType,
        imageAlt: `Cover of ${title} by ${author}`,
        canonicalUrl,
        robots: 'index, follow',
        jsonLd: bookJsonLd({ title, author, url: canonicalUrl, image, language: div.lang || div.language })
      };
    }
    case 'reader': {
      if (!route.workId || !route.chapterId) return fallback;
      const chapterDiv = await fetchDiv(bibliotecaServerUrl, route.chapterId);
      if (!chapterDiv) return fallback;
      const author = authorDisplayName(chapterDiv.author);
      const chapterTitle = chapterDiv.head || route.chapterId.split('/').pop() || route.chapterId;
      let workTitle = chapterTitle;
      let workDiv: Div | null = chapterDiv;
      if (route.chapterId !== route.workId) {
        workDiv = await fetchDiv(bibliotecaServerUrl, route.workId);
        if (workDiv?.head) workTitle = workDiv.head;
      }
      const illustration = await fetchFirstIllustrationUrl(bibliotecaServerUrl, origin, route.workId, route.chapterId);
      const cover = coverImage(workDiv, defaultImage);
      const image = illustration || cover.image;
      const title = chapterTitle === workTitle
        ? `${workTitle} by ${author} | Biblioteca`
        : `${chapterTitle} — ${workTitle} by ${author} | Biblioteca`;
      return {
        language: chapterDiv.lang || chapterDiv.language || chapterDiv.author?.writingLanguage || 'und',
        title,
        description: truncate(`Read "${chapterTitle}" from ${workTitle} by ${author} — free online at Biblioteca.`, 200),
        image,
        imageType: illustration ? 'image/jpeg' : cover.imageType,
        imageAlt: illustration ? `Illustration from ${chapterTitle}` : `Cover of ${workTitle} by ${author}`,
        canonicalUrl,
        robots: 'index, follow',
        jsonLd: bookJsonLd({ title: workTitle, author, url: canonicalUrl, image, language: chapterDiv.lang || chapterDiv.language })
      };
    }
    case 'author': {
      if (!route.authorId) return fallback;
      const author = await fetchAuthor(bibliotecaServerUrl, route.authorId);
      if (!author) return fallback;
      const name = authorDisplayName(author);
      const bio = typeof author.bio === 'string' ? author.bio.trim() : '';
      const portrait = proxiedAssetUrl(origin, author.image_href);
      return {
        language: 'und',
        title: `${name} | Biblioteca`,
        description: bio ? truncate(bio, 200) : `Browse free works by ${name} on Biblioteca.`,
        image: portrait || defaultImage,
        imageType: 'image/jpeg',
        imageAlt: `Portrait of ${name}`,
        canonicalUrl,
        robots: 'index, follow',
        jsonLd: personJsonLd({
          name,
          description: bio || undefined,
          url: canonicalUrl,
          image: portrait || undefined,
          birthDate: author.birthDate,
          deathDate: author.deathDate,
          birthPlace: author.birthPlace
        })
      };
    }
    case 'search': {
      const query = searchParams.get('q')?.trim();
      return {
        ...fallback,
        title: query ? `“${query}” search results | Biblioteca` : 'Search | Biblioteca',
        // Crawlable (so link equity flows through the site's search links)
        // but not indexed - results are ephemeral/duplicate content, the
        // kind of page Google explicitly recommends noindexing rather than
        // blocking outright.
        robots: 'noindex, follow'
      };
    }
    case 'quote':
      // Quotations only ever live in the creating browser's localStorage
      // (see readerService.ts) - this server has no way to know whether a
      // given quoteId resolves to real content or the "fragment not
      // found" state, so it can't build a real preview. noindex avoids
      // handing Google a soft-404 to index.
      return { ...fallback, title: 'Quoted Passage | Biblioteca', robots: 'noindex, follow' };
    case 'admin':
      return { ...fallback, title: 'Admin | Biblioteca', robots: 'noindex, nofollow' };
    case 'collections':
      return { ...fallback, title: 'My Collections | Biblioteca', robots: 'noindex, nofollow' };
    case 'browse':
    default:
      return { ...fallback, jsonLd: websiteJsonLd(origin) };
  }
}

export function renderIndexHtml(template: string, seo: PageSeo): string {
  const jsonLdScript = seo.jsonLd
    ? `<script type="application/ld+json">${seo.jsonLd.replace(/</g, '\\u003c')}</script>`
    : '';
  return template
    .replaceAll('__PAGE_LANG__', escapeHtml(seo.language || 'und'))
    .replaceAll('__PAGE_TITLE__', escapeHtml(seo.title))
    .replaceAll('__PAGE_DESCRIPTION__', escapeHtml(seo.description))
    .replaceAll('__OG_IMAGE_URL__', escapeHtml(seo.image))
    .replaceAll('__OG_IMAGE_TYPE__', seo.imageType)
    .replaceAll('__OG_IMAGE_ALT__', escapeHtml(seo.imageAlt))
    .replaceAll('__CANONICAL_URL__', escapeHtml(seo.canonicalUrl))
    .replaceAll('__ROBOTS__', seo.robots)
    .replace('__JSON_LD__', jsonLdScript);
}

export function buildRobotsTxt(origin: string): string {
  return [
    'User-agent: *',
    'Allow: /',
    'Disallow: /api/',
    'Disallow: /app/admin',
    'Disallow: /app/collections',
    '',
    `Sitemap: ${origin}/sitemap.xml`,
    ''
  ].join('\n');
}

interface AuthorListEntry { strId?: string }
interface DivListEntry { opus?: boolean; path?: string }

// Best-effort on every upstream call: a partial sitemap (or even just the
// homepage) beats a 502 on a file search engines poll unattended. Capped
// at 100 pages (50,000 works) as a sanity bound - the real catalog is
// ~3,800 works as of 2026-10, nowhere near the sitemap protocol's own
// 50,000 URL ceiling.
export async function buildSitemapXml(origin: string, bibliotecaServerUrl: string): Promise<string> {
  // A Set, not an array: offset pagination over a catalog that can change
  // mid-crawl (vectorizing/import jobs run continuously - see
  // project_greg_ollama_contention) can hand back the same row twice
  // across two page fetches. Deduping is cheap insurance against that,
  // not a sign the pagination below is wrong.
  const urls = new Set<string>([`${origin}/app`]);

  try {
    const res = await fetch(`${bibliotecaServerUrl}/api/authors/`, { headers: { Accept: 'application/json' } });
    if (res.ok) {
      const authors = await res.json() as AuthorListEntry[];
      for (const author of authors) {
        if (author.strId) urls.add(`${origin}/app/author/${encodeURIComponent(author.strId)}`);
      }
    }
  } catch {
    // best-effort - a missing author block still leaves a usable sitemap
  }

  try {
    // /api/works (not /api/divs/) - a dedicated, server-filtered works
    // listing, unlike the all-divisions /api/divs/ endpoint where opus
    // roots are a sparse ~2% of rows (chapters/sub-divisions make up the
    // rest), which would need tens of thousands of rows paged through to
    // find every work. The endpoint silently caps size at 100 regardless
    // of what's requested (the response's own "size" field confirms it),
    // so request that cap directly rather than asking for more and
    // mistaking the server's truncation for end-of-results.
    const pageSize = 100;
    for (let page = 0; page < 100; page += 1) {
      const res = await fetch(`${bibliotecaServerUrl}/api/works?page=${page}&size=${pageSize}`, {
        headers: { Accept: 'application/json' }
      });
      if (!res.ok) break;
      const data = await res.json() as { items?: DivListEntry[] };
      const batch = data.items ?? [];
      for (const div of batch) {
        if (div.opus && div.path) {
          urls.add(`${origin}/app/work/${div.path.split('/').map(encodeURIComponent).join('/')}`);
        }
      }
      if (batch.length < pageSize) break;
    }
  } catch {
    // best-effort - see above
  }

  const body = [...urls].map(url => `  <url><loc>${escapeHtml(url)}</loc></url>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}
