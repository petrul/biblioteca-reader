// Reader toolbar's "Share on..." targets: each platform gets a prepared
// post from the chapter's first excerpt, and the shared URL itself carries
// the page's per-page og:image (chapter illustration, or the site's
// generic featured image as fallback - see the server's own per-page SEO
// rendering, which the platforms' link cards read from that URL).

export type ShareTarget = 'facebook' | 'x' | 'linkedin' | 'whatsapp' | 'telegram';

/** All t.co URLs count as 23 characters in a post, links included. */
const X_URL_LENGTH = 23;
/** X posts are capped at 280 characters, URL included. */
const X_MAX_LENGTH = 280;

export interface SharePost {
  excerpt: string;
  title: string;
  authorName: string;
  url: string;
}

/** The chapter's first excerpt: the opening run of its plain text. */
export function firstExcerpt(plainText: string, maxChars: number): string {
  const text = (plainText || '').replace(/\s+/g, ' ').trim();
  if (text.length <= maxChars) return text;
  // Cut at the last word boundary and mark the cut with an ellipsis.
  const cut = text.slice(0, maxChars + 1);
  const lastSpace = cut.lastIndexOf(' ');
  const base = lastSpace > maxChars * 0.5 ? cut.slice(0, lastSpace) : cut.slice(0, maxChars);
  return base.replace(/[,;:.!?"»«\-–— ]+$/, '') + '…';
}

/** The prepared post text for a target, honoring its length constraints. */
export function buildShareText(target: ShareTarget, post: SharePost): string {
  const attribution = ` — ${post.authorName}`;
  if (target === 'x') {
    // 280 total: the URL eats X_URL_LENGTH plus one separator space.
    const budget = X_MAX_LENGTH - X_URL_LENGTH - 1 - attribution.length;
    const quoted = `«${firstExcerpt(post.excerpt, Math.max(40, budget - 2))}»`;
    return `${quoted}${attribution} ${post.url}`;
  }
  // The other targets are lenient; FB quote ~ 500+ is safe, keep it tight.
  return `«${firstExcerpt(post.excerpt, 220)}»${attribution}`;
}

/** The platform's share intent URL for the prepared post. */
export function buildShareIntent(target: ShareTarget, post: SharePost): string {
  const text = buildShareText(target, post);
  const encoded = encodeURIComponent(text);
  const url = encodeURIComponent(post.url);
  switch (target) {
    // Facebook's sharer composes its card from the URL's og tags; &quote
    // pre-fills the user's message with the excerpt.
    case 'facebook':
      return `https://www.facebook.com/sharer/sharer.php?u=${url}&quote=${encoded}`;
    case 'x':
      // text already carries the URL (it counts inside the 280).
      return `https://twitter.com/intent/tweet?text=${encoded}`;
    case 'linkedin':
      return `https://www.linkedin.com/sharing/share-offsite/?url=${url}`;
    case 'whatsapp':
      return `https://wa.me/?text=${encodeURIComponent(`${text} ${post.url}`)}`;
    case 'telegram':
      return `https://t.me/share/url?url=${url}&text=${encoded}`;
  }
}
