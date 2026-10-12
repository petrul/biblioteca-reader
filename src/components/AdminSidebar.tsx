import React, { useState, useEffect } from 'react';
import { appAsset } from '../services/serversideApi';
// The reader's own version and the family release this snapshot is heading
// toward (package.json's releaseName - "Bronze Basilica" while on a
// -SNAPSHOT; see biblioteca-server's README Releases section).
import { version as readerVersion, releaseName } from '../../package.json';
import {
  X,
  Server,
  Database,
  Sparkles,
  RefreshCw,
  Play,
  FileCode2,
  AlertTriangle,
  CheckCircle2,
  Terminal,
  ShieldCheck,
  User as UserIcon,
  Layers,
  ArrowRight,
  ChevronRight,
  ChevronDown,
  BookOpen,
  Search,
  Bookmark,
  Compass,
  FileText,
  Info,
  ExternalLink,
  Settings,
  Cpu,
  LogIn,
  LogOut,
  FolderPlus
} from 'lucide-react';
import { User, AdminStatus, AppView } from '../types/textbase';
import { readerService } from '../services/readerService';
import { useDragToDismiss } from '../hooks/useDragToDismiss';

interface AdminSidebarProps {
  isOpen: boolean;
  isAdmin?: boolean;
  onClose: () => void;
  currentUser: User | null;
  onOpenAuth: () => void;
  onNavigateToFullAdmin?: () => void;
  onNavigateView?: (view: AppView) => void;
  onRandomDiscovery?: () => void;
}

