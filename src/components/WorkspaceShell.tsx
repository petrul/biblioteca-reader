import React, { useEffect, useState } from 'react';
import { ChevronDown, ChevronUp, PanelLeft, PanelRight, X } from 'lucide-react';
import type { SavedQuote } from '../services/serverQuoteApi';
import type { User } from '../types/textbase';
import { ANONYMOUS_USER_ID } from '../services/readerService';
import { CollectionsPanel } from './CollectionsPanel';
import { getWorkspace, setWorkspace, subscribeWorkspace } from '../services/workspaceStore';

interface WorkspaceShellProps {
  currentUser: User | null;
  onOpenAuth: () => void;
  onSelectWork: (workId: string) => void;
  onSelectChapter: (workId: string, chapterId: string) => void;
  onOpenQuote: (quoteId: string, saved?: SavedQuote) => void;
  onRunSearch: (query: string) => void;
  onOpenSavedSearch?: (id: string) => void;
}

export function WorkspaceShell({ currentUser, onOpenAuth, onSelectWork, onSelectChapter, onOpenQuote, onRunSearch, onOpenSavedSearch }: WorkspaceShellProps) {
  const [, redraw] = useState(0);
  useEffect(() => subscribeWorkspace(() => redraw(value => value + 1)), []);
  const state = getWorkspace();
  if (!state.active) return null;
  const userId = currentUser?.id || ANONYMOUS_USER_ID;

  const close = () => setWorkspace({ ...state, active: false });
  const toggleRight = () => setWorkspace({ ...state, right: state.right ? undefined : { kind: 'collection', id: 'favorites' } });

  const drawer = (side: 'left' | 'right') => (
    <aside
      key={side}
      data-testid={`workspace-${side}-drawer`}
      className="fixed z-40 top-16 bottom-4 w-[min(360px,calc(100vw-1rem))] bg-[#061d28]/95 backdrop-blur-xl border border-white/15 shadow-2xl p-3 overflow-hidden flex flex-col"
      style={side === 'left' ? { left: '0.5rem', borderRadius: '0 1rem 1rem 0' } : { right: '0.5rem', borderRadius: '1rem 0 0 1rem' }}
    >
      <div className="flex items-center justify-between gap-2 px-2 pb-2 border-b border-white/10">
        <span className="flex items-center gap-2 text-xs uppercase tracking-widest text-emerald-200/70">
          {side === 'left' ? <PanelLeft className="w-4 h-4 text-amber-300" /> : <PanelRight className="w-4 h-4 text-amber-300" />}
          {side} drawer
        </span>
        <button type="button" aria-label={`Close ${side} drawer`} onClick={() => setWorkspace({ ...state, [side]: undefined })} className="p-1.5 rounded-lg text-white/60 hover:text-white hover:bg-white/10 cursor-pointer"><X className="w-4 h-4" /></button>
      </div>
      <CollectionsPanel
        userId={userId}
        className="min-h-0 flex-1"
        bodyClassName="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1"
        onSelectWork={onSelectWork}
        onSelectChapter={onSelectChapter}
        onOpenQuote={onOpenQuote}
        onRunSearch={onRunSearch}
        onOpenSavedSearch={onOpenSavedSearch}
      />
    </aside>
  );

  return (
    <>
      <div className="hidden sm:block">{drawer('left')}{state.right && drawer('right')}</div>
      <div className="sm:hidden fixed z-40 left-2 right-2 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] max-h-[72vh] bg-[#061d28]/98 backdrop-blur-xl border border-white/15 rounded-2xl shadow-2xl p-3 overflow-hidden flex flex-col" data-testid="workspace-mobile-sheet">
        <div className="flex justify-center pb-2"><span className="h-1 w-10 rounded-full bg-white/30" /></div>
        <div className="flex items-center justify-between px-2 pb-2 border-b border-white/10">
          <span className="text-xs uppercase tracking-widest text-emerald-200/70">Workspace</span>
          <button type="button" aria-label="Close workspace" onClick={close} className="p-1.5 rounded-lg text-white/60 hover:text-white hover:bg-white/10 cursor-pointer"><X className="w-4 h-4" /></button>
        </div>
        <CollectionsPanel
          userId={userId}
          className="min-h-0 flex-1"
          bodyClassName="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1"
          onSelectWork={onSelectWork}
          onSelectChapter={onSelectChapter}
          onOpenQuote={onOpenQuote}
          onRunSearch={onRunSearch}
          onOpenSavedSearch={onOpenSavedSearch}
        />
      </div>
      <div className="fixed z-50 bottom-3 right-3 sm:right-6 flex items-center gap-2">
        <button type="button" aria-label="Toggle second workspace drawer" onClick={toggleRight} className="hidden sm:flex p-3 rounded-full bg-[#0f3d30] border border-emerald-400/40 text-amber-300 shadow-xl hover:bg-[#14563f] cursor-pointer">
          {state.right ? <ChevronDown className="w-5 h-5" /> : <ChevronUp className="w-5 h-5" />}
        </button>
        <button type="button" aria-label="Discard workspace" onClick={close} className="p-3 rounded-full bg-[#f59e0b] text-black shadow-xl hover:bg-amber-300 cursor-pointer"><X className="w-5 h-5" /></button>
      </div>
      {!currentUser && (
        <button type="button" onClick={onOpenAuth} className="fixed z-50 bottom-4 left-4 sm:left-1/2 sm:-translate-x-1/2 px-3 py-2 rounded-xl bg-amber-500/20 border border-amber-300/40 text-amber-100 text-xs cursor-pointer">Sign in to sync this workspace</button>
      )}
    </>
  );
}
