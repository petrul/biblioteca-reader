import { FormEvent, Fragment, ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { Bot, Check, MessageCircle, Palette, RotateCcw, Send, X } from 'lucide-react';
import { parseAppPath } from '../router';
import { useLongPressDrag } from '../hooks/useLongPressDrag';
import { sameOriginFetch } from '../services/sameOriginFetch';
import { onPointerDownOutside } from '../services/outsideTap';

type ChatTheme = 'emerald' | 'amber' | 'rose' | 'cyan' | 'azure' | 'mint' | 'slate';

type ChatMessage = {
  id: number;
  role: 'user' | 'assistant';
  text: string;
  references?: ChatReference[];
};

export type ChatReference = {
  href: string;
  label: string;
  title?: string;
};

const BIBLIOTECA_PATH = /(?<![\w./-])(?:[a-z0-9][a-z0-9_.-]*\/)+[a-z0-9_][a-z0-9_.-]*/i;

/** Turn a server passage URL (including an internal localhost URL) into the
 * reader's same-origin stable path. External hosts are deliberately not
 * carried into the chat, because a source in the corpus is opened by its
 * canonical author/opus/div path. */
export function bibliotecaPathHref(value: string): string | null {
  let path = value.trim();
  if (/^https?:\/\//i.test(path)) {
    try { path = new URL(path).pathname; } catch { return null; }
  }
  path = path.replace(/^\/+/, '').split(/[?#]/, 1)[0];
  const parts = path.split('/').filter(Boolean);
  if (parts.length < 2 || parts.some(part => !/^[\p{L}\p{N}_.-]+$/u.test(part))) return null;
  return `/${parts.map(encodeURIComponent).join('/')}`;
}

/** Normalize the passages returned by /api/mcp/chat into stable links. */
export function chatReferencesFromPassages(passages: unknown): ChatReference[] {
  if (!Array.isArray(passages)) return [];
  const references: ChatReference[] = [];
  const seen = new Set<string>();
  passages.forEach(value => {
    if (!value || typeof value !== 'object') return;
    const passage = value as Record<string, unknown>;
    const rawUrl = typeof passage.url === 'string' ? passage.url : '';
    const rawPath = typeof passage.opusPath === 'string' ? passage.opusPath : '';
    const href = bibliotecaPathHref(rawUrl) ?? bibliotecaPathHref(rawPath);
    if (!href || seen.has(href)) return;
    seen.add(href);
    const label = typeof passage.title === 'string' && passage.title.trim()
      ? passage.title.trim()
      : href.slice(1).split('/').join(' › ');
    references.push({
      href,
      label,
      ...(rawPath || href ? { title: rawPath || href.slice(1) } : {}),
    });
  });
  return references;
}

/** Recover stable paths when the model cites one in prose but the adaptor's
 * structured passage list is empty or incomplete. */
export function chatReferencesFromText(text: string): ChatReference[] {
  const references: ChatReference[] = [];
  const seen = new Set<string>();
  const token = /(?<![\w./-])(?:[a-z0-9][a-z0-9_.-]*\/)+[a-z0-9_][a-z0-9_.-]*/gi;
  for (const match of text.matchAll(token)) {
    const candidate = match[0].replace(/[.,;:!?]+$/, '');
    const href = bibliotecaPathHref(candidate);
    if (!href || seen.has(href)) continue;
    seen.add(href);
    references.push({ href, label: candidate, title: candidate });
  }
  return references;
}

// The assistant returns prose with a small, predictable Markdown subset. Keep
// this renderer deliberately dependency-free and never inject HTML: common
// emphasis, code, links, and list markers become safe React elements.
export function markdownInline(text: string, references: ChatReference[] = []): ReactNode[] {
  const token = /(\*\*[^*]+\*\*|__[^_]+__|`[^`]+`|\[[^\]]+\]\((?:https?:\/\/|\/)[^)\s]+\)|\[\d+\]|(?<!\*)\*[^*]+\*(?!\*)|(?<![\w./-])(?:[a-z0-9][a-z0-9_.-]*\/)+[a-z0-9_][a-z0-9_.-]*)/gi;
  const nodes: ReactNode[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = token.exec(text))) {
    if (match.index > cursor) nodes.push(text.slice(cursor, match.index));
    const value = match[0];
    if (value.startsWith('**') || value.startsWith('__')) nodes.push(<strong key={`${match.index}-strong`}>{value.slice(2, -2)}</strong>);
    else if (value.startsWith('`')) nodes.push(<code key={`${match.index}-code`} className="rounded bg-black/25 px-1 py-0.5">{value.slice(1, -1)}</code>);
    else if (value.startsWith('[')) {
      const citation = /^\[(\d+)\]$/.exec(value);
      const reference = citation ? references[Number(citation[1]) - 1] : undefined;
      const link = /^\[([^\]]+)\]\(((?:https?:\/\/|\/)[^)\s]+)\)$/.exec(value);
      if (reference) nodes.push(<a key={`${match.index}-citation`} data-biblioteca-reference="true" href={reference.href} title={reference.title} className="underline decoration-emerald-300/70 underline-offset-2">{value}</a>);
      else if (link) nodes.push(<a key={`${match.index}-link`} href={link[2]} target={link[2].startsWith('http') ? '_blank' : undefined} rel={link[2].startsWith('http') ? 'noreferrer' : undefined} className="underline decoration-white/40 underline-offset-2">{link[1]}</a>);
      else nodes.push(value);
    } else if (BIBLIOTECA_PATH.test(value)) {
      // A citation is often followed by sentence punctuation; keep that
      // punctuation outside the anchor so the canonical path stays valid.
      const citation = value.replace(/[.,;:!?]+$/, '');
      const trailing = value.slice(citation.length);
      const href = bibliotecaPathHref(citation);
      nodes.push(href
        ? <Fragment key={`${match.index}-biblioteca`}><a data-biblioteca-reference="true" href={href} className="underline decoration-emerald-300/70 underline-offset-2 hover:text-emerald-200">{citation}</a>{trailing}</Fragment>
        : value);
      BIBLIOTECA_PATH.lastIndex = 0;
    } else nodes.push(<em key={`${match.index}-em`}>{value.slice(1, -1)}</em>);
    cursor = match.index + value.length;
  }
  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
}

