import React, { useEffect, useState } from 'react';
import type { Entry, EntryList } from '../library';

interface EntryListViewProps {
  list: EntryList;
  onOpen: (entry: Entry) => void;
}

// One renderer for all list-like surfaces. The list contract owns paging; the
// component remains intentionally small so it can later be virtualized without
// changing collections, searches or saved-search documents.
export const EntryListView: React.FC<EntryListViewProps> = ({ list, onOpen }) => {
  const [entries, setEntries] = useState<Awaited<ReturnType<EntryList['page']>>['entries']>([]);
  useEffect(() => { let alive = true; void list.page(0, 100).then(page => { if (alive) setEntries(page.entries); }); return () => { alive = false; }; }, [list]);
  return (
    <div data-testid="entry-list" className="space-y-2">
      {entries.map(entry => (
        <button key={entry.id} type="button" className="w-full rounded-xl border border-emerald-500/20 bg-black/20 p-3 text-left hover:bg-black/30 hover:border-emerald-400/40 cursor-pointer" onClick={() => onOpen(entry)}>
          <span className="block text-sm font-semibold text-white">{entry.label}</span>
          <span className="block text-[11px] text-emerald-200/70">{entry.authorName} · {entry.workTitle} · {entry.source}{entry.score !== undefined ? ` · score ${entry.score.toFixed(3)}` : ''}{entry.addedAt ? ` · ${new Date(entry.addedAt).toLocaleDateString()}` : ''}</span>
          {entry.snippet && <span className="mt-1 block text-xs text-emerald-100/75 line-clamp-3">{entry.snippet}</span>}
        </button>
      ))}
      {!entries.length && <p className="text-sm text-emerald-200/60">This saved search has no frozen results.</p>}
    </div>
  );
};
