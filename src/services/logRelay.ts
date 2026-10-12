// Client log relay to the dev server's terminal (POST /api/log, see
// server.ts's own endpoint comment): the reader is an SPA, so its
// logging otherwise lands only in the browser's devtools
// console and `rake run` shows nothing but the server's own two startup
// lines. Wraps console.info/warn/error - the levels that carry the page
// navigation trace and load failures; console.debug stays local (it would
// drown the terminal in whoami/GIS noise).
//
// Batched: a 750ms timer flushes whatever accumulated, so a burst of
// retries is one request, not one per line. Fire-and-forget with keepalive;
// relay failures are swallowed - logging must never break the app. Cap the
// queue so a runaway loop can't balloon memory.

const FLUSH_MS = 750;
const MAX_QUEUE = 200;

type Level = 'info' | 'warn' | 'error';

const queue: Record<Level, string[]> = { info: [], warn: [], error: [] };
let timer: ReturnType<typeof setTimeout> | null = null;

function flush(): void {
  timer = null;
  const batch = queue;
  for (const level of ['info', 'warn', 'error'] as Level[]) {
    const lines = batch[level];
    if (lines.length === 0) continue;
    batch[level] = [];
    try {
      void fetch('/api/log', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ level, lines }),
        keepalive: true
      }).catch(() => { /* relay is best-effort only */ });
    } catch { /* no fetch yet (SSR/tests) - drop */ }
  }
}

function schedule(): void {
  if (timer === null) timer = setTimeout(flush, FLUSH_MS);
}

function line(level: Level, args: unknown[]): void {
  if (queue[level].length >= MAX_QUEUE) return;
  const text = args.map(arg => {
    if (typeof arg === 'string') return arg;
    try { return JSON.stringify(arg); } catch { return String(arg); }
  }).join(' ');
  queue[level].push(text.slice(0, 500));
  schedule();
}

/**
 * Wrap console.info/warn/error so every line also lands in the
 * dev server's terminal. Call once from main.tsx; browser-only.
 */
export function relayConsoleToServer(): void {
  if (typeof window === 'undefined') return;
  for (const level of ['info', 'warn', 'error'] as Level[]) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      original(...args);
      line(level, args);
    };
  }
  // A last batch on tab close.
  window.addEventListener('beforeunload', flush);
}
