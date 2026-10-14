/** One delegated listener set for all current chapter blocks; no HTML rewriting. */
export const READER_BLOCKS = 'p, h1, h2, h3, h4, h5, h6, blockquote, li, .l, .lg';
const INTERACTIVE = 'a, button, input, textarea, select, [contenteditable="true"], .note';

export function attachReaderBlocks(container: HTMLElement, callbacks: {
  onChange: (block: HTMLElement | null) => void;
  onActivate: (block: HTMLElement) => void;
}) {
  let active: HTMLElement | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: HTMLElement | null = null;
  let touch: { id: number; x: number; y: number } | null = null;
  let pressed = false;
  const doc = container.ownerDocument;
  const cancel = () => { clearTimeout(timer); timer = undefined; pending = null; };
  const setActive = (block: HTMLElement | null) => {
    active?.classList.remove('block-active');
    active = block;
    active?.classList.add('block-active');
    callbacks.onChange(active);
  };
  const findBlock = (target: EventTarget | null) => {
    const element = target instanceof Element ? target : null;
    if (!element || element.closest(INTERACTIVE)) return null;
    const block = element.closest<HTMLElement>(READER_BLOCKS);
    return block && container.contains(block) && block.textContent?.trim() ? block : null;
  };
  const schedule = (block: HTMLElement, delay: number, activate: boolean) => {
    cancel(); pending = block;
    timer = setTimeout(() => {
      pending = null;
      if (!container.contains(block)) return;
      setActive(block);
      if (activate) { pressed = true; callbacks.onActivate(block); }
    }, delay);
  };
  const over = (event: PointerEvent) => {
    if (event.pointerType !== 'mouse' || event.buttons) return;
    const block = findBlock(event.target);
    if (block === active || block === pending) return;
    cancel(); setActive(null);
    if (block) schedule(block, 400, false);
  };
  const out = (event: PointerEvent) => {
    if (event.pointerType !== 'mouse') return;
    const next = event.relatedTarget instanceof Element ? event.relatedTarget : null;
    if (next?.closest('#reader-block-marker, #selection-quote-toolbar')) return;
    if (findBlock(event.relatedTarget) === (pending || active)) return;
    cancel(); setActive(null);
  };
  const down = (event: PointerEvent) => {
    if (event.pointerType !== 'touch' && event.pointerType !== 'pen') return;
    if (touch) { cancel(); touch = null; return; }
    pressed = false;
    const block = findBlock(event.target);
    cancel(); setActive(null);
    if (!block) return;
    touch = { id: event.pointerId, x: event.clientX, y: event.clientY };
    schedule(block, 500, true);
  };
  const move = (event: PointerEvent) => {
    if (touch?.id !== event.pointerId) return;
    if (Math.hypot(event.clientX - touch.x, event.clientY - touch.y) > 10) {
      cancel(); touch = null;
      if (!pressed) setActive(null);
    }
  };
  const end = () => { cancel(); touch = null; };
  const scrolling = () => { cancel(); touch = null; };
  const context = (event: MouseEvent) => {
    if (pressed && findBlock(event.target) === active) event.preventDefault();
  };
  const outside = (event: PointerEvent) => {
    const target = event.target instanceof Element ? event.target : null;
    if (target && !container.contains(target) && !target.closest('#reader-block-marker, #selection-quote-toolbar, #quote-created-modal')) {
      cancel(); setActive(null);
    }
  };
  const outsideHover = (event: PointerEvent) => {
    if (event.pointerType === 'mouse') outside(event);
  };
  const key = (event: KeyboardEvent) => {
    if (event.key === 'Escape') { cancel(); setActive(null); return; }
    if (event.key !== 'q' || event.ctrlKey || event.metaKey || event.altKey ||
        (event.target instanceof Element && event.target.closest(INTERACTIVE))) return;
    const caret = doc.getSelection()?.anchorNode;
    const block = active || findBlock(caret instanceof Element ? caret : caret?.parentElement || null);
    if (!block) return;
    event.preventDefault(); setActive(block); callbacks.onActivate(block);
  };
  container.addEventListener('pointerover', over);
  container.addEventListener('pointerout', out);
  container.addEventListener('pointerdown', down);
  container.addEventListener('contextmenu', context);
  doc.addEventListener('pointermove', move, { passive: true });
  doc.addEventListener('pointerup', end);
  doc.addEventListener('pointercancel', end);
  doc.addEventListener('pointerdown', outside);
  doc.addEventListener('pointerover', outsideHover);
  doc.addEventListener('keydown', key);
  doc.addEventListener('scroll', scrolling, { capture: true, passive: true });
  return () => {
    cancel(); active?.classList.remove('block-active');
    container.removeEventListener('pointerover', over);
    container.removeEventListener('pointerout', out);
    container.removeEventListener('pointerdown', down);
    container.removeEventListener('contextmenu', context);
    doc.removeEventListener('pointermove', move);
    doc.removeEventListener('pointerup', end);
    doc.removeEventListener('pointercancel', end);
    doc.removeEventListener('pointerdown', outside);
    doc.removeEventListener('pointerover', outsideHover);
    doc.removeEventListener('keydown', key);
    doc.removeEventListener('scroll', scrolling, true);
  };
}