export function ChatReferences({ references, onSaveReference, onSaveReferences }: {
  references: ChatReference[];
  onSaveReference?: (reference: ChatReference) => void;
  onSaveReferences?: (references: ChatReference[]) => void | Promise<void>;
}) {
  const [savedList, setSavedList] = useState(false);
  const [saveListError, setSaveListError] = useState(false);
  const saveAll = async () => {
    if (!onSaveReferences) return;
    try {
      await onSaveReferences(references);
      setSavedList(true);
      setSaveListError(false);
    } catch {
      setSaveListError(true);
    }
  };
  return (
    <aside data-testid="chat-references" className="mt-3 border-t border-white/10 pt-2.5">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <p className="text-[10px] font-semibold uppercase tracking-[.16em] text-white/55">✦ Referințe pentru explorare</p>
        {references.length > 0 && onSaveReferences && (
          savedList
            ? <span className="text-[10px] text-emerald-200">✓ Listă salvată</span>
            : <button type="button" onClick={() => { void saveAll(); }} className="rounded-md border border-white/15 px-1.5 py-0.5 text-[10px] text-white/70 hover:border-white/35 hover:text-white" aria-label="Salvează toate referințele">{saveListError ? 'Încearcă din nou' : 'Salvează lista'}</button>
        )}
      </div>
      {references.length > 0 ? <ol className="space-y-1 text-[11px] text-white/75">
        {references.map(reference => (
          <li key={reference.href} className="flex items-center gap-1.5">
            <span className="text-white/35">↗</span>
            <a href={reference.href} title={reference.title} className="min-w-0 flex-1 underline decoration-white/30 underline-offset-2 hover:text-white">{reference.label}</a>
            {onSaveReference && <button type="button" onClick={() => onSaveReference(reference)} className="shrink-0 text-[10px] text-emerald-200/75 hover:text-emerald-100" aria-label={`Salvează ${reference.label}`}>＋</button>}
          </li>
        ))}
      </ol> : <p className="text-[11px] italic text-white/45">Nu am găsit o trimitere stabilă pentru acest răspuns.</p>}
    </aside>
  );
}

