import { PARAGRAPHS, parseParagraphRange } from './paragraphLinks';
/** One delegated listener set for all current chapter blocks; no HTML rewriting. */
export const READER_BLOCKS = 'p, h1, h2, h3, h4, h5, h6, blockquote, li, .l, .lg';
const INTERACTIVE = 'a, button, input, textarea, select, [contenteditable="true"], .note';

export function attachReaderBlocks(container: HTMLElement, callbacks: {
  onChange: (block: HTMLElement | null) => void;
  onActivate: (block: HTMLElement) => void;
  onLegacyRange?: (first: HTMLElement, last: HTMLElement) => boolean;
}) {
  container.querySelectorAll<HTMLElement>(PARAGRAPHS).forEach((block, index) => {
    const id = `p${index + 1}`;
    block.dataset.readerParagraph = id;
    if (!block.id) block.id = id;
    else if (block.id !== id && !container.querySelector(`#${id}`)) {
      const anchor = container.ownerDocument.createElement('span');
      anchor.id = id; anchor.setAttribute('aria-hidden', 'true'); block.prepend(anchor);
    }
  });
  let selected: HTMLElement | null = null;
  let hovered: HTMLElement | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let touch: { id: number; x: number; y: number } | null = null;
  let pressed: HTMLElement | null = null;
  const doc = container.ownerDocument;
  const cancel = () => { clearTimeout(timer); timer = undefined; };
  const setHovered = (block: HTMLElement | null) => {
    hovered?.classList.remove('block-hover');
    hovered = block;
    hovered?.classList.add('block-hover');
  };
  const select = (block: HTMLElement) => {
    container.querySelectorAll('.block-linked').forEach(element => element.classList.remove('block-linked'));
    selected?.classList.remove('block-active');
    selected = block;
    selected.classList.add('block-active');
    callbacks.onChange(selected);
  };
  const clearSelection = () => {
    selected?.classList.remove('block-active');
    selected = null;
    container.querySelectorAll('.block-linked').forEach(element => element.classList.remove('block-linked'));
    doc.getSelection()?.removeAllRanges();
    callbacks.onChange(null);
  };
  const findBlock = (target: EventTarget | null) => {
    const element = target instanceof Element ? target : null;
    if (!element || element.closest(INTERACTIVE)) return null;
    // Lines (and inline markup within them) belong to their nearest stanza.
    // Standalone lines still work as blocks; native text selection is unchanged.
    const block = element.closest<HTMLElement>('.lg') ?? element.closest<HTMLElement>(READER_BLOCKS);
    return block && container.contains(block) && block.textContent?.trim() ? block : null;
  };
  const over = (event: PointerEvent) => {
    if (event.pointerType !== 'mouse' || event.buttons) return;
    setHovered(findBlock(event.target));
  };
  const out = (event: PointerEvent) => {
    if (event.pointerType !== 'mouse') return;
    setHovered(findBlock(event.relatedTarget));
  };
  const click = (event: MouseEvent) => {
    const block = findBlock(event.target);
    // A text drag still belongs to the native selection/quote toolbar.
    if (!block) return;
    if (!doc.getSelection()?.isCollapsed && !container.classList.contains('reader-block-selection')) return;
    if (block === selected) { clearSelection(); return; }
    if (!doc.getSelection()?.isCollapsed) return;
    select(block);
    callbacks.onActivate(block);
  };
  const down = (event: PointerEvent) => {
    if (event.pointerType !== 'touch' && event.pointerType !== 'pen') return;
    if (touch) { cancel(); touch = null; return; }
    pressed = null;
    const block = findBlock(event.target);
    cancel();
    if (!block) return;
    touch = { id: event.pointerId, x: event.clientX, y: event.clientY };
    timer = setTimeout(() => {
      if (!container.contains(block)) return;
      pressed = block;
      select(block);
      callbacks.onActivate(block);
    }, 500);
  };
  const move = (event: PointerEvent) => {
    if (touch?.id !== event.pointerId) return;
    if (Math.hypot(event.clientX - touch.x, event.clientY - touch.y) > 10) {
      cancel(); touch = null;
    }
  };
  const end = () => { cancel(); touch = null; };
  const context = (event: MouseEvent) => {
    if (pressed && findBlock(event.target) === pressed) event.preventDefault();
  };
  const outside = (event: PointerEvent) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!selected || !target || selected.contains(target) ||
        target.closest('#selection-quote-toolbar, #quote-created-modal, #reader-similarity-dialog')) return;
    clearSelection();
  };
  const key = (event: KeyboardEvent) => {
    if (event.key === 'Escape') { cancel(); setHovered(null); return; }
    if (event.key !== 'q' || event.ctrlKey || event.metaKey || event.altKey ||
        (event.target instanceof Element && event.target.closest(INTERACTIVE))) return;
    const caret = doc.getSelection()?.anchorNode;
    const block = hovered || selected || findBlock(caret instanceof Element ? caret : caret?.parentElement || null);
    if (!block) return;
    event.preventDefault(); select(block); callbacks.onActivate(block);
  };
  const applyLink = () => {
    const range = parseParagraphRange(new URLSearchParams(location.search).get('p') || location.hash);
    if (!range) return;
    const first = container.querySelector<HTMLElement>(`[data-reader-paragraph="p${range.start}"]`);
    const last = container.querySelector<HTMLElement>(`[data-reader-paragraph="p${range.end}"]`);
    if (!first || !last) return;
    if (callbacks.onLegacyRange?.(first, last)) return;
    select(first);
    for (let n = range.start; n <= range.end; n++) container.querySelector(`[data-reader-paragraph="p${n}"]`)?.classList.add('block-linked');
    first.scrollIntoView({ block: 'center' });
    callbacks.onActivate(first);
  };
  applyLink();
  window.addEventListener('hashchange', applyLink);
  window.addEventListener('popstate', applyLink);
  container.addEventListener('pointerover', over);
  container.addEventListener('pointerout', out);
  container.addEventListener('pointerdown', down);
  container.addEventListener('click', click);
  container.addEventListener('contextmenu', context);
  doc.addEventListener('pointerdown', outside);
  doc.addEventListener('pointermove', move, { passive: true });
  doc.addEventListener('pointerup', end);
  doc.addEventListener('pointercancel', end);
  doc.addEventListener('keydown', key);
  doc.addEventListener('scroll', end, { capture: true, passive: true });
  return () => {
    window.removeEventListener('hashchange', applyLink);
    window.removeEventListener('popstate', applyLink);
    container.querySelectorAll('.block-linked').forEach(element => element.classList.remove('block-linked'));
    cancel(); selected?.classList.remove('block-active'); hovered?.classList.remove('block-hover');
    container.removeEventListener('pointerover', over);
    container.removeEventListener('pointerout', out);
    container.removeEventListener('pointerdown', down);
    container.removeEventListener('click', click);
    container.removeEventListener('contextmenu', context);
    doc.removeEventListener('pointerdown', outside);
    doc.removeEventListener('pointermove', move);
    doc.removeEventListener('pointerup', end);
    doc.removeEventListener('pointercancel', end);
    doc.removeEventListener('keydown', key);
    doc.removeEventListener('scroll', end, true);
  };
}
