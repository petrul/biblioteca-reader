import type { LanguageCode } from '../types/textbase';

// The beautiful, entire names of the corpus languages for anything
// UI-visible. The ISO-639 codes (ron, eng, fra...) stay the INTERNAL
// vocabulary - persisted filters, API params, the codes the server sends -
// but never a label: "ron" is the Romanian currency, "RON" on a work card
// reads as money, not language.
export const LANGUAGE_NAMES: Record<LanguageCode, string> = {
  lat: 'Latin',
  grc: 'Ancient Greek',
  ron: 'Romanian',
  eng: 'English',
  fra: 'French',
  deu: 'German',
  ita: 'Italian',
  spa: 'Spanish',
  bul: 'Bulgarian',
  bre: 'Breton',
  cat: 'Catalan',
  dan: 'Danish',
  fin: 'Finnish',
  hun: 'Hungarian',
  nld: 'Dutch',
  nor: 'Norwegian',
  por: 'Portuguese',
  rus: 'Russian',
  zho: 'Chinese'
};

/** The display name for a language code, falling back to the code itself. */
export function languageName(code: LanguageCode | string | undefined | null): string {
  if (!code) return '';
  return LANGUAGE_NAMES[code as LanguageCode] ?? code;
}
