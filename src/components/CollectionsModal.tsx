import React, { useEffect, useRef } from 'react';
import { ExternalLink, X } from 'lucide-react';
import { CollectionsPanel } from './CollectionsPanel';
import { useDragToDismiss } from '../hooks/useDragToDismiss';

interface CollectionsModalProps {
  isOpen: boolean;
  userId: string;
  onClose: () => void;
  onSelectWork: (workId: string) => void;
  onSelectChapter: (workId: string, chapterId: string) => void;
  onOpenQuote: (quoteId: string) => void;
  onRunSearch: (query: string) => void;
  /** Open the full Collections page, where items can be reordered and removed. */
  onManage: () => void;
}

const FOCUSABLE = 'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * The `s` shortcut's quick jump: the same CollectionsPanel as the
 * Collections page, floated over whatever is on screen (a centered dialog
 * on desktop, a full-height sheet on phones that a downward drag on its
 * top handle dismisses). Opening anything closes it.
 */
export const CollectionsModal: React.FC<CollectionsModalProps> = ({
  isOpen,
  userId,
  onClose,
  onSelectWork,
  onSelectChapter,
  onOpenQuote,
  onRunSearch,
  onManage,
}) => {
  const cardRef = useRef<HTMLDivElement>(null);
  const drag = useDragToDismiss('down', onClose);

  // Keep the page behind from scrolling, and hand focus back on close.
  useEffect(() => {
    if (!isOpen) return;
    const opener = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
      opener?.focus?.();
    };
  }, [isOpen]);

  if (!isOpen) return null;

  // The reader listens for keys on window (arrows turn pages, t/i/x toggle
  // panels); nothing typed or pressed in here may leak out to it.
  const onKeyDown = (event: React.KeyboardEvent) => {
    event.stopPropagation();
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    } else if (event.key === 'Tab') {
      const focusable = Array.from(cardRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  };

  const dragStyle = drag.dragY > 0
    ? { transform: `translateY(${drag.dragY}px)`, transition: drag.isDragging ? 'none' : undefined }
    : undefined;

  return (
    <div
      id="collections-modal"
      role="dialog"
      aria-modal="true"
      aria-label="Collections"
      onKeyDown={onKeyDown}
      className="fixed inset-0 z-[70] flex items-stretch sm:items-start justify-center sm:pt-[8vh] sm:px-4 animate-in fade-in duration-150 motion-reduce:animate-none"
    >
      <div className="absolute inset-0 bg-black/70 backdrop-blur-xs" onClick={onClose} aria-hidden="true" />
      <div
        ref={cardRef}
        style={dragStyle}
        className="relative w-full sm:max-w-2xl h-full sm:h-auto sm:max-h-[80vh] flex flex-col bg-[#0b2921] sm:rounded-2xl border-0 sm:border border-emerald-500/30 shadow-2xl px-3 sm:px-4 pt-2 sm:pt-4 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
      >
        <div
          className="sm:hidden flex justify-center py-2 touch-none"
          onTouchStart={drag.onTouchStart}
          onTouchMove={drag.onTouchMove}
          onTouchEnd={drag.onTouchEnd}
          aria-hidden="true"
        >
          <span className="h-1 w-10 rounded-full bg-emerald-200/30" />
        </div>

        <CollectionsPanel
          userId={userId}
          autoFocus
          className="flex-1"
          bodyClassName="flex-1 overflow-y-auto overscroll-contain pr-1"
          onSelectWork={onSelectWork}
          onSelectChapter={onSelectChapter}
          onOpenQuote={onOpenQuote}
          onRunSearch={onRunSearch}
          onNavigate={onClose}
          searchAddon={
            <button
              type="button"
              id="btn-close-collections-modal"
              aria-label="Close"
              title="Close (Esc)"
              onClick={onClose}
              className="p-2.5 rounded-xl text-emerald-200/70 hover:text-white hover:bg-emerald-500/10 cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          }
        />

        <div className="shrink-0 pt-3 mt-3 border-t border-emerald-500/15 flex items-center justify-between gap-3 text-[11px] text-emerald-200/60">
          <span className="hidden sm:inline">
            <kbd className="px-1.5 py-0.5 rounded border border-emerald-500/30 font-mono text-[10px]">↑</kbd>{' '}
            <kbd className="px-1.5 py-0.5 rounded border border-emerald-500/30 font-mono text-[10px]">↓</kbd> to move,{' '}
            <kbd className="px-1.5 py-0.5 rounded border border-emerald-500/30 font-mono text-[10px]">Enter</kbd> to open
          </span>
          <button
            type="button"
            id="btn-open-collections-page"
            onClick={() => { onManage(); onClose(); }}
            className="flex items-center gap-1.5 py-1.5 text-emerald-200 hover:text-white cursor-pointer sm:ml-auto"
          >
            <span>Manage collections</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
};
