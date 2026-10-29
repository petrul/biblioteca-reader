import type { Express, Request } from 'express';
import createClient from 'openapi-fetch';
import type { paths } from '../generated/biblioteca-server-api';
import type { ResolvedFragment } from './fragmentApi';
import { parseFragmentLocation, fragmentPath, legacyFragmentSelector, type FragmentLocation } from './fragmentAddress';
import { anonymousPreviewAllowed, readDiv, negotiatePage, boundedFetch, rewriteTwinLink } from './textTwin';
import { escapeHtml, type PageSeo } from '../seo';
import { PARAGRAPHS, parseParagraphRange } from './paragraphLinks';
import { load } from 'cheerio';

export function legacyParagraphFragment(html: string, token: string, sourcePath: string): FragmentLocation {
  const range = parseParagraphRange(token);
  if (!range) throw Object.assign(new Error('Invalid paragraph range'), { status: 400 });
  const $ = load(html), paragraphs = $(PARAGRAPHS);
  const start = paragraphs.eq(range.start - 1).attr('data-source-path');
  const end = paragraphs.eq(range.end - 1).attr('data-source-path');
  if (!start || !end) throw Object.assign(new Error('Paragraph has no exact source mapping'), { status: 404 });
  return { sourcePath, selector: '_' + start + (start === end ? '' : '..' + end) };
}

export function fragmentSeo(seo: PageSeo, data: ResolvedFragment, origin: string): PageSeo {
  const canonicalUrl = origin + data.canonicalPath;
  return { ...seo, language: data.language || 'und', title: `${data.workTitle} — ${data.authorName}`,
    description: data.text.trim().replace(/\s+/g, ' ').slice(0, 200), canonicalUrl, sharedUrl: canonicalUrl,
    image: origin + '/api/covers/work/' + data.workId, jsonLd: null,
    noscriptHtml: `<article style="max-width:48rem;margin:2rem auto;padding:2rem;background:#fffdf8;color:#262019;font:1.2rem Georgia,serif"><blockquote>${data.html}</blockquote><p>${escapeHtml(data.authorName)} — ${escapeHtml(data.workTitle)}</p><a href="${escapeHtml(data.contextPath + '&view=text')}">Read in full chapter context</a></article>` };
}

