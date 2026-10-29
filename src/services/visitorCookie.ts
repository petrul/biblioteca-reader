import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';

// The reader's visitor cookie: a signed random id a browser gets on its first
// page load, which tells browsers from automated clients (curl and most
// scrapers never keep it). One instance per server process is shared by every
// limit that needs it - the reading limit and the chat limit - so they agree
// on who is a browser. The key is random per process unless given; a restart
// re-issues cookies on the next page load.

export const VISITOR_COOKIE = 'bib_v';

export interface VisitorCookies {
  /** The visitor id of a request carrying a valid, correctly signed cookie. */
  identify(req: Request): string | undefined;
  /** Sets a fresh cookie on the response and returns its id. */
  issue(req: Request, res: Response): string;
}

function cookieValue(req: Request, name: string): string | undefined {
  for (const part of (req.headers.cookie || '').split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return undefined;
}

export function createVisitorCookies(secret: string = randomBytes(32).toString('hex')): VisitorCookies {
  const sign = (id: string) => createHmac('sha256', secret).update(id).digest('base64url');
  return {
    identify(req) {
      const [id, mac] = (cookieValue(req, VISITOR_COOKIE) || '').split('.');
      if (!id || !mac) return undefined;
      const expected = Buffer.from(sign(id));
      const supplied = Buffer.from(mac);
      return expected.length === supplied.length && timingSafeEqual(expected, supplied) ? id : undefined;
    },
    issue(req, res) {
      const id = randomBytes(12).toString('base64url');
      res.cookie(VISITOR_COOKIE, `${id}.${sign(id)}`, {
        httpOnly: true, sameSite: 'lax', secure: req.secure, path: '/', maxAge: 365 * 24 * 3600 * 1000,
      });
      return id;
    },
  };
}
