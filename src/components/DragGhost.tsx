import { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { LongPressDragOffset } from '../hooks/useLongPressDrag';

interface DragGhostProps {
  /** The useLongPressDrag return value (or any object with its
      dragging/origin/offset fields); the ghost shows only while a drag is
      active. */
  drag: {
    dragging: boolean;
    origin: { x: number; y: number } | null;
    offset: LongPressDragOffset | null;
  };
  /** Ghost bubble diameter in px (the chat bubble is 56). */
  diameter?: number;
  testId?: string;
  children?: ReactNode;
}

/**
 * The visual half of useLongPressDrag for hosts that stay put during the
 * gesture (a button docked in a toolbar): a ghost bubble rides the pointer
 * while the real element only dims, until the drop lands.
 *
 * Portaled to document.body on purpose: toolbars carry transforms and
 * backdrop-filters, which make them containing blocks - a fixed ghost
 * inside them would be positioned relative to the bar, not the viewport.
 *
 * Reuse recipe for any draggable button: useLongPressDrag on the host
 * element (onPointerDown, justDragged() in onClick, touch-none
 * select-none, onContextMenu preventDefault) + <DragGhost> for feedback.
 */
export function DragGhost({ drag, diameter = 56, testId, children }: DragGhostProps) {
  if (!drag.dragging || !drag.origin || !drag.offset) return null;
  return createPortal(
    <div
      data-testid={testId}
      className="fixed z-[80] rounded-full grid place-items-center text-white border border-white/30 shadow-xl pointer-events-none"
      style={{
        width: diameter,
        height: diameter,
        left: drag.origin.x + drag.offset.dx - diameter / 2,
        top: drag.origin.y + drag.offset.dy - diameter / 2,
        background: 'linear-gradient(135deg, #34d399, #075985)'
      }}
    >
      {children}
    </div>,
    document.body
  );
}
