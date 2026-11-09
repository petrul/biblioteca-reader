import { useEffect } from 'react';

/**
 * "The URL changed": shown once when the reader landed on a division's new
 * address because a TEI reimport moved it (biblioteca-server's Relocation) -
 * the old link, favourite or bookmark still works, but the address bar now
 * shows the one to keep. Hides itself after a few seconds.
 */
export function RelocationToast({ oldPath, onDone }: { oldPath: string; onDone: () => void }) {
  useEffect(() => {
    const timer = window.setTimeout(onDone, 6000);
    return () => window.clearTimeout(timer);
  }, [oldPath, onDone]);
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="relocation-toast"
      className="fixed bottom-20 left-1/2 -translate-x-1/2 lg:bottom-6 z-50 max-w-sm rounded-xl border border-white/15 bg-black/65 backdrop-blur-lg p-3 text-xs shadow-2xl animate-in fade-in"
    >
      <span className="block font-mono font-bold uppercase tracking-wider text-white/90">URL changed</span>
      <span className="block text-white/70">This text moved to a new address after a catalogue update - the one shown above is the one to keep.</span>
    </div>
  );
}

/** The cookie the reader's server sets on its 301 from an old address (see relocationRedirect.ts). */
export const RELOCATED_COOKIE = 'biblioteca_relocated';

/** The old path a server-side relocation redirect came from, read once and cleared. */
export function takeRelocatedCookie(): string | null {
  const entry = document.cookie.split('; ').find(c => c.startsWith(RELOCATED_COOKIE + '='));
  if (!entry) return null;
  document.cookie = `${RELOCATED_COOKIE}=; Max-Age=0; path=/`;
  try {
    return decodeURIComponent(entry.slice(RELOCATED_COOKIE.length + 1)) || null;
  } catch {
    return null;
  }
}
