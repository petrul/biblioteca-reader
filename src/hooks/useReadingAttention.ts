import { useEffect, useRef } from 'react';
import { bookmarkStoreFor } from '../services/identity';

const HEARTBEAT_MS = 30_000;

/**
 * Reports active (tab-visible) reading time for one work, in HEARTBEAT_MS
 * chunks plus a final flush on work-change/unmount/tab-close, via
 * whichever BookmarkStore matches signedIn (local storage when
 * anonymous, textbase-server when signed in - see identity.ts's
 * bookmarkStoreFor/getMyBooksShelf, the consumer of this data). Tracked
 * for anonymous readers too, deliberately: whether a reader "really read"
 * something must work before they ever sign in.
 *
 * Deliberately opus-level, not per-chapter: turning pages within the same
 * work doesn't reset or re-flush the accumulator.
 */
export function useReadingAttention(workId: string, signedIn: boolean): void {
  const secondsRef = useRef(0);
  const lastTickRef = useRef<number | null>(null);

  useEffect(() => {
    const store = bookmarkStoreFor(signedIn);

    const tick = () => {
      const now = Date.now();
      if (lastTickRef.current != null) {
        secondsRef.current += (now - lastTickRef.current) / 1000;
      }
      lastTickRef.current = document.visibilityState === 'visible' ? now : null;
    };

    const flush = () => {
      tick();
      const whole = Math.floor(secondsRef.current);
      if (whole > 0) {
        secondsRef.current -= whole;
        void store.addAttention(workId, whole);
      }
    };

    lastTickRef.current = document.visibilityState === 'visible' ? Date.now() : null;
    const interval = setInterval(flush, HEARTBEAT_MS);
    document.addEventListener('visibilitychange', tick);
    window.addEventListener('beforeunload', flush);

    return () => {
      flush();
      clearInterval(interval);
      document.removeEventListener('visibilitychange', tick);
      window.removeEventListener('beforeunload', flush);
    };
  }, [workId, signedIn]);
}
