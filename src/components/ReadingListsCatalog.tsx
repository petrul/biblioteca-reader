import React from 'react';
import { ChevronRight } from 'lucide-react';
import { LanguageCode, SystemReadingList } from '../types/textbase';

export interface ReadingListsCatalogProps {
  lists: SystemReadingList[];
  selectedType: 'all' | 'language' | 'author' | 'repo';
  onTypeChange: (type: 'all' | 'language' | 'author' | 'repo') => void;
  onSelectAuthor: (authorId: string) => void;
  onSelectWorks: (language?: LanguageCode) => void;
}

export const ReadingListsCatalog: React.FC<ReadingListsCatalogProps> = ({ lists, selectedType, onTypeChange, onSelectAuthor, onSelectWorks }) => (
  <div className="space-y-6">
    <div className="flex items-center space-x-2 border-b border-emerald-500/20 pb-3">
      <span className="text-xs font-medium text-emerald-100/70">Filter by category:</span>
      {(['all', 'language', 'author', 'repo'] as const).map(type => <button key={type} onClick={() => onTypeChange(type)} className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors cursor-pointer ${selectedType === type ? 'bg-[#0f3d30] text-white border border-emerald-500/30' : 'bg-emerald-950/40 text-emerald-200/70 hover:text-white'}`}>{type === 'all' ? 'All System Lists' : type === 'language' ? 'By Language' : type === 'author' ? 'By Author' : 'By Source Repo'}</button>)}
    </div>
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {lists.map(list => <div key={list.id} id={`card-list-${list.id}`} className="bg-[#0b2921]/80 rounded-xl border border-emerald-500/20 p-5 shadow-md flex flex-col justify-between hover:border-amber-500/50 transition-all">
        <div><div className="flex items-center justify-between mb-2"><span className="text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded bg-amber-500/10 text-[#f59e0b] border border-amber-500/20 font-bold">{list.type === 'language' ? 'Language List' : list.type === 'author' ? 'Author List' : 'Repo List'}</span><span className="text-xs font-bold text-emerald-200/70 font-mono">{list.count} {list.count === 1 ? 'Work' : 'Works'}</span></div>
          <h3 className="font-display-title text-base font-bold text-white mb-1">{list.title}</h3><p className="text-xs text-[#f59e0b] font-medium mb-3">{list.subtitle}</p><p className="text-xs text-emerald-100/70 mb-4 leading-relaxed font-serif-reading">{list.description}</p>
          <div className="bg-[#051a14] rounded-lg p-3 border border-emerald-500/20 mb-4"><p className="text-[10px] font-bold text-emerald-300/60 uppercase tracking-wider mb-1.5">Included Works:</p><ul className="space-y-1">{list.sampleWorkTitles.map((title, index) => <li key={index} className="text-xs text-emerald-100/90 font-serif-reading flex items-center space-x-1.5"><span className="w-1.5 h-1.5 rounded-full bg-[#f59e0b]" /><span>{title}</span></li>)}</ul></div>
        </div><button id={`btn-explore-list-${list.id}`} onClick={() => list.authorId ? onSelectAuthor(list.authorId) : onSelectWorks(list.languageCode)} className="w-full py-2.5 px-3 rounded-lg bg-[#0f3d30] hover:bg-emerald-700/40 text-white text-xs font-semibold uppercase tracking-wider flex items-center justify-center space-x-1.5 border border-emerald-500/30 transition-colors cursor-pointer"><span>Explore this Reading List</span><ChevronRight className="w-3.5 h-3.5 text-[#f59e0b]" /></button>
      </div>)}
    </div>
  </div>
);
