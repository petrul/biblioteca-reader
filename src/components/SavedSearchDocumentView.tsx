import React from 'react';
import { Download, Play, Rows3 } from 'lucide-react';
import type { SavedSearch } from '../types/textbase';
import { exportSavedSearch } from '../services/savedSearches';
import { savedSearchEntryList } from '../library';
import { EntryListView } from './EntryListView';

interface SavedSearchDocumentViewProps {
  search: SavedSearch;
  onSelectWork: (workId: string) => void;
  onSelectChapter: (workId: string, chapterId: string) => void;
  onRerun: (search: SavedSearch) => void;
  onKeepAsCollection: (search: SavedSearch) => void;
}

export const SavedSearchDocumentView: React.FC<SavedSearchDocumentViewProps> = ({ search, onSelectWork, onSelectChapter, onRerun, onKeepAsCollection }) => {
  const list = savedSearchEntryList(search);
  return (
    <main id="saved-search-document" className="min-h-screen bg-scriptorium-blue px-4 pb-20 pt-24 sm:px-8">
      <article className="mx-auto max-w-4xl rounded-2xl border border-emerald-500/20 bg-black/15 p-5 shadow-xl sm:p-8">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-emerald-500/20 pb-5">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-300/70">Transversal document · search:{search.id}</p>
            <h1 className="mt-2 font-display-title text-2xl font-bold text-white">{search.name}</h1>
            <p className="mt-1 text-sm text-emerald-100/80">Frozen results for “{search.query}” · {search.items.length} result{search.items.length === 1 ? '' : 's'}</p>
            <p className="mt-1 text-xs text-emerald-200/60">Mode: {search.mode ?? 'all'} · Scope: {search.scope === 'work' ? `work ${search.scopeWorkId ?? ''}` : 'whole library'} · Saved {new Date(search.createdAt).toLocaleString()}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => onRerun(search)} className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600/30 px-3 py-2 text-xs font-semibold text-emerald-100 hover:bg-emerald-600/50 cursor-pointer"><Play className="h-3.5 w-3.5" /> Rerun search</button>
            <button type="button" onClick={() => onKeepAsCollection(search)} className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500/20 px-3 py-2 text-xs font-semibold text-amber-100 hover:bg-amber-500/30 cursor-pointer"><Rows3 className="h-3.5 w-3.5" /> Keep as collection</button>
            {(['html', 'md', 'odt'] as const).map(format => <button key={format} type="button" title={`Export ${format.toUpperCase()}`} onClick={() => exportSavedSearch(search.id, format)} className="inline-flex items-center gap-1 rounded-lg border border-emerald-400/20 px-2.5 py-2 text-[11px] text-emerald-100 hover:bg-emerald-500/15 cursor-pointer"><Download className="h-3 w-3" /> {format.toUpperCase()}</button>)}
          </div>
        </div>
        <div className="mt-6">
          <EntryListView list={list} onOpen={entry => { if (entry.chapterId) onSelectChapter(entry.workId, entry.chapterId); else onSelectWork(entry.workId); }} />
        </div>
      </article>
    </main>
  );
};
