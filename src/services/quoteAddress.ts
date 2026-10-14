export interface SourceParagraph { path?: string; text?: string }
export const normalizeQuoteText = (value: string) => value.replace(/\s+/g, ' ').trim();

/** Map display whitespace back to exact Java/JavaScript UTF-16 source offsets. */
export function resolveQuoteAddress(chapterPath: string, paragraphs: SourceParagraph[], selectedText: string, context?: string, before?: string) {
  const target = normalizeQuoteText(selectedText);
  if (!target || target.length > 30000) throw Object.assign(new Error('Select between 1 and 30000 characters'), { status: 400 });
  let normalized = '';
  const positions: { paragraph: number; offset: number }[] = [];
  const sources = paragraphs.filter(p => p.path?.startsWith(chapterPath + '/') && p.text && p.path.slice(chapterPath.length + 1).split('/').every(step => /^_[1-9]\d*$/.test(step)));
  const add = (character: string, paragraph: number, offset: number) => {
    if (/\s/.test(character)) {
      if (!normalized || normalized.endsWith(' ')) return;
      character = ' ';
    }
    normalized += character; positions.push({ paragraph, offset });
  };
  sources.forEach((p, paragraph) => {
    if (normalized && !normalized.endsWith(' ')) add(' ', paragraph, 0);
    for (let offset = 0; offset < p.text!.length; offset++) add(p.text![offset], paragraph, offset);
  });
  const matches: number[] = [];
  for (let index = normalized.indexOf(target); index >= 0; index = normalized.indexOf(target, index + 1)) {
    const point = positions[index], source = sources[point.paragraph];
    if (context && normalizeQuoteText(source.text!) !== normalizeQuoteText(context)) continue;
    if (before !== undefined && normalizeQuoteText(source.text!.slice(0, point.offset)) !== normalizeQuoteText(before)) continue;
    matches.push(index);
  }
  if (matches.length !== 1) throw Object.assign(new Error(matches.length ? 'The selected passage is ambiguous in its source' : 'The selected passage could not be resolved in its source'), { status: matches.length ? 409 : 422 });
  const first = positions[matches[0]], last = positions[matches[0] + target.length - 1];
  const dot = (point: { paragraph: number; offset: number }, end = false) => sources[point.paragraph].path!.slice(chapterPath.length + 1).split('/').map(step => step.slice(1)).join('.') + '.' + (point.offset + (end ? 1 : 0));
  return { start: dot(first), end: dot(last, true) };
}
