import createClient from 'openapi-fetch';
import type { components, paths } from '../generated/biblioteca-server-api';
import { sameOriginFetch } from './sameOriginFetch';
import { fragmentPath, parseFragmentLocation, selectionFragment, type FragmentLocation } from './fragmentAddress';
import { resolveSelectedQuote } from './serverQuoteApi';

export type ResolvedFragment = Required<components['schemas']['Fragment']>;
const api = createClient<Pick<paths, '/api/fragments' | '/api/fragments/resolve'>>({
  baseUrl: globalThis.location?.origin || 'http://localhost', fetch: sameOriginFetch,
});

/** Structure check for exceptional deep links missing from a loaded TOC. */
export async function fetchSourceTarget(path: string): Promise<ResolvedFragment> {
  const result = await api.GET('/api/fragments', { params: { query: { path } }, signal: AbortSignal.timeout(30000) });
  if (!result.data || !result.response.ok) throw new Error('Source target unavailable');
  return result.data as ResolvedFragment;
}

export async function fetchFragment(location: FragmentLocation): Promise<ResolvedFragment> {
  const result = await api.GET('/api/fragments', { params: { query: {
    path: location.sourcePath, selector: location.selector, ...(location.revision ? { rev: location.revision } : {}),
  } }, signal: AbortSignal.timeout(30000) });
  if (!result.data || !result.response.ok) {
    throw Object.assign(new Error(result.response.status === 409
      ? 'The source has changed since this fragment was linked. Its text was not relocated.'
      : `The fragment could not be resolved (HTTP ${result.response.status}).`), { status: result.response.status });
  }
  return result.data as ResolvedFragment;
}

export async function resolveReaderFragment(path: string, container: HTMLElement, text: string, context?: string, before?: string) {
  const mapped = selectionFragment(container, window.getSelection(), path);
  if (mapped) return fetchFragment(mapped);
  // Compatibility for an already open page/cache from before source mapping was added.
  const legacy = await resolveSelectedQuote(path, text, context, before);
  const address = new URL(legacy.id.startsWith('server:') ? '/quote/' + legacy.id.slice(7) : legacy.id, window.location.origin);
  const location = parseFragmentLocation(address.pathname, address.search);
  if (!location) throw new Error('The selected passage has no exact source address');
  return fetchFragment(location);
}

export function fragmentLocation(fragment: ResolvedFragment, contextOnly = false): FragmentLocation {
  return { sourcePath: fragment.sourcePath, selector: fragment.selector, revision: fragment.sourceVersion || undefined, contextOnly };
}

export function fragmentCitation(fragment: ResolvedFragment, origin: string): string {
  return `«${fragment.text.trim()}» — ${fragment.authorName}, ${fragment.workTitle} (${fragment.chapterTitle}). ${origin}${fragmentPath(fragmentLocation(fragment))}`;
}
