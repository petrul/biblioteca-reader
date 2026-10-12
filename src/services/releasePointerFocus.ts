// After a mouse or touch click on a button or link, give the focus back to
// the page. Otherwise the clicked control keeps it: Chrome then draws its
// focus ring around it (once the arrow keys have been used, every later click
// shows one), and Space/Enter keep re-pressing that control instead of
// reaching the page. Keyboard activation is left alone - a click triggered by
// Enter/Space has event.detail === 0, a pointer click has detail >= 1 - so
// Tab navigation keeps its focus and ring.
export function releasePointerFocus(event: MouseEvent): void {
  if (event.detail === 0) return;
  const target = event.target as Element | null;
  const control = target?.closest?.('button, a[href], [role="button"]') as HTMLElement | null;
  if (control && control === document.activeElement) control.blur();
}

export function installReleasePointerFocus(doc: Document = document): () => void {
  // Bubble phase: after the control's own handlers, so focus a handler
  // moved on purpose (a dialog's input) is left where it went.
  doc.addEventListener('click', releasePointerFocus);
  return () => doc.removeEventListener('click', releasePointerFocus);
}
