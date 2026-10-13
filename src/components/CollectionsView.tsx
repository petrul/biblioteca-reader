import React, { useState, useEffect } from 'react';
import { Bookmark, Plus } from 'lucide-react';
import { User } from '../types/textbase';
import { readerService, ANONYMOUS_USER_ID } from '../services/readerService';
import { CollectionsPanel } from './CollectionsPanel';
import { useSwipeDismiss } from '../hooks/useSwipeDismiss';

interface CollectionsViewProps {
  isOpen: boolean;
  currentUser: User | null;
  onOpenAuth: () => void;
  onSelectWork: (workId: string) => void;
  onSelectChapter: (workId: string, chapterId: string) => void;
  onOpenQuote: (quoteId: string) => void;
  onRunSearch: (query: string) => void;
  onBack: () => void;
}

/**
 * The Collections page: the shared CollectionsPanel (also shown by the `s`
 * shortcut's modal) in its manage mode, plus creating collections.
 */
export const CollectionsView: React.FC<CollectionsViewProps> = ({
  isOpen,
  currentUser,
  onOpenAuth,
  onSelectWork,
  onSelectChapter,
  onOpenQuote,
  onRunSearch,
  onBack
}) => {
  // Sign-out lives in the AuthModal (the signed-in navbar avatar opens it),
  // not on this page.
  const swipeHandlers = useSwipeDismiss('right', onBack);

  // Keep mounted for one transition duration after isOpen goes false, so
  // the dismiss (swipe or avatar re-tap) fades/slides out instead of
  // vanishing instantly.
  const CLOSE_ANIM_MS = 250;
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
  const userId = currentUser?.id || ANONYMOUS_USER_ID;

  // New Collection Form
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newColName, setNewColName] = useState('');
  const [newColDesc, setNewColDesc] = useState('');

  const handleCreateCollection = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newColName.trim()) return;
    readerService.createCollection(userId, newColName.trim(), newColDesc.trim());
    setNewColName('');
    setNewColDesc('');
    setShowCreateModal(false);
  };

  if (!shouldRender) return null;

  return (
    <div
      {...swipeHandlers}
      className={`fixed inset-0 z-30 overflow-y-auto bg-[linear-gradient(90deg,rgba(2,64,99,1)_0%,rgba(60,168,63,1)_22%,rgba(4,74,111,1)_100%)] transition-all duration-[250ms] ease-in-out ${
        isClosing ? 'opacity-0 translate-x-8' : 'opacity-100 translate-x-0'
      }`}
    >
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 pt-24 pb-8">
      {/* Anonymous visitor notice if not logged in */}
      {!currentUser && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-4 mb-6 flex items-center justify-between gap-4">
          <div className="flex items-center space-x-3 text-xs text-amber-200">
            <Bookmark className="w-5 h-5 text-[#f59e0b] shrink-0" />
            <div>
              <p className="font-bold text-white">Browsing Collections in Guest Session</p>
              <p className="text-amber-200/80">Your collections are saved locally in this browser. Sign in with Google to sync collections across devices.</p>
            </div>
          </div>
          <button
            onClick={onOpenAuth}
            className="px-3.5 py-1.5 bg-[#f59e0b] hover:bg-amber-400 text-black rounded-lg text-xs font-bold uppercase tracking-wider shrink-0 cursor-pointer"
          >
            Sign In
          </button>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="font-display-title text-2xl sm:text-3xl font-bold text-white mb-1">
            Personal Collections
          </h1>
          <p className="text-xs sm:text-sm text-white">
            Organize your work — press <kbd className="px-1.5 py-0.5 rounded border border-white/40 font-mono text-[10px]">s</kbd> anywhere to jump to it
          </p>
        </div>

        <button
          id="btn-create-collection-modal"
          onClick={() => setShowCreateModal(true)}
          className="flex items-center space-x-2 px-4 py-2.5 bg-[#f59e0b] hover:bg-amber-400 text-black rounded-xl text-xs font-bold uppercase tracking-wider shadow-sm transition-colors cursor-pointer"
        >
          <Plus className="w-4 h-4 text-black" />
          <span>New Collection</span>
        </button>
      </div>

      {/* Same card as the work page's (bg-scriptorium-blue: index.css's --scriptorium-card-blue). */}
      <div className="bg-scriptorium-blue rounded-2xl border border-emerald-500/20 p-4 sm:p-8 shadow-xl">
        <CollectionsPanel
          userId={userId}
          manage
          onSelectWork={onSelectWork}
          onSelectChapter={onSelectChapter}
          onOpenQuote={onOpenQuote}
          onRunSearch={onRunSearch}
        />
      </div>

      {/* New Collection Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-[#0b2921] rounded-2xl border border-emerald-500/30 p-6 max-w-md w-full shadow-2xl space-y-4">
            <h3 className="font-display-title text-lg font-bold text-white">
              Create New Collection
            </h3>

            <form onSubmit={handleCreateCollection} className="space-y-4 text-xs">
              <div>
                <label className="font-semibold text-emerald-200 block mb-1">Collection Name *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Stoic Readings, Greek Tragedy, Thesis Notes..."
                  value={newColName}
                  onChange={(e) => setNewColName(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-emerald-500/20 text-sm text-white placeholder:text-emerald-300/40 focus:outline-none focus:ring-1 focus:ring-[#f59e0b] bg-[#051a14]"
                />
              </div>

              <div>
                <label className="font-semibold text-emerald-200 block mb-1">Description (Optional)</label>
                <textarea
                  rows={2}
                  placeholder="Brief summary of what this collection tracks..."
                  value={newColDesc}
                  onChange={(e) => setNewColDesc(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-emerald-500/20 text-sm text-white placeholder:text-emerald-300/40 focus:outline-none focus:ring-1 focus:ring-[#f59e0b] bg-[#051a14]"
                />
              </div>

              <div className="flex items-center justify-end space-x-2 pt-2 border-t border-emerald-500/20">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 rounded-lg text-emerald-200/70 hover:text-white hover:bg-emerald-500/10 font-medium cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg bg-[#f59e0b] hover:bg-amber-400 text-black font-bold text-xs uppercase tracking-wider shadow-xs cursor-pointer"
                >
                  Create Collection
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
    </div>
  );
};
