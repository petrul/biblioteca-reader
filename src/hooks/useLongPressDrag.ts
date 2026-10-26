import { useEffect, useRef, useState } from 'react';

export interface LongPressDragOffset {
  dx: number;
  dy: number;
}

interface LongPressDragOptions {
  /** Element id(s) of the drop target(s); releasing inside any of their
      rects fires onDropTarget, anywhere else fires onDropOutside. Several
      ids let one gesture target whichever bar the viewport actually shows
      (e.g. the bottom nav on mobile, the navbar on desktop). */
  targetId: string | string[];
  onDropTarget?: () => void;
  onDropOutside?: () => void;
  /** Fires only when the drag activates/ends or the pointer crosses the
      target boundary - never per move - so callers can keep state cheap. */
  onDragActiveChange?: (active: boolean, overTarget: boolean) => void;
  /** False disables the gesture entirely (e.g. the chat panel is open). */
  enabled?: boolean;
  longPressMs?: number;
  moveTolerancePx?: number;
}

/**
 * Long-press-and-drag: press and hold still for `longPressMs` to grab the
 * element, then it tracks the pointer 1:1 (`offset`, apply as a transform;
 * skip the CSS transition while dragging so there is no lag). Releasing
 * inside the target element's rect fires onDropTarget, elsewhere
 * onDropOutside (for a snap-back). A press released before the threshold,
 * or a grab that never moved past `moveTolerancePx`, stays a plain tap -
 * `justDragged()` lets the host's onClick tell the two gestures apart.
 *
 * Window-level listeners (attached at pointerdown) keep tracking when the
 * pointer leaves the element, with no reliance on setPointerCapture. The
 * host element should carry `touch-none select-none` and an
 * onContextMenu preventDefault, so a long press on touch devices does not
 * scroll the page, select text, or pop the context menu.
 */
export function useLongPressDrag({
  targetId,
  onDropTarget,
  onDropOutside,
  onDragActiveChange,
  enabled = true,
  longPressMs = 450,
  moveTolerancePx = 10,
}: LongPressDragOptions) {
  const [dragging, setDragging] = useState(false);
  const [offset, setOffset] = useState<LongPressDragOffset | null>(null);
  const [overTarget, setOverTarget] = useState(false);
  /** Viewport point where the press began - anchors a drag ghost. */
  const [origin, setOrigin] = useState<{ x: number; y: number } | null>(null);

  const callbacks = useRef({ onDropTarget, onDropOutside, onDragActiveChange });
  callbacks.current = { onDropTarget, onDropOutside, onDragActiveChange };

  const start = useRef<{ x: number; y: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draggingRef = useRef(false);
  const overRef = useRef(false);
  const movedFar = useRef(false);
  const lastGestureWasDrag = useRef(false);
  const listenersAttached = useRef(false);

  const report = (active: boolean, over: boolean) => callbacks.current.onDragActiveChange?.(active, over);

  const isOverTarget = (x: number, y: number) =>
    (Array.isArray(targetId) ? targetId : [targetId]).some(id => {
      const rect = document.getElementById(id)?.getBoundingClientRect();
      // A display:none target (a bar for another breakpoint) has a zero
      // rect and can never be hit.
      return !!rect && rect.width > 0 && rect.height > 0 && x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
    });

  const onMove = (event: PointerEvent) => {
    if (!start.current) return;
    const dx = event.clientX - start.current.x;
    const dy = event.clientY - start.current.y;
    if (!draggingRef.current) {
      // A real move before the threshold means this press is not a grab.
      if (Math.hypot(dx, dy) > moveTolerancePx) cancelPress();
      return;
    }
    if (Math.hypot(dx, dy) > moveTolerancePx) movedFar.current = true;
    const over = isOverTarget(event.clientX, event.clientY);
    if (over !== overRef.current) {
      overRef.current = over;
      setOverTarget(over);
      report(true, over);
    }
    setOffset({ dx, dy });
  };

  const finish = (commit: boolean) => {
    const wasDragging = draggingRef.current;
    cancelPress();
    if (!wasDragging) return;
    draggingRef.current = false;
    setDragging(false);
    setOffset(null);
    setOrigin(null);
    setOverTarget(false);
    report(false, false);
    if (!commit) return;
    // A grab that never travelled is a tap that over-held - no drop, and
    // the click must go through as usual.
    if (!movedFar.current) {
      lastGestureWasDrag.current = false;
      return;
    }
    const { onDropTarget: hit, onDropOutside: miss } = callbacks.current;
    // overRef tracks the rect live in onMove, so this never reads a stale
    // React state closure at release time.
    if (overRef.current) hit?.(); else miss?.();
    overRef.current = false;
  };

  const onUp = () => finish(true);
  const onCancel = () => finish(false);

  const detach = () => {
    if (!listenersAttached.current) return;
    listenersAttached.current = false;
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onCancel);
  };

  const cancelPress = () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    start.current = null;
    detach();
  };

  const onPointerDown = (event: React.PointerEvent) => {
    if (!enabled || start.current) return; // one pointer at a time
    event.preventDefault(); // no text selection / native image drag
    lastGestureWasDrag.current = false;
    movedFar.current = false;
    start.current = { x: event.clientX, y: event.clientY };
    if (!listenersAttached.current) {
      listenersAttached.current = true;
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onCancel);
    }
    timer.current = setTimeout(() => {
      timer.current = null;
      draggingRef.current = true;
      lastGestureWasDrag.current = true;
      const over = start.current ? isOverTarget(start.current.x, start.current.y) : false;
      overRef.current = over;
      setDragging(true);
      setOffset({ dx: 0, dy: 0 });
      setOrigin(start.current ? { x: start.current.x, y: start.current.y } : null);
      setOverTarget(over);
      report(true, over);
    }, longPressMs);
  };

  // Dropping everything if the host unmounts mid-gesture.
  useEffect(() => () => {
    cancelPress();
    draggingRef.current = false;
  }, []);

  return {
    dragging,
    offset,
    origin,
    overTarget,
    /** True from the moment a grab activates until the next pointerdown -
        the host's click handler must skip toggles when this is set. */
    justDragged: () => lastGestureWasDrag.current,
    onPointerDown,
  };
}
