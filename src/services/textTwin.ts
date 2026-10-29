import createClient from 'openapi-fetch';
import type { paths } from '../generated/biblioteca-server-api';
import type { Express, Request, Response } from 'express';
import { load } from 'cheerio';
import { buildPageSeo, escapeHtml, parseAppPath, renderIndexHtml } from '../seo';
import { PARAGRAPHS, parseParagraphRange, formatCitation, type ParagraphRange } from './paragraphLinks';

export type PageFormat = 'spa' | 'html' | 'text' | 'markdown' | 'json';
const BOTS = /facebookexternalhit|facebot|twitterbot|slackbot|googlebot|bingbot|whatsapp|telegrambot|discordbot|linkedinbot|applebot|lynx|w3m|curl\/|wget\/|links\//i;
export function negotiatePage(accept = '', userAgent = '', mode = '', view = ''): PageFormat {
  if (view === 'text') return 'html';
  const supported: Record<string, PageFormat> = { 'text/html': 'html', 'text/plain': 'text', 'text/markdown': 'markdown', 'application/json': 'json' };
  const choices = accept.split(',').map((part, index) => {
    const [media, ...params] = part.trim().toLowerCase().split(';');
    const q = params.find(p => p.trim().startsWith('q='));
    return { media, quality: q ? Number(q.trim().slice(2)) : 1, index };
  }).filter(c => supported[c.media] && c.quality > 0).sort((a, b) => b.quality - a.quality || a.index - b.index);
  const chosen = choices[0] ? supported[choices[0].media] : 'html';
  if (chosen !== 'html') return chosen;
  if (BOTS.test(userAgent)) return 'html';
  return accept.includes('text/html') && (mode === 'navigate' || /Mozilla\/|Chrome\/|Safari\/|Firefox\//i.test(userAgent)) ? 'spa' : 'html';
}

export function canonicalReaderPath(path: string): string {
  return path.replace(/^\/(?:app\/)?reader\//, '/');
}
export function textAlternates(path: string, params: URLSearchParams): string {
  const base = new URLSearchParams();
  for (const key of ['p', 'start', 'end', 'rev', 'display']) if (params.has(key)) base.set(key, params.get(key)!);
  base.set('view', 'text');
  return `<link rel="alternate" type="text/html" title="Plain text version" href="${escapeHtml(path + '?' + base)}">`;
}
const META = `<title>__PAGE_TITLE__</title><meta name="description" content="__PAGE_DESCRIPTION__"><meta name="robots" content="__ROBOTS__"><link rel="canonical" href="__CANONICAL_URL__"><meta property="og:title" content="__PAGE_TITLE__"><meta property="og:description" content="__PAGE_DESCRIPTION__"><meta property="og:url" content="__OG_URL__"><meta property="og:type" content="article"><meta property="og:image" content="__OG_IMAGE_URL__"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="__PAGE_TITLE__"><meta name="twitter:description" content="__PAGE_DESCRIPTION__"><meta name="twitter:image" content="__OG_IMAGE_URL__">`;

/** Proxy link rewriting keeps navigation on the same public reader URL space. */
export function rewriteTwinLink(href: string, upstreamPage: string, upstreamOrigin: string): string {
  if (!href || href.startsWith('#')) return href;
  let url: URL;
  try { url = new URL(href, upstreamPage); } catch { return ''; }
  if (!['http:', 'https:'].includes(url.protocol)) return /^(mailto:|tel:)/i.test(href) ? href : '';
  if (url.origin !== upstreamOrigin) return url.href;
  const path = url.pathname;
  if (/\/_binary\//.test(path) || /^\/(css|img|js|bootstrap-|webjars|api)\b/.test(path) || /\.(xml|txt|json|html)$/.test(path)) {
    return `/api/server-content${path}${url.search}${url.hash}`;
  }
  const parts = path.split('/').filter(Boolean);
  if (!parts.length) return '/app';
  if (parts.length === 1) return `/${parts[0]}`;
  url.searchParams.delete('noredirect');
  url.searchParams.set('view', 'text');
  return `/${parts.join('/')}?${url.searchParams}${url.hash}`;
}

export function prepareTwin(html: string, upstreamPage: string, range: ParagraphRange | null) {
  const $ = load(html);
  // Analytics, authentication widgets and event handlers are absent from the no-JS edition.
  $('script, iframe, object, embed, form, #g_id_onload, base, meta[http-equiv="refresh"]').remove();
  $('[srcset]').removeAttr('srcset');
  $('[style]').each((_, element) => {
    if (/url\s*\(/i.test($(element).attr('style') || '')) $(element).removeAttr('style');
  });
  $('*').each((_, element) => {
    if (!('attribs' in element)) return;
    for (const name of Object.keys(element.attribs)) if (/^on/i.test(name) || name === 'srcdoc') $(element).removeAttr(name);
  });
  const origin = new URL(upstreamPage).origin;
  $('[href], [src], [action], [poster]').each((_, element) => {
    for (const name of ['href', 'src', 'action', 'poster']) {
      const value = $(element).attr(name);
      if (value === undefined) continue;
      let resolved: URL;
      try { resolved = new URL(value, upstreamPage); } catch { $(element).removeAttr(name); continue; }
      const isNavigationLink = name === 'href' && ['a', 'area'].includes(element.tagName.toLowerCase());
      const isResourceLink = name === 'src' || name === 'poster' || name === 'href' && !isNavigationLink;
      if (isResourceLink && resolved.origin !== origin) { $(element).removeAttr(name); continue; }
      const rewritten = rewriteTwinLink(value, upstreamPage, origin);
      if (rewritten) $(element).attr(name, rewritten);
      else $(element).removeAttr(name);
    }
  });
  const body = $('.body-of-text').first();
  if (!body.length) throw new Error('Upstream page has no literary text container');
  const paragraphs = body.find(PARAGRAPHS);
  paragraphs.each((index, element) => {
    const id = `p${index + 1}`;
    $(element).attr('data-reader-paragraph', id);
    const original = $(element).attr('id');
    if (original && original !== id) $(element).prepend(`<span id="${id}" aria-hidden="true"></span>`);
    else $(element).attr('id', id);
    if (range && index + 1 >= range.start && index + 1 <= range.end) $(element).addClass('shared-passage');
  });
  if (range && range.end > paragraphs.length) throw Object.assign(new Error('Requested paragraph does not exist'), { status: 404 });
  // Footnotes used to be button titles and need readable, non-script contents here.
  body.find('button.note').each((_, element) => {
    const note = $(element);
    const text = note.attr('title');
    if (text) note.after($('<small class="footnote"></small>').text(` [${text}]`));
  });
  const passage = range ? paragraphs.slice(range.start - 1, range.end).text().replace(/\s+/g, ' ').trim() : '';
  const text = body.clone().find('br').replaceWith('\n').end().find('p, h1, h2, h3, h4, h5, h6, li, tr').append('\n\n').end().text().trim();
  const markdownBody = body.clone();
  markdownBody.find('h1,h2,h3,h4,h5,h6').each((_, element) => {
    $(element).prepend('#'.repeat(Number(element.tagName.slice(1))) + ' ');
  });
  markdownBody.find('p, h1, h2, h3, h4, h5, h6, li, tr').append('\n\n');
  return { $, body, text, markdown: markdownBody.text().trim(), passage };
}

interface DivInfo { language?: string; id?: number; head?: string; path?: string; leaf?: boolean; accessType?: string; access?: string; author?: { displayName?: string } }
export async function boundedFetch(url: string, accept: string): Promise<globalThis.Response> {
  return fetch(url, { headers: { Accept: accept }, redirect: 'manual', signal: AbortSignal.timeout(15000) });
}
export async function readDiv(base: string, path: string): Promise<DivInfo> {
  const client = createClient<paths>({ baseUrl: base, fetch: request => fetch(request, { redirect: 'manual', signal: AbortSignal.timeout(15000) }) });
  const result = await client.GET('/api/divs', { params: { query: { path } }, headers: { Accept: 'application/json' } });
  if (!result.response.ok) throw Object.assign(new Error('Chapter not found'), { status: result.response.status === 404 ? 404 : 502 });
  const div = result.data as DivInfo;
  if (!div.id) throw Object.assign(new Error('Chapter not found'), { status: 404 });
  return div;
}
export async function anonymousPreviewAllowed(base: string, work: DivInfo, chapterPath: string): Promise<boolean> {
  if ((work.accessType || work.access) !== 'premium') return true;
  const client = createClient<paths>({ baseUrl: base });
  const result = await client.GET('/api/divs/{id}/toc', { params: { path: { id: work.id! }, query: { page: 0, size: 2000 } }, signal: AbortSignal.timeout(15000) });
  if (!result.response.ok) throw new Error('Cannot verify premium preview');
  const toc = result.data as DivInfo[];
  const firstLeaf = toc.findIndex(d => d.leaf);
  const index = toc.findIndex(d => d.path === chapterPath);
  return index >= 0 && (firstLeaf < 0 || index <= firstLeaf);
}

export function registerTextTwins(app: Express, opts: { serverUrl: string; originFor: (req: Request) => string; defaultImage: (origin: string) => string }) {
  app.get('*', async (req: Request, res: Response, next) => {
    const binaryAt = req.path.indexOf('/_binary/');
    const exportType = req.path.match(/\.(xml|txt|json|html)$/)?.[1];
    const lookupPath = binaryAt >= 0 ? req.path.slice(0, binaryAt).replace(/\.html$/, '') : exportType ? req.path.replace(/\.(xml|txt|json|html)$/, '') : req.path;
    let route;
    try { route = parseAppPath(lookupPath); }
    catch { res.status(400).type('text/plain').send('Invalid reading URL.'); return; }
    if (route.view !== 'reader') { next(); return; }
    res.vary('Accept'); res.vary('User-Agent'); res.vary('Sec-Fetch-Mode');
    res.set('Cache-Control', 'private, no-cache');
    try {
      const params = new URLSearchParams(req.url.split('?')[1] || '');
      if (/^\/(?:app\/)?reader\//.test(req.path)) {
        res.redirect(301, canonicalReaderPath(req.path) + (params.size ? '?' + params.toString() : '')); return;
      }
      if (route.view !== 'reader' || !route.chapterId || !route.workId) { next(); return; }
      const format = negotiatePage(req.get('accept'), req.get('user-agent'), req.get('sec-fetch-mode'), params.get('view') || '');
      if (format === 'spa' && binaryAt < 0 && !exportType) { next(); return; }
      if (params.has('p') && !parseParagraphRange(params.get('p'))) { res.status(400).json({ error: 'Invalid paragraph range' }); return; }
      // Never forward a browser's cookies/authentication to the upstream text edition.
      const work = await readDiv(opts.serverUrl, route.workId);
      const div = route.chapterId === route.workId ? work : await readDiv(opts.serverUrl, route.chapterId);
      if (!await anonymousPreviewAllowed(opts.serverUrl, work, route.chapterId)) {
        res.status(403).set('X-Robots-Tag', 'noindex').type('html').send('<h1>Premium edition</h1><p>Only the first chapter and its opening title pages are available as a free preview.</p>'); return;
      }
      // Existing server export and binary URLs retain their exact root paths.
      if (binaryAt >= 0 || exportType) {
        const upstream = await boundedFetch(`${opts.serverUrl}${req.path}${req.url.includes('?') ? '?' + req.url.split('?')[1] : ''}`, '*/*');
        if (!upstream.ok) throw Object.assign(new Error('Export unavailable'), { status: upstream.status === 404 ? 404 : 502 });
        const bytes = Buffer.from(await upstream.arrayBuffer());
        res.set('Content-Type', upstream.headers.get('content-type') || 'application/octet-stream');
        res.set('X-Content-Type-Options', 'nosniff');
        res.send(bytes); return;
      }
      const upstreamPage = `${opts.serverUrl}/${route.chapterId.split('/').map(encodeURIComponent).join('/')}?noredirect=&depth=0`;
      const upstream = await boundedFetch(upstreamPage, 'text/html');
      if (!upstream.ok) throw Object.assign(new Error('Chapter unavailable'), { status: upstream.status === 404 ? 404 : 502 });
      const html = await upstream.text();
      if (Buffer.byteLength(html) > 8 * 1024 * 1024) throw Object.assign(new Error('Chapter exceeds the 8 MiB text edition limit'), { status: 413 });
      const range = parseParagraphRange(params.get('p'));
      const twin = prepareTwin(html, upstreamPage, range);
      const origin = opts.originFor(req), canonicalPath = canonicalReaderPath(req.path);
      const seo = await buildPageSeo({ route, origin, path: canonicalPath, searchParams: params, bibliotecaServerUrl: opts.serverUrl, defaultImage: opts.defaultImage(origin) });
      seo.image = `${origin}/api/covers/work/${route.workId.split('/').map(encodeURIComponent).join('/')}`;
      seo.imageType = 'image/png';
      seo.sharedUrl = `${origin}${canonicalPath}${range ? '?p=' + params.get('p') : ''}`;
      if (range) { seo.description = twin.passage.slice(0, 200); seo.title = formatCitation(work.head || route.workId, div.head || route.chapterId, range); }
      if (format === 'json') { res.json({ ...div, canonicalUrl: seo.canonicalUrl, sharedUrl: seo.sharedUrl, html: twin.body.html(), plainText: twin.text, passage: twin.passage || null }); return; }
      if (format === 'text') { res.type('text/plain').send(twin.text); return; }
      if (format === 'markdown') { res.type('text/markdown').send(twin.markdown); return; }
      const $ = twin.$;
      $('head title, head meta[name="description"], head meta[name="robots"], head meta[property^="og:"], head meta[name^="twitter:"], head link[rel="canonical"]').remove();
      $('html').attr('lang', seo.language);
      $('head').append(renderIndexHtml(META, seo));
      $('head').append('<style>.shared-passage{border-right:3px solid #9ca3af;background:#eee}.footnote{display:block}button.note{border:0;background:none}</style>');
      const nav = $('<nav aria-label="Edition formats"></nav>');
      nav.append(`<a href="${escapeHtml(canonicalPath + (range ? '?p=' + params.get('p') + '#p' + params.get('p') : ''))}">Interactive edition</a>`);
      if (range) nav.append(` · <a href="#p${range.start}">Shared passage: ${escapeHtml(twin.passage.slice(0, 200))}</a>`);
      $('body').prepend(nav);
      res.type('html').send($.html());
    } catch (error) {
      const status = (error as { status?: number }).status || 502;
      res.status(status).set('X-Robots-Tag', 'noindex').type('text/plain').send(status === 404 ? 'Chapter or paragraph not found.' : status === 413 ? 'Chapter exceeds the text edition limit; use the interactive edition.' : 'Text edition is temporarily unavailable.');
    }
  });
  app.post('/api/edits', (_req, res) => res.status(501).json({ error: 'Edits are not yet implemented.' }));
}
