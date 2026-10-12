import React, { useRef } from 'react';

/**
 * Touch-swipe-to-dismiss handlers for a panel/drawer/full-screen view.
 * Spread the returned handlers onto the swipeable container - a horizontal
 * swipe past the threshold in the given direction calls onDismiss. Mostly-
 * vertical gestures (scrolling) are ignored.
 */
export function useSwipeDismiss(direction: 'left' | 'right', onDismiss: () => void, threshold = 60) {
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
    if (direction === 'right' && dx > 0) onDismiss();
    if (direction === 'left' && dx < 0) onDismiss();
  };

  return { onTouchStart, onTouchEnd };
}
