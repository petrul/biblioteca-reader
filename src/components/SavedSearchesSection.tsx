import React, { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, Pencil, Play, Search, Trash2 } from 'lucide-react';
import { SavedSearch } from '../types/textbase';
import {
  deleteSavedSearch,
  getSavedSearches,
  renameSavedSearch,
  subscribeSavedSearches,
} from '../services/savedSearches';

interface SavedSearchesSectionProps {
  onRunSearch: (query: string) => void;
  onSelectWork: (workId: string) => void;
  onSelectChapter: (workId: string, chapterId: string) => void;
}

/** The "Saved searches" part of the collections card. */
export const SavedSearchesSection: React.FC<SavedSearchesSectionProps> = ({ onRunSearch, onSelectWork, onSelectChapter }) => {
  const [, setRevision] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => subscribeSavedSearches(() => setRevision(n => n + 1)), []);

  const searches: SavedSearch[] = getSavedSearches();

  const commitRename = (search: SavedSearch) => {
    setEditingId(null);
    if (!draftName.trim() || draftName.trim() === search.name) return;
    renameSavedSearch(search.id, draftName).catch(e => setError(`Could not rename: ${e.message}`));
  };

  return (
    <div id="saved-searches-section" className="mt-6 space-y-2">
      <h3 className="text-[10px] font-bold uppercase tracking-widest text-emerald-300/60 mb-3 px-2">
        Saved searches ({searches.length})
      </h3>
      {error && <p className="px-2 text-[11px] text-red-300">{error}</p>}
      {searches.length === 0 && (
        <p className="px-2 text-[11px] text-emerald-300/50">Use “Save search” on a search page to keep its results here.</p>
      )}
      {searches.map(search => {
        const isOpen = openId === search.id;
        return (
          <div key={search.id} id={`saved-search-${search.id}`}
               className="rounded-xl border border-emerald-500/20 bg-[#0b2921]/70 text-emerald-200/80">
            <div className="flex items-center justify-between p-3 gap-2">
              <button type="button" className="flex items-center space-x-2 truncate text-left cursor-pointer"
                      onClick={() => setOpenId(isOpen ? null : search.id)}>
                {isOpen ? <ChevronDown className="w-4 h-4 shrink-0" /> : <ChevronRight className="w-4 h-4 shrink-0" />}
                <Search className="w-4 h-4 shrink-0 text-[#f59e0b]" />
                <span className="truncate">
                  {editingId === search.id ? (
                    <input
                      autoFocus
                      value={draftName}
                      onClick={e => e.stopPropagation()}
                      onChange={e => setDraftName(e.target.value)}
                      onBlur={() => commitRename(search)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') commitRename(search);
                        if (e.key === 'Escape') setEditingId(null);
                      }}
                      className="w-full px-1 rounded bg-[#051a14] text-xs text-white border border-emerald-500/30"
                    />
                  ) : (
                    <>
                      <span className="block text-xs font-bold truncate">{search.name}</span>
                      <span className="block text-[10px] text-emerald-300/50">
                        {search.items.length} {search.items.length === 1 ? 'result' : 'results'}
                      </span>
                    </>
                  )}
                </span>
              </button>
              <div className="flex items-center shrink-0">
                <button type="button" title="Run this search again" className="p-1 hover:text-white cursor-pointer"
                        onClick={() => onRunSearch(search.query)}>
                  <Play className="w-3.5 h-3.5" />
                </button>
                <button type="button" title="Rename" className="p-1 hover:text-white cursor-pointer"
                        onClick={() => { setDraftName(search.name); setEditingId(search.id); }}>
                  <Pencil className="w-3.5 h-3.5" />
                </button>
                <button type="button" title="Delete saved search" className="p-1 hover:text-red-400 cursor-pointer"
                        onClick={() => {
                          if (confirm(`Delete the saved search “${search.name}”?`)) {
                            deleteSavedSearch(search.id).catch(e => setError(`Could not delete: ${e.message}`));
                          }
                        }}>
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
            {isOpen && (
              <ul className="border-t border-emerald-500/15 divide-y divide-emerald-500/10">
                <li className="px-3 py-2 text-[10px] text-emerald-300/60">Query: “{search.query}”</li>
                {search.items.map(item => (
                  <li key={item.id}>
                    <button type="button" className="w-full text-left px-3 py-2 hover:bg-emerald-500/10 cursor-pointer"
                            onClick={() => (item.chapterId ? onSelectChapter(item.workId, item.chapterId) : onSelectWork(item.workId))}>
                      <span className="block text-[11px] font-bold text-white truncate">{item.workTitle}</span>
                      {item.snippet && <span className="block text-[11px] text-emerald-200/70 line-clamp-2">«{item.snippet}»</span>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
};
