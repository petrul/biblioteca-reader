import React, { useState } from 'react';
import { 
  ArrowLeft, 
  Quote, 
  BookOpen, 
  Share2, 
  Bookmark, 
  Copy, 
  Check, 
  ExternalLink,
  ChevronRight,
  Globe2
} from 'lucide-react';
import { Quotation } from '../types/textbase';
import { readerService } from '../services/readerService';

interface QuoteViewProps {
  quoteId: string;
  onBack: () => void;
  onOpenWork: (workId: string) => void;
  onOpenChapter: (workId: string, chapterId: string) => void;
  onOpenAddToCollection: (item: { 
    type: 'quote'; 
    referenceId: string; 
    workId: string; 
    workTitle: string; 
    authorName: string; 
    chapterId?: string; 
    chapterTitle?: string;
    quoteText?: string;
  }) => void;
}

export const QuoteView: React.FC<QuoteViewProps> = ({
  quoteId,
  onBack,
  onOpenWork,
  onOpenChapter,
  onOpenAddToCollection
}) => {
  const quote = readerService.getQuotationById(quoteId);
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedCitation, setCopiedCitation] = useState(false);

  if (!quote) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-16 text-center">
        <Quote className="w-10 h-10 text-stone-600 mx-auto mb-3" />
        <h2 className="font-display-title text-xl font-bold text-white mb-2">
          Quotation Fragment Not Found
        </h2>
        <p className="text-stone-400 text-sm mb-6">
          The requested textbase fragment link does not exist or may have been deleted.
        </p>
        <button
          onClick={onBack}
          className="px-4 py-2 bg-[#f59e0b] text-black rounded-xl text-xs font-bold uppercase tracking-wider hover:bg-amber-400 cursor-pointer"
        >
          Back
        </button>
      </div>
    );
  }

  const shareUrl = readerService.generateQuoteShareUrl(quote.id);

  const handleCopyCitation = () => {
    const citation = `«${quote.text}» — ${quote.authorName}, ${quote.workTitle} (${quote.chapterTitle}). Permanent TEI fragment citation: ${shareUrl}`;
    navigator.clipboard.writeText(citation);
    setCopiedCitation(true);
    setTimeout(() => setCopiedCitation(false), 2000);
  };

  const handleNativeShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: `Quote from ${quote.workTitle} by ${quote.authorName}`,
          text: `«${quote.text}» — ${quote.authorName}`,
          url: shareUrl
        });
      } catch {
        // Ignored
      }
    } else {
      navigator.clipboard.writeText(shareUrl);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    }
  };

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
      {/* Back button */}
      <button
        id="btn-quote-back"
        onClick={onBack}
        className="inline-flex items-center space-x-1.5 text-xs font-semibold text-emerald-300 hover:text-white transition-colors mb-8 group cursor-pointer"
      >
        <ArrowLeft className="w-4 h-4 transition-transform group-hover:-translate-x-1" />
        <span>Back</span>
      </button>

      {/* Standalone Quotation Card */}
      <div className="bg-[#0b2921]/95 rounded-3xl border border-emerald-500/30 p-8 sm:p-12 shadow-2xl relative overflow-hidden mb-8">
        <div className="absolute -top-6 -right-6 text-emerald-300/[0.04] pointer-events-none">
          <Quote className="w-48 h-48" />
        </div>

        <div className="relative z-10 space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-emerald-500/20 pb-4">
            <div className="flex items-center space-x-2">
              <span className="px-2.5 py-0.5 rounded-full text-xs font-mono uppercase bg-amber-500/15 text-[#f59e0b] border border-amber-500/30 font-semibold">
                Permanent Fragment
              </span>
              <span className="text-xs text-emerald-300/50 font-mono">
                ID: {quote.id}
              </span>
            </div>
            <span className="text-xs text-emerald-300/50">
              Created {new Date(quote.createdAt).toLocaleDateString()}
            </span>
          </div>

          {/* Large literary quote display */}
          <blockquote className="font-serif-reading text-xl sm:text-2xl italic leading-relaxed text-emerald-50 border-l-4 border-[#f59e0b] pl-6 my-6">
            «{quote.text}»
          </blockquote>

          {/* Attribution & Context */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-4 border-t border-emerald-500/20">
            <div>
              <h3 className="font-display-title text-lg font-bold text-white">
                {quote.authorName}
              </h3>
              <p className="text-sm font-serif-reading text-[#f59e0b] font-semibold">
                {quote.workTitle}
              </p>
              <p className="text-xs font-mono text-emerald-200/60">
                {quote.chapterTitle} (Division {quote.chapterNumber})
              </p>
            </div>

            {/* Path back to full work / chapter button */}
            <button
              id="btn-read-full-context"
              onClick={() => onOpenChapter(quote.workId, quote.chapterId)}
              className="flex items-center justify-center space-x-2 px-5 py-3 rounded-xl bg-[#f59e0b] hover:bg-amber-400 text-black font-bold uppercase tracking-wider text-xs shadow-md transition-all cursor-pointer"
            >
              <BookOpen className="w-4 h-4" />
              <span>Read in Full Chapter Context</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Action Toolbar */}
      <div className="bg-[#0b2921]/90 rounded-2xl border border-emerald-500/20 p-5 shadow-lg flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4">
        <div className="flex items-center space-x-2 text-xs font-mono text-emerald-200/70 flex-1 truncate">
          <Globe2 className="w-4 h-4 text-emerald-400/60 shrink-0" />
          <input
            type="text"
            readOnly
            value={shareUrl}
            className="bg-transparent outline-none w-full text-emerald-100 truncate"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2 justify-end">
          <button
            onClick={() => onOpenAddToCollection({
              type: 'quote',
              referenceId: quote.id,
              workId: quote.workId,
              workTitle: quote.workTitle,
              authorName: quote.authorName,
              chapterId: quote.chapterId,
              chapterTitle: quote.chapterTitle,
              quoteText: quote.text
            })}
            className="flex items-center space-x-1.5 px-3.5 py-2 rounded-xl bg-[#0f3d30] hover:bg-emerald-700/50 text-emerald-200 hover:text-white text-xs font-medium border border-emerald-500/30 transition-colors cursor-pointer"
          >
            <Bookmark className="w-3.5 h-3.5 text-[#f59e0b]" />
            <span>Save to Collection</span>
          </button>

          <button
            onClick={handleCopyCitation}
            className="flex items-center space-x-1.5 px-3.5 py-2 rounded-xl bg-[#0f3d30] hover:bg-emerald-700/50 text-emerald-200 hover:text-white text-xs font-medium border border-emerald-500/30 transition-colors cursor-pointer"
          >
            {copiedCitation ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copiedCitation ? 'Copied Citation' : 'Copy Citation'}</span>
          </button>

          <button
            onClick={handleNativeShare}
            className="flex items-center space-x-1.5 px-4 py-2 rounded-xl bg-[#f59e0b] hover:bg-amber-400 text-black text-xs font-bold uppercase tracking-wider shadow-sm transition-colors cursor-pointer"
          >
            {copiedLink ? <Check className="w-3.5 h-3.5" /> : <Share2 className="w-3.5 h-3.5" />}
            <span>{copiedLink ? 'Link Copied!' : 'Share Quote'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
