// A chapter's plain text, derived from the chapter HTML the reader already
// fetched - so a chapter costs one request to biblioteca-server, not two
// (.html and .txt; see biblioteca-server's docs/caching-plan.md). The
// result follows the server's own TEI-to-text transform (tei2text.xsl):
//
// - paragraphs, verse lines, line groups and table rows each on their own
//   line; headings followed by a blank line;
// - <br> (TEI lb) is a line break;
// - a note keeps its text inline in brackets: " [note text]" (the HTML
//   carries it in the note button's title);
// - an illustration is "[IMAGE].";
// - the site's decoration (the ❖ separator and the author line the HTML
//   adds under a work's title) is not text, and is left out.
//
// Used for read-aloud, the share excerpt, the sentence count and the
// "download as text" button.

const BLOCK = new Set([
  'P', 'DIV', 'BLOCKQUOTE', 'TABLE', 'TR', 'LI', 'UL', 'OL', 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER', 'FIGURE',
]);
const HEADING = /^H[1-8]$/;
const SKIPPED = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT']);

/** Plain text of a parsed chapter (its body, or any element). */
export function plainTextOf(root: Node): string {
  const out: string[] = [];
  // A block boundary ensures `count` line breaks (ignoring trailing
  // spaces), it does not add them: two adjacent paragraphs are one line
  // apart, not two. <br> always adds one.
  const trailingBreaks = () => {
    let breaks = 0;
    for (let i = out.length - 1; i >= 0; i--) {
      const chunk = out[i].replace(/ +$/, '');
      const m = chunk.match(/\n*$/)![0].length;
      breaks += m;
      if (m < chunk.length) return breaks;
    }
    return out.length ? breaks : Infinity;
  };
  const newline = (count = 1) => { const have = trailingBreaks(); if (have < count) out.push('\n'.repeat(count - have)); };

  const walk = (node: Node) => {
    if (node.nodeType === 3 /* TEXT_NODE */) {
      out.push((node.nodeValue ?? '').replace(/\s+/g, ' '));
      return;
    }
    if (node.nodeType !== 1 /* ELEMENT_NODE */) {
      if (node.nodeType === 9 /* DOCUMENT_NODE */ || node.nodeType === 11 /* FRAGMENT */) node.childNodes.forEach(walk);
      return;
    }
    const el = node as Element;
    const tag = el.tagName.toUpperCase();
    if (SKIPPED.has(tag)) return;
    const classes = el.classList;
    if (classes.contains('deco-title-author-separator') || (tag === 'H2' && classes.contains('author'))) return;
    if (classes.contains('note')) {
      const note = (el.getAttribute('title') ?? '').replace(/\s+/g, ' ').trim();
      if (note) out.push(` [${note}]`);
      return;
    }
    if (tag === 'BR') { out.push('\n'); return; }
    if (tag === 'IMG') {
      if (classes.contains('illustration')) { newline(); out.push('[IMAGE].'); newline(); }
      return;
    }
    const heading = HEADING.test(tag);
    const block = heading || BLOCK.has(tag);
    if (block) newline();
    el.childNodes.forEach(walk);
    if (tag === 'TD' || tag === 'TH') out.push(' ');
    if (block) newline(heading ? 2 : 1);
  };
  walk(root);

  return out.join('')
    .split('\n')
    .map(line => line.replace(/ {2,}/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Plain text of a chapter's HTML. Browser (or any DOMParser) only. */
export function htmlToPlainText(html: string, parser: DOMParser = new DOMParser()): string {
  const doc = parser.parseFromString(html, 'text/html');
  return plainTextOf(doc.body ?? doc);
}
