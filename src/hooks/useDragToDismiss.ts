import React, { useRef, useState } from 'react';

/**
 * Touch-drag-to-dismiss: unlike useSwipeDismiss (which only checks the net
 * delta at touchend), this tracks the finger live so a dragged panel can
 * visually follow the touch as it moves, then either completes the
 * dismissal (calling onDismiss, leaving the panel to animate the rest of
 * the way via its own closing-transition state) or snaps back to 0 if the
 * drag didn't pass the threshold.
 *
 * Consumer is expected to apply `transform: translateX(${dragX}px)` - or
 * `translateY(${dragY}px)` for a bottom sheet dragged 'down' - (and skip
 * the CSS transition while isDragging is true, so the drag tracks 1:1 with
 * no lag) whenever it isn't itself in a separate "closing" animation state.
 */
export function useDragToDismiss(direction: 'left' | 'right' | 'down', onDismiss: () => void, threshold = 80) {
  const [offset, setOffset] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const start = useRef<number | null>(null);
  // The live offset for onTouchEnd: the state above may not have re-rendered
  // since the last touchmove (continuous events are batched), and a stale
  // read made a long drag snap back instead of dismissing.
  const latest = useRef(0);
  const vertical = direction === 'down';
  const coordinate = (touch: React.Touch) => (vertical ? touch.clientY : touch.clientX);

  const onTouchStart = (e: React.TouchEvent) => {
    start.current = coordinate(e.touches[0]);
    latest.current = 0;
    setIsDragging(true);
  };

  const onTouchMove = (e: React.TouchEvent) => {
    if (start.current === null) return;
    const delta = coordinate(e.touches[0]) - start.current;
    // Only track movement in the dismiss direction - the opposite
    // direction clamps to 0 rather than overshooting past "fully open".
    latest.current = direction === 'left' ? Math.min(0, delta) : Math.max(0, delta);
    setOffset(latest.current);
  };

  const onTouchEnd = () => {
    setIsDragging(false);
    const passedThreshold = direction === 'left' ? latest.current < -threshold : latest.current > threshold;
    if (passedThreshold) {
      onDismiss();
      // Leave the offset where it is - the panel's own closing-transition
      // state takes over from this exact position once isDragging flips off.
    } else {
      latest.current = 0;
      setOffset(0);
    }
    start.current = null;
  };

  return {
    dragX: vertical ? 0 : offset,
    dragY: vertical ? offset : 0,
    isDragging,
    onTouchStart,
    onTouchMove,
    onTouchEnd,
  };
}
