import { ReactNode, useEffect, useState } from 'react';
import { Search, Sparkles, Loader2, CheckCircle2, WifiOff, Pause, Play } from 'lucide-react';
import { fetchLuceneRebuildStatus, fetchVectorizingStatus, postVectorizingAction } from '../services/serversideApi';

// Real, live progress for the two background pipelines biblioteca-server /
// biblioteca-nestjs run on their own: the Lucene full-text rebuild
// (GET /api/lucene/status, see LuceneIndexService.rebuildStatus()) and
// nestjs's vector-store ingestion (GET /api/vectorizing, nestjs's own
// existing status endpoint - no server changes needed on that side).
// Polls both every 3s via serversideApi's typed wrappers; an API failure
// degrades that one bar to an "unreachable" state instead of breaking the
// whole card.

interface LuceneStatus {
  indexExists: boolean;
  running: boolean;
  startedAtMillis: number;
  totalOpera: number;
  processedOpera: number;
  indexedDocs: number;
}

interface VectorizingStatus {
  running: boolean;
  totalOpera: number;
  completedOpera: number;
  processedParas: number;
  startedAt: number | null;
  updatedAt: number | null;
  finishedAt: number | null;
  state: 'idle' | 'running' | 'pausing' | 'paused' | 'finished';
  canResume?: boolean;
}

const POLL_MS = 3000;

