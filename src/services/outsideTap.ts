// Close a popup when the user taps or clicks anywhere outside it - used by the
// chat box's theme picker (outsideTap.test.ts pins the rule). A pointer-down
// inside any of `inside()` (the popup itself, and the button that toggles it,
// which handles its own click) is left alone; anywhere else calls onOutside.
// Pointer-down rather than click, so it also closes before a scroll or drag
// that never becomes a click; capture phase, so a child stopping the event
// cannot keep the popup open.

export function onPointerDownOutside(
  target: Document,
  inside: () => Array<Element | null | undefined>,
  onOutside: () => void,
): () => void {
  const listener = (event: Event) => {
    const node = event.target as Node | null;
    if (node && inside().some(element => element?.contains(node))) return;
    onOutside();
  };
  target.addEventListener('pointerdown', listener, true);
  return () => target.removeEventListener('pointerdown', listener, true);
}
