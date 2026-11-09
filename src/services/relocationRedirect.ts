import type { Express, NextFunction, Request, Response } from 'express';
import { parseAppPath } from '../router';

// biblioteca-server keeps a Relocation for every division path a TEI reimport
// changed (its slug moved, or the division was retitled, moved or removed):
// the old path answers 301 there, and GET /api/relocations?path= says where
// it lives now. These helpers carry that to the reader, so favourites, shared
// links and crawlers reach the division's current address.

/**
 * An upstream redirect's Location, made a path on this origin: biblioteca-
 * server builds absolute URLs on its own host. A relayed content page
 * (/api/server-content/*) stays under that prefix.
 */
export function readerLocation(upstreamLocation: string, serverContent: boolean): string {
  const url = new URL(upstreamLocation, 'http://upstream.invalid');
  const path = url.pathname + url.search;
  return serverContent ? `/api/server-content${path}` : path;
}

/**
 * The division path a reader page names - /author/opus/chapter, /app/reader/...
 * or /app/work/... - or null for any other page.
 */
export function divisionPathOf(pathname: string, search = ''): string | null {
  const route = parseAppPath(pathname, '', search);
  if (route.view === 'reader' && route.chapterId) return '/' + route.chapterId;
  if (route.view === 'work' && route.workId) return '/' + route.workId;
  return null;
}

/** The reader page for a relocated division, in the same URL form as the old one. */
export function relocatedPagePath(pathname: string, newDivisionPath: string, search = ''): string {
  const prefix = pathname.startsWith('/app/reader/') ? '/app/reader'
    : pathname.startsWith('/app/work/') ? '/app/work' : '';
  return prefix + newDivisionPath + search;
}

type Lookup = (divisionPath: string) => Promise<string | null>;

/** Asks biblioteca-server where a division path lives now; null when not relocated or unreachable. */
export function relocationLookup(serverUrl: string, timeoutMs = 1500, fetchImpl: typeof fetch = fetch): Lookup {
  return async divisionPath => {
    try {
      const response = await fetchImpl(`${serverUrl}/api/relocations?path=${encodeURIComponent(divisionPath)}`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) return null;
      const body = await response.json() as { newPath?: string };
      return typeof body.newPath === 'string' && body.newPath.startsWith('/') ? body.newPath : null;
    } catch {
      return null; // never let the lookup break a page: the reader then shows its own not-found
    }
  };
}

/**
 * A request for a relocated division's old address - a page load (a
 * favourite opened in a new tab, a link from elsewhere), a crawler's text
 * edition, an export - answers 301 to the new one, before anything reads the
 * old path. Registered ahead of the text twins and the app.
 */
export function registerRelocationRedirects(app: Express, lookup: Lookup) {
  app.get('*', async (req: Request, res: Response, next: NextFunction) => {
    if (req.path.startsWith('/api/')) return next();
    const search = req.originalUrl.includes('?') ? req.originalUrl.slice(req.originalUrl.indexOf('?')) : '';
    // a chapter's text edition and exports (.txt, .xml, .json, .html) too
    const extension = req.path.match(/\.(xml|txt|json|html)$/)?.[0] ?? '';
    const pagePath = extension ? req.path.slice(0, -extension.length) : req.path;
    const divisionPath = divisionPathOf(pagePath, search);
    if (!divisionPath) return next();
    const relocated = await lookup(divisionPath);
    if (!relocated || relocated === divisionPath) return next();
    // read (and cleared) by the app, which then says "URL changed" (RelocationToast)
    if (!extension) res.cookie('biblioteca_relocated', divisionPath, { maxAge: 30_000, path: '/', sameSite: 'lax' });
    res.redirect(301, relocatedPagePath(pagePath, relocated + extension, search));
  });
}
