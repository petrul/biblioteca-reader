import { useEffect, useState } from 'react';
import { readerService } from '../services/readerService';
import { appAsset, SERVER_ERROR_EVENT } from '../services/serversideApi';

// Bottom-right connection toast. With no offline fallback data anymore,
// an unreachable textbase-server renders exactly like an empty library -
// this is the only visible signal that the server is down, with a retry
// that checks server status without downloading author/work pages. Sits above the
// mobile bottom nav on small screens.
export function ServerStatusToast() {
  const [down, setDown] = useState(readerService.isServerDown());
  const [serverError, setServerError] = useState<number | null>(null);
  const [retrying, setRetrying] = useState(false);

  useEffect(() => readerService.subscribe(() => {
    setDown(readerService.isServerDown());
  }), []);

  useEffect(() => {
    const handleServerError = (event: Event) => {
      const status = (event as CustomEvent<number>).detail;
      if (status >= 500) setServerError(status);
    };
    window.addEventListener(SERVER_ERROR_EVENT, handleServerError);
    return () => window.removeEventListener(SERVER_ERROR_EVENT, handleServerError);
  }, []);

  if (!down && serverError === null) return null;

  const retry = async () => {
    if (retrying) return;
    setRetrying(true);
    try {
      await readerService.retryServerConnection();
      if (!readerService.isServerDown()) setServerError(null);
    } finally {
      setRetrying(false);
    }
  };

  return (
    <div
      id="server-status-toast"
      role="alert"
      className="fixed bottom-20 right-4 lg:bottom-6 lg:right-6 z-50 max-w-sm rounded-xl border border-white/15 bg-black/65 backdrop-blur-lg p-3 text-xs flex items-center gap-3 shadow-2xl animate-in fade-in"
    >
      <img src={appAsset('500.jpeg')} alt="Server error (5xx)" className="h-16 w-16 shrink-0 rounded-lg object-cover" />
      <div className="min-w-0">
        <span className="block font-mono font-bold uppercase tracking-wider text-white/90">
          {serverError === null ? 'Server down' : `Server error (${serverError})`}
        </span>
        <button
          type="button"
          onClick={retry}
          disabled={retrying}
          className="mt-2 px-2.5 py-1 rounded-lg border border-white/20 bg-white/10 hover:bg-white/20 disabled:opacity-60 font-mono font-bold uppercase tracking-wider text-white/85 transition-colors cursor-pointer"
        >
          {retrying ? 'Retrying…' : 'Retry'}
        </button>
      </div>
    </div>
  );
}
