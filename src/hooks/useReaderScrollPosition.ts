import { useEffect, useRef } from 'react';
import { bookmarkStoreFor } from '../services/identity';

const SAVE_DEBOUNCE_MS = 1_500;
const HEARTBEAT_MS = 15_000;
// Below this, there's nothing meaningful to resume to - skip both the
// restore and the noise of repeatedly saving "basically at the top".
const MIN_MEANINGFUL_FRACTION = 0.01;

function currentScrollFraction(): number {
  const max = document.documentElement.scrollHeight - window.innerHeight;
  return max > 0 ? window.scrollY / max : 0;
}

/**
 * Restores the reader's exact in-chapter scroll position on open, and
 * keeps it saved - debounced while actively scrolling, a periodic
 * heartbeat otherwise, and a final flush on chapter-change/unmount/tab-
 * close (same shape as useReadingAttention) - as a 0-1 fraction of the
 * chapter's total scrollable height (see BookmarkStore.setScrollFraction).
 *
 * `ready` gates the restore: a live work's chapter HTML can still be
 * loading when this mounts (see ReaderView's isLiveLoading), and
 * scrolling before the real content has painted would scroll to nothing.
 */
export function useReaderScrollPosition(workId: string, divPath: string, signedIn: boolean, ready: boolean): void {
  const restoredForRef = useRef<string | null>(null);
  const lastSavedRef = useRef(0);

  useEffect(() => {
    if (!ready) return;
    const store = bookmarkStoreFor(signedIn);
    let cancelled = false;

    const save = () => {
      const fraction = currentScrollFraction();
      if (Math.abs(fraction - lastSavedRef.current) < MIN_MEANINGFUL_FRACTION) return;
      lastSavedRef.current = fraction;
      void store.setScrollFraction(workId, divPath, fraction);
    };

    const restoreKey = `${workId}::${divPath}`;
    if (restoredForRef.current !== restoreKey) {
      restoredForRef.current = restoreKey;
      lastSavedRef.current = 0;
      void store.get(workId).then((position) => {
        if (cancelled) return;
        const fraction = position?.divPath === divPath ? position.scrollFraction ?? 0 : 0;
        if (fraction < MIN_MEANINGFUL_FRACTION) return;
        // Double rAF: wait for the chapter content's real layout to
        // settle (a single frame can still land mid-reflow) before
        // computing where "fraction" actually points.
        requestAnimationFrame(() => requestAnimationFrame(() => {
          if (cancelled) return;
          const max = document.documentElement.scrollHeight - window.innerHeight;
          if (max > 0) {
            window.scrollTo({ top: fraction * max, behavior: 'auto' });
            lastSavedRef.current = fraction;
          }
        }));
      });
    }

    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const onScroll = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(save, SAVE_DEBOUNCE_MS);
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    const interval = setInterval(save, HEARTBEAT_MS);
    window.addEventListener('beforeunload', save);

    return () => {
      cancelled = true;
      save();
      if (debounceTimer) clearTimeout(debounceTimer);
      clearInterval(interval);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('beforeunload', save);
    };
  }, [workId, divPath, signedIn, ready]);
}
