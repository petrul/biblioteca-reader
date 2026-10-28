import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, RequestHandler, Response } from 'express';

// Reading limits: generous for people, tight for scrapers, which are meant to
// pay for volume access. What counts is defined positively - a READ is one
// chapter's content (see chapterRead below) - so nothing else can ever be
// charged by accident: not assets, not Vite's dev modules, not the page
// shell (it carries only metadata), not the app's other API calls. Each
// chapter counts once per window, whatever formats or reloads fetch it.
//
// A browser gets a signed visitor cookie on its first page load and reads
// against its own generous budget; many people behind one address (an
// office, a library) share only a high per-address ceiling. Clients that do
// not keep the cookie - curl, most scrapers - read against a small
// per-address budget, and an address minting many fresh cookies an hour
// (cookie farming) gets no more of them.
//
// Counters live in memory: a restart forgives everyone, which is fine for a
// deterrent whose real backstop is the paid-access offer.

export const READ_LIMIT_ERROR = 'read_limit';
export const VISITOR_COOKIE = 'bib_v';
const CONTACT = 'petru@scriptorium.ro';
const WINDOW_MS = 60 * 60 * 1000;
const MAX_TRACKED_KEYS = 50_000;

export type ReadLimitScope = 'visitor' | 'address' | 'cookieless';

export interface ReadLimitOptions {
  /** Reads per hour for one browser holding a valid visitor cookie. */
  visitorHourly?: number;
  /** Reads per hour from one address, all its visitors together (shared NAT). */
  addressHourly?: number;
  /** Reads per hour from one address for clients without a valid cookie. */
  cookielessHourly?: number;
  /** Fresh visitor cookies one address may obtain per hour. */
  newVisitorsHourly?: number;
  windowMs?: number;
  now?: () => number;
  /** HMAC key for visitor cookies; a random per-process key by default. */
  secret?: string;
}

function envInt(name: string): number | undefined {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : undefined;
}

/** Limits from READ_LIMIT_* environment variables, falling back to the defaults. */
export function readLimitOptionsFromEnv(): ReadLimitOptions {
  return {
    visitorHourly: envInt('READ_LIMIT_VISITOR_HOURLY'),
    addressHourly: envInt('READ_LIMIT_ADDRESS_HOURLY'),
    cookielessHourly: envInt('READ_LIMIT_COOKIELESS_HOURLY'),
    newVisitorsHourly: envInt('READ_LIMIT_NEW_VISITORS_HOURLY'),
  };
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

function limitMessage(scope: ReadLimitScope, limit: number, retryAfterSeconds: number): string {
  const who = scope === 'visitor' ? 'for this browser'
    : scope === 'address' ? 'from your network'
    : 'for clients that do not keep cookies';
  const minutes = Math.max(1, Math.ceil(retryAfterSeconds / 60));
  return `Reading limit reached: ${limit} chapters per hour ${who}. You can continue in about ${minutes} minute${minutes === 1 ? '' : 's'}. `
    + `Automated or high-volume access is available as a paid service - contact ${CONTACT}.`;
}

export function crawlerPageRateLimit(options: ReadLimitOptions = {}): RequestHandler {
  const windowMs = options.windowMs ?? WINDOW_MS;
  const now = options.now ?? Date.now;
  const limits: Record<ReadLimitScope, number> = {
    visitor: options.visitorHourly ?? 1500,
    address: options.addressHourly ?? 6000,
    cookieless: options.cookielessHourly ?? 150,
  };
  const newVisitorsHourly = options.newVisitorsHourly ?? 40;
  const secret = options.secret || randomBytes(32).toString('hex');
  const visitors = new DistinctWindow(limits.visitor, windowMs);
  const addresses = new DistinctWindow(limits.address, windowMs);
  const cookieless = new DistinctWindow(limits.cookieless, windowMs);
  const newVisitors = new DistinctWindow(newVisitorsHourly, windowMs);

  const sign = (id: string) => createHmac('sha256', secret).update(id).digest('base64url');
  const validVisitor = (value: string | undefined): string | undefined => {
    const [id, mac] = (value || '').split('.');
    if (!id || !mac) return undefined;
    const expected = Buffer.from(sign(id));
    const supplied = Buffer.from(mac);
    return expected.length === supplied.length && timingSafeEqual(expected, supplied) ? id : undefined;
  };

  return (req: Request, res: Response, next: NextFunction) => {
    const chapter = chapterRead(req);
    const loadingPage = !chapter && pageLoad(req);
    if (!chapter && !loadingPage) {
      next();
      return;
    }
    const timestamp = now();
    const address = req.ip || req.socket.remoteAddress || 'unknown';
    let visitor = validVisitor(cookieValue(req, VISITOR_COOKIE));

    // A browser's page load mints its cookie - unless this address has
    // already minted its hourly share, which is how cookie farming ends.
    if (!visitor && loadingPage) {
      const fresh = randomBytes(12).toString('base64url');
      if (newVisitors.retryAfter(address, fresh, timestamp) === 0) {
        newVisitors.record(address, fresh, timestamp);
        res.cookie(VISITOR_COOKIE, `${fresh}.${sign(fresh)}`, {
          httpOnly: true, sameSite: 'lax', secure: req.secure, path: '/', maxAge: 365 * 24 * 3600 * 1000,
        });
      }
    }
    if (!chapter) {
      next();
      return;
    }

    // Distinct per budget: the per-address ceiling counts each visitor's
    // chapter separately, so people sharing a network are not mistaken for
    // one reader re-reading.
    const checks: Array<[ReadLimitScope, DistinctWindow, string, string]> = visitor
      ? [['visitor', visitors, visitor, chapter], ['address', addresses, address, `${visitor} ${chapter}`]]
      : [['cookieless', cookieless, address, chapter], ['address', addresses, address, `- ${chapter}`]];
    for (const [scope, window, key, item] of checks) {
      const retryAfterSeconds = window.retryAfter(key, item, timestamp);
      if (retryAfterSeconds > 0) {
        const message = limitMessage(scope, limits[scope], retryAfterSeconds);
        res.setHeader('Retry-After', String(retryAfterSeconds));
        res.setHeader('Cache-Control', 'no-store');
        res.status(429).json({ error: READ_LIMIT_ERROR, scope, limit: limits[scope], retryAfterSeconds, contact: CONTACT, message });
        return;
      }
    }
    for (const [, window, key, item] of checks) window.record(key, item, timestamp);
    next();
  };
}
