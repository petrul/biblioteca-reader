import { legacyFragmentSelector } from './fragmentAddress';
import type { PageSeo } from '../seo';
import createClient from 'openapi-fetch';
import type { paths } from '../generated/biblioteca-server-api';
import { resolveQuoteAddress, type SourceParagraph } from './quoteAddress';
import { quoteApiContract } from './quoteApiContract';
import type { Express, Request } from 'express';
import { load } from 'cheerio';
import { anonymousPreviewAllowed, boundedFetch, negotiatePage, readDiv, rewriteTwinLink } from './textTwin';
import { escapeHtml } from '../seo';

export interface ServerQuote {
  workId: string; chapterId: string; workTitle: string; chapterTitle: string;
  authorName: string; language?: string; text: string; paragraphs: string[]; canonicalUrl: string;
}
export function quoteSource(raw: string, params: URLSearchParams) {
  const path = raw.split('/').filter(Boolean).map(decodeURIComponent).join('/');
  const start = params.get('start'), end = params.get('end');
  if (path.split('/').length < 2 || !/^[a-z0-9_]+\/[\p{L}\p{N}_./-]+$/u.test(path) || path.split('/').some(part => part === '.' || part === '..') ||
      !start || !end || !/^[0-9]+(?:\.[0-9]+)*$/.test(start) || !/^[0-9]+(?:\.[0-9]+)*$/.test(end)) {
    throw Object.assign(new Error('Invalid quote path or start/end boundaries'), { status: 400 });
  }
  return { path, start, end };
}
async function resolve(base: string, raw: string, params: URLSearchParams, origin: string) {
  const source = quoteSource(raw, params);
  const workId = source.path.split('/').slice(0, 2).join('/');
  const work = await readDiv(base, workId);
  const chapter = source.path === workId ? work : await readDiv(base, source.path);
  if (!await anonymousPreviewAllowed(base, work, source.path)) throw Object.assign(new Error('Quote outside free preview'), { status: 403 });
  const query = new URLSearchParams({ start: source.start, end: source.end });
  const publicPath = `/quote/${source.path.split('/').map(encodeURIComponent).join('/')}?${query}`;
  const upstreamPage = `${base}${publicPath}`;
  const client = createClient<paths>({ baseUrl: base });
  const resolved = await client.GET('/api/fragments', { params: { query: { path: source.path, selector: legacyFragmentSelector(source.start, source.end) } }, signal: AbortSignal.timeout(30000) });
  if (!resolved.data || !resolved.response.ok) throw Object.assign(new Error('Quote unavailable'), { status: resolved.response.status });
  const fragment = resolved.data;
  // Compatibility HTML now comes from the typed fragment contract, never a scraped upstream card.
  const compatibilityHtml = '<html><head></head><body><main class="quote-card"><blockquote class="quote-text">' + fragment.html + '</blockquote><p>' + escapeHtml(fragment.authorName || '') + ' — ' + escapeHtml(fragment.workTitle || '') + '</p><a href="/' + source.path + '">Read source</a></main></body></html>';
  const $ = load(compatibilityHtml);
  $('script, iframe, form, object, embed, base').remove();
  $('*').each((_, element) => {
    if ('attribs' in element) for (const key of Object.keys(element.attribs)) if (/^on/i.test(key)) $(element).removeAttr(key);
  });
  $('[href], [src]').each((_, element) => {
    for (const key of ['href', 'src']) {
      const value = $(element).attr(key);
      if (value) $(element).attr(key, rewriteTwinLink(value, upstreamPage, new URL(base).origin));
    }
  });
  const paragraphs = (fragment.text || '').split('\n\n');
  if (!paragraphs.length) throw new Error('Quote renderer returned no quoted text');
  const data: ServerQuote = { workId, chapterId: source.path, workTitle: work.head || workId, chapterTitle: chapter.head || source.path, authorName: work.author?.displayName || 'Anonymous', language: chapter.language || work.language, text: paragraphs.join('\n\n'), paragraphs, canonicalUrl: origin + fragment.canonicalPath };
  $('head title, head meta[property^="og:"], head meta[name^="twitter:"], head link[rel="canonical"]').remove();
  const image = `${origin}/api/covers/work/${workId}`;
  const title = `${data.workTitle} — ${data.authorName}`;
  $('head').append(`<title>${escapeHtml(title)}</title><link rel="canonical" href="${escapeHtml(data.canonicalUrl)}"><meta property="og:url" content="${escapeHtml(data.canonicalUrl)}"><meta property="og:title" content="${escapeHtml(title)}"><meta property="og:description" content="${escapeHtml(data.text.slice(0, 200))}"><meta property="og:image" content="${escapeHtml(image)}"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${escapeHtml(title)}"><meta name="twitter:description" content="${escapeHtml(data.text.slice(0, 200))}"><meta name="twitter:image" content="${escapeHtml(image)}">`);
  return { data, html: $.html() };
}
export function registerQuoteTwins(app: Express, opts: { serverUrl: string; originFor: (req: Request) => string; apiDocument?: { paths?: Record<string, unknown> } }) {
  if (opts.apiDocument) {
    opts.apiDocument.paths ||= {};
    opts.apiDocument.paths['/api/quote'] = quoteApiContract;
  }
  app.get('/api/quote', async (req, res) => {
    try {
      const params = new URLSearchParams(req.url.split('?')[1]);
      const result = await resolve(opts.serverUrl, params.get('path') || '', params, opts.originFor(req));
      res.set('Cache-Control', 'private, no-cache').json(result.data);
    } catch (error) { res.status((error as { status?: number }).status || 502).json({ error: 'Quotation could not be resolved.' }); }
  });
  app.post('/api/quote', async (req, res) => {
    try {
      const { path, text, context, before } = req.body || {};
      if (typeof path !== 'string' || typeof text !== 'string' || text.length > 30000 || path.length > 2000 ||
          (context !== undefined && typeof context !== 'string') || (before !== undefined && typeof before !== 'string')) {
        res.status(400).json({ error: 'Invalid quote selection' }); return;
      }
      const work = await readDiv(opts.serverUrl, path.split('/').slice(0, 2).join('/'));
      const chapter = await readDiv(opts.serverUrl, path);
      if (!await anonymousPreviewAllowed(opts.serverUrl, work, path)) throw Object.assign(new Error('Outside free preview'), { status: 403 });
      const client = createClient<paths>({ baseUrl: opts.serverUrl });
      const paragraphs: SourceParagraph[] = [];
      for (let page = 0; page < 20; page++) {
        const result = await client.GET('/api/divs/{divId}/paras', { params: { path: { divId: chapter.id! }, query: { page, size: 1000, withContent: '' } }, signal: AbortSignal.timeout(15000) });
        if (!result.data) throw new Error('Paragraph source unavailable');
        paragraphs.push(...result.data);
        if (result.data.length < 1000) break;
        if (page === 19) throw Object.assign(new Error('Quote source exceeds the paragraph limit'), { status: 413 });
      }
      // A premium section preview must not quote descendants from locked chapters.
      const eligible = (work.accessType || work.access) === 'premium' && !chapter.leaf
        ? paragraphs.filter(p => p.path?.slice(path.length + 1).split('/').length === 1) : paragraphs;
      const address = resolveQuoteAddress(path, eligible, text, context, before);
      const result = await resolve(opts.serverUrl, path, new URLSearchParams(address), opts.originFor(req));
      res.set('Cache-Control', 'private, no-cache').json(result.data);
    } catch (error) {
      res.status((error as { status?: number }).status || 502).json({ error: (error as { status?: number }).status ? (error as Error).message : 'Quotation source is temporarily unavailable.' });
    }
  });
  app.get(['/quote/*', '/app/quote/*'], async (req, res, next) => {
    if (req.path.startsWith('/app/quote/')) { res.redirect(301, req.originalUrl.replace(/^\/app\/quote\//, '/quote/')); return; }
    res.vary('Accept'); res.vary('User-Agent'); res.vary('Sec-Fetch-Mode'); res.set('Cache-Control', 'private, no-cache');
    const params = new URLSearchParams(req.url.split('?')[1]);
    const format = negotiatePage(req.get('accept'), req.get('user-agent'), req.get('sec-fetch-mode'), params.get('view') || '');
    if (format === 'spa') { next(); return; }
    try {
      const result = await resolve(opts.serverUrl, req.path.slice('/quote/'.length), params, opts.originFor(req));
      if (format === 'json') { res.json(result.data); return; }
      if (format === 'text' || format === 'markdown') { res.type(format === 'text' ? 'text/plain' : 'text/markdown').send(result.data.text); return; }
      res.type('html').send(result.html);
    } catch (error) { res.status((error as { status?: number }).status || 502).set('X-Robots-Tag', 'noindex').type('text/plain').send('Quotation could not be resolved.'); }
  });
}

export async function enrichQuoteSeo(seo: PageSeo, quoteId: string | undefined, base: string, origin: string): Promise<PageSeo> {
  if (!quoteId?.startsWith('server:')) return seo;
  try {
    const [path, query] = quoteId.slice(7).split('?');
    const { data } = await resolve(base, path, new URLSearchParams(query), origin);
    return { ...seo, title: `${data.workTitle} — ${data.authorName}`, description: data.text.slice(0, 200),
      image: `${origin}/api/covers/work/${data.workId}`, imageType: 'image/png',
      canonicalUrl: data.canonicalUrl, sharedUrl: data.canonicalUrl, robots: 'index, follow', language: data.language || 'und' };
  } catch { return { ...seo, robots: 'noindex, follow' }; }
}
