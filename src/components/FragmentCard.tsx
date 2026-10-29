import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Quote, X, Copy, Check, Bookmark, Share2, BookOpen, ExternalLink, Sparkles } from 'lucide-react';
import type { ResolvedFragment } from '../services/fragmentApi';
import { copyToClipboard } from '../services/clipboard';

export interface FragmentCardProps {
  fragment: ResolvedFragment;
  modal?: boolean;
  onClose: () => void;
  onReadContext: () => void;
  onOpenWork: () => void;
  onSave: () => void;
  onSimilar?: () => void;
}

/** One literary card for deep links, Quote Link and legacy saved quotation snapshots. */
export function FragmentCard({ fragment, modal = true, onClose, onReadContext, onOpenWork, onSave, onSimilar }: FragmentCardProps) {
  const [copied, setCopied] = useState('');
  const close = useRef<HTMLButtonElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const closeAction = useRef(onClose);
  closeAction.current = onClose;
  const url = new URL(fragment.canonicalPath, window.location.origin).href;
  const citation = `«${fragment.text.trim()}» — ${fragment.authorName}, ${fragment.workTitle} (${fragment.chapterTitle}). ${url}`;
  const copy = async (value: string, label: string) => {
    if (await copyToClipboard(value)) { setCopied(label); setTimeout(() => setCopied(''), 2000); }
  };
  useEffect(() => {
    if (!modal) return;
    const previous = document.activeElement as HTMLElement | null;
    close.current?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const key = (event: KeyboardEvent) => {
      if (document.querySelector('#reader-similarity-dialog, #add-to-collection-modal')) return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); closeAction.current(); return; }
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') event.stopImmediatePropagation();
      if (event.key !== 'Tab') return;
      const buttons = Array.from(root.current?.querySelectorAll<HTMLElement>('button:not(:disabled),a,input') || []);
      const first = buttons[0], last = buttons.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', key, true);
    return () => { document.body.style.overflow = overflow; document.removeEventListener('keydown', key, true); previous?.focus(); };
  }, [modal, fragment.canonicalPath]);
  const share = async () => {
    if (navigator.share) {
      try { await navigator.share({ title: `${fragment.workTitle} — ${fragment.authorName}`, text: fragment.text.trim(), url }); }
      catch { /* Native cancellation leaves the source selection intact. */ }
    } else await copy(url, 'link');
  };
  const button = 'flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-white/20 text-white/85 hover:text-white hover:bg-white/10 text-xs cursor-pointer';
  const card = <section ref={root} role={modal ? 'dialog' : undefined} aria-modal={modal || undefined} aria-labelledby="fragment-card-title"
    onKeyDown={event => event.stopPropagation()}
    className="relative bg-[#061d28]/95 text-white border border-white/20 rounded-3xl shadow-2xl w-full max-w-3xl max-h-[90dvh] flex flex-col overflow-hidden">
    <Quote className="absolute -top-5 -right-5 w-48 h-48 text-amber-300/[0.06] pointer-events-none" aria-hidden="true" />
    <header className="relative flex items-center justify-between gap-3 px-5 sm:px-8 py-4 border-b border-white/15 shrink-0">
      <h2 id="fragment-card-title" className="flex items-center gap-2 text-sm font-bold text-amber-300"><Quote className="w-4 h-4" />Source fragment</h2>
      <button ref={close} id="btn-quote-back" type="button" onClick={onClose} aria-label={modal ? 'Close quotation' : 'Back'} className="p-2 rounded-lg hover:bg-white/10 cursor-pointer"><X className="w-4 h-4" /></button>
    </header>
    <div className="relative overflow-y-auto min-h-0 px-5 sm:px-8 py-6">
      <blockquote className="fragment-literary-text font-serif-reading text-lg sm:text-xl leading-relaxed border-l-4 border-[#f59e0b] pl-5 sm:pl-6 my-2">
        {fragment.html ? <div dangerouslySetInnerHTML={{ __html: fragment.html }} /> : <p className="whitespace-pre-wrap">«{fragment.text}»</p>}
      </blockquote>
      <div className="mt-6 pt-4 border-t border-white/15 space-y-1">
        <p className="font-display-title text-lg">{fragment.authorName}</p>
        <button type="button" onClick={onOpenWork} className="text-amber-300 font-serif-reading cursor-pointer hover:underline">{fragment.workTitle}</button>
        <p className="text-xs text-white/60">{fragment.chapterTitle}</p>
      </div>
      <div className="mt-5 flex items-center gap-2 bg-black/20 rounded-xl border border-white/15 p-2">
        <input aria-label="Fragment link" readOnly value={url} className="min-w-0 flex-1 bg-transparent text-xs font-mono text-amber-300 outline-none" />
        <button type="button" className={button} onClick={() => void copy(url, 'link')}><Copy className="w-3.5 h-3.5" />{copied === 'link' ? 'Copied!' : 'Copy Link'}</button>
        <a href={url} target="_blank" rel="noopener noreferrer" aria-label="Open fragment in a new tab" className="p-2 rounded hover:bg-white/10"><ExternalLink className="w-4 h-4" /></a>
      </div>
    </div>
    <footer className="relative shrink-0 border-t border-white/15 px-5 sm:px-8 py-4 flex flex-wrap items-center gap-2">
      <button id="btn-read-full-context" type="button" onClick={onReadContext} className={button}><BookOpen className="w-3.5 h-3.5 text-amber-300" />Read in Full Chapter Context</button>
      <button type="button" onClick={onSave} className={button}><Bookmark className="w-3.5 h-3.5 text-amber-300" />Save to Collection</button>
      <button type="button" onClick={() => void copy(fragment.text, 'text')} className={button}>{copied === 'text' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}{copied === 'text' ? 'Copied Text' : 'Copy Text'}</button>
      <button type="button" onClick={() => void copy(citation, 'citation')} className={button}><Copy className="w-3.5 h-3.5" />{copied === 'citation' ? 'Copied Citation' : 'Copy Citation'}</button>
      {onSimilar && <button type="button" onClick={onSimilar} className={button}><Sparkles className="w-3.5 h-3.5 text-amber-300" />Similar</button>}
      <button type="button" onClick={() => void share()} className="flex items-center gap-1.5 px-3 py-2 bg-[#f59e0b] text-black rounded-lg text-xs font-bold cursor-pointer hover:bg-amber-400"><Share2 className="w-3.5 h-3.5" />{copied === 'link' ? 'Link Copied!' : 'Share Quote'}</button>
    </footer>
  </section>;
  return modal ? createPortal(<div id="quote-created-modal" className="fixed inset-0 z-[60] bg-black/35 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6"
    onClick={event => { if (event.target === event.currentTarget) onClose(); }}>{card}</div>, document.body)
    : <div className="max-w-4xl mx-auto px-4 py-10">{card}</div>;
}
