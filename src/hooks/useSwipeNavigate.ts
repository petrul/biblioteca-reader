import React, { useRef } from 'react';

/**
 * Touch-swipe page-turn handlers, the paging counterpart of
 * useSwipeDismiss's drawer gesture. Spread the returned handlers onto the
 * reading column - a horizontal swipe past the threshold calls
 * onSwipeLeft (content moves left, next page enters from the right - the
 * same direction every mobile reader/carousel uses for "forward") or
 * onSwipeRight ("back"). Mostly-vertical gestures (scrolling) are ignored,
 * and so is any gesture that ends with text actually selected - that's a
 * selection drag, not a page turn, and must never hijack it into a
 * chapter change.
 */
export function useSwipeNavigate(
  onSwipeLeft?: () => void,
  onSwipeRight?: () => void,
  threshold = 60
) {
  const startX = useRef<number | null>(null);
  const startY = useRef<number | null>(null);

  const onTouchStart = (e: React.TouchEvent) => {
    startX.current = e.touches[0].clientX;
    startY.current = e.touches[0].clientY;
  };

  const onTouchEnd = (e: React.TouchEvent) => {
    if (startX.current === null || startY.current === null) return;
    const dx = e.changedTouches[0].clientX - startX.current;
    const dy = e.changedTouches[0].clientY - startY.current;
    startX.current = null;
    startY.current = null;

    if (Math.abs(dx) < threshold || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    if ((window.getSelection()?.toString() ?? '').length > 0) return;

    if (dx < 0) onSwipeLeft?.();
    else onSwipeRight?.();
  };

  return { onTouchStart, onTouchEnd };
}
