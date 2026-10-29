// Every limit the reader enforces, in one place - the reader's counterpart of
// biblioteca-server's ResourceLimits. resourceLimits.test.ts states each one
// and when it applies; change a value there and here together.
//
// Automated clients are meant to pay for volume access; people should never
// notice a limit. Clients that do not keep the reader's visitor cookie
// (curl, most scrapers) get a small budget; a browser gets one no person,
// however expert, reaches - it only stops a scraper that keeps a cookie:
//
//   what is limited                         who                          limit
//   --------------------------------------  ---------------------------  ------------------
//   distinct chapters read                  a browser (valid visitor     3000 per hour,
//                                           cookie)                      per browser
//   distinct chapters read                  clients without a valid      150 per hour,
//                                           visitor cookie               per address
//   fresh visitor cookies handed out        one address                  40 per hour
//   chat / ask / RAG search requests        clients without a valid      refused (403)
//                                           visitor cookie
//   chat / ask / RAG search requests        a browser                    60 per hour,
//                                                                        300 per day
//   chat / ask / RAG search requests        one address, all browsers    240 per hour
//                                           together
//
// The chat runs on the shared GPU: one message is three or four calls to a
// 9B model, ~9 s of GPU time. So it is for people only - an automated client
// gets nothing - and a browser's budget is a message a minute, nonstop for an
// hour: a person typing and reading the answers stays below it, a bot looping
// does not. The address ceiling keeps one address from multiplying that with
// many cookies. Administrators are exempt.
//
// Why 3000 is out of human reach: reading straight through costs one read per
// new chapter (the reader prefetches the next one), jumping around at most
// three (previous, this, next). Opening a new chapter every 5 seconds for a
// whole hour is ~720 views, ~2200 reads at worst.
//
// A "chapter read" is defined positively, in crawlerPageLimit.ts's
// chapterRead(): one chapter's content from /api/server-content/, counted
// once per hour whatever formats or reloads fetch it. Nothing else counts.
// The cookie cap is what keeps a scraper from taking a fresh cookie per
// request to pass as a browser. Per-request size caps (search results,
// TOC pages...) are the server's: see ResourceLimits.java.

export const RESOURCE_LIMITS = {
  /** Distinct chapters an hour for one browser holding a valid visitor cookie. */
  browserChaptersPerHour: 3000,
  /** Distinct chapters an hour, per address, for clients without a valid visitor cookie. */
  cookielessChaptersPerHour: 150,
  /** Fresh visitor cookies one address may obtain an hour. */
  newVisitorCookiesPerHour: 40,
  /** Chat/ask/RAG search requests an hour for one browser. */
  chatMessagesPerHourPerBrowser: 60,
  /** Chat/ask/RAG search requests a day for one browser. */
  chatMessagesPerDayPerBrowser: 300,
  /** Chat/ask/RAG search requests an hour from one address, all its browsers together. */
  chatMessagesPerHourPerAddress: 240,
  /** The window the reading limits are counted over (chat: hour and day as named). */
  windowMs: 60 * 60 * 1000,
  /** Where volume access is offered. */
  contact: 'petru@scriptorium.ro',
} as const;

export interface ResourceLimitOverrides {
  browserChaptersPerHour?: number;
  cookielessChaptersPerHour?: number;
  newVisitorCookiesPerHour?: number;
}

function envInt(name: string): number | undefined {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : undefined;
}

/** Deployment overrides (READ_LIMIT_BROWSER_HOURLY, READ_LIMIT_COOKIELESS_HOURLY, READ_LIMIT_NEW_VISITORS_HOURLY); unset means the defaults above. */
export function resourceLimitOverridesFromEnv(): ResourceLimitOverrides {
  return {
    browserChaptersPerHour: envInt('READ_LIMIT_BROWSER_HOURLY'),
    cookielessChaptersPerHour: envInt('READ_LIMIT_COOKIELESS_HOURLY'),
    newVisitorCookiesPerHour: envInt('READ_LIMIT_NEW_VISITORS_HOURLY'),
  };
}
