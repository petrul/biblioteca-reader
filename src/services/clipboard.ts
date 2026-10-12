// Clipboard copy that works on the LAN deployment too: navigator.clipboard
// exists ONLY in secure contexts (https:, localhost) - on the plain-http
// LAN origin (http://192.168.x.x:3333) it is undefined and every direct
// call dies silently. The legacy execCommand path needs no secure context,
// so: try the modern API first, fall back to a temporary textarea.
// Returns whether anything was actually copied - callers flip their
// "copied" indicator on it instead of assuming success.

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Permission denied or the write failed - fall through to the legacy
    // path rather than reporting a copy that did not happen.
  }
  try {
    const scratch = document.createElement('textarea');
    scratch.value = text;
    // Off-screen but focusable/selectable: fixed + opacity 0, never
    // display:none (unselectable).
    scratch.style.position = 'fixed';
    scratch.style.opacity = '0';
    document.body.appendChild(scratch);
    scratch.focus();
    scratch.select();
    const copied = document.execCommand('copy');
    document.body.removeChild(scratch);
    return copied;
  } catch {
    return false;
  }
}