function MarkdownMessage({ text, references = [] }: { text: string; references?: ChatReference[] }) {
  const lines = text.split('\n');
  const content: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | undefined;
  const flushList = () => {
    if (!list) return;
    const Tag = list.ordered ? 'ol' : 'ul';
    content.push(<Tag key={`list-${content.length}`} className="my-1 list-inside space-y-0.5">{list.items.map((item, index) => <li key={index}>{markdownInline(item, references)}</li>)}</Tag>);
    list = undefined;
  };
  lines.forEach((line, index) => {
    const marker = /^(?:\s*)([-*]|\d+\.)\s+(.+)$/.exec(line);
    if (marker) {
      const ordered = /\d+\./.test(marker[1]);
      if (!list || list.ordered !== ordered) { flushList(); list = { ordered, items: [] }; }
      list.items.push(marker[2]);
    } else {
      flushList();
      if (line.trim()) content.push(<p key={`line-${index}`} className="my-1 first:mt-0 last:mb-0">{markdownInline(line, references)}</p>);
    }
  });
  flushList();
    return <>{content}</>;
}

const THEMES: Record<ChatTheme, {
  name: string;
  accent: string;
  accentSoft: string;
  panel: string;
  header: string;
  user: string;
}> = {
  emerald: {
    name: 'Emerald Ocean',
    accent: '#34d399',
    accentSoft: 'rgba(52, 211, 153, .22)',
    panel: 'linear-gradient(165deg, #06251e 0%, #073d34 48%, #0b2841 100%)',
    header: 'linear-gradient(90deg, rgba(4, 42, 34, .98), rgba(6, 60, 73, .98))',
    user: 'linear-gradient(100deg, #059669, #0e7490)',
  },
  amber: {
    name: 'Solar Ember',
    accent: '#fbbf24',
    accentSoft: 'rgba(251, 191, 36, .22)',
    panel: 'linear-gradient(165deg, #281207 0%, #57220b 48%, #301006 100%)',
    header: 'linear-gradient(90deg, rgba(54, 21, 6, .98), rgba(95, 35, 6, .98))',
    user: 'linear-gradient(100deg, #d97706, #c2410c)',
  },
  rose: {
    name: 'Blood Ruby',
    accent: '#fb7185',
    accentSoft: 'rgba(251, 113, 133, .22)',
    panel: 'linear-gradient(165deg, #28050e 0%, #520817 48%, #20030a 100%)',
    header: 'linear-gradient(90deg, rgba(58, 5, 17, .98), rgba(105, 8, 29, .98))',
    user: 'linear-gradient(100deg, #e11d48, #9f1239)',
  },
  cyan: {
    name: 'Arctic Glass',
    accent: '#67e8f9',
    accentSoft: 'rgba(103, 232, 249, .22)',
    panel: 'linear-gradient(165deg, #06202a 0%, #0b3c4d 48%, #111e3d 100%)',
    header: 'linear-gradient(90deg, rgba(6, 39, 51, .98), rgba(14, 59, 77, .98))',
    user: 'linear-gradient(100deg, #0891b2, #2563eb)',
  },
  azure: {
    name: 'Oceanic Cobalt',
    accent: '#38bdf8',
    accentSoft: 'rgba(56, 189, 248, .22)',
    panel: 'linear-gradient(165deg, #051c36 0%, #0d2e54 45%, #113454 100%)',
    header: 'linear-gradient(90deg, rgba(7, 33, 64, .98), rgba(13, 56, 105, .98))',
    user: 'linear-gradient(100deg, #2563eb, #0891b2)',
  },
  mint: {
    name: 'Cyber Mint & Jade',
    accent: '#2dd4bf',
    accentSoft: 'rgba(45, 212, 191, .22)',
    panel: 'linear-gradient(165deg, #01221a 0%, #033c2e 45%, #022c22 100%)',
    header: 'linear-gradient(90deg, rgba(2, 40, 30, .98), rgba(4, 75, 58, .98))',
    user: 'linear-gradient(100deg, #0d9488, #059669)',
  },
  slate: {
    name: 'Titanium Monolith',
    accent: '#cbd5e1',
    accentSoft: 'rgba(203, 213, 225, .22)',
    panel: 'linear-gradient(165deg, #0f1728 0%, #1a2538 45%, #0f172a 100%)',
    header: 'linear-gradient(90deg, rgba(17, 26, 44, .98), rgba(30, 44, 68, .98))',
    user: 'linear-gradient(100deg, #475569, #3f3f46)',
  },
};