function formatElapsed(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const totalSeconds = Math.floor(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function formatRate(count: number, elapsedMs: number, unit: string): string {
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return `— ${unit}`;
  const perSecond = count / (elapsedMs / 1000);
  return `${perSecond.toFixed(1)} ${unit}`;
}

type BarTone = 'done' | 'active' | 'idle' | 'offline';

function toneClasses(tone: BarTone): { bar: string; text: string; dot: string } {
  switch (tone) {
    case 'done':
      return { bar: 'bg-emerald-500', text: 'text-emerald-300', dot: 'bg-emerald-400' };
    case 'active':
      return { bar: 'bg-sky-500', text: 'text-sky-300', dot: 'bg-sky-400 animate-pulse' };
    case 'offline':
      return { bar: 'bg-red-500/60', text: 'text-red-300', dot: 'bg-red-400' };
    default:
      return { bar: 'bg-stone-500', text: 'text-stone-300', dot: 'bg-stone-400' };
  }
}

function ProgressBar({
  label,
  icon,
  tone,
  percent,
  indeterminate,
  stats,
}: {
  label: string;
  icon: ReactNode;
  tone: BarTone;
  percent: number;
  indeterminate?: boolean;
  stats: string;
}) {
  const c = toneClasses(tone);
  const clamped = Math.max(0, Math.min(100, percent));
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-1.5">
          <span className={`w-2 h-2 rounded-full shrink-0 ${c.dot}`} />
          {icon}
          <span className="text-xs font-semibold text-white">{label}</span>
        </div>
        <span className={`text-[11px] font-mono ${c.text}`}>
          {tone === 'offline' ? 'unreachable' : indeterminate ? 'in progress' : `${clamped.toFixed(0)}%`}
        </span>
      </div>
      <div className="h-2.5 w-full rounded-full bg-black/30 overflow-hidden">
        {indeterminate ? (
          <div
            className={`h-full w-1/3 rounded-full ${c.bar} animate-[pulse_1.4s_ease-in-out_infinite]`}
            style={{ animationName: 'indexing-indeterminate' }}
          />
        ) : (
          <div
            className={`h-full rounded-full ${c.bar} transition-[width] duration-500 ease-out`}
            style={{ width: `${clamped}%` }}
          />
        )}
      </div>
      <div className="text-[11px] font-mono text-emerald-200/60">{stats}</div>
    </div>
  );
}

export function IndexingProgressCard() {
  const [lucene, setLucene] = useState<LuceneStatus | 'offline' | null>(null);
  const [vectorizing, setVectorizing] = useState<VectorizingStatus | 'offline' | null>(null);
  const [now, setNow] = useState(Date.now());
  const [pendingAction, setPendingAction] = useState<'pause' | 'resume' | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const pollVectorizing = async () => {
    try {
      const data = await fetchVectorizingStatus() as VectorizingStatus;
      setVectorizing(data);
    } catch {
      setVectorizing('offline');
    }
  };

  useEffect(() => {
    let cancelled = false;

    const pollLucene = async () => {
      try {
        const data = await fetchLuceneRebuildStatus() as LuceneStatus;
        if (!cancelled) setLucene(data);
      } catch {
        if (!cancelled) setLucene('offline');
      }
    };

    const pollBoth = () => {
      pollLucene();
      if (!cancelled) pollVectorizing();
    };

    pollBoth();
    const dataTimer = setInterval(pollBoth, POLL_MS);
    const clockTimer = setInterval(() => setNow(Date.now()), 1000);

    return () => {
      cancelled = true;
      clearInterval(dataTimer);
      clearInterval(clockTimer);
    };
  }, []);

  // The reader's own /vz/* proxy responds as soon as it has kicked the
  // upstream POST off (fire-and-forget) - nestjs's own start/resume don't
  // resolve until the whole run finishes (hours), so this returns quickly
  // either way. A short delay before re-polling gives nestjs a moment to
  // flip running/state before the next regular poll would.
  const sendAction = async (action: 'pause' | 'resume') => {
    setPendingAction(action);
    setActionError(null);
    try {
      await postVectorizingAction(action);
      setTimeout(pollVectorizing, 800);
    } catch (err: any) {
      setActionError(`Failed to ${action}: ${err?.message ?? 'unknown error'}`);
    } finally {
      setPendingAction(null);
    }
  };

  const luceneOffline = lucene === 'offline';
  const l = luceneOffline || lucene === null ? null : lucene;
  const luceneElapsed = l && l.startedAtMillis > 0 ? now - l.startedAtMillis : 0;
  const luceneDone = !!l && !l.running && l.indexExists && (l.totalOpera === 0 || l.processedOpera >= l.totalOpera);
  const lucenePercent = l && l.totalOpera > 0 ? (l.processedOpera / l.totalOpera) * 100 : 0;
  const luceneTone: BarTone = luceneOffline ? 'offline' : !l ? 'idle' : luceneDone ? 'done' : l.running ? 'active' : 'idle';

  const vectorizingOffline = vectorizing === 'offline';
  const v = vectorizingOffline || vectorizing === null ? null : vectorizing;
  const vEnd = v?.finishedAt ?? now;
  const vElapsed = v?.startedAt ? vEnd - v.startedAt : 0;
  const vOperaPercent = v && v.totalOpera > 0 ? (v.completedOpera / v.totalOpera) * 100 : 0;
  const vOperaTone: BarTone = vectorizingOffline ? 'offline' : !v ? 'idle' : v.state === 'finished' ? 'done' : v.running ? 'active' : 'idle';
  const vParasTone: BarTone = vectorizingOffline ? 'offline' : !v ? 'idle' : v.state === 'finished' ? 'done' : v.running ? 'active' : 'idle';

  return (
    <div className="bg-[#0b2921]/90 rounded-2xl border border-emerald-500/20 p-6 shadow-xl space-y-5">
      <style>{`
        @keyframes indexing-indeterminate {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(300%); }
        }
      `}</style>
      <div className="flex items-center justify-between border-b border-emerald-500/15 pb-3">
        <div className="flex items-center space-x-2">
          <Sparkles className="w-4 h-4 text-[#f59e0b]" />
          <h2 className="font-display-title text-lg font-bold text-white">Overnight Indexing Progress</h2>
        </div>
        <div className="flex items-center space-x-3">
          {(luceneOffline || vectorizingOffline) && (
            <span className="flex items-center space-x-1 text-[11px] text-red-300">
              <WifiOff className="w-3.5 h-3.5" />
              <span>one or more services unreachable</span>
            </span>
          )}
          {!vectorizingOffline && v?.running && (
            <button
              onClick={() => sendAction('pause')}
              disabled={pendingAction !== null}
              className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 disabled:opacity-50 disabled:cursor-not-allowed border border-amber-500/30 text-[11px] font-semibold text-amber-300 transition-colors cursor-pointer"
            >
              <Pause className="w-3.5 h-3.5" />
              <span>{pendingAction === 'pause' ? 'Pausing…' : 'Pause Vectorizing'}</span>
            </button>
          )}
          {!vectorizingOffline && !v?.running && v?.state === 'paused' && v?.canResume && (
            <button
              onClick={() => sendAction('resume')}
              disabled={pendingAction !== null}
              className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 disabled:opacity-50 disabled:cursor-not-allowed border border-emerald-500/30 text-[11px] font-semibold text-emerald-300 transition-colors cursor-pointer"
            >
              <Play className="w-3.5 h-3.5" />
              <span>{pendingAction === 'resume' ? 'Resuming…' : 'Resume Vectorizing'}</span>
            </button>
          )}
        </div>
      </div>
      {actionError && (
        <div className="text-[11px] font-mono text-red-300 -mt-3">{actionError}</div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <ProgressBar
          label="Lucene Full-Text Index"
          icon={<Search className="w-3.5 h-3.5 text-emerald-300/70" />}
          tone={luceneTone}
          percent={lucenePercent}
          stats={
            luceneOffline
              ? 'biblioteca-server unreachable'
              : !l
              ? 'loading…'
              : `${l.processedOpera.toLocaleString()} / ${l.totalOpera.toLocaleString()} opera · ${l.indexedDocs.toLocaleString()} docs · ${formatElapsed(
                  luceneElapsed
                )} · ${formatRate(l.indexedDocs, luceneElapsed, 'docs/s')}`
          }
        />

        <ProgressBar
          label="Vectorizing: Opera"
          icon={<Loader2 className="w-3.5 h-3.5 text-emerald-300/70" />}
          tone={vOperaTone}
          percent={vOperaPercent}
          stats={
            vectorizingOffline
              ? 'biblioteca-nestjs unreachable'
              : !v
              ? 'loading…'
              : `${v.completedOpera.toLocaleString()} / ${v.totalOpera.toLocaleString()} opera · ${formatElapsed(vElapsed)} · ${formatRate(
                  v.completedOpera,
                  vElapsed,
                  'opera/s'
                )} · ${v.state}`
          }
        />

        <ProgressBar
          label="Vectorizing: Paragraphs"
          icon={<CheckCircle2 className="w-3.5 h-3.5 text-emerald-300/70" />}
          tone={vParasTone}
          percent={vOperaPercent}
          indeterminate={!vectorizingOffline && !!v && v.running}
          stats={
            vectorizingOffline
              ? 'biblioteca-nestjs unreachable'
              : !v
              ? 'loading…'
              : `${v.processedParas.toLocaleString()} paragraphs embedded · ${formatElapsed(vElapsed)} · ${formatRate(
                  v.processedParas,
                  vElapsed,
                  'paras/s'
                )}`
          }
        />
      </div>
    </div>
  );
}
