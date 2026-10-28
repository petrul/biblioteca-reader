import type { NextFunction, Request, RequestHandler, Response } from 'express';

const DEFAULT_HOURLY_PAGE_LIMIT = 500;
const WINDOW_MS = 60 * 60 * 1000;
const MAX_TRACKED_CLIENTS = 50_000;

export function crawlerPageRateLimit(options: { hourlyLimit?: number; windowMs?: number; now?: () => number } = {}): RequestHandler {
  const hourlyLimit = options.hourlyLimit ?? DEFAULT_HOURLY_PAGE_LIMIT;
  const windowMs = options.windowMs ?? WINDOW_MS;
  const now = options.now ?? Date.now;
  const pageRequests = new Map<string, number[]>();

  return (req: Request, res: Response, next: NextFunction) => {
    if (!['GET', 'HEAD'].includes(req.method) || req.path === '/api' || req.path.startsWith('/api/') || req.path.startsWith('/assets/') ||
        /^\/(?:robots\.txt|sitemap\.xml|favicon\.ico)$/.test(req.path) ||
        /\.(?:avif|css|gif|ico|jpe?g|js|map|png|svg|webp|woff2?)$/i.test(req.path)) {
      next();
      return;
    }

    const timestamp = now();
    const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
    const recent = (pageRequests.get(clientIp) || []).filter(requestedAt => timestamp - requestedAt < windowMs);
    if (recent.length >= hourlyLimit) {
      const retryAfterSeconds = Math.max(1, Math.ceil((recent[0] + windowMs - timestamp) / 1000));
      res.setHeader('Retry-After', String(retryAfterSeconds));
      res.setHeader('Cache-Control', 'no-store');
      res.status(429).type('text/plain').send(
        `Automated crawling limit reached (${hourlyLimit} page requests per hour per IP). For paid higher-volume access, contact petru@scriptorium.ro.`,
      );
      pageRequests.set(clientIp, recent);
      return;
    }

    if (!pageRequests.has(clientIp) && pageRequests.size >= MAX_TRACKED_CLIENTS) {
      const oldestClient = pageRequests.keys().next().value;
      if (oldestClient) pageRequests.delete(oldestClient);
    }
    recent.push(timestamp);
    pageRequests.delete(clientIp);
    pageRequests.set(clientIp, recent);
    next();
  };
}
