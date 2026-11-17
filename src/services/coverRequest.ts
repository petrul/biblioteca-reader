/** Do not display deleted source-bundled author portraits in admin JSON. */
export function withoutLegacyCoverArtUrl(request: Record<string, unknown>): Record<string, unknown> {
  const value = request.coverArtUrl;
  if (value === undefined || typeof value !== 'string') return request;
  if (/^data:/i.test(value.trim())) return request;
  let parsed: URL;
  try { parsed = new URL(value); } catch { return withoutCoverArt(request); }
  if (!['http:', 'https:'].includes(parsed.protocol)
    || /^(localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0|\[?::1\]?)$/i.test(parsed.hostname)
    || /(^|\/)img\/authors(?:\/|$)/i.test(parsed.pathname)
    || /(^|\/)authors(?:\/|$)/i.test(parsed.pathname)) return withoutCoverArt(request);
  return request;
}

function withoutCoverArt(request: Record<string, unknown>): Record<string, unknown> {
  const { coverArtUrl: _removed, ...clean } = request;
  return clean;
}