/** Additive gateway: raw source exports and upstream/vector locators are untouched. */
export function registerFragmentGateway(app: Express, opts: { serverUrl: string; originFor: (req: Request) => string }) {
  const api = createClient<paths>({ baseUrl: opts.serverUrl });
  const resolve = async (location: FragmentLocation) => {
    const result = await api.GET('/api/fragments', { params: { query: {
      path: location.sourcePath, selector: location.selector, ...(location.revision ? { rev: location.revision } : {}),
    } }, signal: AbortSignal.timeout(30000) });
    if (!result.data || !result.response.ok) throw Object.assign(new Error('Fragment could not be resolved'), { status: result.response.status });
    const data = result.data as ResolvedFragment;
    const work = await readDiv(opts.serverUrl, data.workId);
    if ((work.accessType || work.access) === 'premium' && data.readingPages?.some(path => path !== data.sourcePath))
      throw Object.assign(new Error('Open the available preview chapter to quote its text'), { status: 403 });
    for (const path of new Set([data.sourcePath, ...(data.readingPages || [])])) {
      if (!await anonymousPreviewAllowed(opts.serverUrl, work, path))
        throw Object.assign(new Error('Fragment outside free preview'), { status: 403 });
    }
    return data;
  };
  const status = (error: unknown) => (error as { status?: number }).status || 502;
  app.get('/api/fragments', async (req, res) => {
    try {
      const p = new URLSearchParams(req.originalUrl.split('?')[1]);
      for (const key of ['path', 'selector', 'rev']) if (p.getAll(key).length > 1) throw Object.assign(new Error('Repeated fragment parameter'), { status: 400 });
      const data = await resolve({ sourcePath: p.get('path') || '', selector: p.get('selector') || '', revision: p.get('rev') || undefined });
      res.set('Cache-Control', 'private, no-cache').json(data);
    } catch (error) { res.status(status(error)).json({ error: (error as Error).message }); }
  });
  app.post('/api/fragments/resolve', async (req, res) => {
    try {
      const { path, rev, start, end } = req.body || {};
      let { selector } = req.body || {};
      if (selector == null && typeof start === 'string' && typeof end === 'string') selector = legacyFragmentSelector(start, end);
      if (typeof path !== 'string' || typeof selector !== 'string') { res.status(400).json({ error: 'Exact source boundaries are required' }); return; }
      res.set('Cache-Control', 'private, no-cache').json(await resolve({ sourcePath: path, selector, revision: rev }));
    } catch (error) { res.status(status(error)).json({ error: (error as Error).message }); }
  });
  app.get('*', async (req, res, next) => {
    let location: FragmentLocation | null;
    try {
      const params = new URLSearchParams(req.url.split('?')[1] || '');
      location = parseFragmentLocation(req.path, params.toString());
      if (!location && params.has('p') && !/^\/(api|assets|src)\b/.test(req.path) && !/\.(html|txt|xml|json)$/.test(req.path)) {
        if (params.getAll('p').length !== 1) throw new Error('Repeated paragraph parameter');
        const path = req.path.replace(/^\/(?:app\/)?reader\//, '/').replace(/^\//, '');
        fragmentPath({ sourcePath: path, selector: '_1' }); // Validate before requesting the source renderer.
        const response = await boundedFetch(`${opts.serverUrl}/${path}.html?fragments=1&depth=0`, 'text/html');
        if (!response.ok) { res.status(response.status === 404 ? 404 : 502).send('Source page unavailable'); return; }
        location = legacyParagraphFragment(await response.text(), params.get('p')!, path);
      }
    }
    catch { res.status(400).set('X-Robots-Tag', 'noindex').send('Invalid fragment address.'); return; }
    if (!location) { next(); return; }
    res.vary('Accept'); res.vary('User-Agent'); res.vary('Sec-Fetch-Mode');
    res.set('Cache-Control', 'private, no-cache');
    try {
      // _N can be an actual anonymous division. Check structure before treating it as a fragment.
      const rawParts = req.path.split('/').filter(Boolean);
      const rawLegacy = rawParts.slice(2).some(p => /^_\d+$/.test(p)) && rawParts.every(p => !p.includes(':') && !p.includes('..'));
      let data: ResolvedFragment;
      if (rawLegacy && !new URLSearchParams(req.url.split('?')[1]).has('start')) {
        const result = await api.GET('/api/fragments', { params: { query: { path: req.path.replace(/^\/(?:app\/)?(?:reader|quote)\//, '/') } }, signal: AbortSignal.timeout(30000) });
        if (!result.data || !result.response.ok) throw Object.assign(new Error('Fragment not found'), { status: result.response.status });
        if (result.data.kind === 'page') { next(); return; }
        data = await resolve({ sourcePath: result.data.sourcePath!, selector: result.data.selector!, revision: location.revision });
      } else data = await resolve(location);
      if (data.kind === 'page') { res.redirect(302, data.canonicalPath); return; }
      const canonical = fragmentPath({ sourcePath: data.sourcePath, selector: data.selector, revision: data.sourceVersion, contextOnly: location.contextOnly });
      const params = new URLSearchParams(req.url.split('?')[1]);
      // view=text remains a no-JS presentation override, not a selector.
      if (params.get('view') === 'text') {
        const expected = canonical + (canonical.includes('?') ? '&' : '?') + 'view=text';
        if (req.originalUrl !== expected) { res.redirect(302, expected); return; }
      } else if (req.originalUrl !== canonical) { res.redirect(302, canonical); return; }
      const accepted = req.accepts(['text/html', 'text/plain', 'text/markdown', 'application/json']);
      if (!accepted) { res.status(406).send('Unsupported fragment representation'); return; }
      const format = negotiatePage(accepted, req.get('user-agent'), req.get('sec-fetch-mode'), params.get('view') || '');
      if (format === 'spa') { res.locals.resolvedFragment = data; next(); return; }
      const publicUrl = opts.originFor(req) + fragmentPath({ sourcePath: data.sourcePath, selector: data.selector, revision: data.sourceVersion });
      if (format === 'json') { res.json({ ...data, canonicalUrl: publicUrl }); return; }
      if (format === 'text') { res.type('text/plain').send(data.text); return; }
      if (format === 'markdown') { res.type('text/markdown').send(`${data.text}\n\n— ${data.authorName}, ${data.workTitle} (${data.chapterTitle})\n${publicUrl}\n`); return; }
      let contents = data.html;
      if (location.contextOnly) {
        const response = await boundedFetch(`${opts.serverUrl}/${data.sourcePath}.html?fragments=1&depth=${data.readingPages?.some(path => path !== data.sourcePath) ? 64 : 0}`, 'text/html');
        if (!response.ok) throw new Error('Source page unavailable');
        const $ = load(await response.text());
        $('script, iframe, object, embed, form, base, style, meta[http-equiv]').remove();
        $('[srcset],[srcdoc]').removeAttr('srcset').removeAttr('srcdoc');
        $('*').each((_, el) => { if ('attribs' in el) for (const key of Object.keys(el.attribs)) if (/^on/i.test(key)) $(el).removeAttr(key); });
        $('[href],[src],[poster],[style]').each((_, el) => {
          $(el).removeAttr('style');
          for (const key of ['href', 'src', 'poster']) {
            const value = $(el).attr(key);
            if (value === undefined) continue;
            const rewritten = rewriteTwinLink(value, `${opts.serverUrl}/${data.sourcePath}`, new URL(opts.serverUrl).origin);
            if (rewritten) $(el).attr(key, rewritten); else $(el).removeAttr(key);
          }
        });
        $('[data-fragment-text]').each((_, el) => {
          const a = Number($(el).attr('data-fragment-from')), b = Number($(el).attr('data-fragment-to'));
          if (b <= data.startOffset || a >= data.endOffset) return;
          const text = $(el).text(); const start = Math.max(0, data.startOffset - a), end = Math.min(text.length, data.endOffset - a);
          $(el).html(escapeHtml(text.slice(0, start)) + '<mark>' + escapeHtml(text.slice(start, end)) + '</mark>' + escapeHtml(text.slice(end)));
        });
        contents = $('body').html() || '';
      }
      const title = `${data.workTitle} — ${data.authorName}`;
      res.type('html').send(`<!doctype html><html lang="${escapeHtml(data.language || 'und')}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(title)}</title><link rel="canonical" href="${escapeHtml(publicUrl)}"><meta property="og:url" content="${escapeHtml(publicUrl)}"><meta property="og:title" content="${escapeHtml(title)}"><meta property="og:description" content="${escapeHtml(data.text.trim().slice(0, 200))}"><meta property="og:image" content="${escapeHtml(opts.originFor(req) + '/api/covers/work/' + data.workId)}"><style>body{background:#eef1f2;color:#262019;font:1.15rem Georgia,serif;margin:0;padding:2rem 1rem}.quote-card{max-width:48rem;margin:auto;background:#fffdf8;padding:2rem;border:1px solid #e2dccd;border-radius:1rem;box-shadow:0 8px 30px #0001}blockquote{margin:0;border-left:3px solid #d99c24;padding-left:1.5rem;line-height:1.6}.lg{margin:1em 0}.l{margin:0}table{border-collapse:collapse}td{border:1px solid #ccb;padding:.4em}footer{margin-top:1.5rem;padding-top:1rem;border-top:1px solid #ddd}a{color:#075979}mark{background:#f8d981}nav{display:flex;gap:1rem;flex-wrap:wrap;margin-top:1rem}</style></head><body><main class="quote-card"><blockquote class="quote-text">${contents}</blockquote><footer>${escapeHtml(data.authorName)} — ${escapeHtml(data.workTitle)} · ${escapeHtml(data.chapterTitle)}<nav><a href="${escapeHtml(data.contextPath)}">Read in full chapter context</a><a href="${escapeHtml(data.canonicalPath)}">Fragment card</a></nav></footer></main></body></html>`);
    } catch (error) { res.status(status(error)).set('X-Robots-Tag', 'noindex').type('text/plain').send((error as Error).message); }
  });
}
