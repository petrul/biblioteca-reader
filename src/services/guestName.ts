import { sameOriginFetch } from './sameOriginFetch';

// A browser without a guest name asks for one, once: the reader's
// POST /api/guests has biblioteca-server pick it ("guest_formidable_dictator")
// and keeps it in the bib_guest cookie, which names this reader in every
// Biblioteca log until they sign in - so a guest's browsing reads as one
// story. Browsers that never run this (crawlers) stay anonymous.

export function hasGuestName(cookies: string): boolean {
  return /(?:^|;\s*)bib_guest=guest_[a-z]+_[a-z]+(?:;|$)/.test(cookies);
}

export async function ensureGuestName(
  cookies: string = document.cookie,
  request: () => Promise<unknown> = () => sameOriginFetch('/api/guests', { method: 'POST' }),
): Promise<void> {
  if (hasGuestName(cookies)) return;
  await request().catch(() => { /* still anonymous - the next visit asks again */ });
}
