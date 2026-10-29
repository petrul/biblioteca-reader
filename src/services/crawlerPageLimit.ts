import { randomBytes } from 'node:crypto';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { RESOURCE_LIMITS, type ResourceLimitOverrides } from './resourceLimits';
import { createVisitorCookies, type VisitorCookies } from './visitorCookie';

// The automated-access limit: clients that do not keep the reader's visitor
// cookie - curl, most scrapers - may read a small number of chapters an
// hour; a browser gets a budget out of any person's reach, which only stops
// a scraper that keeps its cookie. Both are offered paid volume access. The
// limits themselves are in resourceLimits.ts.
//
// A browser gets a signed visitor cookie on its first page load and is from
// then on counted on its own. An address may only obtain so many fresh
// cookies an hour, so a scraper cannot take a new one per request to pass
// as a browser. Counters live in memory: a restart forgives everyone.

export const READ_LIMIT_ERROR = 'read_limit';
export { VISITOR_COOKIE } from './visitorCookie';
const MAX_TRACKED_KEYS = 50_000;

export interface CrawlerLimitOptions extends ResourceLimitOverrides {
  windowMs?: number;
  now?: () => number;
  /** The process's visitor cookies, shared with the chat limit; a fresh set by default. */
  visitors?: VisitorCookies;
  /** HMAC key for a fresh set of visitor cookies (tests); ignored with `visitors`. */
  secret?: string;
}

// Chapter content as the reader fetches it: /api/server-content/{author}/
// {opus}[/{div}...].{html|txt|xml|json}. Not a chapter's embedded images
// (/_binary/), not a table-of-contents skeleton (?depth=0).
const CHAPTER_CONTENT = /^\/api\/server-content\/([^/]+\/[^/]+(?:\/[^/]+)*)\.(?:html|txt|xml|json)$/;

/** The chapter a request reads, as "author/opus/.../div", or null if it reads none. */
export function chapterRead(req: Request): string | null {
  if (!['GET', 'HEAD'].includes(req.method) || req.path.includes('/_binary/') || req.query.depth === '0') return null;
  const match = CHAPTER_CONTENT.exec(req.path);
  return match ? match[1] : null;
}

/** A browser navigating to a page - where a visitor cookie is handed out. */
function pageLoad(req: Request): boolean {
  if (req.method !== 'GET' || req.path === '/api' || req.path.startsWith('/api/')) return false;
  const dest = req.get('sec-fetch-dest');
  return dest ? dest === 'document' : (req.get('accept') || '').includes('text/html');
}

/** Per-key sliding window of distinct items (chapters, or fresh cookies). */
class DistinctWindow {
  private readonly hits = new Map<string, Map<string, number>>();
  constructor(private readonly limit: number, private readonly windowMs: number) {}

  private recent(key: string, timestamp: number): Map<string, number> {
    const items = this.hits.get(key) || new Map<string, number>();
    for (const [item, at] of items) if (timestamp - at >= this.windowMs) items.delete(item);
    return items;
  }

  /** Seconds until `key` may take `item`, or 0 if it may now (an item already taken is free). */
  retryAfter(key: string, item: string, timestamp: number): number {
    const items = this.recent(key, timestamp);
    if (items.has(item) || items.size < this.limit) return 0;
    const oldest = Math.min(...items.values());
    return Math.max(1, Math.ceil((oldest + this.windowMs - timestamp) / 1000));
  }

  record(key: string, item: string, timestamp: number): void {
    const items = this.recent(key, timestamp);
    if (items.has(item)) return;
    if (!this.hits.has(key) && this.hits.size >= MAX_TRACKED_KEYS) {
      const oldest = this.hits.keys().next().value;
      if (oldest !== undefined) this.hits.delete(oldest);
    }
    items.set(item, timestamp);
    // Re-insert so the Map's insertion order stays least-recently-used first.
    this.hits.delete(key);
    this.hits.set(key, items);
  }
}


export type ReadLimitScope = 'browser' | 'cookieless';

function limitMessage(scope: ReadLimitScope, limit: number, retryAfterSeconds: number): string {
  const minutes = Math.max(1, Math.ceil(retryAfterSeconds / 60));
  const why = scope === 'browser'
    ? `This browser has read ${limit} different chapters within an hour, which only automated access does.`
    : `Clients that do not keep cookies may read ${limit} chapters an hour; reading in a browser with cookies enabled is not limited this way.`;
  return `Automated access limit reached. ${why} You can continue in about ${minutes} minute${minutes === 1 ? '' : 's'}. `
    + `High-volume access is available as a paid service - contact ${RESOURCE_LIMITS.contact}.`;
}

export function crawlerPageRateLimit(options: CrawlerLimitOptions = {}): RequestHandler {
  const windowMs = options.windowMs ?? RESOURCE_LIMITS.windowMs;
  const now = options.now ?? Date.now;
  const limits: Record<ReadLimitScope, number> = {
    browser: options.browserChaptersPerHour ?? RESOURCE_LIMITS.browserChaptersPerHour,
    cookieless: options.cookielessChaptersPerHour ?? RESOURCE_LIMITS.cookielessChaptersPerHour,
  };
  const visitorCookies = options.visitors ?? createVisitorCookies(options.secret);
  const windows: Record<ReadLimitScope, DistinctWindow> = {
    browser: new DistinctWindow(limits.browser, windowMs),
    cookieless: new DistinctWindow(limits.cookieless, windowMs),
  };
  const newVisitors = new DistinctWindow(options.newVisitorCookiesPerHour ?? RESOURCE_LIMITS.newVisitorCookiesPerHour, windowMs);


  return (req: Request, res: Response, next: NextFunction) => {
    const chapter = chapterRead(req);
    const loadingPage = !chapter && pageLoad(req);
    if (!chapter && !loadingPage) {
      next();
      return;
    }
    const visitor = visitorCookies.identify(req);
    const timestamp = now();
    const address = req.ip || req.socket.remoteAddress || 'unknown';

    if (loadingPage) {
      if (visitor) {
        next();
        return;
      }
      // A browser's page load gets its cookie - unless this address has
      // already had its hourly share, which is how cookie farming ends.
      const slot = randomBytes(12).toString('base64url');
      if (newVisitors.retryAfter(address, slot, timestamp) === 0) {
        newVisitors.record(address, slot, timestamp);
        visitorCookies.issue(req, res);
      }
      next();
      return;
    }

    // A browser is counted on its own; a cookieless client by its address.
    const scope: ReadLimitScope = visitor ? 'browser' : 'cookieless';
    const key = visitor ?? address;
    const retryAfterSeconds = windows[scope].retryAfter(key, chapter!, timestamp);
    if (retryAfterSeconds > 0) {
      res.setHeader('Retry-After', String(retryAfterSeconds));
      res.setHeader('Cache-Control', 'no-store');
      res.status(429).json({
        error: READ_LIMIT_ERROR, scope, limit: limits[scope], retryAfterSeconds,
        contact: RESOURCE_LIMITS.contact, message: limitMessage(scope, limits[scope], retryAfterSeconds),
      });
      return;
    }
    windows[scope].record(key, chapter!, timestamp);
    next();
  };
}
