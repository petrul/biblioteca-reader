import React, { useRef, useState } from 'react';

/**
 * Touch-drag-to-dismiss: unlike useSwipeDismiss (which only checks the net
 * delta at touchend), this tracks the finger live so a dragged panel can
 * visually follow the touch as it moves, then either completes the
 * dismissal (calling onDismiss, leaving the panel to animate the rest of
 * the way via its own closing-transition state) or snaps back to 0 if the
 * drag didn't pass the threshold.
 *
 * Consumer is expected to apply `transform: translateX(${dragX}px)` (and
 * skip the CSS transition while isDragging is true, so the drag tracks
 * 1:1 with no lag) whenever it isn't itself in a separate "closing"
 * animation state.
 */
export function useDragToDismiss(direction: 'left' | 'right', onDismiss: () => void, threshold = 80) {
  const [dragX, setDragX] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const startX = useRef<number | null>(null);

  const onTouchStart = (e: React.TouchEvent) => {
    startX.current = e.touches[0].clientX;
    setIsDragging(true);
  };

  const onTouchMove = (e: React.TouchEvent) => {
    if (startX.current === null) return;
    const dx = e.touches[0].clientX - startX.current;
    // Only track movement in the dismiss direction - the opposite
    // direction clamps to 0 rather than overshooting past "fully open".
    setDragX(direction === 'left' ? Math.min(0, dx) : Math.max(0, dx));
  };

  const onTouchEnd = () => {
    setIsDragging(false);
    const passedThreshold = direction === 'left' ? dragX < -threshold : dragX > threshold;
    if (passedThreshold) {
      onDismiss();
      // Leave dragX where it is - the panel's own closing-transition state
      // takes over from this exact position once isDragging flips off.
    } else {
      setDragX(0);
    }
    startX.current = null;
  };

  return { dragX, isDragging, onTouchStart, onTouchMove, onTouchEnd };
}
