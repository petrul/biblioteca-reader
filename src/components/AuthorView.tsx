import React from 'react';
import { ArrowLeft, Globe, Calendar, ChevronRight, Bookmark } from 'lucide-react';
import { readerService } from '../services/readerService';
import { appAsset } from '../services/serversideApi';
import { languageName } from '../services/languageNames';
import { WorkCoverImage } from './DefaultWorkCover';

interface AuthorViewProps {
  authorId: string;
  onBack: () => void;
  onSelectWork: (workId: string) => void;
  onSelectChapter: (workId: string, chapterId: string) => void;
  onOpenAddToCollection: (item: { type: 'work'; referenceId: string; workId: string; workTitle: string; authorName: string }) => void;
}

export const AuthorView: React.FC<AuthorViewProps> = ({
  authorId,
  onBack,
  onSelectWork,
  onSelectChapter,
  onOpenAddToCollection
}) => {
  const author = readerService.getAuthorById(authorId);
  const works = author ? readerService.getAuthorWorks(author.id) : [];

  if (!author) {
    if (readerService.isAuthorLoading(authorId)) {
      return (
        <div className="max-w-4xl mx-auto px-4 py-12 text-center">
          <p className="text-white mb-4">Loading author…</p>
        </div>
      );
    }
    return (
      <div className="max-w-4xl mx-auto px-4 py-12 text-center">
        <p className="text-white mb-4">Author not found in textbase catalog.</p>
        <button
          onClick={onBack}
          className="px-4 py-2 bg-[#f59e0b] hover:bg-amber-400 text-black font-bold rounded-lg text-xs uppercase tracking-wider"
        >
          Back
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Back button */}
      <button
        id="btn-author-back"
        onClick={onBack}
        className="inline-flex items-center space-x-1.5 text-xs font-semibold text-white hover:text-amber-300 transition-colors mb-6 group cursor-pointer"
      >
        <ArrowLeft className="w-4 h-4 transition-transform group-hover:-translate-x-1" />
        <span>Back</span>
      </button>

      {/* Author Header Profile */}
      <div className="bg-[#0b2921]/90 rounded-2xl border border-emerald-500/20 p-6 sm:p-8 shadow-xl mb-8">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6 pb-6 border-b border-emerald-500/15">
          <div className="flex items-center space-x-4">
            {author.imageHref ? (
              <img src={author.imageHref} alt={author.name} className="w-16 h-16 rounded-2xl object-cover border border-amber-500/30 shadow-inner" />
            ) : (
              <div className="w-16 h-16 rounded-2xl bg-amber-500/15 text-[#f59e0b] font-display-title font-bold text-2xl flex items-center justify-center border border-amber-500/30 shadow-inner">
                {author.name.slice(0, 2).toUpperCase()}
              </div>
            )}
            <div>
              <div className="flex items-center space-x-2 mb-1">
                <span className="font-mono text-[10px] px-2 py-0.5 rounded bg-emerald-950/60 text-emerald-200/70 border border-emerald-500/20">
                  Canonical ID: {author.canonicalId}
                </span>
                <span className="font-mono text-[10px] px-2 py-0.5 rounded bg-amber-500/10 text-[#f59e0b] border border-amber-500/20 font-bold">
                  Lang: {languageName(author.language)}
                </span>
              </div>
              <h1 className="font-display-title text-2xl sm:text-3xl font-bold text-white">
                {author.name}
              </h1>
            </div>
          </div>

          <div className="flex flex-col sm:items-end text-xs text-emerald-100/70 space-y-1">
            <div className="flex items-center space-x-1 font-medium">
              <Globe className="w-3.5 h-3.5 text-emerald-400" />
              <span>{author.nationality}</span>
            </div>
            <div className="flex items-center space-x-1 text-emerald-200/60">
              <Calendar className="w-3.5 h-3.5 text-emerald-400" />
              <span>
                {author.era ? `${author.era} • ` : ''}
                {author.birthYear ? (author.birthYear < 0 ? `${Math.abs(author.birthYear)} BC` : author.birthYear) : ''}
                {author.deathYear ? ` – ${author.deathYear < 0 ? `${Math.abs(author.deathYear)} BC` : author.deathYear}` : ''}
              </span>
            </div>
          </div>
        </div>

        {/* Biography */}
        {author.bio && (
          <div className="pt-6">
            <p className="text-emerald-100/90 text-sm leading-relaxed font-serif-reading">
              {author.bio}
            </p>
          </div>
        )}
      </div>

      {/* Author Works List */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-display-title text-xl font-bold text-white">
            Works in Corpus ({works.length})
          </h2>
          <span className="text-xs text-emerald-200/60 font-mono">
            Encoded in TEI P5 XML
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {works.map((work) => (
            <div
              key={work.id}
              id={`author-work-${work.id}`}
              // The whole card is the navigation affordance - the work
              // page is one tap anywhere, not only on the title or the
              // OPEN WORK button (those keep their explicit affordances
              // for pointer/keyboard users). The card's own buttons
              // stop the bubbling so they keep their separate actions.
              onClick={() => onSelectWork(work.id)}
              className="bg-scriptorium-blue rounded-xl border border-emerald-500/20 p-5 shadow-md hover:border-amber-500/50 transition-all flex flex-col justify-between group cursor-pointer"
            >
              <div className="flex items-stretch">
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2 mb-2">
                  {work.origDate && (
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-950/60 text-emerald-200/70 border border-emerald-500/20">
                      {work.origDate}
                    </span>
                  )}
                  <span className="text-xs text-emerald-200/60 font-mono ml-auto">
                    {work.chapterCount} {work.chapterCount === 1 ? 'Chapter' : 'Chapters'}
                  </span>
                </div>

                <h3
                  className="font-display-title text-base font-bold text-white group-hover:text-[#f59e0b] transition-colors mb-1"
                >
                  {work.title}
                </h3>
                {work.subtitle && (
                  <p className="text-xs text-emerald-200/60 italic mb-2 font-serif-reading">
                    {work.subtitle}
                  </p>
                )}

                {work.summary && (
                  <p className="text-xs text-emerald-100/70 line-clamp-3 mb-4 leading-relaxed font-serif-reading">
                    {work.summary}
                  </p>
                )}
                </div>

                {/* Work cover, same pattern as the main-page works cards
                    (WorksCatalog): the generated cover image, or
                    DefaultWorkCover when there is none or it fails to load. */}
                <div className="w-28 sm:w-32 shrink-0 self-stretch bg-black/20 rounded-xl overflow-hidden ml-4">
                  <WorkCoverImage src={work.coverImage} title={work.title} author={author.name} className="h-full min-h-44 w-full" />
                </div>
              </div>

              <div className="pt-3 border-t border-emerald-500/15 flex items-center justify-between">
                <button
                  id={`btn-col-author-work-${work.id}`}
                  onClick={(event) => {
                    // keep the collection action - a tap here must not
                    // also navigate to the work page (the card is
                    // clickable everywhere else)
                    event.stopPropagation();
                    onOpenAddToCollection({
                      type: 'work',
                      referenceId: work.id,
                      workId: work.id,
                      workTitle: work.title,
                      authorName: author.name
                    });
                  }}
                  className="text-xs text-emerald-200/70 hover:text-white flex items-center space-x-1 font-medium transition-colors cursor-pointer"
                >
                  <Bookmark className="w-3.5 h-3.5 text-[#f59e0b]" />
                  <span>Save to Collection</span>
                </button>

                <button
                  id={`btn-read-author-work-${work.id}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    onSelectWork(work.id);
                  }}
                  className="flex items-center space-x-1 px-3 py-1.5 rounded-lg bg-[#0f3d30] hover:bg-emerald-700/50 text-white border border-emerald-500/30 text-xs font-semibold uppercase tracking-wider transition-colors cursor-pointer"
                >
                  <span>Open Work</span>
                  <ChevronRight className="w-3.5 h-3.5 text-[#f59e0b]" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
