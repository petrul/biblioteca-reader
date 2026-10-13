import type { Chapter } from '../types/textbase';

export type TocEntry =
  | { type: 'section'; chapter: Chapter; expanded: boolean; collapsible: boolean }
  | { type: 'chapter'; chapter: Chapter };

/** The work's own title page: the section whose path is the work's. */
export const isWorkRoot = (chapter: Chapter): boolean => chapter.isSection === true && chapter.id === chapter.workId;

/**
 * What stays open by default: every section leading to the current page, and
 * the current page's own children when it is itself a section.
 */
export const ancestorIds = (chapter: Chapter | null | undefined): string[] => [
  ...(chapter?.ancestors ?? []).map(a => a.id),
  ...(chapter?.isSection ? [chapter.id] : []),
];

/**
 * The free-preview page of a premium work is its first chapter; the title
 * pages that come before it are free as well.
 */
export function isPreviewPage(chapters: Chapter[], chapter: Chapter | null | undefined): boolean {
  if (!chapter) return true;
  const firstLeaf = chapters.findIndex(c => !c.isSection);
  const index = chapters.findIndex(c => c.id === chapter.id);
  return firstLeaf < 0 || index <= firstLeaf;
}

/**
 * Flattens the pages into TOC rows. A page shows while every section above it
 * is in `expanded`. With a `match` (a search) the matching pages show, each
 * under the sections that lead to it, all open.
 */
export function buildTocEntries(
  chapters: Chapter[],
  expanded: ReadonlySet<string>,
  match: ((chapter: Chapter) => boolean) | null,
): TocEntry[] {
  let visible: Set<string> | null = null;
  if (match) {
    visible = new Set();
    for (const chapter of chapters) {
      if (!match(chapter)) continue;
      visible.add(chapter.id);
      (chapter.ancestors ?? []).forEach(a => visible!.add(a.id));
    }
  }
  const entries: TocEntry[] = [];
  for (const chapter of chapters) {
    const shown = visible
      ? visible.has(chapter.id)
      : (chapter.ancestors ?? []).every(a => expanded.has(a.id));
    if (!shown) continue;
    entries.push(chapter.isSection
      ? {
        type: 'section',
        chapter,
        expanded: visible !== null || isWorkRoot(chapter) || expanded.has(chapter.id),
        collapsible: visible === null && !isWorkRoot(chapter),
      }
      : { type: 'chapter', chapter });
  }
  return entries;
}
