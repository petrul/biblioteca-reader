// Ported from textbase-server's own static/js/teidiv.js
// (recompute_stanzas_margins) - the old Spring MVC reader's poem-centering
// trick, rewritten without jQuery for direct use on a content container ref.
//
// A "poem" is a run of consecutive <div class="lg"> (TEI <lg>, a stanza)
// siblings - textbase-server's teidiv2html.xsl renders one per <lg>, with
// each line inside as <p class="l">. Lines within a stanza are meant to sit
// left-aligned relative to each other, but the stanza block as a whole
// should read as centered in the column - so each stanza's average line
// width is measured, and if it's narrower than the container, a left
// margin is set to center that block.

const STANZA_SELECTOR = 'div.lg';
const LINE_SELECTOR = '.l';

type Poem = { totalWidth: number; maxWidth: number; lineCount: number; stanzas: HTMLElement[] };

export function alignPoemStanzas(container: HTMLElement): void {
  const stanzas = Array.from(container.querySelectorAll<HTMLElement>(STANZA_SELECTOR));
  if (stanzas.length === 0) return;

  // XHTML-style <div class="lg"/> separators are parsed as opening tags
  // in HTML, so later stanzas can be nested. Only the outer group gets a
  // centering margin; otherwise the same offset accumulates at every level.
  // Reset offsets first, including when a resize makes centering impossible.
  stanzas.forEach(stanza => {
    stanza.style.marginLeft = '0px';
    stanza.style.width = 'auto';
  });
  const outerStanzas = stanzas.filter(stanza => {
    const ancestor = stanza.parentElement?.closest(STANZA_SELECTOR);
    return !ancestor || !container.contains(ancestor);
  });

  // width:max-content first, to measure each line's natural (unwrapped) width.
  outerStanzas.forEach(stanza => { stanza.style.width = 'max-content'; });
  outerStanzas.forEach(stanza => {
    stanza.querySelectorAll<HTMLElement>(LINE_SELECTOR).forEach(line => { line.style.width = 'max-content'; });
  });

  const stanzaToPoem = new Map<HTMLElement, Poem>();
  let currentPoem: Poem | null = null;
  for (const stanza of outerStanzas) {
    const previous = stanza.previousElementSibling;
    const previousIsStanza = previous?.tagName === 'DIV' && previous.classList.contains('lg');
    if (!previousIsStanza || !currentPoem) {
      currentPoem = { totalWidth: 0, maxWidth: 0, lineCount: 0, stanzas: [stanza] };
    } else {
      currentPoem.stanzas.push(stanza);
    }
    stanzaToPoem.set(stanza, currentPoem);

    stanza.querySelectorAll<HTMLElement>(LINE_SELECTOR).forEach(line => {
      // Round upward: offsetWidth rounds to the nearest pixel and can leave
      // a fractional-pixel shortage that unexpectedly wraps the longest line.
      const lineWidth = Math.ceil(line.getBoundingClientRect().width);
      currentPoem!.totalWidth += lineWidth;
      currentPoem!.maxWidth = Math.max(currentPoem!.maxWidth, lineWidth);
      currentPoem!.lineCount += 1;
      // back to auto so a long line still wraps instead of overflowing -
      // max-content was only needed for the measurement above.
      line.style.width = 'auto';
    });
  }

  const containerWidth = container.getBoundingClientRect().width;
  for (const stanza of outerStanzas) {
    const poem = stanzaToPoem.get(stanza);
    stanza.style.width = 'auto';
    if (!poem || poem.lineCount === 0) continue;
    const avgLineWidth = poem.totalWidth / poem.lineCount;
    if (avgLineWidth >= containerWidth) continue; // too wide to center meaningfully
    // Do not wrap a line that would fit the column without a centering offset.
    const margin = Math.max(0, Math.min(
      (containerWidth - avgLineWidth) / 2,
      containerWidth - poem.maxWidth,
    ));
    stanza.style.marginLeft = `${Math.floor(margin)}px`;
  }
}
