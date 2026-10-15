import { useEffect, useRef } from 'react';
import { bookmarkStoreFor } from '../services/identity';
import { AttentionMeter } from '../services/attentionMeter';

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
  const meterRef = useRef<AttentionMeter | null>(null);

  useEffect(() => {
    const store = bookmarkStoreFor(signedIn);
    const meter = (meterRef.current ??= new AttentionMeter());

    const tick = () => meter.tick();

    const flush = () => {
      const whole = meter.takeWholeSeconds();
      if (whole > 0) void store.addAttention(workId, whole);
    };

    meter.start();
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
