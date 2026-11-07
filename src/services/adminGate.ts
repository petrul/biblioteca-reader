import type { NextFunction, Request, Response } from 'express';

/**
 * Express middleware: only an administrator's session gets through; anyone
 * else gets 403. `isAdmin` asks biblioteca-server (server.ts's
 * isAdminSession), so the gate does not depend on what the UI shows.
 */
export function requireAdmin(isAdmin: (req: Request) => Promise<boolean>) {
  return async (req: Request, res: Response, next: NextFunction) => {
    let admin = false;
    try { admin = await isAdmin(req); } catch { admin = false; }
    if (!admin) {
      res.status(403).json({ error: 'administrators only' });
      return;
    }
    next();
  };
}
