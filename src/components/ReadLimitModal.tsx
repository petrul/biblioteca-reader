import { useEffect, useState } from 'react';
import { Hourglass } from 'lucide-react';
import { READ_LIMIT_EVENT, type ReadLimitNotice } from '../services/readLimit';

// Blocking card for the automated-access limit (see services/readLimit.ts).
// No person reading normally sees it: the browser limit is set above any
// human pace, and the small cookieless one only hits browsers blocking cookies. It cannot be dismissed while the
// limit holds - every read would fail anyway - and offers a reload after.
export function ReadLimitModal() {
  const [notice, setNotice] = useState<ReadLimitNotice | null>(null);
  const [until, setUntil] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const onLimit = (event: Event) => {
      const detail = (event as CustomEvent<ReadLimitNotice>).detail;
      setNotice(detail);
      setUntil(Date.now() + detail.retryAfterSeconds * 1000);
    };
    window.addEventListener(READ_LIMIT_EVENT, onLimit);
    return () => window.removeEventListener(READ_LIMIT_EVENT, onLimit);
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [notice]);

  if (!notice) return null;
  const remaining = Math.max(0, Math.ceil((until - now) / 1000));
  const minutes = Math.floor(remaining / 60);
  const seconds = String(remaining % 60).padStart(2, '0');

  return (
    <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-xs flex items-center justify-center p-4"
         role="alertdialog" aria-modal="true" aria-labelledby="read-limit-title" aria-describedby="read-limit-text">
      <div className="bg-[#0b2921] rounded-2xl border border-emerald-500/30 max-w-md w-full p-6 sm:p-8 shadow-2xl space-y-5 text-center animate-in fade-in zoom-in-95 duration-150">
        <Hourglass className="w-10 h-10 mx-auto text-[#f59e0b]" aria-hidden="true" />
        <h3 id="read-limit-title" className="font-display-title text-xl font-bold text-white">Automated access limit</h3>
        <p id="read-limit-text" className="text-stone-300 text-sm leading-relaxed">{notice.message}</p>
        <p className="text-emerald-200/80 text-sm" aria-live="polite">
          {remaining > 0 ? <>You can continue in <span className="font-mono text-white">{minutes}:{seconds}</span></> : 'You can continue now.'}
        </p>
        <div className="flex flex-wrap justify-center gap-3">
          <button
            onClick={() => window.location.reload()}
            disabled={remaining > 0}
            className="px-5 py-2.5 bg-[#f59e0b] hover:bg-amber-400 disabled:opacity-40 disabled:cursor-not-allowed text-black font-bold rounded-lg text-xs uppercase tracking-wider transition-colors"
          >
            Continue reading
          </button>
          <a
            href={`mailto:${notice.contact}?subject=Biblioteca%20volume%20access`}
            className="px-5 py-2.5 border border-emerald-500/30 hover:border-emerald-400/50 text-white font-bold rounded-lg text-xs uppercase tracking-wider transition-colors"
          >
            Ask about volume access
          </a>
        </div>
      </div>
    </div>
  );
}
