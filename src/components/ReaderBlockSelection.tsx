import { useEffect, type RefObject } from 'react';
import { attachReaderBlocks } from '../services/readerBlocks';

/** Whole-paragraph clicks use exactly the native text-selection toolbar. */
export function ReaderBlockSelection({ containerRef, contentKey }: {
  containerRef: RefObject<HTMLDivElement | null>; contentKey: string;
}) {
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const activate = (block: HTMLElement) => {
      const linked = Array.from(container.querySelectorAll<HTMLElement>('.block-linked'));
      const blocks = linked.includes(block) ? linked : [block];
      const selection = window.getSelection();
      if (!selection) return;
      const range = document.createRange();
      range.setStart(blocks[0], 0);
      range.setEnd(blocks.at(-1)!, blocks.at(-1)!.childNodes.length);
      selection.removeAllRanges(); selection.addRange(range);
      document.dispatchEvent(new Event('pointerup'));
    };
    return attachReaderBlocks(container, { onChange: () => {}, onActivate: activate });
  }, [containerRef, contentKey]);
  return null;
}
