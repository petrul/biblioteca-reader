import { appAsset } from '../services/serversideApi';

// Shared "gone astray" presentation for every flavour of not-found this app
// can hit: a route that matches nothing at all (App.tsx's notFound view),
// and the data-level misses inside WorkView/ReaderView (a syntactically
// valid work/chapter path whose id just isn't in the catalog). Same art and
// copy tone as biblioteca-server's own templates/error/404.html, restyled
// to this app's dark emerald/amber chrome instead of that page's light
// paper theme - two different apps sharing one piece of art and one voice.
interface NotFoundCardProps {
  message: string;
  primaryLabel: string;
  onPrimary: () => void;
  secondaryLabel?: string;
  onSecondary?: () => void;
}

export function NotFoundCard({ message, primaryLabel, onPrimary, secondaryLabel, onSecondary }: NotFoundCardProps) {
  return (
    <div className="max-w-md mx-auto px-4 py-12 text-center">
      <img
        src={appAsset('404.png')}
        alt="A book gone astray, somewhere in the stacks"
        className="w-full max-w-[280px] mx-auto rounded-2xl shadow-2xl shadow-black/40 mb-6"
      />
      <h1 className="font-serif text-2xl font-semibold text-white mb-2">This page wandered off the shelf</h1>
      <p className="text-stone-400 mb-6">{message}</p>
      <div className="flex flex-wrap justify-center gap-3">
        <button
          onClick={onPrimary}
          className="px-5 py-2.5 bg-[#f59e0b] hover:bg-amber-400 text-black font-bold rounded-lg text-xs uppercase tracking-wider transition-colors"
        >
          {primaryLabel}
        </button>
        {secondaryLabel && onSecondary && (
          <button
            onClick={onSecondary}
            className="px-5 py-2.5 border border-emerald-500/30 hover:border-emerald-400/50 text-white font-bold rounded-lg text-xs uppercase tracking-wider transition-colors"
          >
            {secondaryLabel}
          </button>
        )}
      </div>
    </div>
  );
}
