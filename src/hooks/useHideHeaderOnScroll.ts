import { useEffect, useRef, useState } from 'react';

// Ignore sub-pixel/trackpad jitter - only a real scroll of at least this
// many pixels in one direction flips the header's visibility.
const MIN_DELTA = 8;
// Never hide until scrolled past roughly the header's own height - avoids
// a flicker where the header disappears the instant you nudge the page.
const HIDE_AFTER = 80;

/**
 * Classic auto-hiding sticky header: hides while scrolling down (more
 * room for the actual reading content), reappears on any scroll up or
 * once back near the very top. `enabled=false` always returns visible
 * (true) and skips attaching the scroll listener entirely - for callers
 * like the navbar that only want this behavior on the reader page.
 */
export function useHideHeaderOnScroll(enabled: boolean = true): boolean {
  const [visible, setVisible] = useState(true);
  const lastY = useRef(0);

  useEffect(() => {
    if (!enabled) {
      setVisible(true);
      return;
    }

    lastY.current = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      const delta = y - lastY.current;
      if (y < HIDE_AFTER) {
        setVisible(true);
      } else if (delta > MIN_DELTA) {
        setVisible(false);
      } else if (delta < -MIN_DELTA) {
        setVisible(true);
      }
      lastY.current = y;
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [enabled]);

  return visible;
}
