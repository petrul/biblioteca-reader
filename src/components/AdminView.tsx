import React, { useState, useEffect } from 'react';
import { 
  ShieldCheck, 
  Server, 
  RefreshCw, 
  GitBranch, 
  Database, 
  Sparkles, 
  AlertOctagon, 
  CheckCircle2, 
  AlertTriangle, 
  Clock, 
  FileText, 
  Terminal,
  Activity,
  Layers,
  FileCode,
  ExternalLink
} from 'lucide-react';
import { AdminStatus } from '../types/textbase';
import { readerService } from '../services/readerService';
import { IndexingProgressCard } from './IndexingProgressCard';

export const AdminView: React.FC = () => {
  const [adminStatus, setAdminStatus] = useState<AdminStatus>(() => readerService.getAdminStatus());
  const [selectedRepoId, setSelectedRepoId] = useState<string>('perseus-latin-lit');
  const [singleFilePath, setSingleFilePath] = useState<string>('phi1017/phi013/phi1017.phi013.perseus-lat2.xml');
  const [isReindexing, setIsReindexing] = useState(false);
  const [reindexSuccess, setReindexSuccess] = useState(false);
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  // Force-Full Confirmation Modal
  const [showForceFullModal, setShowForceFullModal] = useState(false);

  const refreshStatus = () => {
    setAdminStatus(readerService.getAdminStatus());
  };

  // The vector card's "Simulate Disconnect / Reconnect Sidecar" toggle:
  // flip the service-side override, then re-read the assembled status so
  // the badge reflects it immediately (the live vectorizer job state
  // keeps arriving through fetchAdminStatus; the override wins over it
  // until toggled back).
  const handleToggleVector = () => {
    readerService.setVectorSearchAvailability(!adminStatus.vectorSearchStatus.available);
    readerService.fetchAdminStatus().then(setAdminStatus).catch(() => refreshStatus());
  };

  // Real status from the live services on mount (placeholder first) -
  // see readerService.fetchAdminStatus; whatever can't be fetched keeps
  // its placeholder value.
  useEffect(() => {
    readerService.fetchAdminStatus().then(setAdminStatus).catch(() => { /* keep placeholders */ });
  }, []);

  // Re-import handler
  const handleTriggerReimport = (mode: 'fresher-only' | 'full' | 'single-file' | 'force-full') => {
    const res = readerService.triggerReimport(
      mode, 
      selectedRepoId, 
      mode === 'single-file' ? singleFilePath : undefined
    );
    setActionNotice(res.message);
    refreshStatus();
    setShowForceFullModal(false);
    setTimeout(() => setActionNotice(null), 5000);
  };

  // Lucene Reindex Handler
  const handleLuceneReindex = async () => {
    setIsReindexing(true);
    setReindexSuccess(false);
    await readerService.triggerLuceneReindex();
    setIsReindexing(false);
    setReindexSuccess(true);
    refreshStatus();
    setTimeout(() => setReindexSuccess(false), 4000);
  };

  // No local admin gate here: App.tsx already decides whether this view
  // renders at all, on the REAL identity (whoAmI.isAdmin from the server's
  // ADMIN_USERS allow-list) - the old fabricated currentUser.role gate died
  // with the demo personas. The enforcement that matters is server-side
  // (/api/admin/** requires the same allow-list).

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-amber-500/10 border border-amber-500/30 text-[#f59e0b] text-xs font-mono font-semibold mb-2">
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>Administrator Control Deck</span>
          </div>
          <h1 className="font-display-title text-2xl sm:text-3xl font-bold text-white">
            Server Ingest & Indexing Operations
          </h1>
          <p className="text-xs sm:text-sm text-stone-400">
            Trigger textbase-server ingest pipelines to parse XML trees, validate TEI P5 schemas, and update database records.
          </p>
        </div>

        <button
          onClick={refreshStatus}
          className="flex items-center space-x-1.5 px-4 py-2 rounded-xl bg-[#0b2921] border border-emerald-500/20 hover:bg-[#0f3d30] text-xs font-medium text-emerald-200 transition-colors self-start cursor-pointer"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>Refresh Metrics</span>
        </button>
      </div>

      {/* Live indexing/vectorizing progress - real data, not a mock */}
      <IndexingProgressCard />

      {/* Action Notification Banner */}
      {actionNotice && (
        <div className="bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 p-4 rounded-xl text-xs font-mono flex items-center space-x-2 animate-in fade-in">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{actionNotice}</span>
        </div>
      )}

      {/* Flagged Dependency Security Callout (Per Spec) */}
      <div className="bg-amber-500/10 border-l-4 border-[#f59e0b] p-4 rounded-r-xl text-xs text-amber-200 space-y-1">
        <p className="font-bold flex items-center space-x-1.5 text-white">
          <AlertTriangle className="w-4 h-4 text-[#f59e0b]" />
          <span>Security Notice (Flagged Dependency):</span>
        </p>
        <p className="leading-relaxed text-amber-200/90">
          The server's <code className="bg-white/10 px-1 py-0.5 rounded text-[#f59e0b]">/admin/**</code> routes currently require only being signed in, not strictly validated for the <code className="bg-white/10 px-1 py-0.5 rounded text-[#f59e0b]">admin</code> role. Real enforcement requires a server-side RBAC middleware validation alongside this dashboard UI gate.
        </p>
      </div>

      {/* System Status Dashboard Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* 1. Version & Server Uptime */}
        <div className="bg-[#0b2921]/90 rounded-2xl border border-emerald-500/20 p-6 shadow-xl space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-300/60">Host Server</span>
            <Server className="w-4 h-4 text-[#f59e0b]" />
          </div>
          <h3 className="font-mono text-sm font-bold text-white">
            {adminStatus.serverVersion}
          </h3>
          <div className="text-xs font-mono text-emerald-200/70 space-y-1">
            <div className="flex justify-between">
              <span>Uptime:</span>
              <span className="font-semibold text-white">{adminStatus.uptime}</span>
            </div>
            <div className="flex justify-between">
              <span>Build:</span>
              <span className="text-emerald-300/60 truncate max-w-[150px]">{adminStatus.serverBuild}</span>
            </div>
            <div className="flex justify-between">
              <span>TEI Parser:</span>
              <span className="text-emerald-400 font-bold">{adminStatus.teiEngineStatus.parserVersion}</span>
            </div>
          </div>
        </div>

        {/* 2. Lucene Inverted Index Status */}
        <div className="bg-[#0b2921]/90 rounded-2xl border border-emerald-500/20 p-6 shadow-xl space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-300/60">Lucene 9.x Index</span>
            <Database className="w-4 h-4 text-[#f59e0b]" />
          </div>
          <div className="flex items-baseline justify-between">
            <h3 className="font-mono text-lg font-bold text-white">
              {adminStatus.luceneIndexStatus.docsIndexed.toLocaleString()} Docs
            </h3>
            <span className="text-[10px] font-mono text-emerald-400 font-bold bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
              INDEX HEALTHY
            </span>
          </div>
          <div className="text-xs font-mono text-emerald-200/70 space-y-1">
            <div className="flex justify-between">
              <span>Index Size:</span>
              <span className="text-white">{(adminStatus.luceneIndexStatus.indexSizeBytes / (1024 * 1024)).toFixed(1)} MB</span>
            </div>
            <div className="flex justify-between">
              <span>Last Rebuilt:</span>
              <span className="text-white">{new Date(adminStatus.luceneIndexStatus.lastRebuilt).toLocaleTimeString()}</span>
            </div>
          </div>
        </div>

        {/* 3. Vector Embedding Engine & Toggle */}
        <div className="bg-[#0b2921]/90 rounded-2xl border border-emerald-500/20 p-6 shadow-xl space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-300/60">Vector Search Sidecar</span>
            <Sparkles className="w-4 h-4 text-[#f59e0b]" />
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <span className={`w-2.5 h-2.5 rounded-full ${adminStatus.vectorSearchStatus.available ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'}`} />
              <span className="font-mono text-xs font-bold text-white">
                {adminStatus.vectorSearchStatus.available ? 'AVAILABLE (3072 dims)' : 'OFFLINE (DEGRADED)'}
              </span>
            </div>
            <button
              id="btn-admin-toggle-vector"
              onClick={handleToggleVector}
              className={`px-2.5 py-1 rounded text-[11px] font-semibold transition-colors cursor-pointer ${
                adminStatus.vectorSearchStatus.available
                  ? 'bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20'
                  : 'bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/20'
              }`}
            >
              {adminStatus.vectorSearchStatus.available ? 'Simulate Disconnect' : 'Reconnect Sidecar'}
            </button>
          </div>
          <div className="text-xs font-mono text-emerald-200/70 space-y-1">
            <div className="flex justify-between">
              <span>Model:</span>
              <span className="truncate max-w-[160px] text-white font-medium">{adminStatus.vectorSearchStatus.model}</span>
            </div>
            <div className="flex justify-between">
              <span>Avg Latency:</span>
              <span className="text-white">{adminStatus.vectorSearchStatus.averageLatencyMs} ms</span>
            </div>
          </div>
        </div>
      </div>

      {/* OPERATIONS SECTION */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left 2 Cols: Re-import Operations Deck */}
        <div className="lg:col-span-2 bg-[#0b2921]/90 rounded-2xl border border-emerald-500/20 p-6 shadow-xl space-y-6">
          <div className="border-b border-emerald-500/15 pb-4">
            <h2 className="font-display-title text-xl font-bold text-white">
              TEI Repository Re-Import Actions
            </h2>
            <p className="text-xs text-emerald-200/70">
              Trigger textbase-server ingest pipelines to parse XML trees, validate TEI P5 schemas, and update database records.
            </p>
          </div>

          {/* Repo Selector */}
          <div className="space-y-2">
            <label className="text-xs font-bold text-emerald-200">Target TEI Repository</label>
            <select
              id="select-admin-repo"
              value={selectedRepoId}
              onChange={(e) => setSelectedRepoId(e.target.value)}
              className="w-full text-xs font-mono bg-[#051a14] border border-emerald-500/20 rounded-xl px-3 py-2.5 text-white focus:outline-none focus:ring-1 focus:ring-[#f59e0b]"
            >
              {adminStatus.repos.map((r) => (
                <option key={r.id} value={r.id} className="bg-[#0b2921] text-white">
                  {r.name} ({r.fileCount} TEI XML files • branch: {r.branch})
                </option>
              ))}
            </select>
          </div>

          {/* 4 Ingest Modes Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {/* Mode 1: Fresher-Only */}
            <div className="border border-emerald-500/20 rounded-xl p-4 bg-[#051a14] flex flex-col justify-between space-y-3">
              <div>
                <span className="text-[10px] font-bold uppercase font-mono px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  Standard Mode
                </span>
                <h4 className="font-display-title text-sm font-bold text-white mt-2 mb-1">
                  Fresher-Only Ingest
                </h4>
                <p className="text-[11px] text-emerald-200/70 leading-relaxed">
                  Imports only documents with modified git timestamps or newer commit hashes. Fast & non-blocking.
                </p>
              </div>
              <button
                id="btn-admin-fresher-reimport"
                onClick={() => handleTriggerReimport('fresher-only')}
                className="w-full py-2 bg-[#0f3d30] hover:bg-emerald-700/50 text-white rounded-lg text-xs font-semibold uppercase tracking-wider border border-emerald-500/30 transition-colors cursor-pointer"
              >
                Trigger Fresher-Only
              </button>
            </div>

            {/* Mode 2: Full Ingest */}
            <div className="border border-emerald-500/20 rounded-xl p-4 bg-[#051a14] flex flex-col justify-between space-y-3">
              <div>
                <span className="text-[10px] font-bold uppercase font-mono px-2 py-0.5 rounded bg-amber-500/10 text-[#f59e0b] border border-amber-500/20">
                  Full Corpus
                </span>
                <h4 className="font-display-title text-sm font-bold text-white mt-2 mb-1">
                  Full Re-Import
                </h4>
                <p className="text-[11px] text-emerald-200/70 leading-relaxed">
                  Re-parses all files in the chosen repository, updating existing AST chapters and metadata.
                </p>
              </div>
              <button
                id="btn-admin-full-reimport"
                onClick={() => handleTriggerReimport('full')}
                className="w-full py-2 bg-[#f59e0b] hover:bg-amber-400 text-black rounded-lg text-xs font-bold uppercase tracking-wider transition-colors cursor-pointer"
              >
                Trigger Full Sync
              </button>
            </div>

            {/* Mode 3: Single-File Ingest */}
            <div className="border border-emerald-500/20 rounded-xl p-4 bg-[#051a14] flex flex-col justify-between space-y-3">
              <div>
                <span className="text-[10px] font-bold uppercase font-mono px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                  Targeted
                </span>
                <h4 className="font-display-title text-sm font-bold text-white mt-2 mb-1">
                  Single-File Re-Import
                </h4>
                <input
                  type="text"
                  placeholder="Relative file path..."
                  value={singleFilePath}
                  onChange={(e) => setSingleFilePath(e.target.value)}
                  className="w-full text-[11px] font-mono p-1.5 rounded border border-emerald-500/20 bg-[#0b2921] text-white placeholder:text-emerald-300/40 mb-1 focus:outline-none focus:ring-1 focus:ring-[#f59e0b]"
                />
              </div>
              <button
                id="btn-admin-single-reimport"
                onClick={() => handleTriggerReimport('single-file')}
                className="w-full py-2 bg-[#0f3d30] hover:bg-emerald-700/50 text-white border border-emerald-500/30 rounded-lg text-xs font-semibold uppercase tracking-wider transition-colors cursor-pointer"
              >
                Parse Single File
              </button>
            </div>
          </div>

          {/* Mode 4: Force-Full (Clearly separated as disruptive per Spec) */}
          <div className="rounded-2xl border border-red-500/30 bg-red-500/5 p-5 space-y-3">
            <div className="flex items-start justify-between">
              <div className="flex items-center space-x-2 text-red-400 font-bold text-xs uppercase font-mono">
                <AlertOctagon className="w-4 h-4 text-red-500" />
                <span>Disruptive Operation: Force-Full Wipe & Ingest</span>
              </div>
              <span className="text-[10px] uppercase font-mono font-bold bg-red-500/10 text-red-400 px-2 py-0.5 rounded border border-red-500/30">
                Caution
              </span>
            </div>

            <p className="text-xs text-red-200/80 leading-relaxed">
              Force-Full drops all cached AST tokens, clears previous indexes for this repository, and performs an unconditional clean build. Active readers may experience brief latency spikes.
            </p>

            <div className="pt-2 flex justify-end">
              <button
                id="btn-admin-force-full"
                onClick={() => setShowForceFullModal(true)}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-bold uppercase tracking-wider shadow-sm transition-colors flex items-center space-x-1.5 cursor-pointer"
              >
                <AlertOctagon className="w-3.5 h-3.5" />
                <span>Execute Force-Full Ingest...</span>
              </button>
            </div>
          </div>
        </div>

        {/* Right 1 Col: Lucene Reindex & Ingest Logs */}
        <div className="space-y-6">
          {/* Lucene Reindex Card */}
          <div className="bg-[#0b2921]/90 rounded-2xl border border-emerald-500/20 p-6 shadow-xl space-y-4">
            <div className="flex items-center justify-between border-b border-emerald-500/15 pb-3">
              <h3 className="font-display-title text-base font-bold text-white">
                Lucene Index Maintenance
              </h3>
              <Database className="w-4 h-4 text-[#f59e0b]" />
            </div>

            <p className="text-xs text-emerald-200/70 leading-relaxed">
              Reconstructs the BM25 full-text token inverted index across all TEI chapters and apparatus annotations.
            </p>

            <button
              id="btn-admin-lucene-reindex"
              onClick={handleLuceneReindex}
              disabled={isReindexing}
              className="w-full py-2.5 bg-[#0f3d30] hover:bg-emerald-700/50 text-white border border-emerald-500/30 rounded-xl text-xs font-semibold uppercase tracking-wider transition-colors flex items-center justify-center space-x-2 disabled:opacity-50 cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isReindexing ? 'animate-spin' : ''}`} />
              <span>{isReindexing ? 'Rebuilding Inverted Index...' : 'Trigger Lucene Reindex'}</span>
            </button>

            {reindexSuccess && (
              <div className="text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-2.5 font-mono text-center">
                ✓ Inverted index rebuilt ({adminStatus.luceneIndexStatus.docsIndexed} documents).
              </div>
            )}
          </div>

          {/* Audit / Reimport Activity Logs */}
          <div className="bg-[#0b2921]/90 rounded-2xl border border-emerald-500/20 p-6 shadow-xl space-y-3">
            <div className="flex items-center justify-between border-b border-emerald-500/15 pb-3">
              <h3 className="font-display-title text-base font-bold text-white flex items-center space-x-1.5">
                <Terminal className="w-4 h-4 text-[#f59e0b]" />
                <span>Recent Ingest Logs</span>
              </h3>
              <span className="text-[10px] font-mono text-emerald-300/40">textbase.log</span>
            </div>

            <div className="space-y-2 max-h-64 overflow-y-auto font-mono text-[11px]">
              {adminStatus.reimportLogs.map((log) => (
                <div key={log.id} className="p-2.5 rounded-lg bg-[#051a14] border border-emerald-500/20 space-y-1">
                  <div className="flex justify-between text-emerald-300/50 text-[10px]">
                    <span className="font-bold text-[#f59e0b] uppercase">[{log.mode}]</span>
                    <span>{new Date(log.timestamp).toLocaleTimeString()}</span>
                  </div>
                  <p className="text-emerald-100/90 text-[11px] leading-tight">
                    {log.message}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Source Repositories */}
      <div className="bg-[#0b2921]/90 rounded-2xl border border-emerald-500/20 p-6 shadow-xl space-y-6">
        <div className="border-b border-emerald-500/15 pb-4">
          <h2 className="font-display-title text-xl font-bold text-white flex items-center space-x-2">
            <GitBranch className="w-5 h-5 text-[#f59e0b]" />
            <span>Source Repositories</span>
          </h2>
          <p className="text-xs text-emerald-200/70">
            Configured upstream Git repositories containing canonical TEI XML corpora. The textbase-server
            routinely syncs and indexes these trees into Lucene full-text and vector sidecars.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4">
          {adminStatus.repos.map((repo) => (
            <div
              key={repo.id}
              id={`card-repo-${repo.id}`}
              className="bg-[#051a14] rounded-xl border border-emerald-500/20 p-5 shadow-md flex flex-col md:flex-row items-start md:items-center justify-between gap-4"
            >
              <div className="space-y-1.5 max-w-2xl">
                <div className="flex items-center space-x-2">
                  <h3 className="font-mono text-sm font-bold text-white">
                    {repo.name}
                  </h3>
                  <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-950/80 text-emerald-300 border border-emerald-500/40">
                    <CheckCircle2 className="w-3 h-3" />
                    <span>{repo.status.toUpperCase()}</span>
                  </span>
                </div>

                <p className="text-xs text-emerald-100/70 leading-relaxed font-serif-reading">
                  {repo.description}
                </p>

                <div className="flex flex-wrap items-center gap-3 text-[11px] text-emerald-200/50 font-mono">
                  <span className="flex items-center space-x-1">
                    <GitBranch className="w-3 h-3 text-emerald-300/70" />
                    <span>{repo.branch}</span>
                  </span>
                  <span>•</span>
                  <span>Commit: {repo.commitHash}</span>
                  <span>•</span>
                  <span>{repo.fileCount} TEI Files</span>
                  <span>•</span>
                  <span>Last Sync: {new Date(repo.lastSync).toLocaleString()}</span>
                </div>
              </div>

              <a
                href={repo.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center space-x-1 px-3 py-2 rounded-lg border border-emerald-500/20 text-xs font-medium text-emerald-200 hover:text-white hover:bg-emerald-500/20 transition-colors"
              >
                <span>Source</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>
          ))}
        </div>
      </div>

      {/* Force-Full Confirmation Modal */}
      {showForceFullModal && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-[#0b2921] rounded-2xl border border-red-500/30 p-6 max-w-md w-full shadow-2xl space-y-4">
            <div className="flex items-center space-x-3 text-red-400">
              <AlertOctagon className="w-8 h-8 shrink-0 text-red-500" />
              <div>
                <h3 className="font-display-title text-lg font-bold text-white">
                  Confirm Force-Full Ingest
                </h3>
                <p className="text-xs text-red-400 font-semibold font-mono">
                  Target: {selectedRepoId}
                </p>
              </div>
            </div>

            <p className="text-xs text-emerald-100/80 leading-relaxed">
              This action will completely invalidate all indexed TEI chapters for <strong>{selectedRepoId}</strong> and re-parse every single XML document from scratch.
            </p>

            <div className="flex items-center justify-end space-x-2 pt-3 border-t border-emerald-500/20">
              <button
                onClick={() => setShowForceFullModal(false)}
                className="px-4 py-2 rounded-lg text-emerald-200/70 hover:text-white hover:bg-emerald-500/10 text-xs font-medium cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={() => handleTriggerReimport('force-full')}
                className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-bold uppercase tracking-wider shadow-sm cursor-pointer"
              >
                I Understand, Execute Force-Full
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
