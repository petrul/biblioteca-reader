import { useCallback, useEffect, useState, useRef, type RefObject } from 'react';
import { fetchRealChapterContent } from '../services/serversideApi';
import { FragmentCard } from './FragmentCard';
import { fetchFragment, fragmentLocation, type ResolvedFragment } from '../services/fragmentApi';
import type { FragmentLocation } from '../services/fragmentAddress';

type FragmentProps = {
  location?: FragmentLocation;
  containerRef: RefObject<HTMLDivElement | null>;
  contentKey: string;
  onChange: (location?: FragmentLocation, page?: string) => void;
  onSelection: (fragment: ResolvedFragment | null, range?: Range) => void;
  onExpandedSource: (source?: { path: string; html: string }) => void;
  onSave: (fragment: ResolvedFragment) => void;
  onOpenWork: (workId: string) => void;
  onSimilar: (text: string) => void;
};

/** Keeps fragment identity/selection alive independently of whether its card is open. */
export function FragmentPresentation({ location, containerRef, contentKey, onChange, onSelection, onSave, onOpenWork, onSimilar, onExpandedSource }: FragmentProps) {
  const [fragment, setFragment] = useState<ResolvedFragment | null>(null);
  const [error, setError] = useState('');
  const activeRange = useRef<Range | null>(null);
  const key = location ? JSON.stringify([location.sourcePath, location.selector, location.revision]) : '';
  useEffect(() => {
    let cancelled = false;
    setFragment(null); setError('');
    if (!location) { onExpandedSource(undefined); return; }
    void fetchFragment(location).then(async data => {
      if (cancelled) return;
      if (data.kind === 'page') { onChange(undefined, data.sourcePath); return; }
      if (data.readingPages?.some(path => path !== data.sourcePath)) {
        const source = await fetchRealChapterContent(data.sourcePath);
        if (cancelled) return;
        if (!source) throw new Error('The full source context could not be loaded.');
        onExpandedSource({ path: data.sourcePath, html: source.htmlContent });
      } else onExpandedSource(undefined);
      setFragment(data);
      if (location.sourcePath !== data.sourcePath || location.selector !== data.selector || location.revision !== data.sourceVersion)
        onChange(fragmentLocation(data, location.contextOnly));
    }).catch(error => { if (!cancelled) setError((error as Error).message); });
    return () => { cancelled = true; };
  }, [key]);
  const dismiss = useCallback(() => {
    if (!fragment) return;
    onChange(fragmentLocation(fragment, true));
    requestAnimationFrame(() => {
      const block = containerRef.current?.querySelector<HTMLElement>('[data-fragment-active]');
      if (block) { block.tabIndex = -1; block.focus({ preventScroll: true }); }
    });
  }, [fragment, onChange, containerRef]);
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !fragment) return;
    const version = container.querySelector<HTMLElement>('[data-fragment-version]')?.dataset.fragmentVersion;
    if (version && version !== fragment.sourceVersion) { setError('The source page and fragment have different revisions. Reload to read the current source.'); return; }
    const spans = [...container.querySelectorAll<HTMLElement>('[data-fragment-text]')].filter(el =>
      Number(el.dataset.fragmentTo) > fragment.startOffset && Number(el.dataset.fragmentFrom) < fragment.endOffset);
    if (!version) return; // Source HTML may still be loading.
    if (!spans.length) { setError('The source selection could not be displayed exactly. Reload the source page.'); return; }
    setError('');
    const range = document.createRange();
    const first = spans[0], last = spans.at(-1)!;
    range.setStart(first.firstChild!, Math.max(0, fragment.startOffset - Number(first.dataset.fragmentFrom)));
    range.setEnd(last.firstChild!, Math.min(last.textContent?.length || 0, fragment.endOffset - Number(last.dataset.fragmentFrom)));
    activeRange.current = range.cloneRange();
    container.classList.remove('reader-block-selection');
    const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range);
    const highlights = (globalThis.CSS as any)?.highlights;
    const HighlightClass = (globalThis as any).Highlight;
    if (highlights && HighlightClass) highlights.set('biblioteca-fragment', new HighlightClass(range));
    const marked = new Set<Element>();
    for (const el of spans) {
      const block = el.closest('.lg') || el.closest('p, table, li, blockquote, h1,h2,h3,h4,h5,h6');
      if (block) { marked.add(block); block.setAttribute('data-fragment-active', ''); }
    }
    first.scrollIntoView({ block: 'center' });
    onSelection(fragment, range);
    return () => { activeRange.current = null; highlights?.delete('biblioteca-fragment'); marked.forEach(el => el.removeAttribute('data-fragment-active')); };
  }, [fragment, contentKey]);
  useEffect(() => {
    if (!location?.contextOnly || !fragment) return;
    const clear = () => { onSelection(null); onChange(undefined); window.getSelection()?.removeAllRanges(); };
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || document.querySelector('[role="dialog"], #collections-modal')) return;
      event.preventDefault(); event.stopImmediatePropagation(); clear();
    };
    const pointer = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target || target.closest('[role="dialog"],#selection-quote-toolbar,#quote-created-modal,#reader-similarity-dialog,[data-fragment-active]')) return;
      clear();
    };
    let selecting = false;
    const down = (event: PointerEvent) => { selecting = !!containerRef.current?.contains(event.target as Node); };
    const up = () => {
      if (!selecting) return;
      selecting = false;
      const selection = window.getSelection();
      const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
      if (!range || !activeRange.current ||
          range.compareBoundaryPoints(Range.START_TO_START, activeRange.current) !== 0 ||
          range.compareBoundaryPoints(Range.END_TO_END, activeRange.current) !== 0) {
        onSelection(null); onChange(undefined);
      }
    };
    document.addEventListener('keydown', key, true); document.addEventListener('pointerdown', pointer);
    document.addEventListener('pointerdown', down); document.addEventListener('pointerup', up);
    return () => { document.removeEventListener('keydown', key, true); document.removeEventListener('pointerdown', pointer);
      document.removeEventListener('pointerdown', down); document.removeEventListener('pointerup', up); };
  }, [location?.contextOnly, fragment, onChange, onSelection]);
  if (!location) return null;
  if (error) return <div role="alert" className="fixed bottom-20 left-4 right-4 z-[60] mx-auto max-w-xl rounded-xl bg-[#061d28] text-white border border-amber-300/40 p-4"><p>{error}</p><button type="button" className="mt-2 text-amber-300 cursor-pointer" onClick={() => { onSelection(null); onChange(undefined); }}>Read source without fragment</button></div>;
  if (!fragment) return <p role="status" className="fixed bottom-20 right-4 z-50 rounded-xl bg-[#061d28] text-white p-3">Resolving source fragment…</p>;
  if (location.contextOnly) return null;
  return <FragmentCard fragment={fragment} onClose={dismiss} onReadContext={dismiss}
    onSave={() => { onChange(fragmentLocation(fragment, true)); onSave(fragment); }} onOpenWork={() => onOpenWork(fragment.workId)} onSimilar={() => onSimilar(fragment.text)} />;
}
