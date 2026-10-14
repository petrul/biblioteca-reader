import type { Express, Request, Response } from 'express';

const PREFIX = '/api/cover-thumbnails';
const WIDTHS = [160, 320, 640];
const KEY = /^[a-f0-9]{64}\.webp$/;

export interface ReaderThumbnailOptions { coversUrl: string; apiDocument?: { paths: Record<string, unknown> }; }
export function registerReaderThumbnails(app: Express, options: ReaderThumbnailOptions, requestUpstream: typeof fetch = fetch) {
  const coversUrl = options.coversUrl.replace(/\/$/, '');
  async function relay(req: Request, res: Response, upstreamPath: string) {
    try {
      const headers: Record<string, string> = { Accept: 'image/webp' };
      if (req.headers['if-none-match']) headers['If-None-Match'] = req.headers['if-none-match'];
      const upstream = await requestUpstream(`${coversUrl}${upstreamPath}`, { headers, redirect: 'manual', signal: AbortSignal.timeout(20_000) });
      if (upstream.status >= 300 && upstream.status < 400 && upstream.status !== 304) {
        res.status(502).json({ error: 'Thumbnail service returned an unexpected redirect' }); return;
      }
      res.status(upstream.status);
      for (const name of ['Content-Type', 'Cache-Control', 'ETag', 'X-Thumbnail-Cache', 'X-Content-Type-Options']) {
        const value = upstream.headers.get(name); if (value) res.setHeader(name, value);
      }
      const location = upstream.headers.get('content-location');
      if (location?.startsWith('/api/thumbnails/cache/') && KEY.test(location.slice('/api/thumbnails/cache/'.length))) {
        res.setHeader('Content-Location', location.replace('/api/thumbnails', PREFIX));
      }
      if (upstream.status === 304) { res.end(); return; }
      if (upstream.ok && !upstream.headers.get('content-type')?.startsWith('image/webp')) {
        res.removeHeader('ETag'); res.setHeader('Cache-Control', 'no-store');
        res.status(502).type('application/json').json({ error: 'Thumbnail service did not return a WebP image' }); return;
      }
      res.send(Buffer.from(await upstream.arrayBuffer()));
    } catch {
      res.status(502).type('application/json').set('Cache-Control', 'no-store').json({ error: 'Cover thumbnail service is unavailable' });
    }
  }
  app.get(PREFIX, (req, res) => {
    const width = req.query.width === undefined ? 320 : Number(req.query.width);
    if (typeof req.query.url !== 'string' || !WIDTHS.includes(width)) {
      res.status(400).json({ error: 'An original cover URL and width 160, 320, or 640 are required' }); return;
    }
    let original: URL;
    try { original = new URL(req.query.url); } catch { res.status(400).json({ error: 'Invalid original cover URL' }); return; }
    if (!['http:', 'https:'].includes(original.protocol) || original.username || original.password || original.hash) {
      res.status(400).json({ error: 'Original cover must be an HTTP(S) URL without credentials or a fragment' }); return;
    }
    const query = new URLSearchParams({ url: original.href, width: String(width) });
    void relay(req, res, `/api/thumbnails?${query}`);
  });
  app.get(`${PREFIX}/cache/:key`, (req, res) => {
    if (!KEY.test(req.params.key)) { res.status(400).json({ error: 'Invalid thumbnail key' }); return; }
    void relay(req, res, `/api/thumbnails/cache/${req.params.key}`);
  });
  const doc = {
    openapi: '3.0.3', info: { title: 'Reader same-origin cover thumbnails', version: '1.0.0' },
    paths: {
      [PREFIX]: { get: { summary: 'Proxy a cover thumbnail from biblioteca-covers', parameters: [
        { name: 'url', in: 'query', required: true, schema: { type: 'string', format: 'uri' } },
        { name: 'width', in: 'query', schema: { type: 'integer', enum: WIDTHS, default: 320 } },
      ], responses: { '200': { description: 'WebP thumbnail', content: { 'image/webp': { schema: { type: 'string', format: 'binary' } } } }, '304': { description: 'Unchanged thumbnail' }, '400': { description: 'Invalid request' }, '502': { description: 'Thumbnail service unavailable' } } } },
      [`${PREFIX}/cache/{key}`]: { get: { summary: 'Proxy an already generated cached thumbnail', parameters: [{ name: 'key', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'WebP thumbnail' }, '304': { description: 'Unchanged' }, '404': { description: 'Not cached' } } } },
    },
  };
  app.get(`${PREFIX}/openapi.json`, (_req, res) => res.json(doc));
  if (options.apiDocument) Object.assign(options.apiDocument.paths, doc.paths);
}
