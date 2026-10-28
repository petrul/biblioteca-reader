import type { Express, NextFunction, Request, Response } from 'express';

export function isSafeServerContentPath(value: string): boolean {
  const rawPath = value.split('?', 1)[0];
  if (!rawPath.startsWith('/') || rawPath.startsWith('//') || rawPath.includes('\\') || /[\u0000-\u001f]/.test(rawPath)) return false;
  let decoded = rawPath;
  try {
    for (let i = 0; i < 8; i++) {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
      if (i === 7) return false;
    }
  } catch { return false; }
  const lower = decoded.toLowerCase();
  return !decoded.startsWith('//') && !decoded.includes('\\')
    && !/[\u0000-\u001f]/.test(decoded)
    && !decoded.split('/').some(segment => segment === '.' || segment === '..')
    && !/^\/(?:api|actuator)(?:\/|$)/.test(lower);
}

/** Explicit same-origin gateway for biblioteca-server's public surface. */
export class BibliotecaServerProxy {
  // Read-only deployments pass a rejection handler for the state-changing
  // routes; null keeps forwarding them.
  constructor(private readonly baseUrl: string, private readonly rejectWrite: ((req: Request, res: Response, next: NextFunction) => unknown) | null = null) {}
  private static readonly PUBLIC_GET_ROUTES = [
    '/api/users/me', '/api/lucene/status', '/api/reading-progress', '/api/reading-progress/one',
    '/api/divs', '/api/divs/:id/toc', '/api/authors', '/api/authors/page', '/api/authors/:strId',
    '/api/works', '/api/collections/mine', '/api/collections/system/repos', '/api/collections/system/featured',
    '/api/drest/teiDivs/search/findOpera', '/api/search/authors', '/api/search/divHeads',
    '/api/search/grep', '/api/search/lucene', '/api/search/vector', '/api/util/random'
  ];

  // The one public route whose upstream path differs - the server's random-
  // discovery redirect lives at /util/random, no /api prefix - mirroring
  // build-openapi-public.mjs's own upstream remap for the same route.
  private static readonly UPSTREAM_GET_PATHS: Record<string, string> = {
    '/api/util/random': '/util/random'
  };

  register(app: Express): void {
    BibliotecaServerProxy.PUBLIC_GET_ROUTES.forEach(route =>
      app.get(route, (req, res) => void this.relayGet(req, res, BibliotecaServerProxy.UPSTREAM_GET_PATHS[route])));
    const putHandler = this.rejectWrite ?? ((req: Request, res: Response) => void this.relayPut(req, res));
    ['/api/reading-progress', '/api/reading-progress/attention', '/api/reading-progress/scroll']
      .forEach(route => app.put(route, putHandler));
    app.get('/api/server-content/*', (req, res) => void this.relayContent(req, res));
  }

  private forwardedHeaders(req: Request, accept = 'application/json'): Record<string, string> {
    const headers: Record<string, string> = { Accept: accept };
    if (req.headers.cookie) headers.Cookie = req.headers.cookie;
    return headers;
  }

  private relayCookies(upstream: globalThis.Response, res: Response): void {
    const cookies = upstream.headers.getSetCookie?.() ?? [];
    if (cookies.length) res.setHeader('Set-Cookie', cookies);
  }

  // A remapped route's upstream may be ANOTHER reader rather than
  // biblioteca-server: a dev profile (biblioteca/yoga2) points the base URL
  // at the public production address, where /api/* reaches the prod reader.
  // That reader serves only the public path, so a 404 on the server path
  // retries there once.
  private async relayGet(req: Request, res: Response, serverPath?: string): Promise<void> {
    try {
      const get = (path: string) => fetch(`${this.baseUrl}${path}`, {
        headers: this.forwardedHeaders(req, req.get('Accept') || 'application/json'), redirect: 'manual'
      });
      let upstream = await get(serverPath ?? req.originalUrl);
      if (serverPath && upstream.status === 404) upstream = await get(req.originalUrl);
      this.relayCookies(upstream, res);
      if (upstream.status >= 300 && upstream.status < 400) {
        // Relay the upstream redirect as data, never as a browser-observable
        // redirect: a same-origin fetch() auto-follows any Location header
        // on a 3xx - off-origin to the server's own HTML page, into CORS
        // failure - so the caller would never see this JSON. A 200 keeps
        // the follow-or-not decision with the client (fetchRandomServerLocation).
        const location = upstream.headers.get('location') || '';
        res.status(200).json({ location });
        return;
      }
      const contentType = upstream.headers.get('content-type') || 'application/octet-stream';
      let body = Buffer.from(await upstream.arrayBuffer());
      if (req.path === '/api/users/me' && upstream.ok && contentType.includes('application/json')) {
        try {
          const profile = JSON.parse(body.toString('utf8')) as { avatarUrl?: unknown };
          if (typeof profile.avatarUrl === 'string') {
            let avatar: URL | undefined;
            try { avatar = new URL(profile.avatarUrl); } catch { /* drop malformed avatar URLs */ }
            profile.avatarUrl = avatar?.protocol === 'https:' && /^lh\d+\.googleusercontent\.com$/.test(avatar.hostname)
              && !avatar.username && !avatar.password && !avatar.hash
              ? `/api/cover-thumbnails?${new URLSearchParams({ url: avatar.href, width: '160' })}`
              : undefined;
            body = Buffer.from(JSON.stringify(profile));
          }
        } catch { /* Preserve an upstream response we cannot safely interpret. */ }
      }
      res.status(upstream.status);
      res.setHeader('Content-Type', contentType);
      res.send(body);
    } catch (error: any) {
      res.status(502).json({ error: `biblioteca-server unreachable at ${this.baseUrl}: ${error?.message || error}` });
    }
  }

  private async relayPut(req: Request, res: Response): Promise<void> {
    try {
      const upstream = await fetch(`${this.baseUrl}${req.originalUrl}`, {
        method: 'PUT', headers: { ...this.forwardedHeaders(req), 'Content-Type': 'application/json' },
        body: JSON.stringify(req.body ?? {}), redirect: 'manual'
      });
      this.relayCookies(upstream, res);
      res.status(upstream.status);
      res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/octet-stream');
      res.send(Buffer.from(await upstream.arrayBuffer()));
    } catch (error: any) {
      res.status(502).json({ error: `biblioteca-server unreachable at ${this.baseUrl}: ${error?.message || error}` });
    }
  }

  private async relayContent(req: Request, res: Response): Promise<void> {
    const upstreamPath = req.originalUrl.replace(/^\/api\/server-content/, '');
    if (!isSafeServerContentPath(upstreamPath)) {
      res.status(404).json({ error: 'not a public endpoint' });
      return;
    }
    await this.relayGet(req, res, upstreamPath);
  }
}
