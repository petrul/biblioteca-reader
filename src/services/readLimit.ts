// Reading-limit notices: the reader server answers a read over the hourly
// limit with a 429 whose JSON body carries error "read_limit" (see
// crawlerPageLimit.ts). Every fetch in the app goes through window.fetch,
// so one wrapper catches the notice wherever it happens and raises an event
// ReadLimitModal turns into a blocking card - no call site needs to know.

export const READ_LIMIT_EVENT = 'reader:read-limit';

export interface ReadLimitNotice {
  scope: 'visitor' | 'address' | 'cookieless';
  limit: number;
  retryAfterSeconds: number;
  contact: string;
  message: string;
}

export function readLimitNotice(body: unknown): ReadLimitNotice | null {
  if (!body || typeof body !== 'object') return null;
  const candidate = body as Partial<ReadLimitNotice> & { error?: unknown };
  if (candidate.error !== 'read_limit' || typeof candidate.message !== 'string') return null;
  return {
    scope: candidate.scope ?? 'visitor',
    limit: Number(candidate.limit) || 0,
    retryAfterSeconds: Math.max(1, Number(candidate.retryAfterSeconds) || 60),
    contact: candidate.contact || 'petru@scriptorium.ro',
    message: candidate.message,
  };
}

export function installReadLimitWatcher(target: Window = window): void {
  const originalFetch = target.fetch.bind(target);
  target.fetch = async (...args: Parameters<typeof fetch>) => {
    const response = await originalFetch(...args);
    if (response.status === 429 && (response.headers.get('content-type') || '').includes('application/json')) {
      // A clone, so the caller still reads its own (unconsumed) body.
      response.clone().json()
        .then(body => {
          const notice = readLimitNotice(body);
          if (notice) target.dispatchEvent(new CustomEvent<ReadLimitNotice>(READ_LIMIT_EVENT, { detail: notice }));
        })
        .catch(() => undefined);
    }
    return response;
  };
}