export const AdminSidebar: React.FC<AdminSidebarProps> = ({
  isOpen,
  isAdmin = false,
  onClose,
  currentUser,
  onOpenAuth,
  onNavigateToFullAdmin,
  onNavigateView,
  onRandomDiscovery
}) => {
  const drag = useDragToDismiss('left', onClose);

  // Sidebar navigation sections: 'reader-tools' (Library) | 'admin' | 'about'
  const [activeMenuSection, setActiveMenuSection] = useState<'reader-tools' | 'admin' | 'about'>('reader-tools');
  const [isAdminSectionExpanded, setIsAdminSectionExpanded] = useState<boolean>(true);

  const [adminStatus, setAdminStatus] = useState<AdminStatus>(() => readerService.getAdminStatus());
  const [selectedRepoId, setSelectedRepoId] = useState<string>('scriptorium-ro');
  const [singleFilePath, setSingleFilePath] = useState<string>('cantemir/descrierea-moldovei.xml');
  const [isReindexing, setIsReindexing] = useState(false);
  const [operationMsg, setOperationMsg] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);

  // Sync state when sidebar opens
  useEffect(() => {
    if (isOpen) {
      // Placeholder first, then the real status from the live services
      // (see readerService.fetchAdminStatus) - whatever can't be fetched
      // keeps its placeholder value.
      setAdminStatus(readerService.getAdminStatus());
      readerService.fetchAdminStatus().then(setAdminStatus).catch(() => { /* keep placeholders */ });
    }
  }, [isOpen]);

  // Handle ESC key to close sidebar
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Keep the drawer mounted for one transition duration after isOpen goes
  // false, so the slide-out/fade-out actually plays instead of the panel
  // vanishing instantly.
  const CLOSE_ANIM_MS = 300;
  const [shouldRender, setShouldRender] = useState(isOpen);
  const [isClosing, setIsClosing] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setShouldRender(true);
      setIsClosing(false);
    } else if (shouldRender) {
      setIsClosing(true);
      const timer = setTimeout(() => {
        setShouldRender(false);
        setIsClosing(false);
      }, CLOSE_ANIM_MS);
      return () => clearTimeout(timer);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const refreshStatus = () => {
    setAdminStatus(readerService.getAdminStatus());
  };

  const showFeedback = (type: 'success' | 'error' | 'info', text: string) => {
    setOperationMsg({ type, text });
    setTimeout(() => {
      setOperationMsg(null);
    }, 5000);
  };

  const handleTriggerReimport = (mode: 'fresher-only' | 'full' | 'single-file' | 'force-full') => {
    try {
      const res = readerService.triggerReimport(mode, selectedRepoId, mode === 'single-file' ? singleFilePath : undefined);
      refreshStatus();
      showFeedback('success', `Pipeline completed: ${res.message}`);
    } catch (e) {
      showFeedback('error', 'Reimport action failed: ' + String(e));
    }
  };

  const handleLuceneReindex = async () => {
    setIsReindexing(true);
    try {
      await readerService.triggerLuceneReindex();
      setIsReindexing(false);
      refreshStatus();
      showFeedback('success', 'Lucene index reconstructed: documents indexed successfully in BM25 store');
    } catch (e) {
      setIsReindexing(false);
      showFeedback('error', 'Lucene reindexing failed: ' + String(e));
    }
  };

  const handleNavigate = (view: AppView) => {
    onClose();
    if (onNavigateView) {
      onNavigateView(view);
    }
  };

  if (!shouldRender) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-hidden">
      {/* Backdrop */}
      <div
        onClick={onClose}
        className={`fixed inset-0 bg-black/80 backdrop-blur-sm transition-opacity duration-300 ${
          isClosing ? 'opacity-0' : 'opacity-100'
        }`}
      />

      {/* Drawer Container */}
      <div className="fixed inset-y-0 left-0 max-w-full flex pr-10 sm:pr-16">
        <div
          onTouchStart={drag.onTouchStart}
          onTouchMove={drag.onTouchMove}
          onTouchEnd={drag.onTouchEnd}
          style={!isClosing && drag.dragX !== 0 ? { transform: `translateX(${drag.dragX}px)` } : undefined}
          className={`w-screen max-w-md sm:max-w-lg bg-[linear-gradient(180deg,#022e44_0%,#033a4c_40%,#022332_100%)] border-r border-emerald-400/30 text-[#e4efe9] shadow-2xl flex flex-col transform ${
            drag.isDragging ? '' : 'transition-transform ease-in-out duration-300'
          } ${isClosing ? '-translate-x-full' : 'translate-x-0'}`}
        >
          {/* Drawer Header */}
          <div className="p-5 border-b border-emerald-400/20 bg-[linear-gradient(90deg,rgba(2,64,99,0.95)_0%,rgba(60,168,63,0.85)_22%,rgba(4,74,111,0.95)_100%)] flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <img
                src={appAsset('textbase-logo.png')}
                alt="Textbase"
                className="w-9 h-9 rounded-lg object-cover shadow-md shadow-amber-950/50"
              />
              <div>
                <div className="flex items-center space-x-2">
                  <h2 className="font-display-title text-base font-bold text-white tracking-tight">
                    Biblioteca
                  </h2>
                </div>
                <p className="text-[11px] text-emerald-200/60">
                  Your Scriptorium classical readings
                </p>
              </div>
            </div>

            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-emerald-300/70 hover:text-white hover:bg-emerald-500/10 border border-transparent hover:border-emerald-500/20 transition-colors cursor-pointer"
              title="Close Sidebar (Esc)"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Operation Status Toast */}
          {operationMsg && (
            <div className={`mx-4 mt-3 p-3 rounded-xl border text-xs flex items-center space-x-2 animate-in fade-in ${
              operationMsg.type === 'success' ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-200' :
              operationMsg.type === 'error' ? 'bg-red-500/20 border-red-500/40 text-red-200' :
              'bg-sky-500/20 border-sky-500/40 text-sky-200'
            }`}>
              <CheckCircle2 className="w-4 h-4 shrink-0 text-[#f59e0b]" />
              <span className="truncate">{operationMsg.text}</span>
            </div>
          )}

          {/* Sidebar Navigation Menu Items */}
          <div className="px-5 pt-4 pb-2 border-b border-emerald-500/15 flex items-center space-x-2">
            {/* Reader Tools / Library Menu Item Tab (Default & on the left) */}
            <button
              id="sidebar-tab-library"
              onClick={() => setActiveMenuSection('reader-tools')}
              className={`flex-1 py-2 px-3 rounded-xl text-xs font-bold font-mono uppercase tracking-wider flex items-center justify-center space-x-2 transition-all cursor-pointer ${
                activeMenuSection === 'reader-tools'
                  ? 'bg-emerald-500/20 text-emerald-200 border border-emerald-400/40 shadow-sm'
                  : 'text-emerald-300/70 hover:text-white hover:bg-emerald-500/10 border border-transparent'
              }`}
            >
              <BookOpen className="w-4 h-4 text-emerald-300" />
              <span>Library</span>
            </button>

            {/* Admin Menu Item Tab (To the right of Library) */}
            {isAdmin && <button
              id="sidebar-tab-admin"
              onClick={() => setActiveMenuSection('admin')}
              className={`flex-1 py-2 px-3 rounded-xl text-xs font-bold font-mono uppercase tracking-wider flex items-center justify-center space-x-2 transition-all cursor-pointer ${
                activeMenuSection === 'admin'
                  ? 'bg-amber-500/15 text-[#f59e0b] border border-amber-500/40 shadow-sm'
                  : 'text-emerald-300/70 hover:text-white hover:bg-emerald-500/10 border border-transparent'
              }`}
            >
              <ShieldCheck className="w-4 h-4 text-[#f59e0b]" />
              <span>Admin</span>
            </button>}

            {/* About / Corpus Tab */}
            <button
              id="sidebar-tab-about"
              onClick={() => setActiveMenuSection('about')}
              className={`py-2 px-3 rounded-xl text-xs font-bold font-mono uppercase tracking-wider flex items-center justify-center space-x-1 transition-all cursor-pointer ${
                activeMenuSection === 'about'
                  ? 'bg-emerald-500/20 text-white border border-emerald-400/40 shadow-sm'
                  : 'text-emerald-300/70 hover:text-white hover:bg-emerald-500/10 border border-transparent'
              }`}
              title="About Scriptorium"
            >
              <Info className="w-4 h-4" />
            </button>
          </div>

          {/* Drawer Body - Scrollable */}
          <div className="flex-1 overflow-y-auto p-5 space-y-6">

            {/* ======================================================== */}
            {/* SECTION 1: ADMIN MENU ITEM (ALL ADMIN CONTROLS INSIDE) */}
            {/* ======================================================== */}
            {activeMenuSection === 'admin' && (
              <div className="space-y-6 animate-in fade-in duration-200">
                
                {/* Admin Menu Title Card with Collapsible or Status Summary */}
                <div className="p-4 rounded-xl bg-gradient-to-r from-amber-500/10 via-[#0b2921] to-[#0b2921] border border-amber-500/30 flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <div className="w-8 h-8 rounded-lg bg-[#f59e0b] flex items-center justify-center text-black font-bold shadow-sm">
                      <ShieldCheck className="w-5 h-5" />
                    </div>
                    <div>
                      <h3 className="font-display-title text-sm font-bold text-white flex items-center space-x-1.5">
                        <span>Admin Console & Ingest</span>
                      </h3>
                      <p className="text-[11px] text-emerald-200/70">
                        TEI XML Pipelines, Lucene BM25 & Sidecar Controls
                      </p>
                    </div>
                  </div>

                  <button
                    onClick={() => setIsAdminSectionExpanded(!isAdminSectionExpanded)}
                    className="p-1 rounded-lg text-emerald-300/70 hover:text-white hover:bg-emerald-500/10 cursor-pointer"
                    title={isAdminSectionExpanded ? 'Collapse Admin Panel' : 'Expand Admin Panel'}
                  >
                    {isAdminSectionExpanded ? <ChevronDown className="w-5 h-5" /> : <ChevronRight className="w-5 h-5" />}
                  </button>
                </div>

                {isAdminSectionExpanded && (
                  <>
                    {/* 1. Signed-in user bar */}
                    <div className="p-4 rounded-xl bg-[#0b2921]/90 border border-emerald-500/20 space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-2.5">
                          <div className="w-8 h-8 rounded-full bg-emerald-950/80 border border-amber-500/40 flex items-center justify-center text-[#f59e0b] font-bold text-xs">
                            {currentUser?.name ? currentUser.name[0] : 'G'}
                          </div>
                          <div>
                            <p className="text-xs font-semibold text-white">
                              {currentUser?.name || 'Guest'}
                            </p>
                            <p className="text-[10px] text-emerald-200/60">
                              {currentUser?.email || 'Not signed in'}
                            </p>
                          </div>
                        </div>

                        {!currentUser && (
                          <button
                            onClick={onOpenAuth}
                            className="px-2.5 py-1.5 rounded-lg bg-[#f59e0b] hover:bg-amber-400 text-black text-[11px] font-bold transition-colors cursor-pointer shadow-sm"
                          >
                            Sign in
                          </button>
                        )}
                      </div>
                    </div>

                    {/* 2. System Status & Health Cards */}
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <h3 className="text-xs font-bold uppercase tracking-wider text-emerald-200 flex items-center space-x-1.5">
                          <Server className="w-3.5 h-3.5 text-[#f59e0b]" />
                          <span>Host & Engine Metrics</span>
                        </h3>
                        <button
                          onClick={refreshStatus}
                          className="text-[10px] font-mono text-emerald-300/70 hover:text-white flex items-center space-x-1 cursor-pointer"
                        >
                          <RefreshCw className="w-3 h-3" />
                          <span>Refresh</span>
                        </button>
                      </div>

                      <div className="grid grid-cols-2 gap-2 text-xs">
                        {/* Server Uptime */}
                        <div className="p-3 rounded-xl bg-[#051a14] border border-emerald-500/20">
                          <span className="text-[10px] font-mono text-emerald-300/60 block mb-0.5">Uptime</span>
                          <span className="font-mono text-white font-bold text-xs">{adminStatus.uptime}</span>
                        </div>

                        {/* TEI Parser */}
                        <div className="p-3 rounded-xl bg-[#051a14] border border-emerald-500/20">
                          <span className="text-[10px] font-mono text-emerald-300/60 block mb-0.5">TEI Engine</span>
                          <span className="font-mono text-emerald-300 font-bold text-xs">P5 Strict XML</span>
                          <span className="text-[10px] text-emerald-300/60 block mt-0.5">v{adminStatus.teiEngineStatus.parserVersion}</span>
                        </div>

                        {/* Lucene 9.x Index */}
                        <div className="p-3 rounded-xl bg-[#051a14] border border-emerald-500/20 col-span-2">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-[10px] font-mono text-emerald-300/60">Lucene Inverted Index</span>
                            <span className="text-[10px] font-mono font-emerald-400 font-bold">
                              {adminStatus.luceneIndexStatus.status.toUpperCase()}
                            </span>
                          </div>
                          <div className="flex items-center justify-between">
                            <div>
                              <p className="text-white font-mono font-bold text-xs">
                                {adminStatus.luceneIndexStatus.docsIndexed.toLocaleString()} Docs
                              </p>
                              {adminStatus.luceneIndexStatus.indexSizeBytes !== undefined && (
                                <p className="text-[10px] font-mono text-emerald-300/60">
                                  {(adminStatus.luceneIndexStatus.indexSizeBytes / (1024 * 1024)).toFixed(1)} MB BM25
                                </p>
                              )}
                            </div>
                            <button
                              onClick={handleLuceneReindex}
                              disabled={isReindexing}
                              className="flex items-center space-x-1 px-2.5 py-1.5 rounded-lg bg-[#0f3d30] hover:bg-emerald-700/50 border border-emerald-500/30 text-[11px] font-semibold text-white disabled:opacity-50 cursor-pointer"
                            >
                              <RefreshCw className={`w-3 h-3 ${isReindexing ? 'animate-spin' : ''}`} />
                              <span>{isReindexing ? 'Reindexing...' : 'Reindex'}</span>
                            </button>
                          </div>
                        </div>

                        {/* Vector Embeddings Sidecar */}
                        <div className="p-3 rounded-xl bg-[#051a14] border border-emerald-500/20 col-span-2">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-[10px] font-mono text-emerald-300/60">Vector Embeddings</span>
                            <span className={`text-[10px] font-mono font-bold ${adminStatus.vectorSearchStatus.available ? 'text-emerald-400' : 'text-amber-400'}`}>
                              {adminStatus.vectorSearchStatus.available ? 'ONLINE' : 'OFFLINE'}
                            </span>
                          </div>
                          <div className="flex items-center justify-between">
                            <div className="truncate max-w-[240px]">
                              <p className="text-white font-mono font-bold text-xs truncate">
                                {adminStatus.vectorSearchStatus.available
                                  ? `vectorizer job: ${adminStatus.vectorSearchStatus.state ?? 'unknown'}`
                                  : (adminStatus.vectorSearchStatus.degradationReason ?? 'vectorizer unreachable')}
                              </p>
                              <p className="text-[10px] font-mono text-emerald-300/60 truncate">
                                {adminStatus.vectorSearchStatus.provider}
                              </p>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* 3. TEI Repository Re-Import Actions */}
                    <div className="space-y-3">
                      <h3 className="text-xs font-bold uppercase tracking-wider text-emerald-200 flex items-center space-x-1.5">
                        <FileCode2 className="w-3.5 h-3.5 text-[#f59e0b]" />
                        <span>TEI Ingestion Pipelines</span>
                      </h3>

                      {/* Target Repository */}
                      <div className="space-y-1">
                        <label className="text-[11px] text-emerald-300/70 font-semibold block">Target Repository</label>
                        <select
                          value={selectedRepoId}
                          onChange={(e) => setSelectedRepoId(e.target.value)}
                          className="w-full text-xs font-mono bg-[#051a14] border border-emerald-500/20 rounded-xl px-3 py-2 text-white focus:outline-none focus:ring-1 focus:ring-[#f59e0b]"
                        >
                          {adminStatus.repos.map((r) => (
                            <option key={r.id} value={r.id} className="bg-[#0b2921] text-white">
                              {r.name} ({r.fileCount} TEI XML files)
                            </option>
                          ))}
                        </select>
                      </div>

                      {/* Action Buttons */}
                      <div className="space-y-2 pt-1">
                        {/* Fresher-Only Ingest */}
                        <button
                          onClick={() => handleTriggerReimport('fresher-only')}
                          className="w-full p-3 rounded-xl bg-[#0b2921]/90 hover:bg-[#0f3d30] border border-emerald-500/20 text-left transition-all group cursor-pointer flex items-center justify-between"
                        >
                          <div>
                            <div className="flex items-center space-x-1.5">
                              <span className="font-bold text-white text-xs">Fresher-Only Ingest</span>
                              <span className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-300 uppercase">Fast</span>
                            </div>
                            <p className="text-[11px] text-emerald-200/60 mt-0.5">
                              Syncs only modified XML files based on Git commit timestamps.
                            </p>
                          </div>
                          <Play className="w-4 h-4 text-[#f59e0b] shrink-0 group-hover:translate-x-0.5 transition-transform" />
                        </button>

                        {/* Full Re-Import */}
                        <button
                          onClick={() => handleTriggerReimport('full')}
                          className="w-full p-3 rounded-xl bg-[#0b2921]/90 hover:bg-[#0f3d30] border border-emerald-500/20 text-left transition-all group cursor-pointer flex items-center justify-between"
                        >
                          <div>
                            <div className="flex items-center space-x-1.5">
                              <span className="font-bold text-white text-xs">Full Repository Ingest</span>
                              <span className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-amber-500/20 text-[#f59e0b] uppercase">Corpus</span>
                            </div>
                            <p className="text-[11px] text-emerald-200/60 mt-0.5">
                              Re-parses all TEI P5 files in repository, updating metadata and ASTs.
                            </p>
                          </div>
                          <RefreshCw className="w-4 h-4 text-[#f59e0b] shrink-0 group-hover:rotate-45 transition-transform" />
                        </button>

                        {/* Single File Ingest */}
                        <div className="p-3 rounded-xl bg-[#051a14] border border-emerald-500/20 space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold text-white">Single-File XML Parser</span>
                            <span className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-emerald-500/15 text-emerald-300 uppercase">Targeted</span>
                          </div>
                          <input
                            type="text"
                            value={singleFilePath}
                            onChange={(e) => setSingleFilePath(e.target.value)}
                            placeholder="Relative XML path..."
                            className="w-full text-xs font-mono p-2 rounded-lg border border-emerald-500/20 bg-[#0b2921] text-white placeholder:text-emerald-300/40 focus:outline-none focus:ring-1 focus:ring-[#f59e0b]"
                          />
                          <button
                            onClick={() => handleTriggerReimport('single-file')}
                            className="w-full py-1.5 bg-[#0f3d30] hover:bg-emerald-700/50 text-white rounded-lg text-xs font-semibold border border-emerald-500/30 transition-colors cursor-pointer"
                          >
                            Parse XML File
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* 4. Ingest & Audit Logs */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <h3 className="text-xs font-bold uppercase tracking-wider text-emerald-200 flex items-center space-x-1.5">
                          <Terminal className="w-3.5 h-3.5 text-[#f59e0b]" />
                          <span>Ingest Logs (textbase.log)</span>
                        </h3>
                        <span className="text-[10px] font-mono text-emerald-300/50">
                          {adminStatus.reimportLogs.length} events
                        </span>
                      </div>

                      <div className="space-y-1.5 max-h-40 overflow-y-auto font-mono text-[10px]">
                        {adminStatus.reimportLogs.map((log) => (
                          <div key={log.id} className="p-2 rounded-lg bg-[#051a14] border border-emerald-500/15 space-y-0.5">
                            <div className="flex justify-between text-emerald-300/50">
                              <span className="font-bold text-[#f59e0b] uppercase">[{log.mode}]</span>
                              <span>{new Date(log.timestamp).toLocaleTimeString()}</span>
                            </div>
                            <p className="text-emerald-100/90 leading-tight">
                              {log.message}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* 5. Direct Link to Full Admin Screen */}
                    {onNavigateToFullAdmin && (
                      <div className="pt-2 border-t border-emerald-500/20">
                        <button
                          onClick={() => {
                            onClose();
                            onNavigateToFullAdmin();
                          }}
                          className="w-full py-2.5 px-4 rounded-xl bg-gradient-to-r from-amber-500/20 to-amber-600/10 hover:from-amber-500/30 hover:to-amber-600/20 border border-amber-500/30 text-[#f59e0b] text-xs font-bold flex items-center justify-center space-x-2 transition-all cursor-pointer"
                        >
                          <span>Open Full-Screen Admin Deck</span>
                          <ArrowRight className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                  </>
                )}

              </div>
            )}

            {/* ======================================================== */}
            {/* SECTION 2: READER & SCHOLAR TOOLS (COLLECTIONS, SEARCH, DISCOVERY) */}
            {/* ======================================================== */}
            {activeMenuSection === 'reader-tools' && (
              <div className="space-y-4 animate-in fade-in duration-200">
                <div className="border-b border-emerald-500/20 pb-3">
                  <h3 className="font-display-title text-base font-bold text-white">
                    Reader Navigation & Library
                  </h3>
                  <p className="text-xs text-emerald-200/60">
                    Quickly jump to catalog sections and personal reading lists.
                  </p>
                </div>

                <div className="space-y-2">
                  {/* Random Discovery - drawer copy of the navbar's dice
                      button (same Sparkles tumble, see .shuffle-tumble in
                      index.css). Like the other cards, it dismisses the
                      drawer first and lets the handler navigate. */}
                  {onRandomDiscovery && (
                    <button
                      id="sidebar-random-btn"
                      onClick={event => {
                        // Dice-tumble the Sparkles icon - restart it if the
                        // previous tumble is still mid-flight.
                        const icon = event.currentTarget.querySelector('svg');
                        icon?.classList.remove('shuffle-tumble');
                        void icon?.getBoundingClientRect();
                        icon?.classList.add('shuffle-tumble');
                        onClose();
                        onRandomDiscovery();
                      }}
                      title="Discover something at random"
                      className="w-full p-3.5 rounded-xl bg-[#0b2921]/90 hover:bg-[#0f3d30] border border-emerald-500/20 flex items-center justify-between text-left transition-all cursor-pointer group active:scale-[0.98] active:brightness-90"
                    >
                      <div className="flex items-center space-x-3">
                        <div className="w-8 h-8 rounded-lg bg-emerald-950/80 border border-amber-500/30 flex items-center justify-center text-[#f59e0b]">
                          <Sparkles className="w-4 h-4" />
                        </div>
                        <div>
                          <p className="text-xs font-bold text-white group-hover:text-amber-300 transition-colors">
                            Random Discovery
                          </p>
                          <p className="text-[11px] text-emerald-200/60">
                            Let fate pick your next read
                          </p>
                        </div>
                      </div>
                      <ChevronRight className="w-4 h-4 text-emerald-300/40 group-hover:text-white group-hover:translate-x-0.5 transition-all" />
                    </button>
                  )}

                  <button
                    onClick={() => handleNavigate('browse')}
                    className="w-full p-3.5 rounded-xl bg-[#0b2921]/90 hover:bg-[#0f3d30] border border-emerald-500/20 flex items-center justify-between text-left transition-all cursor-pointer group"
                  >
                    <div className="flex items-center space-x-3">
                      <div className="w-8 h-8 rounded-lg bg-emerald-950/80 border border-emerald-500/30 flex items-center justify-center text-emerald-300">
                        <Compass className="w-4 h-4" />
                      </div>
                      <div>
                        <p className="text-xs font-bold text-white group-hover:text-emerald-300 transition-colors">
                          Complete Authors Catalog
                        </p>
                        <p className="text-[11px] text-emerald-200/60">
                          Antiquity, Medieval, Renaissance, and Modern corpora
                        </p>
                      </div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-emerald-300/40 group-hover:text-white group-hover:translate-x-0.5 transition-all" />
                  </button>

                  <button
                    onClick={() => handleNavigate('search')}
                    className="w-full p-3.5 rounded-xl bg-[#0b2921]/90 hover:bg-[#0f3d30] border border-emerald-500/20 flex items-center justify-between text-left transition-all cursor-pointer group"
                  >
                    <div className="flex items-center space-x-3">
                      <div className="w-8 h-8 rounded-lg bg-emerald-950/80 border border-emerald-500/30 flex items-center justify-center text-[#f59e0b]">
                        <Search className="w-4 h-4" />
                      </div>
                      <div>
                        <p className="text-xs font-bold text-white group-hover:text-amber-300 transition-colors">
                          Multi-Mode Search Engine
                        </p>
                        <p className="text-[11px] text-emerald-200/60">
                          Lucene, Semantic, Fuzzy, and Apparatus filters
                        </p>
                      </div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-emerald-300/40 group-hover:text-white group-hover:translate-x-0.5 transition-all" />
                  </button>

                  <button
                    onClick={() => handleNavigate('collections')}
                    className="w-full p-3.5 rounded-xl bg-[#0b2921]/90 hover:bg-[#0f3d30] border border-emerald-500/20 flex items-center justify-between text-left transition-all cursor-pointer group"
                  >
                    <div className="flex items-center space-x-3">
                      <div className="w-8 h-8 rounded-lg bg-emerald-950/80 border border-emerald-500/30 flex items-center justify-center text-amber-400">
                        <Bookmark className="w-4 h-4" />
                      </div>
                      <div>
                        <p className="text-xs font-bold text-white group-hover:text-amber-300 transition-colors">
                          Personal Collections & Quotes
                        </p>
                        <p className="text-[11px] text-emerald-200/60">
                          Curated reading lists, highlights, and annotations
                        </p>
                      </div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-emerald-300/40 group-hover:text-white group-hover:translate-x-0.5 transition-all" />
                  </button>

                  {/* Leaves the app - a real external link to the parent
                      site, not an in-app view, so it's an <a>, not a
                      handleNavigate() button like the three above. */}
                  <a
                    href="https://scriptorium.ro"
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={onClose}
                    className="w-full p-3.5 rounded-xl bg-[#0b2921]/90 hover:bg-[#0f3d30] border border-emerald-500/20 flex items-center justify-between text-left transition-all cursor-pointer group"
                  >
                    <div className="flex items-center space-x-3">
                      <div className="w-8 h-8 rounded-lg bg-emerald-950/80 border border-emerald-500/30 flex items-center justify-center text-emerald-300">
                        <ExternalLink className="w-4 h-4" />
                      </div>
                      <div>
                        <p className="text-xs font-bold text-white group-hover:text-emerald-300 transition-colors">
                          Scriptorium.ro
                        </p>
                        <p className="text-[11px] text-emerald-200/60">
                          The parent site this corpus belongs to
                        </p>
                      </div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-emerald-300/40 group-hover:text-white group-hover:translate-x-0.5 transition-all" />
                  </a>
                </div>
              </div>
            )}

            {/* ======================================================== */}
            {/* SECTION 3: ABOUT TEXTBASE & SCRIPTORIUM */}
            {/* ======================================================== */}
            {activeMenuSection === 'about' && (
              <div className="space-y-4 animate-in fade-in duration-200">
                <div className="border-b border-emerald-500/20 pb-3">
                  <h3 className="font-display-title text-base font-bold text-white">
                    About Scriptorium Textbase
                  </h3>
                  <p className="text-xs text-emerald-200/60">
                    TEI P5 Classical & Critical Editions platform.
                  </p>
                </div>

                <div className="p-4 rounded-xl bg-[#0b2921]/90 border border-emerald-500/20 space-y-3 text-xs text-emerald-100/80 leading-relaxed font-sans">
                  <p>
                    <strong>TEXTBASE</strong> is a modern web reader and digital critical apparatus designed for classical, philosophical, and historical TEI-XML corpora.
                  </p>
                  <p>
                    Built with strict TEI P5 AST ingestion, Lucene 9.x BM25 full-text indexing, and vector semantic similarity.
                  </p>
                  <div className="pt-2 border-t border-emerald-500/20 flex items-center justify-between text-[11px] font-mono text-emerald-300/70">
                    <span>Corpus: Scriptorium.ro</span>
                    <span>TEI Guidelines: P5</span>
                  </div>
                </div>
              </div>
            )}

          </div>

          {/* Drawer Footer */}
          <div className="p-4 border-t border-emerald-500/20 bg-[#051f17]/90 text-[10px] font-mono text-emerald-300/70 flex items-center justify-between">
            <span>Biblioteca Server v{adminStatus.serverVersion}</span>
            <span>{releaseName}</span>
            <span>Biblioteca Reader v{readerVersion}</span>
          </div>

        </div>
      </div>
    </div>
  );
};
