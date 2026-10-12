import React, { useEffect, useState } from 'react';
import { ImagePlus, Loader2 } from 'lucide-react';

type CoverWork = { coverUrl?: string; request: Record<string, unknown> | null };

/**
 * Admin-only, at the bottom of a work card's back face: shows the request
 * JSON the work's current cover was rendered from, and renders a new random
 * cover synchronously (POST /api/admin/covers/work - same-origin, gated
 * server-side to administrators, proxied to biblioteca-nestjs).
 */
export function AdminCoverSection({ workId, onCoverChanged }: { workId: string; onCoverChanged?: (coverUrl: string) => void }) {
  const [current, setCurrent] = useState<CoverWork | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setCurrent(null);
    setError('');
    fetch(`/api/admin/covers/work/request?path=${encodeURIComponent(workId)}`, { headers: { Accept: 'application/json' } })
      .then(async res => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body?.error || body?.message || `HTTP ${res.status}`);
        if (!cancelled) setCurrent(body as CoverWork);
      })
      .catch(e => { if (!cancelled) setError(`Could not load the cover request: ${e.message}`); });
    return () => { cancelled = true; };
  }, [workId]);

  const generate = async () => {
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/admin/covers/work', {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: workId }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || body?.message || `HTTP ${res.status}`);
      setCurrent(body as CoverWork);
      if (body.coverUrl) onCoverChanged?.(body.coverUrl);
    } catch (e: any) {
      setError(`Cover generation failed: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section data-testid="admin-cover-section" aria-label="Cover (administrators)"
      className="mt-6 pt-4 border-t border-amber-400/30 space-y-3 text-left">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-xs font-bold uppercase tracking-wider text-amber-300">Cover · admin</h3>
        <button
          id="btn-admin-generate-cover"
          type="button"
          onClick={generate}
          disabled={busy}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#f59e0b] hover:bg-amber-400 disabled:opacity-60 text-black text-xs font-bold cursor-pointer disabled:cursor-wait"
        >
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ImagePlus className="w-3.5 h-3.5" />}
          {busy ? 'Rendering…' : 'Generate a new cover'}
        </button>
      </div>
      {current?.coverUrl && (
        <img src={current.coverUrl} alt="Current cover" referrerPolicy="no-referrer"
          className="h-40 rounded border border-emerald-500/20 object-contain bg-black/20" />
      )}
      {current && (current.request
        ? <pre data-testid="admin-cover-request"
            className="max-h-64 overflow-auto rounded-lg bg-black/40 p-3 text-[11px] leading-snug text-emerald-100 font-mono whitespace-pre-wrap break-all">{JSON.stringify(current.request, null, 2)}</pre>
        : <p className="text-xs text-emerald-200/70">
            {current.coverUrl
              ? 'This cover was rendered before cover requests were recorded - no JSON stored for it.'
              : 'No cover yet.'}
          </p>)}
      {!current && !error && <p className="text-xs text-emerald-200/60">Loading the cover request…</p>}
      {error && <p role="alert" className="text-xs text-red-300">{error}</p>}
    </section>
  );
}
