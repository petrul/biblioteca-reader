import type { Express, Request, Response } from 'express';

/** Explicit same-origin gateway for biblioteca-server's public surface. */
export class BibliotecaServerProxy {
  private static readonly PUBLIC_GET_ROUTES = [
    '/api/users/me', '/api/lucene/status', '/api/reading-progress', '/api/reading-progress/one',
    '/api/divs', '/api/divs/:id/toc', '/api/authors', '/api/authors/page', '/api/authors/:strId',
    '/api/works', '/api/collections/system/repos', '/api/collections/system/featured',
    '/api/drest/teiDivs/search/findOpera', '/api/search/authors', '/api/search/divHeads',
    '/api/search/grep', '/api/search/lucene', '/api/search/vector', '/api/util/random'
  ];

  // The one public route whose upstream path differs - the server's random-
  // discovery redirect lives at /util/random, no /api prefix - mirroring
  // build-openapi-public.mjs's own upstream remap for the same route.
  private static readonly UPSTREAM_GET_PATHS: Record<string, string> = {
    '/api/util/random': '/util/random'
  };

  constructor(private readonly baseUrl: string) {}

  register(app: Express): void {
    BibliotecaServerProxy.PUBLIC_GET_ROUTES.forEach(route =>
      app.get(route, (req, res) => void this.relayGet(req, res, BibliotecaServerProxy.UPSTREAM_GET_PATHS[route] ?? req.originalUrl)));
    ['/api/reading-progress', '/api/reading-progress/attention', '/api/reading-progress/scroll']
      .forEach(route => app.put(route, (req, res) => void this.relayPut(req, res)));
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

  private async relayGet(req: Request, res: Response, upstreamPath = req.originalUrl): Promise<void> {
    try {
      const upstream = await fetch(`${this.baseUrl}${upstreamPath}`, {
        headers: this.forwardedHeaders(req, req.get('Accept') || 'application/json'), redirect: 'manual'
      });
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
      res.status(upstream.status);
      res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/octet-stream');
      res.send(Buffer.from(await upstream.arrayBuffer()));
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
    if (upstreamPath.startsWith('/api/') || upstreamPath.startsWith('/actuator')) {
      res.status(404).json({ error: 'not a public endpoint' });
      return;
    }
    await this.relayGet(req, res, upstreamPath);
  }
}
