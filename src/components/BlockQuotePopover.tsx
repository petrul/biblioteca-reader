import { useState } from 'react';
import { formatCitation, paragraphShareUrl, parseParagraphRange } from '../services/paragraphLinks';

export function BlockQuotePopover({ block, chapterId, title, chapterTitle, position, onQuote, onClose }: {
  block: HTMLElement; chapterId: string; title: string; chapterTitle: string;
  position: { left: number; top: number }; onQuote: () => void; onClose: () => void;
}) {
  const [message, setMessage] = useState('');
  const single = parseParagraphRange(block.dataset.readerParagraph);
  const linked = Array.from(block.closest('.reader-text-container')?.querySelectorAll<HTMLElement>('.block-linked') || []);
  const first = parseParagraphRange(linked[0]?.dataset.readerParagraph);
  const last = parseParagraphRange(linked.at(-1)?.dataset.readerParagraph);
  const range = first && last && linked.includes(block) ? { start: first.start, end: last.end } : single;
  const url = range ? paragraphShareUrl(chapterId, range, location.origin) : `${location.origin}/${chapterId}`;
  const citation = range ? formatCitation(title, chapterTitle, range) : `${title} — ${chapterTitle}`;
  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); setMessage('Copied'); }
    catch { setMessage('Copy unavailable; select the link below to copy it.'); }
  };
  const edit = async () => {
    try {
      const response = await fetch('/api/edits', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: chapterId, paragraph: range?.start }) });
      setMessage(response.status === 501 ? 'Editing is not yet available.' : 'Unable to open editing.');
    } catch { setMessage('Editing is temporarily unavailable.'); }
  };
  const html = () => {
    return (linked.includes(block) ? linked : [block]).map(element => {
      const clone = element.cloneNode(true) as HTMLElement;
      clone.classList.remove('block-active', 'block-hover', 'block-linked');
      return clone.outerHTML;
    }).join('\n');
  };
  return <div id="reader-block-popover" role="dialog" aria-label="Paragraph sharing" style={{ position: 'fixed', left: Math.max(8, Math.min(position.left - 250, window.innerWidth - 310)), top: Math.max(60, Math.min(position.top + 28, window.innerHeight - 210)) }} className="z-50 w-[300px] bg-[#08231c] text-white border border-gray-400/40 rounded-xl p-3 shadow-xl text-sm">
    <p>{citation}</p>
    <input aria-label="Stable paragraph link" readOnly value={url} className="w-full my-2 bg-transparent border border-gray-400 rounded p-1 text-xs" onFocus={event => event.target.select()} />
    <div className="flex flex-wrap gap-2">
      <button onClick={() => void copy(url)}>Copy link</button>
      <button onClick={() => void copy(citation)}>Copy citation</button>
      <button onClick={() => void copy(html())}>Copy HTML</button>
      <button onClick={onQuote}>Quote selection</button>
      <button onClick={() => void edit()}>Edit</button>
      <button onClick={onClose}>Close</button>
    </div>
    {message && <p role="status" className="mt-2">{message}</p>}
  </div>;
}
