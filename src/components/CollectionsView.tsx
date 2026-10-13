import React, { useState, useEffect } from 'react';
import { 
  Bookmark, 
  Plus, 
  Trash2, 
  BookOpen, 
  Quote, 
  Layers, 
  ExternalLink, 
  ChevronRight, 
  ChevronUp,
  ChevronDown,
  Search,
  Star,
  FolderPlus,
  LogIn
} from 'lucide-react';
import { PersonalCollection, CollectionItem, User, CollectionItemType } from '../types/textbase';
import { readerService, ANONYMOUS_USER_ID } from '../services/readerService';
import { SavedSearchesSection } from './SavedSearchesSection';
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
  // Read on every render, never copied into state: App keeps this view
  // mounted and re-renders on readerService changes, and a copy taken at
  // mount went stale - chapters bookmarked in the reader (saved through
  // AddToCollectionModal) never showed up in Favorites.
  const collections: PersonalCollection[] = readerService.getCollections(userId);
  const [selectedColId, setSelectedColId] = useState<string>('');
  
  // New Collection Form
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newColName, setNewColName] = useState('');
  const [newColDesc, setNewColDesc] = useState('');

  // Item filter
  const [typeFilter, setTypeFilter] = useState<'all' | CollectionItemType>('all');
  const [itemQuery, setItemQuery] = useState('');

  const handleCreateCollection = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newColName.trim()) return;
    const created = readerService.createCollection(userId, newColName.trim(), newColDesc.trim());
    setSelectedColId(created.id);
    setNewColName('');
    setNewColDesc('');
    setShowCreateModal(false);
  };

  const handleDeleteCollection = (colId: string) => {
    if (confirm('Are you sure you want to delete this collection?')) {
      readerService.deleteCollection(userId, colId);
    }
  };

  const handleRemoveItem = (colId: string, itemId: string) => {
    readerService.removeItemFromCollection(userId, colId, itemId);
  };

  const currentCollection = collections.find(c => c.id === selectedColId) || collections[0];
  // Each type tab shows its count, like "All (n)".
  const canReorder = typeFilter === 'all' && !itemQuery.trim();
  const countOfType = (type: CollectionItemType) => currentCollection?.items.filter(i => i.type === type).length ?? 0;

  let filteredItems = currentCollection ? currentCollection.items : [];
  if (typeFilter !== 'all') {
    filteredItems = filteredItems.filter(i => i.type === typeFilter);
  }
  if (itemQuery.trim()) {
    const q = itemQuery.toLowerCase();
    filteredItems = filteredItems.filter(i => 
      i.workTitle.toLowerCase().includes(q) ||
      i.authorName.toLowerCase().includes(q) ||
      (i.chapterTitle && i.chapterTitle.toLowerCase().includes(q)) ||
      (i.quoteText && i.quoteText.toLowerCase().includes(q)) ||
      (i.note && i.note.toLowerCase().includes(q))
    );
  }

  if (!shouldRender) return null;

  return (
    <div
      {...swipeHandlers}
      className={`fixed inset-0 z-30 overflow-y-auto bg-[linear-gradient(90deg,rgba(2,64,99,1)_0%,rgba(60,168,63,1)_22%,rgba(4,74,111,1)_100%)] transition-all duration-[250ms] ease-in-out ${
        isClosing ? 'opacity-0 translate-x-8' : 'opacity-100 translate-x-0'
      }`}
    >
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-24 pb-8">
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
            Organize your work
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

      {/* Two-column layout: Sidebar Collections list + Main Items View */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
        {/* Left Sidebar: Collection Tabs */}
        <div className="lg:col-span-1 space-y-2">
          <h3 className="text-[10px] font-bold uppercase tracking-widest text-emerald-300/60 mb-3 px-2">
            Your Reading Lists ({collections.length})
          </h3>

          <div className="space-y-1.5">
            {collections.map((col) => {
              const isSelected = currentCollection?.id === col.id;
              return (
                <div
                  key={col.id}
                  id={`collection-tab-${col.id}`}
                  onClick={() => setSelectedColId(col.id)}
                  className={`flex items-center justify-between p-3 rounded-xl cursor-pointer transition-all ${
                    isSelected
                      ? 'bg-[#0f3d30] text-white shadow-md border border-emerald-400/50 ring-1 ring-emerald-400/30'
                      : 'bg-[#0b2921]/70 hover:bg-[#0b2921] text-emerald-200/80 border border-emerald-500/20'
                  }`}
                >
                  <div className="flex items-center space-x-2.5 truncate">
                    {col.isDefaultFavorites ? (
                      <Star className={`w-4 h-4 shrink-0 ${isSelected ? 'text-[#f59e0b] fill-[#f59e0b]' : 'text-[#f59e0b]'}`} />
                    ) : (
                      <Bookmark className={`w-4 h-4 shrink-0 ${isSelected ? 'text-[#f59e0b]' : 'text-emerald-300/70'}`} />
                    )}
                    <div className="truncate">
                      <p className="text-xs font-bold truncate leading-tight">
                        {col.name}
                      </p>
                      <p className={`text-[10px] ${isSelected ? 'text-emerald-200/70' : 'text-emerald-300/50'}`}>
                        {col.items.length} {col.items.length === 1 ? 'item' : 'items'}
                      </p>
                    </div>
                  </div>

                  {!col.isDefaultFavorites && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteCollection(col.id);
                      }}
                      title="Delete Collection"
                      className={`p-1 rounded opacity-0 group-hover:opacity-100 hover:text-red-400 transition-opacity ${isSelected ? 'text-emerald-300 hover:text-red-400' : 'text-emerald-400 hover:text-red-400'}`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          <SavedSearchesSection onRunSearch={onRunSearch} onSelectWork={onSelectWork} onSelectChapter={onSelectChapter} />
        </div>

        {/* Right Main Panel: Collection Details and Saved Items */}
        <div className="lg:col-span-3 space-y-6">
          {currentCollection && (
            // Same card as the work page's (bg-scriptorium-blue: index.css's --scriptorium-card-blue).
            <div className="bg-scriptorium-blue rounded-2xl border border-emerald-500/20 p-6 sm:p-8 shadow-xl">
              {/* Collection Header */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-emerald-500/15">
                <div>
                  <div className="flex items-center space-x-2 mb-1">
                    {currentCollection.isDefaultFavorites && (
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-amber-500/15 text-[#f59e0b] border border-amber-500/30">
                        Default Favorites (Protected)
                      </span>
                    )}
                    <span className="text-xs text-emerald-200/60 font-mono">
                      Updated {new Date(currentCollection.updatedAt).toLocaleDateString()}
                    </span>
                  </div>
                  <h2 className="font-display-title text-xl font-bold text-white">
                    {currentCollection.name}
                  </h2>
                  {currentCollection.description && (
                    <p className="text-xs text-emerald-200/70 mt-1 font-serif-reading">
                      {currentCollection.description}
                    </p>
                  )}
                </div>

                {!currentCollection.isDefaultFavorites && (
                  <button
                    onClick={() => handleDeleteCollection(currentCollection.id)}
                    className="flex items-center space-x-1.5 px-3 py-1.5 text-xs text-red-400 hover:bg-red-500/10 border border-red-500/20 rounded-lg transition-colors self-start cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Delete Collection</span>
                  </button>
                )}
              </div>

              {/* Items Filter Bar */}
              <div className="flex flex-wrap items-center justify-between gap-3 pt-4">
                <div className="flex items-center space-x-1 bg-[#051a14] p-1 rounded-lg border border-emerald-500/20">
                  <button
                    onClick={() => setTypeFilter('all')}
                    className={`px-3 py-1 rounded text-xs font-medium transition-colors cursor-pointer ${
                      typeFilter === 'all' ? 'bg-[#0f3d30] text-white shadow-xs font-bold border border-emerald-500/30' : 'text-emerald-200/60 hover:text-white'
                    }`}
                  >
                    All ({currentCollection.items.length})
                  </button>
                  <button
                    onClick={() => setTypeFilter('work')}
                    className={`px-3 py-1 rounded text-xs font-medium transition-colors cursor-pointer ${
                      typeFilter === 'work' ? 'bg-[#0f3d30] text-white shadow-xs font-bold border border-emerald-500/30' : 'text-emerald-200/60 hover:text-white'
                    }`}
                  >
                    Works ({countOfType('work')})
                  </button>
                  <button
                    onClick={() => setTypeFilter('chapter')}
                    className={`px-3 py-1 rounded text-xs font-medium transition-colors cursor-pointer ${
                      typeFilter === 'chapter' ? 'bg-[#0f3d30] text-white shadow-xs font-bold border border-emerald-500/30' : 'text-emerald-200/60 hover:text-white'
                    }`}
                  >
                    Chapters ({countOfType('chapter')})
                  </button>
                  <button
                    onClick={() => setTypeFilter('quote')}
                    className={`px-3 py-1 rounded text-xs font-medium transition-colors cursor-pointer ${
                      typeFilter === 'quote' ? 'bg-[#0f3d30] text-white shadow-xs font-bold border border-emerald-500/30' : 'text-emerald-200/60 hover:text-white'
                    }`}
                  >
                    Quotations ({countOfType('quote')})
                  </button>
                </div>

                <div className="relative">
                  <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-emerald-400/60" />
                  <input
                    type="text"
                    placeholder="Search in this collection..."
                    value={itemQuery}
                    onChange={(e) => setItemQuery(e.target.value)}
                    className="pl-8 pr-3 py-1.5 rounded-lg border border-emerald-500/20 text-xs text-white placeholder:text-emerald-300/40 focus:outline-none focus:ring-1 focus:ring-[#f59e0b] bg-[#051a14]"
                  />
                </div>
              </div>

              {/* Items List */}
              <div className="mt-6 space-y-3">
                {filteredItems.length === 0 ? (
                  <div className="py-12 text-center text-emerald-200/60 text-xs space-y-2">
                    <Bookmark className="w-8 h-8 text-emerald-400/40 mx-auto" />
                    <p>No items found in this collection.</p>
                    <p className="text-[11px] text-emerald-300/40">
                      You can add works, chapters, or quotation fragments from anywhere in the app!
                    </p>
                  </div>
                ) : (
                  filteredItems.map((item, index) => (
                    <div
                      key={item.id}
                      id={`col-item-${item.id}`}
                      className="p-4 rounded-xl border border-emerald-500/20 hover:border-emerald-400/40 transition-all flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-black/20 hover:bg-black/30"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center space-x-2">
                          <span className={`text-[10px] font-bold uppercase font-mono px-2 py-0.5 rounded border ${
                            item.type === 'work' ? 'bg-amber-500/15 text-[#f59e0b] border-amber-500/30' :
                            item.type === 'chapter' ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30' :
                            'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                          }`}>
                            {item.type}
                          </span>
                          <span className="text-xs font-semibold text-emerald-200/70">
                            {item.authorName}
                          </span>
                        </div>

                        <h4 className="font-display-title text-sm sm:text-base font-bold text-white">
                          {item.workTitle}
                          {item.chapterTitle && <span className="font-normal font-serif-reading text-emerald-200/60 text-xs ml-2">— {item.chapterTitle}</span>}
                        </h4>

                        {item.quoteText && (
                          <blockquote className="font-serif-reading text-xs italic text-emerald-100 border-l-2 border-[#f59e0b] pl-3 py-0.5">
                            «{item.quoteText}»
                          </blockquote>
                        )}

                        {item.note && (
                          <p className="text-[11px] text-emerald-200/60 italic">
                            Note: {item.note}
                          </p>
                        )}
                      </div>

                      <div className="flex items-center space-x-2 shrink-0 self-end sm:self-auto">
                        {/* Reorder: only on the unfiltered list, where up/down are unambiguous. */}
                        {canReorder && (
                          <div className="flex items-center" role="group" aria-label={`Move ${item.workTitle}`}>
                            <button
                              type="button"
                              aria-label="Move up"
                              title="Move up"
                              disabled={index === 0}
                              onClick={() => readerService.moveItemInCollection(userId, currentCollection.id, item.id, -1)}
                              className="p-2 text-emerald-200/60 hover:text-white hover:bg-emerald-500/10 rounded-lg transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-default"
                            >
                              <ChevronUp className="w-4 h-4" />
                            </button>
                            <button
                              type="button"
                              aria-label="Move down"
                              title="Move down"
                              disabled={index === filteredItems.length - 1}
                              onClick={() => readerService.moveItemInCollection(userId, currentCollection.id, item.id, 1)}
                              className="p-2 text-emerald-200/60 hover:text-white hover:bg-emerald-500/10 rounded-lg transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-default"
                            >
                              <ChevronDown className="w-4 h-4" />
                            </button>
                          </div>
                        )}
                        <button
                          onClick={() => handleRemoveItem(currentCollection.id, item.id)}
                          title="Remove from collection"
                          className="p-2 text-emerald-200/60 hover:text-red-400 hover:bg-emerald-500/10 rounded-lg transition-colors cursor-pointer"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>

                        <button
                          onClick={() => {
                            if (item.type === 'quote') {
                              onOpenQuote(item.referenceId);
                            } else if (item.type === 'chapter' && item.chapterId) {
                              onSelectChapter(item.workId, item.chapterId);
                            } else {
                              onSelectWork(item.workId);
                            }
                          }}
                          className="flex items-center space-x-1 px-3 py-1.5 rounded-lg bg-[#0f3d30] hover:bg-emerald-700/50 text-white border border-emerald-500/30 text-xs font-semibold uppercase tracking-wider transition-colors cursor-pointer"
                        >
                          <span>Open</span>
                          <ChevronRight className="w-3.5 h-3.5 text-[#f59e0b]" />
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
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
