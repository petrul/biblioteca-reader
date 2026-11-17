/**
 * Text sent to biblioteca-server's vector search endpoint.
 *
 * The endpoint embeds the `q` parameter server-side, so the reader should
 * send the rendered page rather than a work title.  Keep the request below a
 * conservative URL-size budget: the public API is a GET endpoint, and the
 * reader also carries the active search in its shareable `/app/search?q=…`
 * route. The encoded query is larger than its JavaScript string for
 * non-ASCII books.
 */
export const MAX_SIMILARITY_QUERY_CHARS = 1800;

function normalizedText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/** Keep as much complete-word page text as the vector-search URL can carry. */
export function limitSimilarityQuery(value: string, maxChars = MAX_SIMILARITY_QUERY_CHARS): string {
  const text = normalizedText(value);
  if (text.length <= maxChars) return text;
  const boundary = text.lastIndexOf(' ', maxChars);
  const end = boundary >= Math.floor(maxChars * 0.7) ? boundary : maxChars;
  return text.slice(0, end).trim();
}

/**
 * Read the current rendered reader page.  `innerText` is preferred because it
 * follows the browser's visible-text rules; textContent keeps the feature
 * usable in SSR/tests and in browsers which do not expose innerText yet.
 */
export function currentPageSimilarityQuery(root: HTMLElement | null, fallback: string): string {
  const visible = root?.innerText || root?.textContent || '';
  return limitSimilarityQuery(visible) || normalizedText(fallback);
}
