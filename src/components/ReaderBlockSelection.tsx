import { useEffect, type RefObject } from 'react';
import type { FragmentLocation } from '../services/fragmentAddress';
import { attachReaderBlocks } from '../services/readerBlocks';

/** Whole-paragraph clicks use exactly the native text-selection toolbar. */
export function ReaderBlockSelection({ containerRef, contentKey, sourcePath, onLegacyFragment }: {
  containerRef: RefObject<HTMLDivElement | null>; contentKey: string; sourcePath?: string; onLegacyFragment?: (fragment: FragmentLocation) => void;
}) {
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let blockRange: Range | null = null;
    const clearAppearance = () => {
      blockRange = null;
      container.classList.remove('reader-block-selection');
    };
    const selectionChanged = () => {
      const selection = window.getSelection();
      if (!blockRange) return;
      if (!selection?.rangeCount ||
          selection.getRangeAt(0).compareBoundaryPoints(Range.START_TO_START, blockRange) !== 0 ||
          selection.getRangeAt(0).compareBoundaryPoints(Range.END_TO_END, blockRange) !== 0) clearAppearance();
    };
    const activate = (block: HTMLElement) => {
      const linked = Array.from(container.querySelectorAll<HTMLElement>('.block-linked'));
      const blocks = linked.includes(block) ? linked : [block];
      const selection = window.getSelection();
      if (!selection) return;
      const range = document.createRange();
      range.setStart(blocks[0], 0);
      range.setEnd(blocks.at(-1)!, blocks.at(-1)!.childNodes.length);
      blockRange = range.cloneRange();
      container.classList.add('reader-block-selection');
      selection.removeAllRanges(); selection.addRange(range);
      document.dispatchEvent(new Event('pointerup'));
    };
    container.addEventListener('pointerdown', clearAppearance);
    document.addEventListener('selectionchange', selectionChanged);
    const detach = attachReaderBlocks(container, {
      onLegacyRange: (first, last) => {
        const revision = container.querySelector<HTMLElement>('[data-fragment-version]')?.dataset.fragmentVersion;
        if (!sourcePath || !onLegacyFragment || !revision || !first.dataset.sourcePath || !last.dataset.sourcePath) return false;
        onLegacyFragment({ sourcePath, selector: '_' + first.dataset.sourcePath + (first === last ? '' : '..' + last.dataset.sourcePath), revision });
        return true;
      },
      onChange: block => { if (!block) clearAppearance(); }, onActivate: activate,
    });
    return () => {
      detach();
      clearAppearance();
      container.removeEventListener('pointerdown', clearAppearance);
      document.removeEventListener('selectionchange', selectionChanged);
    };
  }, [containerRef, contentKey]);
  return null;
}
