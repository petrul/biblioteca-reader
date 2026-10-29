import { mapServerLanguage } from './serversideApi';
import createClient from 'openapi-fetch';
import type { paths } from '../generated/same-origin-api';
import type { Quotation } from '../types/textbase';
import { sameOriginFetch } from './sameOriginFetch';
const api = createClient<paths>({ baseUrl: globalThis.location?.origin || 'http://localhost', fetch: sameOriginFetch });
export async function fetchServerQuote(id: string): Promise<Quotation | null> {
  const [path, query] = id.slice('server:'.length).split('?');
  const params = new URLSearchParams(query);
  const result = await api.GET('/api/quote', { params: { query: { path, start: params.get('start') || '', end: params.get('end') || '' } } });
  if (!result.data) return null;
  const data = result.data;
  return { id, workId: data.workId, workTitle: data.workTitle, authorName: data.authorName,
    chapterId: data.chapterId, chapterTitle: data.chapterTitle, chapterNumber: 0, text: data.text,
    startOffset: 0, endOffset: data.text.length, createdAt: '', language: mapServerLanguage((data as { language?: string }).language) };
}

export async function resolveSelectedQuote(path: string, text: string, context?: string, before?: string) {
  const result = await api.POST('/api/quote', { body: { path, text, context, before }, signal: AbortSignal.timeout(30000) });
  if (!result.data) throw new Error((result.error as { error?: string })?.error || 'The selection could not be resolved in its TEI source.');
  const url = new URL(result.data.canonicalUrl);
  return { id: url.pathname.startsWith('/quote/') ? 'server:' + url.pathname.slice('/quote/'.length) + url.search : url.pathname + url.search, text: result.data.text };
}
