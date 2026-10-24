import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Bot, Check, MessageCircle, Palette, RotateCcw, Send, X } from 'lucide-react';

type ChatTheme = 'emerald' | 'amber' | 'rose' | 'cyan' | 'azure' | 'mint' | 'slate';

type ChatMessage = {
  id: number;
  role: 'user' | 'assistant';
  text: string;
};

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

export function ChatWidget() {
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useState<ChatTheme>(() => {
    const saved = window.localStorage.getItem('biblioteca-chat-theme') as ChatTheme | null;
    return saved && saved in THEMES ? saved : 'emerald';
  });
  const [showThemes, setShowThemes] = useState(false);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [messages, setMessages] = useState<ChatMessage[]>([initialMessage()]);
  const endRef = useRef<HTMLDivElement>(null);
  const currentTheme = useMemo(() => THEMES[theme], [theme]);

  useEffect(() => {
    window.localStorage.setItem('biblioteca-chat-theme', theme);
  }, [theme]);

  useEffect(() => {
    if (open) endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [open, messages, loading]);

  const reset = () => { setMessages([initialMessage()]); setConversationId(undefined); };

  const send = async (event?: FormEvent) => {
    event?.preventDefault();
    const text = input.trim();
    if (!text || loading) return;
    setInput('');
    const userMessage: ChatMessage = { id: Date.now(), role: 'user', text };
    setMessages(previous => [...previous, userMessage]);
    setLoading(true);
    try {
      const response = await fetch('/api/rag/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, ...(conversationId ? { conversationId } : {}) }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || typeof payload.message !== 'string') throw new Error('chat unavailable');
      if (typeof payload.conversationId === 'string') setConversationId(payload.conversationId);
      setMessages(previous => [...previous, { id: Date.now() + 1, role: 'assistant', text: payload.message }]);
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
              <button type="button" onClick={() => setShowThemes(value => !value)} className="p-2 rounded-lg text-white/60 hover:text-white hover:bg-white/10" title="Schimbă tema" aria-label="Schimbă tema"><Palette className="w-4 h-4" /></button>
              <button type="button" onClick={() => setOpen(false)} className="p-2 rounded-lg text-white/60 hover:text-white hover:bg-white/10" title="Închide chatul" aria-label="Închide chatul"><X className="w-4 h-4" /></button>
            </div>
            {showThemes && (
              <div className="absolute mt-28 right-14 w-48 rounded-xl border border-white/15 bg-slate-950/95 p-2 shadow-2xl">
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
                  {message.text}
                </div>
              </div>
            ))}
            {loading && <div className="text-xs text-white/60">Se gândește…</div>}
            <div ref={endRef} />
          </div>

          <form onSubmit={send} className="p-3 border-t border-white/10 bg-black/20 flex gap-2">
            <input value={input} onChange={event => setInput(event.target.value)} placeholder="Scrie o întrebare…" className="min-w-0 flex-1 rounded-xl border border-white/15 bg-black/25 px-3 py-2 text-xs text-white placeholder:text-white/40 outline-none focus:border-white/40" />
            <button type="submit" disabled={!input.trim() || loading} className="w-9 h-9 rounded-xl grid place-items-center disabled:opacity-40" style={{ background: currentTheme.accent, color: '#031411' }} aria-label="Trimite întrebarea"><Send className="w-4 h-4" /></button>
          </form>
        </section>
      )}

      <button type="button" onClick={() => setOpen(value => !value)} className="w-14 h-14 rounded-full grid place-items-center text-white border border-white/30 shadow-xl transition-transform hover:scale-105 active:scale-95" style={{ background: `linear-gradient(135deg, ${currentTheme.accent}, #075985)` }} aria-label={open ? 'Închide chatul' : 'Deschide chatul'}>
        {open ? <X className="w-6 h-6" /> : <MessageCircle className="w-6 h-6" />}
      </button>
    </div>
  );
}
