/** Ordinals are chapter-local and stable until the source paragraph breaks change. */
export const PARAGRAPHS = 'p:not(.deco-title-author-separator):not(.deco-end)';
export interface ParagraphRange { start: number; end: number }
export function parseParagraphRange(value: string | null | undefined): ParagraphRange | null {
  const match = value?.replace(/^#/, '').match(/^p?([1-9]\d{0,5})(?:-p?([1-9]\d{0,5}))?$/);
  if (!match) return null;
  const start = Number(match[1]), end = Number(match[2] || match[1]);
  return end >= start && end - start < 100 ? { start, end } : null;
}
export function paragraphToken(range: ParagraphRange): string {
  return range.start === range.end ? String(range.start) : `${range.start}-${range.end}`;
}
export function paragraphShareUrl(chapterId: string, range: ParagraphRange, origin = ''): string {
  const token = paragraphToken(range);
  return `${origin}/${chapterId.split('/').map(encodeURIComponent).join('/')}?p=${token}#p${token}`;
}
export function formatCitation(title: string, chapter: string, range: ParagraphRange): string {
  return `${title} — ${chapter}, ${range.start === range.end ? '¶' : '¶¶'} ${paragraphToken(range)}`;
}