const initialMessage = (): ChatMessage => ({
  id: 1,
  role: 'assistant',
  text: 'Bun venit în Biblioteca. Întreabă-mă despre autori, opere sau cum să găsești un text.',
});

type ChatPlacement = 'floating' | 'docked';

/** The errors services/chatLimit.ts refuses a message with, each with a message to show. */
const CHAT_REFUSALS = ['chat_limit', 'chat_requires_sign_in', 'chat_busy'];

interface ChatWidgetProps {
  /** 'docked' hands the bubble over to a toolbar: the bottom nav's chat tab
      below lg, the navbar's chat button on lg+ - and the bubble hides. */
  placement?: ChatPlacement;
  /** Open state can be controlled from outside (the docked tab opens the
      panel) and falls back to internal state otherwise. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onDock?: () => void;
  /** Lifted so the app can force the toolbars visible mid-drag, even where
      they auto-hid themselves on scroll. */
  onDragActiveChange?: (active: boolean, overTarget: boolean) => void;
  /** The chat is for signed-in users only (services/chatLimit.ts): false
      offers sign-in instead of the message box; null while not yet known. */
  signedIn?: boolean | null;
  onSignIn?: () => void;
  onSaveReference?: (reference: ChatReference) => void;
  onSaveReferences?: (references: ChatReference[]) => void | Promise<void>;
}

