import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { RESOURCE_LIMITS } from './resourceLimits';
import type { VisitorCookies } from './visitorCookie';

// The chat limit, for every route that runs the chat model or the embedder on
// the shared GPU (/api/rag/chat, /ask, /ask/stream, /search). The limits are in
// resourceLimits.ts, and resourceLimits.test.ts states them:
//
// - a client without a valid visitor cookie - not a browser - is refused;
// - a browser may send a message a minute for an hour, and 300 a day;
// - one address, all its browsers together, 240 an hour;
// - administrators are exempt.
//
// Counters live in memory: a restart forgives everyone.

export const CHAT_LIMIT_ERROR = 'chat_limit';
export const CHAT_REQUIRES_BROWSER_ERROR = 'chat_requires_browser';
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const MAX_TRACKED_KEYS = 50_000;

export interface ChatLimitOptions {
  visitors: VisitorCookies;
  /** Requests that are never limited (an administrator's session). */
  isExempt?: (req: Request) => Promise<boolean>;
  now?: () => number;
  messagesPerHourPerBrowser?: number;
  messagesPerDayPerBrowser?: number;
  messagesPerHourPerAddress?: number;
}

/** Request timestamps per key, within the longest window asked about. */
class Timestamps {
  private readonly hits = new Map<string, number[]>();
  constructor(private readonly keepMs: number) {}

  /** Seconds until `key` is under `limit` within `windowMs`, or 0 if it is now. */
  retryAfter(key: string, limit: number, windowMs: number, timestamp: number): number {
    const recent = (this.hits.get(key) || []).filter(at => timestamp - at < this.keepMs);
    this.hits.set(key, recent);
    const inWindow = recent.filter(at => timestamp - at < windowMs);
    if (inWindow.length < limit) return 0;
    return Math.max(1, Math.ceil((inWindow[inWindow.length - limit] + windowMs - timestamp) / 1000));
  }

  record(key: string, timestamp: number): void {
    const recent = this.hits.get(key) || [];
    if (!this.hits.has(key) && this.hits.size >= MAX_TRACKED_KEYS) {
      const oldest = this.hits.keys().next().value;
      if (oldest !== undefined) this.hits.delete(oldest);
    }
    recent.push(timestamp);
    this.hits.delete(key);
    this.hits.set(key, recent);
  }
}

export function chatRateLimit(options: ChatLimitOptions): RequestHandler {
  const now = options.now ?? Date.now;
  const perHour = options.messagesPerHourPerBrowser ?? RESOURCE_LIMITS.chatMessagesPerHourPerBrowser;
  const perDay = options.messagesPerDayPerBrowser ?? RESOURCE_LIMITS.chatMessagesPerDayPerBrowser;
  const perAddress = options.messagesPerHourPerAddress ?? RESOURCE_LIMITS.chatMessagesPerHourPerAddress;
  const browsers = new Timestamps(DAY_MS);
  const addresses = new Timestamps(HOUR_MS);

  const refuse = (res: Response, status: number, body: Record<string, unknown>, retryAfterSeconds?: number) => {
    if (retryAfterSeconds) res.setHeader('Retry-After', String(retryAfterSeconds));
    res.setHeader('Cache-Control', 'no-store');
    res.status(status).json({ ...body, contact: RESOURCE_LIMITS.contact });
  };

  return (req: Request, res: Response, next: NextFunction) => {
    void (async () => {
      if (options.isExempt && await options.isExempt(req)) {
        next();
        return;
      }
      const browser = options.visitors.identify(req);
      if (!browser) {
        refuse(res, 403, {
          error: CHAT_REQUIRES_BROWSER_ERROR,
          message: 'The chat is for people reading in a browser with cookies enabled. Automated access is not offered.',
        });
        return;
      }
      const timestamp = now();
      const address = req.ip || req.socket.remoteAddress || 'unknown';
      const checks: Array<[string, Timestamps, string, number, number]> = [
        ['hour', browsers, browser, perHour, HOUR_MS],
        ['day', browsers, browser, perDay, DAY_MS],
        ['address', addresses, address, perAddress, HOUR_MS],
      ];
      for (const [scope, window, key, limit, windowMs] of checks) {
        const retryAfterSeconds = window.retryAfter(key, limit, windowMs, timestamp);
        if (retryAfterSeconds > 0) {
          const minutes = Math.max(1, Math.ceil(retryAfterSeconds / 60));
          refuse(res, 429, {
            error: CHAT_LIMIT_ERROR, scope, limit, retryAfterSeconds,
            message: `Chat limit reached (${limit} messages ${scope === 'day' ? 'a day' : 'an hour'}${scope === 'address' ? ' from your network' : ''}). You can ask again in about ${minutes} minute${minutes === 1 ? '' : 's'}.`,
          }, retryAfterSeconds);
          return;
        }
      }
      browsers.record(browser, timestamp);
      addresses.record(address, timestamp);
      next();
    })().catch(next);
  };
}
