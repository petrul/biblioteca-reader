import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { runAs } from './initiator';
import { RESOURCE_LIMITS } from './resourceLimits';

// The chat limit, for every route that runs the chat model or the embedder on
// the shared GPU (/api/rag/chat, /ask, /ask/stream, /search). The limits are in
// resourceLimits.ts, and resourceLimits.test.ts states them:
//
// - only signed-in users may chat: anyone else is refused (401);
// - one message at a time: a user's next message is refused (409) until the
//   answer to the previous one has been sent;
// - a user may send 60 messages an hour and 400 a day;
// - one address, all its users together, 240 an hour;
// - administrators are exempt from the counts, not from the one-at-a-time rule.
//
// The request then runs as its user (services/initiator.ts), so the user is
// what biblioteca-nestjs logs and records on biblioteca_events.
//
// Counters live in memory: a restart forgives everyone.

export const CHAT_LIMIT_ERROR = 'chat_limit';
export const CHAT_REQUIRES_SIGN_IN_ERROR = 'chat_requires_sign_in';
export const CHAT_BUSY_ERROR = 'chat_busy';
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const MAX_TRACKED_KEYS = 50_000;

/** Who sent a chat request, as biblioteca-server knows them. */
export interface ChatUser {
  username: string;
  isAdmin: boolean;
}

export interface ChatLimitOptions {
  /** The signed-in user who sent the request, or null for a guest. */
  userOf: (req: Request) => Promise<ChatUser | null>;
  now?: () => number;
  messagesPerHourPerUser?: number;
  messagesPerDayPerUser?: number;
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
  const perHour = options.messagesPerHourPerUser ?? RESOURCE_LIMITS.chatMessagesPerHourPerUser;
  const perDay = options.messagesPerDayPerUser ?? RESOURCE_LIMITS.chatMessagesPerDayPerUser;
  const perAddress = options.messagesPerHourPerAddress ?? RESOURCE_LIMITS.chatMessagesPerHourPerAddress;
  const users = new Timestamps(DAY_MS);
  const addresses = new Timestamps(HOUR_MS);
  /** Users whose previous message is still being answered. */
  const answering = new Set<string>();

  const refuse = (res: Response, status: number, body: Record<string, unknown>, retryAfterSeconds?: number) => {
    if (retryAfterSeconds) res.setHeader('Retry-After', String(retryAfterSeconds));
    res.setHeader('Cache-Control', 'no-store');
    res.status(status).json({ ...body, contact: RESOURCE_LIMITS.contact });
  };

  return (req: Request, res: Response, next: NextFunction) => {
    void (async () => {
      const user = await options.userOf(req);
      if (!user) {
        refuse(res, 401, {
          error: CHAT_REQUIRES_SIGN_IN_ERROR,
          message: 'Asistentul este disponibil doar utilizatorilor autentificați. Autentifică-te pentru a pune întrebări.',
        });
        return;
      }
      if (answering.has(user.username)) {
        refuse(res, 409, {
          error: CHAT_BUSY_ERROR,
          message: 'Așteaptă răspunsul la întrebarea anterioară înainte de a trimite alta.',
        });
        return;
      }
      if (!user.isAdmin) {
        const timestamp = now();
        const address = req.ip || req.socket.remoteAddress || 'unknown';
        const checks: Array<[string, Timestamps, string, number, number]> = [
          ['hour', users, user.username, perHour, HOUR_MS],
          ['day', users, user.username, perDay, DAY_MS],
          ['address', addresses, address, perAddress, HOUR_MS],
        ];
        for (const [scope, window, key, limit, windowMs] of checks) {
          const retryAfterSeconds = window.retryAfter(key, limit, windowMs, timestamp);
          if (retryAfterSeconds > 0) {
            const minutes = Math.max(1, Math.ceil(retryAfterSeconds / 60));
            refuse(res, 429, {
              error: CHAT_LIMIT_ERROR, scope, limit, retryAfterSeconds,
              message: `Ai atins limita de ${limit} mesaje ${scope === 'day' ? 'pe zi' : 'pe oră'}${scope === 'address' ? ' din rețeaua ta' : ''}. Poți întreba din nou în aproximativ ${minutes} minut${minutes === 1 ? '' : 'e'}.`,
            }, retryAfterSeconds);
            return;
          }
        }
        users.record(user.username, timestamp);
        addresses.record(address, timestamp);
      }
      // held until the answer is sent - or the browser gives up on it
      answering.add(user.username);
      res.once('close', () => answering.delete(user.username));
      runAs(user.username, next);
    })().catch(next);
  };
}