export function ChatWidget({ placement = 'floating', open: openProp, onOpenChange, onDock, onDragActiveChange, signedIn = null, onSignIn, onSaveReference, onSaveReferences }: ChatWidgetProps = {}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = openProp ?? internalOpen;
  const setOpen = (value: boolean) => {
    setInternalOpen(value);
    onOpenChange?.(value);
  };
  // Long-press grabs the bubble and drags it onto a toolbar to dock it
  // there - the bottom nav on mobile, the navbar on desktop; dropped
  // anywhere else it snaps back to its corner. Disabled while docked or
  // while the panel is open (the bubble is a close button then, not a drag
  // handle).
  const drag = useLongPressDrag({
    targetId: ['mobile-bottom-nav', 'navbar'],
    onDropTarget: () => onDock?.(),
    onDropOutside: () => {},
    onDragActiveChange,
    enabled: placement === 'floating' && !open,
  });
  const [theme, setTheme] = useState<ChatTheme>(() => {
    const saved = window.localStorage.getItem('biblioteca-chat-theme') as ChatTheme | null;
    return saved && saved in THEMES ? saved : 'emerald';
  });
  const [showThemes, setShowThemes] = useState(false);
  // The theme picker closes on a tap anywhere outside it (services/outsideTap.ts).
  const themePickerRef = useRef<HTMLDivElement>(null);
  const themeToggleRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!showThemes) return;
    return onPointerDownOutside(document, () => [themePickerRef.current, themeToggleRef.current], () => setShowThemes(false));
  }, [showThemes]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [, setConversationId] = useState<string | undefined>();
  // Keep one backend conversation per work, so returning to a book restores
  // its context instead of mixing it with another book or the library chat.
  const conversationIdsRef = useRef<Record<string, string>>({});
  const [messages, setMessages] = useState<ChatMessage[]>([initialMessage()]);
  const endRef = useRef<HTMLDivElement>(null);
  const currentTheme = useMemo(() => THEMES[theme], [theme]);

  useEffect(() => {
    window.localStorage.setItem('biblioteca-chat-theme', theme);
  }, [theme]);

  useEffect(() => {
    if (open) endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [open, messages, loading]);

  const reset = () => {
    setMessages([initialMessage()]);
    const route = parseAppPath(window.location.pathname, window.location.hash, window.location.search);
    const scopeKey = route.view === 'reader' && route.workId ? route.workId : '__library__';
    delete conversationIdsRef.current[scopeKey];
    setConversationId(undefined);
  };

  const send = async (event?: FormEvent) => {
    event?.preventDefault();
    const text = input.trim();
    if (!text || loading) return;
    setInput('');
    const userMessage: ChatMessage = { id: Date.now(), role: 'user', text };
    setMessages(previous => [...previous, userMessage]);
    setLoading(true);
    try {
      // A reader conversation is deliberately narrowed to the open work;
      // every other page searches the whole library. Resolve this at send
      // time so in-app navigation is reflected even while the widget stays
      // mounted.
      const route = parseAppPath(window.location.pathname, window.location.hash, window.location.search);
      const opusPath = route.view === 'reader' ? route.workId : undefined;
      const scopeKey = opusPath ?? '__library__';
      const scope = opusPath ? { opusPaths: [opusPath] } : undefined;
      const continuedConversationId = conversationIdsRef.current[scopeKey];
      const response = await sameOriginFetch('/api/mcp/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, ...(continuedConversationId ? { conversationId: continuedConversationId } : {}), ...(scope ? { scope } : {}) }),
      });
      const payload = await response.json().catch(() => ({}));
      // A chat refusal (services/chatLimit.ts) explains itself; show its message.
      if (CHAT_REFUSALS.includes(payload.error) && typeof payload.message === 'string') {
        setMessages(previous => [...previous, { id: Date.now() + 1, role: 'assistant', text: payload.message }]);
        return;
      }
      if (!response.ok || typeof payload.answer !== 'string') throw new Error('chat unavailable');
      if (typeof payload.conversationId === 'string') {
        conversationIdsRef.current[scopeKey] = payload.conversationId;
        setConversationId(payload.conversationId);
      }
      const references = [...chatReferencesFromPassages(payload.passages)];
      const seenReferences = new Set(references.map(reference => reference.href));
      chatReferencesFromText(payload.answer).forEach(reference => {
        if (!seenReferences.has(reference.href)) { seenReferences.add(reference.href); references.push(reference); }
      });
      setMessages(previous => [...previous, {
        id: Date.now() + 1,
        role: 'assistant',
        text: payload.answer,
        references,
      }]);
    } catch {
      setMessages(previous => [...previous, {
        id: Date.now() + 1,
        role: 'assistant',
        text: 'Serverul de chat nu este disponibil momentan. Poți continua să explorezi Biblioteca și să încerci din nou.',
      }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed right-4 bottom-20 sm:right-6 sm:bottom-6 z-[70] flex flex-col items-end gap-3" data-testid="biblioteca-chat-widget">
      {open && (
        <section
          className="w-[min(400px,calc(100vw-2rem))] h-[min(580px,calc(100vh-7rem))] rounded-2xl overflow-hidden border border-white/20 shadow-2xl flex flex-col text-white"
          style={{ background: currentTheme.panel, boxShadow: `0 24px 70px rgba(0,0,0,.55), 0 0 35px ${currentTheme.accentSoft}` }}
          aria-label="Biblioteca chat"
        >
          <header className="px-4 py-3 border-b border-white/10 flex items-center justify-between" style={{ background: currentTheme.header }}>
            <div className="flex items-center gap-2.5">
              <span className="w-9 h-9 rounded-xl grid place-items-center bg-white/10 border border-white/15">
                <Bot className="w-5 h-5" style={{ color: currentTheme.accent }} />
              </span>
              <div>
                <h2 className="text-sm font-bold">Biblioteca Assistant</h2>
                <p className="text-[10px] text-white/60">Întreabă despre colecția digitală</p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button type="button" onClick={reset} className="p-2 rounded-lg text-white/60 hover:text-white hover:bg-white/10" title="Resetează conversația" aria-label="Resetează conversația"><RotateCcw className="w-4 h-4" /></button>
              <button ref={themeToggleRef} type="button" onClick={() => setShowThemes(value => !value)} className="p-2 rounded-lg text-white/60 hover:text-white hover:bg-white/10" title="Schimbă tema" aria-label="Schimbă tema"><Palette className="w-4 h-4" /></button>
              <button type="button" onClick={() => setOpen(false)} className="p-2 rounded-lg text-white/60 hover:text-white hover:bg-white/10" title="Închide chatul" aria-label="Închide chatul"><X className="w-4 h-4" /></button>
            </div>
            {showThemes && (
              <div ref={themePickerRef} className="absolute mt-28 right-14 w-48 rounded-xl border border-white/15 bg-slate-950/95 p-2 shadow-2xl">
                <p className="px-2 py-1 text-[10px] uppercase tracking-widest text-white/45">Chat themes</p>
                {(Object.keys(THEMES) as ChatTheme[]).map(key => (
                  <button key={key} type="button" onClick={() => { setTheme(key); setShowThemes(false); }} className="w-full flex items-center gap-2 px-2 py-2 rounded-lg text-left text-xs text-white/80 hover:bg-white/10">
                    <span className="w-3 h-3 rounded-full" style={{ background: THEMES[key].accent }} />
                    <span className="flex-1">{THEMES[key].name}</span>
                    {key === theme && <Check className="w-3.5 h-3.5" style={{ color: currentTheme.accent }} />}
                  </button>
                ))}
              </div>
            )}
          </header>

          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {messages.map(message => (
              <div key={message.id} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className="max-w-[86%] rounded-2xl px-3.5 py-2.5 text-xs leading-relaxed whitespace-pre-wrap" style={message.role === 'user' ? { background: currentTheme.user } : { background: 'rgba(0,0,0,.25)', border: `1px solid ${currentTheme.accentSoft}` }}>
                  {message.role === 'assistant' ? <MarkdownMessage text={message.text} references={message.references} /> : message.text}
                  {message.role === 'assistant' && message.references && <ChatReferences references={message.references} onSaveReference={onSaveReference} onSaveReferences={onSaveReferences} />}
                </div>
              </div>
            ))}
            {loading && <div className="text-xs text-white/60">Se gândește…</div>}
            <div ref={endRef} />
          </div>

          {signedIn === false ? (
            <div className="p-3 border-t border-white/10 bg-black/20 flex items-center gap-2">
              <p className="flex-1 text-xs text-white/70">Asistentul este disponibil doar utilizatorilor autentificați.</p>
              <button type="button" onClick={onSignIn} className="rounded-xl px-3 py-2 text-xs font-semibold" style={{ background: currentTheme.accent, color: '#031411' }}>Autentificare</button>
            </div>
          ) : (
            <form onSubmit={send} className="p-3 border-t border-white/10 bg-black/20 flex gap-2">
              <input value={input} onChange={event => setInput(event.target.value)} placeholder="Scrie o întrebare…" className="min-w-0 flex-1 rounded-xl border border-white/15 bg-black/25 px-3 py-2 text-xs text-white placeholder:text-white/40 outline-none focus:border-white/40" />
              <button type="submit" disabled={!input.trim() || loading} className="w-9 h-9 rounded-xl grid place-items-center disabled:opacity-40" style={{ background: currentTheme.accent, color: '#031411' }} aria-label="Trimite întrebarea"><Send className="w-4 h-4" /></button>
            </form>
          )}
        </section>
      )}

      <button
        type="button"
        onClick={() => { if (drag.justDragged()) return; setOpen(!open); }}
        onPointerDown={drag.onPointerDown}
        onContextMenu={event => event.preventDefault()}
        className={`w-14 h-14 rounded-full grid place-items-center text-white border border-white/30 shadow-xl hover:scale-105 active:scale-95 touch-none select-none ${drag.dragging ? 'scale-110' : 'transition-transform'} ${placement === 'docked' ? 'hidden' : ''}`}
        style={{
          background: `linear-gradient(135deg, ${currentTheme.accent}, #075985)`,
          ...(drag.dragging && drag.offset ? { transform: `translate(${drag.offset.dx}px, ${drag.offset.dy}px) scale(1.1)` } : {}),
        }}
        aria-label={open ? 'Închide chatul' : 'Deschide chatul'}
      >
        {open ? <X className="w-6 h-6" /> : <MessageCircle className="w-6 h-6" />}
      </button>
    </div>
  );
}
