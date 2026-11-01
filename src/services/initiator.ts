import { AsyncLocalStorage } from 'node:async_hooks';

// Who a log line is for. Every line a Biblioteca service writes starts with
// its initiator: "(petru@scriptorium.ro) ...", "(guest_formidable_dictator)
// ..." for a reader who is not signed in but has a guest name (biblioteca-
// server hands them out at POST /api/guests; the reader's browser keeps its
// own in the bib_guest cookie), "(anonymous) ..." for a request without one,
// or "(system) ..." for work no request started (startup, Kafka consumers,
// schedulers). The label travels between services in the
// X-Biblioteca-Initiator header.
//
// Kept identical in biblioteca-reader (src/services/initiator.ts),
// biblioteca-nestjs (src/initiator.ts) and biblioteca-covers
// (src/server/initiator.ts); biblioteca-server's Initiator.java holds the
// same rules.

export const INITIATOR_HEADER = 'x-biblioteca-initiator';
export const GUEST_COOKIE = 'bib_guest';
export const SYSTEM_INITIATOR = 'system';
export const ANONYMOUS_INITIATOR = 'anonymous';

const GUEST_RE = /^guest_[a-z]{1,40}_[a-z]{1,40}$/;
// a user name: an email, or a plain name like the seeded admin's
const USER_RE = /^[A-Za-z0-9._%+@-]{1,254}$/;

export function isGuestName(value: string | null | undefined): boolean {
  return GUEST_RE.test(value ?? '');
}

/** A signed-in user's label - not a guest, anonymous or system. */
export function isUserLabel(value: string): boolean {
  return !isGuestName(value) && value !== ANONYMOUS_INITIATOR && value !== SYSTEM_INITIATOR && USER_RE.test(value);
}

/**
 * A label received from another service, or undefined when it is not one.
 * Only these shapes pass, so a header can never inject text into a log.
 */
export function receivedLabel(value: string | string[] | undefined | null): string | undefined {
  const label = Array.isArray(value) ? value[0] : value;
  if (!label) return undefined;
  return label === SYSTEM_INITIATOR || label === ANONYMOUS_INITIATOR || USER_RE.test(label) ? label : undefined;
}

/**
 * The initiator of a request to an internal service: the label its caller
 * sent - "system" for the caller's own background work - else "anonymous".
 */
export function requestInitiator(header: string | string[] | undefined): string {
  return receivedLabel(header) ?? ANONYMOUS_INITIATOR;
}

const storage = new AsyncLocalStorage<string>();

/** The initiator of the work running now - "system" outside any request. */
export function currentInitiator(): string {
  return storage.getStore() ?? SYSTEM_INITIATOR;
}

/** Runs fn, and everything it starts, on behalf of label. */
export function runAs<T>(label: string, fn: () => T): T {
  return storage.run(label, fn);
}

/** Starts every line written to stream with "(initiator) ". */
export function prefixLines(stream: NodeJS.WritableStream): void {
  const write = stream.write.bind(stream) as (...args: unknown[]) => boolean;
  let atLineStart = true;
  (stream as { write: unknown }).write = (chunk: unknown, ...rest: unknown[]) => {
    if (typeof chunk !== 'string' && !(chunk instanceof Uint8Array)) return write(chunk, ...rest);
    const text = typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
    if (!text) return write(chunk, ...rest);
    const prefix = `(${currentInitiator()}) `;
    const prefixed = (atLineStart ? prefix : '') + text.replace(/\n(?=[^\n])/g, `\n${prefix}`);
    atLineStart = text.endsWith('\n');
    // a Buffer chunk is now a string: its encoding is utf8, whatever was given
    if (typeof chunk !== 'string' && typeof rest[0] === 'string') rest[0] = 'utf8';
    return write(prefixed, ...rest);
  };
}

/** Prefixes everything this process writes - console, framework loggers, libraries. */
export function prefixProcessOutput(): void {
  prefixLines(process.stdout);
  prefixLines(process.stderr);
}

/**
 * Adds the current initiator - "system" outside a request - to every fetch()
 * towards the given Biblioteca services, and hands each of their responses
 * to onResponse. No other host ever sees it.
 */
export function propagateInitiator(
  serviceUrls: string[],
  onResponse?: (request: Request, response: Response) => void,
): void {
  const origins = new Set(serviceUrls.filter(Boolean).map(url => new URL(url).origin));
  const fetchUpstream = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    if (!URL.canParse(url) || !origins.has(new URL(url).origin)) return fetchUpstream(input, init);
    const request = new Request(input, init);
    request.headers.set(INITIATOR_HEADER, currentInitiator());
    const response = await fetchUpstream(request);
    onResponse?.(request, response);
    return response;
  }) as typeof fetch;
}
