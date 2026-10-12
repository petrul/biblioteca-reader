import React, { useRef, useState } from 'react';
import { X } from 'lucide-react';
import { useDragToDismiss } from '../hooks/useDragToDismiss';

// Matches the slide-out transition below.
const CLOSE_MS = 250;

/**
 * A footnote on phones: a bottom sheet sliding up over a dimmed page, in
 * place of the desktop popover anchored at the note chip (too cramped on a
 * narrow screen, and long TEI notes overflow it). Dismissed by tapping the
 * backdrop, the X, Escape (ReaderView), or dragging it down. Mounted only
 * while a footnote is open, so each one starts from a fresh drag state.
 */
export const FootnoteSheet: React.FC<{ text: string; onClose: () => void }> = ({ text, onClose }) => {
  const [closing, setClosing] = useState(false);
  const sheetRef = useRef<HTMLDivElement>(null);

  const close = () => {
    if (closing) return;
    setClosing(true);
    setTimeout(onClose, CLOSE_MS);
  };
  const drag = useDragToDismiss('down', close);

  return (
    <div
      id="footnote-sheet-root"
      className="fixed inset-0 z-50"
      role="dialog"
      aria-modal="true"
      aria-label="Footnote"
    >
      <div
        id="footnote-sheet-backdrop"
        onClick={close}
        className={`absolute inset-0 bg-black/50 transition-opacity duration-200 animate-in fade-in ${closing ? 'opacity-0' : 'opacity-100'}`}
      />
      <div
        id="footnote-sheet"
        ref={sheetRef}
        // A drag scrolls the note while it is scrolled down; only from its
        // top does dragging down pull the sheet away.
        onTouchStart={e => { if (!sheetRef.current?.scrollTop) drag.onTouchStart(e); }}
        onTouchMove={drag.onTouchMove}
        onTouchEnd={drag.onTouchEnd}
        style={!closing && drag.dragY !== 0 ? { transform: `translateY(${drag.dragY}px)` } : undefined}
        className={`absolute inset-x-0 bottom-0 max-h-[70vh] overflow-y-auto overscroll-contain rounded-t-2xl border-t border-emerald-500/30 bg-[#08231c] text-emerald-100 shadow-2xl px-5 pt-2 pb-[max(1.25rem,env(safe-area-inset-bottom))] animate-in slide-in-from-bottom duration-300 ${
          drag.isDragging ? '' : 'transition-transform ease-out duration-200'
        } ${closing ? 'translate-y-full' : 'translate-y-0'}`}
      >
        <div className="mx-auto mb-2 h-1.5 w-10 rounded-full bg-emerald-200/30" aria-hidden="true" />
        <div className="flex items-center justify-between pb-2">
          <span className="text-[10px] font-bold uppercase tracking-widest text-emerald-200/60">Footnote</span>
          <button
            id="btn-footnote-sheet-close"
            type="button"
            onClick={close}
            aria-label="Close footnote"
            className="p-1.5 -mr-1.5 rounded-full text-emerald-200/70 hover:text-white hover:bg-white/10 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <p className="text-[15px] leading-relaxed whitespace-pre-line">{text}</p>
      </div>
    </div>
  );
};
