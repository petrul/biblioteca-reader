// The server's teidiv2html.xsl renders a TEI heading's label (the roman
// numeral, act number and the like) as a sur-title span inside the heading:
// <h2><span class="head-label">IV</span> Fuga</h2>. The TOC's own head for
// the same chapter carries the title WITHOUT that label ("Fuga").
const HEAD_LABEL_SPAN = /<span[^>]*class=["']head-label["'][^>]*>[\s\S]*?<\/span>/i;
// A footnote marker occasionally lands inside the leading heading itself
// (e.g. a title with an inline note right after it) - its visible number
// (<sup>416</sup> inside the .note button) survives visibleMarkupText's
// tag-only stripping same as any other text, so the heading would compare
// as "title 416" against the plain "title" from the TOC/page title and
// never match, leaving the heading unstripped and visibly duplicated.
const NOTE_BUTTON = /<button[^>]*class=["'][^"']*\bnote\b[^"']*["'][^>]*>[\s\S]*?<\/button>/gi;

/** Title from the XML-rendered leading heading, without its label or notes. */
export function leadingHeadTitle(html: string): string {
  const match = html.match(/<h([1-6])\b[^>]*>[\s\S]*?<\/h\1>/i);
  if (!match || match.index == null || visibleMarkupText(html.slice(0, match.index))) return '';
  return visibleMarkupText(match[0].replace(NOTE_BUTTON, '').replace(HEAD_LABEL_SPAN, ''))
    .replace(/\s+/g, ' ').trim();
}

/** Remove a server-rendered leading TEI heading when ReaderView renders its own heading. */
export function stripLeadingChapterHeading(html: string, title: string): string {
  if (!html || !title) return html;

  const match = html.match(/<h([1-6])\b[^>]*>[\s\S]*?<\/h\1>\s*/i);
  if (!match || match.index == null) return html;

  const before = html.slice(0, match.index);
  // A heading is leading when everything before it is wrapper markup/whitespace,
  // not visible prose or another heading.
  if (visibleMarkupText(before)) return html;

  const headingWithoutNotes = match[0].replace(NOTE_BUTTON, '');
  const headingText = visibleMarkupText(headingWithoutNotes);
  const textWithoutLabel = visibleMarkupText(headingWithoutNotes.replace(HEAD_LABEL_SPAN, ''));
  const titleNorm = normalizeHeading(title);
  // Match either the full heading text (a TOC head that carries the label)
  // or the label-less text (the usual case: "Fuga" titles a heading whose
  // visible text is "IV Fuga" because of the sur-title label).
  if (normalizeHeading(headingText) !== titleNorm && normalizeHeading(textWithoutLabel) !== titleNorm) return html;

  // The whole heading goes, footnote marker included - ReaderView pulls that
  // marker back out separately via leadingHeadNote and renders it next to
  // its own title, the same way it already does for the sur-title label.
  return before + html.slice(match.index + match[0].length);
}

/**
 * The sur-title label of the chapter's leading heading (teidiv2html.xsl's
 * head-label span - "IV" for "<span class=head-label>IV</span> Fuga"), ''
 * when the heading carries none or is not leading. Callers show it above
 * their own title rendering, the way the original server page styles it
 * (block, small-caps, ~80% size - see teidiv.css).
 */
export function leadingHeadLabel(html: string): string {
  if (!html) return '';
  const match = html.match(/<h([1-6])\b[^>]*>[\s\S]*?<\/h\1>/i);
  if (!match || match.index == null) return '';
  if (visibleMarkupText(html.slice(0, match.index))) return '';
  const label = match[0].match(HEAD_LABEL_SPAN);
  return label ? visibleMarkupText(label[0]) : '';
}

/**
 * A footnote marker (the .note button teidiv2html.xsl renders for a TEI
 * <note>) riding on the chapter's leading heading, '' when it carries none
 * or isn't leading - same gating as leadingHeadLabel. Unlike the label,
 * this is real HTML (the marker is interactive, carries the note's full
 * text in its title attribute - see ReaderView's tap-to-view handling),
 * not plain text: callers render it raw, next to their own title, rather
 * than losing it when the duplicated heading text around it is stripped.
 */
export function leadingHeadNote(html: string): string {
  if (!html) return '';
  const match = html.match(/<h([1-6])\b[^>]*>[\s\S]*?<\/h\1>/i);
  if (!match || match.index == null) return '';
  if (visibleMarkupText(html.slice(0, match.index))) return '';
  return (match[0].match(NOTE_BUTTON) || []).join('');
}

function visibleMarkupText(value: string): string {
  return value
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .trim();
}

function normalizeHeading(value: string): string {
  // Whitespace AND punctuation/symbols collapse away, case too: the
  // leading heading and its TOC title can differ in harmless ways around
  // footnote refs and separators (heading "Celano. [7]" vs TOC title
  // "Celano7", "Celano 7") and must still count as the same heading -
  // otherwise the strip leaves it and the reader renders the title twice.
  // Alphanumerics (incl. letters with diacritics) are what identify a
  // heading; two headings differing only in punctuation are the same one.
  return visibleMarkupText(value)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '');
}
