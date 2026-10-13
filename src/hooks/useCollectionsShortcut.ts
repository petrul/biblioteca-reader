import { useEffect } from 'react';
import { isTypingBurst, noteLetterKey } from '../services/typingBurst';

/**
 * A bare `s` (no modifiers, nothing editable focused, no modal already open,
 * not in the middle of typing a word - the shared typing-burst guard) calls
 * onTrigger. Shift+S
 * is left alone: it belongs to the reader's display preferences.
 *
 * Registered in the capture phase: the reader's own letter handlers note
 * every letter they see, which would otherwise make this one read the very
 * same keypress as "typing" whenever they ran first.
 */
export function useCollectionsShortcut(onTrigger: () => void, enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key !== 's' || event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.matches('input, textarea, select, [contenteditable="true"]')) return;
      if (document.querySelector('[aria-modal="true"]')) return;
      if (isTypingBurst()) return;
      noteLetterKey();
      event.preventDefault();
      onTrigger();
    };
    window.addEventListener('keydown', handleKey, true);
    return () => window.removeEventListener('keydown', handleKey, true);
  }, [onTrigger, enabled]);
}
