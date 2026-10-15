import React, { useEffect, useState } from 'react';
import { Check, Copy, ImagePlus, Loader2, Shuffle } from 'lucide-react';
import { trackedFetch } from '../services/serversideApi';
import { coverThumbnailUrl } from '../services/coverThumbnail';
import { copyToClipboard } from '../services/clipboard';

type CoverWork = { coverUrl?: string; request: Record<string, unknown> | null };

/**
 * Admin-only, at the bottom of a work card's back face: shows the request
 * JSON the work's current cover was rendered from (editable - "Generate
 * cover" renders from exactly what is in the box), rolls a fresh random
 * JSON without rendering ("New random JSON"), and renders a new cover
 * synchronously (POST /api/admin/covers/work - same-origin, gated
 * server-side to administrators, proxied to biblioteca-nestjs).
 */
export function AdminCoverSection({ workId, onCoverChanged, onOpenCover }: {
  workId: string;
  onCoverChanged?: (coverUrl: string) => void;
  /** Tapping the cover: show it full screen (the work card's own lightbox). */
  onOpenCover?: (coverUrl: string) => void;
}) {
  const [current, setCurrent] = useState<CoverWork | null>(null);
  // The editable JSON text - initialized from the stored request, replaced
  // wholesale by "New random JSON" and by a finished render.
  const [jsonText, setJsonText] = useState('');
  const [rendering, setRendering] = useState(false);
  const [rolling, setRolling] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setCurrent(null);
    setJsonText('');
    setError('');
    trackedFetch(`/api/admin/covers/work/request?path=${encodeURIComponent(workId)}`, { headers: { Accept: 'application/json' } })
      .then(async res => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body?.error || body?.message || `HTTP ${res.status}`);
        if (cancelled) return;
        setCurrent(body as CoverWork);
        if (body.request) setJsonText(JSON.stringify(body.request, null, 2));
      })
      .catch(e => { if (!cancelled) setError(`Could not load the cover request: ${e.message}`); });
    return () => { cancelled = true; };
  }, [workId]);

  const newRandomJson = async () => {
    setRolling(true);
    setError('');
    try {
      const res = await trackedFetch(`/api/admin/covers/work/request/random?path=${encodeURIComponent(workId)}`, { headers: { Accept: 'application/json' } });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || body?.message || `HTTP ${res.status}`);
      if (body.request) setJsonText(JSON.stringify(body.request, null, 2));
    } catch (e: any) {
      setError(`Could not roll a random JSON: ${e.message}`);
    } finally {
      setRolling(false);
    }
  };

  const generate = async () => {
    let request: unknown;
    try {
      request = JSON.parse(jsonText);
    } catch {
      setError('The JSON is not valid - fix it before generating.');
      return;
    }
    setRendering(true);
    setError('');
    try {
      const res = await trackedFetch('/api/admin/covers/work', {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: workId, request }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || body?.message || `HTTP ${res.status}`);
      setCurrent(body as CoverWork);
      if (body.request) setJsonText(JSON.stringify(body.request, null, 2));
      if (body.coverUrl) onCoverChanged?.(body.coverUrl);
    } catch (e: any) {
      setError(`Cover generation failed: ${e.message}`);
    } finally {
      setRendering(false);
    }
  };

  const copy = async () => {
    if (await copyToClipboard(jsonText)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  const busy = rendering || rolling;

  return (
    <section data-testid="admin-cover-section" aria-label="Cover (administrators)"
      className="mt-6 pt-4 border-t border-amber-400/30 space-y-3 text-left">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h3 className="text-xs font-bold uppercase tracking-wider text-amber-300">Cover · admin</h3>
        <div className="flex items-center gap-2">
          <button
            id="btn-admin-new-random-json"
            type="button"
            onClick={() => void newRandomJson()}
            disabled={busy}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#0f3d30] hover:bg-emerald-700/50 disabled:opacity-60 text-emerald-100 text-xs font-bold border border-emerald-500/30 cursor-pointer disabled:cursor-wait"
          >
            {rolling ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Shuffle className="w-3.5 h-3.5" />}
            {rolling ? 'Rolling…' : 'New random JSON'}
          </button>
          <button
            id="btn-admin-generate-cover"
            type="button"
            onClick={() => void generate()}
            disabled={busy || !jsonText.trim()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#f59e0b] hover:bg-amber-400 disabled:opacity-60 text-black text-xs font-bold cursor-pointer disabled:cursor-wait"
          >
            {rendering ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ImagePlus className="w-3.5 h-3.5" />}
            {rendering ? 'Rendering…' : 'Generate cover'}
          </button>
        </div>
      </div>
      {/* The cover on the left, its request JSON on the right (stacked on
          narrow screens). */}
      <div className={`grid gap-3 items-start ${current?.coverUrl ? 'sm:grid-cols-[minmax(0,13rem)_minmax(0,1fr)]' : ''}`}>
        {current?.coverUrl && (
          <button
            type="button"
            data-testid="admin-cover-open"
            onClick={() => onOpenCover?.(current.coverUrl!)}
            disabled={!onOpenCover}
            title="View cover full screen"
            aria-label="View the cover full screen"
            className="block w-full max-w-[13rem] rounded border border-emerald-500/20 bg-black/20 cursor-zoom-in hover:border-amber-400/60 transition-colors disabled:cursor-default"
          >
            <img src={coverThumbnailUrl(current.coverUrl)} alt="Current cover" referrerPolicy="no-referrer"
              data-testid="admin-cover-image"
              className="w-full rounded object-contain" />
          </button>
        )}
        {jsonText ? (
          <div className="relative min-w-0">
            <textarea
              data-testid="admin-cover-request"
              aria-label="Cover request JSON (editable)"
              value={jsonText}
              onChange={e => setJsonText(e.target.value)}
              spellCheck={false}
              rows={Math.min(24, Math.max(8, jsonText.split('\n').length + 1))}
              className="w-full max-h-96 overflow-auto rounded-lg bg-black/40 p-3 pr-10 text-[11px] leading-snug text-emerald-100 font-mono whitespace-pre break-all focus:outline-none focus:ring-1 focus:ring-amber-500/60 resize-y"
            />
            <button
              id="btn-admin-copy-cover-request"
              type="button"
              onClick={() => void copy()}
              title={copied ? 'Copied!' : 'Copy the JSON'}
              aria-label="Copy the cover request JSON"
              className="absolute top-2 right-2 p-1.5 rounded-md text-emerald-200/70 hover:text-white hover:bg-black/30 transition-colors cursor-pointer"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-300" /> : <Copy className="w-3.5 h-3.5" />}
            </button>
          </div>
        ) : current ? (
          <p className="text-xs text-emerald-200/70">
            {current.coverUrl
              ? 'This cover was rendered before cover requests were recorded - no JSON stored for it. Roll a new random one.'
              : 'No cover yet.'}
          </p>
        ) : null}
      </div>
      {!current && !error && <p className="text-xs text-emerald-200/60">Loading the cover request…</p>}
      {error && <p role="alert" className="text-xs text-red-300">{error}</p>}
    </section>
  );
}
