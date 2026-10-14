import { useEffect, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { attachReaderBlocks } from '../services/readerBlocks';

/** The marker lives outside the imported HTML so it never enters copied text. */
export function ReaderBlockMarker({ containerRef, contentKey }: {
  containerRef: RefObject<HTMLDivElement | null>;
  contentKey: string;
}) {
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
    setBlock(null);
    const container = containerRef.current;
    if (!container) return;
    return attachReaderBlocks(container, { onChange: setBlock, onActivate: activate });
  }, [containerRef, contentKey]);
  useEffect(() => {
    if (!block) return;
    const reposition = () => {
      const rect = block.getBoundingClientRect();
      setPosition({ left: rect.left + 4, top: rect.top + 2 });
    };
    reposition();
    window.addEventListener('scroll', reposition, { capture: true, passive: true });
    window.addEventListener('resize', reposition);
    return () => {
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
    };
  }, [block]);
  if (!block) return null;
  return createPortal(<button
    id="reader-block-marker"
    type="button"
    aria-label="Paragraph actions"
    title="Paragraph actions (q)"
    style={{ position: 'fixed', ...position }}
    className="z-40 w-6 h-6 flex items-center justify-center rounded-md border border-[#9ca3af]/50 bg-white/60 hover:bg-white/80 backdrop-blur-[2px] shadow-sm text-[#9ca3af] hover:text-[#6b7280] font-serif text-xl leading-none cursor-pointer"
    onMouseDown={event => event.preventDefault()}
    onClick={() => activate(block)}
  >¶</button>, document.body);
}
