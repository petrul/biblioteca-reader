import { useEffect, useState } from 'react';
import { FragmentCard } from './FragmentCard';
import { fetchServerQuote, resolveSelectedQuote } from '../services/serverQuoteApi';
import { readerService } from '../services/readerService';
import type { Quotation } from '../types/textbase';
import type { ResolvedFragment } from '../services/fragmentApi';

interface QuoteViewProps {
  quoteId: string;
  onBack: () => void;
  onOpenWork: (workId: string) => void;
  onOpenChapter: (workId: string, chapterId: string) => void;
  onOpenAddToCollection: (item: {
    type: 'quote'; referenceId: string; workId: string; workTitle: string;
    authorName: string; chapterId?: string; chapterTitle?: string; quoteText?: string;
  }) => void;
}

/** Compatibility for browser-local quotation IDs. Source-addressed quotes use the reader overlay. */
export function QuoteView({ quoteId, onBack, onOpenWork, onOpenChapter, onOpenAddToCollection }: QuoteViewProps) {
  const [quote, setQuote] = useState<Quotation>();
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    setLoading(true); setQuote(undefined);
    const request = quoteId.startsWith('server:') ? fetchServerQuote(quoteId) : Promise.resolve(readerService.getQuotationById(quoteId));
    void request.then(async data => {
      if (cancelled) return;
      setQuote(data || undefined); setLoading(false);
      // Upgrade a browser-local snapshot only when the existing matcher resolves one exact occurrence.
      if (data && !quoteId.startsWith('server:')) {
        try {
          const resolved = await resolveSelectedQuote(data.chapterId, data.text);
          if (!cancelled && resolved.id.startsWith('/')) onOpenChapter(data.workId, resolved.id);
        } catch { /* Preserve the saved snapshot when the source is unavailable or ambiguous. */ }
      }
    }).catch(() => { if (!cancelled) setQuote(undefined); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [quoteId]);
  if (loading) return <p role="status" className="p-8 text-white">Loading quotation…</p>;
  if (!quote) return <div role="alert" className="p-8 text-white"><p>This legacy quotation is unavailable in this browser.</p><button className="mt-3 text-amber-300 cursor-pointer" onClick={onBack}>Back</button></div>;
  const fragment: ResolvedFragment = {
    kind: 'fragment', sourcePath: quote.chapterId, selector: '', sourceVersion: '',
    canonicalPath: readerService.generateQuoteShareUrl(quote.id), contextPath: '/' + quote.chapterId,
    workId: quote.workId, workTitle: quote.workTitle, chapterId: quote.chapterId,
    chapterTitle: quote.chapterTitle, authorName: quote.authorName, language: quote.language,
    text: quote.text, html: '', readingPages: [quote.chapterId], startOffset: quote.startOffset, endOffset: quote.endOffset,
  };
  return <FragmentCard fragment={fragment} modal={false} onClose={onBack}
    onReadContext={() => onOpenChapter(quote.workId, quote.chapterId)} onOpenWork={() => onOpenWork(quote.workId)}
    onSave={() => onOpenAddToCollection({ type: 'quote', referenceId: quote.id, workId: quote.workId,
      workTitle: quote.workTitle, authorName: quote.authorName, chapterId: quote.chapterId,
      chapterTitle: quote.chapterTitle, quoteText: quote.text })} />;
}
