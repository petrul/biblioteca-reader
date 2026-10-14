import { BlockQuotePopover } from './BlockQuotePopover';
import { useEffect, useLayoutEffect, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { attachReaderBlocks } from '../services/readerBlocks';

/** The marker lives outside the imported HTML so it never enters copied text. */
export function ReaderBlockMarker({ containerRef, contentKey, chapterId, title, chapterTitle }: {
  containerRef: RefObject<HTMLDivElement | null>;
  contentKey: string; chapterId: string; title: string; chapterTitle: string;
}) {
  const [open, setOpen] = useState(false);
  const [block, setBlock] = useState<HTMLElement | null>(null);
  const [position, setPosition] = useState({ left: 8, top: 80 });
  const activate = (element: HTMLElement) => {
    const selection = window.getSelection();
    if (!selection) return;
    const range = document.createRange();
    range.selectNodeContents(element);
    selection.removeAllRanges(); selection.addRange(range);
    // Reuse the existing quote/copy/save/citation toolbar's selection handler.
    document.dispatchEvent(new Event('pointerup'));
  };
  useEffect(() => {
    setBlock(null); setOpen(false);
    const container = containerRef.current;
    if (!container) return;
    return attachReaderBlocks(container, { onChange: block => { setBlock(block); setOpen(false); }, onActivate: activate });
  }, [containerRef, contentKey]);
  useLayoutEffect(() => {
    if (!block) return;
    const reposition = () => {
      const rect = block.getBoundingClientRect();
      // Place the persistent action button inside the selected block, at its top right.
      const next = { left: Math.max(4, Math.min(rect.right - 28, (window.visualViewport?.width ?? window.innerWidth) + (window.visualViewport?.offsetLeft ?? 0) - 28)), top: rect.top };
      setPosition(current => current.left === next.left && current.top === next.top ? current : next);
    };
    // Chapter transitions can move the paragraph without scroll/resize events.
    let frame = 0;
    const track = () => { reposition(); frame = requestAnimationFrame(track); };
    track();
    window.addEventListener('scroll', reposition, { capture: true, passive: true });
    window.addEventListener('resize', reposition);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
    };
  }, [block]);
  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, []);
  if (!block) return null;
  return createPortal(<>
  <button
    id="reader-block-marker"
    type="button"
    aria-label="Paragraph actions"
    title="Paragraph actions (q)"
    style={{ position: 'fixed', ...position }}
    className="z-40 w-6 h-6 flex items-center justify-center rounded-md border-0 bg-transparent hover:bg-transparent text-[#9ca3af] hover:text-[#6b7280] font-serif text-xl leading-none cursor-pointer"
    onMouseDown={event => event.preventDefault()}
    onClick={() => setOpen(value => !value)}
  >¶</button>
  {open && <BlockQuotePopover block={block} chapterId={chapterId} title={title} chapterTitle={chapterTitle} position={position} onClose={() => setOpen(false)} onQuote={() => { setOpen(false); activate(block); }} />}
  </>, document.body);
}
