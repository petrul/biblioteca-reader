import React, { useState, useEffect } from 'react';
import { X, Bookmark, Plus, Check, Star } from 'lucide-react';
import { User, PersonalCollection, CollectionItemType } from '../types/textbase';
import { readerService, ANONYMOUS_USER_ID } from '../services/readerService';

export interface AddToCollectionPayload {
  type: CollectionItemType;
  referenceId: string;
  workId: string;
  workTitle: string;
  authorName: string;
  chapterId?: string;
  chapterTitle?: string;
  quoteText?: string;
}

interface AddToCollectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: User | null;
  payload: AddToCollectionPayload | null;
  onSuccess: () => void;
}

export const AddToCollectionModal: React.FC<AddToCollectionModalProps> = ({
  isOpen,
  onClose,
  currentUser,
  payload,
  onSuccess
}) => {
  const userId = currentUser?.id || ANONYMOUS_USER_ID;
  const [collections, setCollections] = useState<PersonalCollection[]>([]);
  const [selectedColId, setSelectedColId] = useState<string>('');
  const [note, setNote] = useState<string>('');
  const [showNewColInput, setShowNewColInput] = useState(false);
  const [newColName, setNewColName] = useState('');
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      const cols = readerService.getCollections(userId);
      setCollections(cols);
      if (cols.length > 0) {
        setSelectedColId(cols[0].id);
      }
      setNote('');
      setShowNewColInput(false);
      setSavedSuccess(false);
      setSaving(false);
      setSaveError(null);
    }
  }, [isOpen, userId]);

  if (!isOpen || !payload) return null;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    try {
      if (saveError) {
        await readerService.retryCollectionsSave(userId);
      } else {
        let targetColId = selectedColId;
        if (showNewColInput && newColName.trim()) {
          targetColId = readerService.createCollection(userId, newColName.trim()).id;
        }
        const saved = readerService.addItemToCollection(userId, targetColId, {
          type: payload.type,
          referenceId: payload.referenceId,
          workId: payload.workId,
          workTitle: payload.workTitle,
          authorName: payload.authorName,
          chapterId: payload.chapterId,
          chapterTitle: payload.chapterTitle,
          quoteText: payload.quoteText,
          note: note.trim() || undefined
        });
        if (!saved) throw new Error('The selected collection is no longer available');
        await readerService.flushCollections(userId);
      }
      setSaveError(null);
      setSavedSuccess(true);
      setTimeout(() => {
        onSuccess();
        onClose();
      }, 1000);
    } catch {
      setSaveError('Could not save your collection. Keep this page open and retry.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-[#0b2921] rounded-2xl border border-emerald-500/30 max-w-md w-full p-6 shadow-2xl space-y-5 animate-in fade-in zoom-in-95 duration-150">
        <div className="flex items-center justify-between border-b border-emerald-500/20 pb-3">
          <div className="flex items-center space-x-2 text-white">
            <Bookmark className="w-5 h-5 text-[#f59e0b]" />
            <h3 className="font-display-title text-base font-bold">
              Save to Personal Collection
            </h3>
          </div>
          <button onClick={onClose} className="text-emerald-300 hover:text-white cursor-pointer">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Item Preview */}
        <div className="p-3 bg-[#051a14] rounded-xl border border-emerald-500/20 text-xs space-y-1">
          <div className="flex items-center justify-between text-emerald-300/60 font-mono text-[10px]">
            <span className="uppercase font-bold text-[#f59e0b]">{payload.type} ITEM</span>
            <span>{payload.authorName}</span>
          </div>
          <p className="font-bold text-white font-display-title">
            {payload.workTitle}
          </p>
          {payload.chapterTitle && (
            <p className="text-emerald-200/60 font-serif-reading italic">
              — {payload.chapterTitle}
            </p>
          )}
          {payload.quoteText && (
            <p className="text-emerald-100 italic border-l border-[#f59e0b] pl-2 mt-1">
              «{payload.quoteText.slice(0, 120)}...»
            </p>
          )}
        </div>

        {savedSuccess ? (
          <div className="py-6 text-center space-y-2 text-emerald-400 font-medium text-xs">
            <div className="w-10 h-10 bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded-full flex items-center justify-center mx-auto">
              <Check className="w-6 h-6" />
            </div>
            <p className="font-bold">Successfully saved to collection!</p>
          </div>
        ) : (
          <form onSubmit={handleSave} className="space-y-4 text-xs">
            {/* Target Collection Selection */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="font-bold text-emerald-200">Choose Collection</label>
                <button
                  type="button"
                  onClick={() => setShowNewColInput(!showNewColInput)}
                  className="text-[#f59e0b] hover:text-amber-400 font-semibold flex items-center space-x-1 cursor-pointer"
                >
                  <Plus className="w-3 h-3" />
                  <span>{showNewColInput ? 'Select Existing' : 'Create New'}</span>
                </button>
              </div>

              {showNewColInput ? (
                <input
                  type="text"
                  required
                  placeholder="Enter new collection name..."
                  value={newColName}
                  onChange={(e) => setNewColName(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-emerald-500/20 bg-[#051a14] text-white focus:outline-none focus:ring-1 focus:ring-[#f59e0b]"
                />
              ) : (
                <div className="space-y-1.5 max-h-40 overflow-y-auto">
                  {collections.map((col) => (
                    <label
                      key={col.id}
                      className={`flex items-center justify-between p-2.5 rounded-lg border cursor-pointer transition-colors ${
                        selectedColId === col.id
                          ? 'border-emerald-400/60 bg-[#0f3d30] text-white font-bold ring-1 ring-emerald-400/30'
                          : 'border-emerald-500/20 bg-[#051a14] hover:bg-[#07241c] text-emerald-200/80'
                      }`}
                    >
                      <div className="flex items-center space-x-2 truncate">
                        <input
                          type="radio"
                          name="collectionSelect"
                          value={col.id}
                          checked={selectedColId === col.id}
                          onChange={() => setSelectedColId(col.id)}
                          className="accent-[#f59e0b]"
                        />
                        <span className="truncate">{col.name}</span>
                      </div>
                      <span className="text-[10px] text-emerald-300/50 font-mono">
                        {col.items.length} items
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </div>

            {/* Optional Scholarly Note */}
            <div>
              <label className="font-semibold text-emerald-200 block mb-1">
                Scholarly Note / Tag (Optional)
              </label>
              <input
                type="text"
                placeholder="e.g. Reference for Chapter 3 thesis argument..."
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-emerald-500/20 bg-[#051a14] text-white focus:outline-none focus:ring-1 focus:ring-[#f59e0b]"
              />
            </div>

            {/* Action Buttons */}
            {saveError && <p role="alert" className="text-amber-300">{saveError}</p>}
            <div className="flex items-center justify-end space-x-2 pt-2 border-t border-emerald-500/20">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-lg text-emerald-200/70 hover:text-white hover:bg-emerald-500/10 font-medium cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-5 py-2 rounded-lg bg-[#f59e0b] hover:bg-amber-400 text-black font-bold uppercase tracking-wider shadow-sm cursor-pointer"
              >
                {saving ? 'Saving…' : saveError ? 'Retry Save' : 'Save'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
