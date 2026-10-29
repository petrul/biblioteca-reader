import type { SearchResult, SearchTarget, SavedSearchItem } from '../types/textbase';
import { fragmentPath, parseFragmentLocation } from './fragmentAddress';

/** Stored vectors remain source locators. Resolution on opening is authoritative, including unnamed divisions. */
export function sourceTarget(path: string): SearchTarget {
  const url = new URL(path.startsWith('/') ? path : '/' + path, 'https://library.invalid');
  let reference;
  try { reference = parseFragmentLocation(url.pathname, url.search); } catch { /* Retain malformed/stale saved entries; opening them reports the address error. */ }
  if (reference) return { kind: 'fragment', reference };
  const sourcePath = url.pathname.replace(/^\//, '');
  return sourcePath.split('/').length > 2 ? { kind: 'page', sourcePath } : { kind: 'work', workId: sourcePath };
}
export function searchTargetPath(item: Pick<SearchResult | SavedSearchItem, 'workId' | 'chapterId' | 'target'>): string {
  const target = item.target;
  if (target?.kind === 'fragment') return fragmentPath(target.reference);
  if (target?.kind === 'page') return target.sourcePath;
  if (target?.kind === 'work') return target.workId;
  return item.chapterId || item.workId;
}
