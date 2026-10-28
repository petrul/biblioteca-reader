import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, RequestHandler, Response } from 'express';

// Reading limits: generous for people, tight for scrapers, which are meant to
// pay for volume access. Only READS count - chapter text fetched through
// /api/server-content/* and real page loads - never assets, Vite's dev
// modules or the app's other API calls (one page view loads hundreds of
// those, which is what tripped the old per-request limit).
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

const STATIC_FILE = /\.(?:avif|css|gif|ico|jpe?g|js|jsx|map|mjs|png|svg|ts|tsx|webmanifest|webp|woff2?)$/i;
const DEV_OR_ASSET_PREFIX = /^\/(?:assets|src|node_modules|@vite|@fs|@id|@react-refresh)(?:\/|$)/;

/** A read worth counting: chapter text, or a page load. */
export function isCountedRead(req: Request): boolean {
  if (!['GET', 'HEAD'].includes(req.method)) return false;
  if (req.path.startsWith('/api/server-content/')) return true;
  if (req.path === '/api' || req.path.startsWith('/api/')) return false;
  if (DEV_OR_ASSET_PREFIX.test(req.path) || STATIC_FILE.test(req.path)) return false;
  return !/^\/(?:robots\.txt|sitemap\.xml|favicon\.ico)$/.test(req.path);
}

class SlidingWindow {
  private readonly hits = new Map<string, number[]>();
  constructor(private readonly limit: number, private readonly windowMs: number) {}

  /** Seconds until `key` may act again, or 0 if it may act now. */
  retryAfter(key: string, timestamp: number): number {
    const recent = (this.hits.get(key) || []).filter(at => timestamp - at < this.windowMs);
    this.hits.set(key, recent);
    if (recent.length < this.limit) return 0;
    return Math.max(1, Math.ceil((recent[0] + this.windowMs - timestamp) / 1000));
  }

  record(key: string, timestamp: number): void {
    const recent = this.hits.get(key) || [];
    if (!this.hits.has(key) && this.hits.size >= MAX_TRACKED_KEYS) {
      const oldest = this.hits.keys().next().value;
      if (oldest !== undefined) this.hits.delete(oldest);
    }
    recent.push(timestamp);
    // Re-insert so the Map's insertion order stays least-recently-used first.
    this.hits.delete(key);
    this.hits.set(key, recent);
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
  return `Reading limit reached: ${limit} pages per hour ${who}. You can continue in about ${minutes} minute${minutes === 1 ? '' : 's'}. `
    + `Automated or high-volume access is available as a paid service - contact ${CONTACT}.`;
}

/** The page a blocked page load gets: the same card the app shows, server-rendered. */
function limitPage(message: string): string {
  const text = message.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow">
  <title>Reading limit reached — Biblioteca</title>
  <style>
    body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
           background: #061a15; color: #e7e5e4; font-family: Georgia, serif; padding: 16px; box-sizing: border-box; }
    .card { max-width: 28rem; background: #0b2921; border: 1px solid rgba(16,185,129,.3); border-radius: 16px;
            padding: 32px; text-align: center; box-shadow: 0 25px 50px rgba(0,0,0,.5); }
    h1 { font-size: 1.4rem; color: #fff; margin: 0 0 12px; }
    p { color: #a8a29e; line-height: 1.5; margin: 0 0 24px; font-family: system-ui, sans-serif; font-size: .95rem; }
    a { display: inline-block; padding: 10px 20px; background: #f59e0b; color: #000; font-weight: 700; border-radius: 8px;
        text-decoration: none; font-family: system-ui, sans-serif; font-size: .75rem; text-transform: uppercase; letter-spacing: .05em; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Time for a short pause</h1>
    <p>${text}</p>
    <a href="mailto:${CONTACT}?subject=Biblioteca%20volume%20access">Ask about volume access</a>
  </div>
</body>
</html>`;
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
  const visitors = new SlidingWindow(limits.visitor, windowMs);
  const addresses = new SlidingWindow(limits.address, windowMs);
  const cookieless = new SlidingWindow(limits.cookieless, windowMs);
  const newVisitors = new SlidingWindow(newVisitorsHourly, windowMs);

  const sign = (id: string) => createHmac('sha256', secret).update(id).digest('base64url');
  const validVisitor = (value: string | undefined): string | undefined => {
    const [id, mac] = (value || '').split('.');
    if (!id || !mac) return undefined;
    const expected = Buffer.from(sign(id));
    const supplied = Buffer.from(mac);
    return expected.length === supplied.length && timingSafeEqual(expected, supplied) ? id : undefined;
  };

  return (req: Request, res: Response, next: NextFunction) => {
    if (!isCountedRead(req)) {
      next();
      return;
    }
    const timestamp = now();
    const address = req.ip || req.socket.remoteAddress || 'unknown';
    let visitor = validVisitor(cookieValue(req, VISITOR_COOKIE));

    // A browser's first page load mints its cookie - unless this address
    // has already minted its hourly share, which is how cookie farming ends.
    if (!visitor && !req.path.startsWith('/api/') && newVisitors.retryAfter(address, timestamp) === 0) {
      visitor = randomBytes(12).toString('base64url');
      newVisitors.record(address, timestamp);
      res.cookie(VISITOR_COOKIE, `${visitor}.${sign(visitor)}`, {
        httpOnly: true, sameSite: 'lax', secure: req.secure, path: '/', maxAge: 365 * 24 * 3600 * 1000,
      });
    }

    const checks: Array<[ReadLimitScope, SlidingWindow, string]> = visitor
      ? [['visitor', visitors, visitor], ['address', addresses, address]]
      : [['cookieless', cookieless, address], ['address', addresses, address]];
    for (const [scope, window, key] of checks) {
      const retryAfterSeconds = window.retryAfter(key, timestamp);
      if (retryAfterSeconds > 0) {
        const message = limitMessage(scope, limits[scope], retryAfterSeconds);
        res.setHeader('Retry-After', String(retryAfterSeconds));
        res.setHeader('Cache-Control', 'no-store');
        res.status(429);
        if (req.path.startsWith('/api/')) {
          res.json({ error: READ_LIMIT_ERROR, scope, limit: limits[scope], retryAfterSeconds, contact: CONTACT, message });
        } else {
          res.type('html').send(limitPage(message));
        }
        return;
      }
    }
    for (const [, window, key] of checks) window.record(key, timestamp);
    next();
  };
}
