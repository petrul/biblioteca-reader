/** Do not display deleted source-bundled author portraits in admin JSON. */
export function withoutLegacyCoverArtUrl(request: Record<string, unknown>): Record<string, unknown> {
  const value = request.coverArtUrl;
  if (value === undefined || typeof value !== 'string') return request;
  let pathname = value;
  try { pathname = new URL(value, 'http://biblioteca.invalid').pathname; } catch { /* keep raw value */ }
  if (!/(^|\/)img\/authors(?:\/|$)/i.test(pathname) && !/(^|\/)authors(?:\/|$)/i.test(pathname)) return request;
  const { coverArtUrl: _removed, ...clean } = request;
  return clean;
}
