import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { RESOURCE_LIMITS, type ResourceLimitOverrides } from './resourceLimits';

// The automated-access limit: people reading in a browser are never
// limited; clients that do not keep the reader's visitor cookie - curl, most
// scrapers - may read a limited number of chapters an hour and are offered
// paid volume access. The limits themselves are in resourceLimits.ts.
//
// A browser gets a signed visitor cookie on its first page load and is from
// then on recognised and never counted. An address may only obtain so many
// fresh cookies an hour, so a scraper cannot take a new one per request to
// pass as a browser. Counters live in memory: a restart forgives everyone.

export const READ_LIMIT_ERROR = 'read_limit';
export const VISITOR_COOKIE = 'bib_v';
const MAX_TRACKED_KEYS = 50_000;

export interface CrawlerLimitOptions extends ResourceLimitOverrides {
  windowMs?: number;
  now?: () => number;
  /** HMAC key for visitor cookies; a random per-process key by default. */
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

function cookieValue(req: Request, name: string): string | undefined {
  for (const part of (req.headers.cookie || '').split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return undefined;
}

function limitMessage(limit: number, retryAfterSeconds: number): string {
  const minutes = Math.max(1, Math.ceil(retryAfterSeconds / 60));
  return `Automated access limit reached: ${limit} chapters per hour for clients that do not keep cookies. `
    + `Reading in a browser with cookies enabled is not limited; otherwise you can continue in about ${minutes} minute${minutes === 1 ? '' : 's'}. `
    + `High-volume access is available as a paid service - contact ${RESOURCE_LIMITS.contact}.`;
}

export function crawlerPageRateLimit(options: CrawlerLimitOptions = {}): RequestHandler {
  const windowMs = options.windowMs ?? RESOURCE_LIMITS.windowMs;
  const now = options.now ?? Date.now;
  const cookielessLimit = options.cookielessChaptersPerHour ?? RESOURCE_LIMITS.cookielessChaptersPerHour;
  const secret = options.secret || randomBytes(32).toString('hex');
  const cookieless = new DistinctWindow(cookielessLimit, windowMs);
  const newVisitors = new DistinctWindow(options.newVisitorCookiesPerHour ?? RESOURCE_LIMITS.newVisitorCookiesPerHour, windowMs);

  const sign = (id: string) => createHmac('sha256', secret).update(id).digest('base64url');
  const validVisitor = (value: string | undefined): boolean => {
    const [id, mac] = (value || '').split('.');
    if (!id || !mac) return false;
    const expected = Buffer.from(sign(id));
    const supplied = Buffer.from(mac);
    return expected.length === supplied.length && timingSafeEqual(expected, supplied);
  };

  return (req: Request, res: Response, next: NextFunction) => {
    const chapter = chapterRead(req);
    const loadingPage = !chapter && pageLoad(req);
    if ((!chapter && !loadingPage) || validVisitor(cookieValue(req, VISITOR_COOKIE))) {
      next();
      return;
    }
    const timestamp = now();
    const address = req.ip || req.socket.remoteAddress || 'unknown';

    if (loadingPage) {
      // A browser's page load gets its cookie - unless this address has
      // already had its hourly share, which is how cookie farming ends.
      const fresh = randomBytes(12).toString('base64url');
      if (newVisitors.retryAfter(address, fresh, timestamp) === 0) {
        newVisitors.record(address, fresh, timestamp);
        res.cookie(VISITOR_COOKIE, `${fresh}.${sign(fresh)}`, {
          httpOnly: true, sameSite: 'lax', secure: req.secure, path: '/', maxAge: 365 * 24 * 3600 * 1000,
        });
      }
      next();
      return;
    }

    const retryAfterSeconds = cookieless.retryAfter(address, chapter!, timestamp);
    if (retryAfterSeconds > 0) {
      res.setHeader('Retry-After', String(retryAfterSeconds));
      res.setHeader('Cache-Control', 'no-store');
      res.status(429).json({
        error: READ_LIMIT_ERROR, scope: 'cookieless', limit: cookielessLimit, retryAfterSeconds,
        contact: RESOURCE_LIMITS.contact, message: limitMessage(cookielessLimit, retryAfterSeconds),
      });
      return;
    }
    cookieless.record(address, chapter!, timestamp);
    next();
  };
}
