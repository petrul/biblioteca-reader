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
  /** The window every limit is counted over. */
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
