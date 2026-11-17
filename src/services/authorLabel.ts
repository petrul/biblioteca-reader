/** The title bar should not advertise placeholder authors as real bylines. */
export function authorLabelForTitleBar(label?: string, workTitle?: string): string | undefined {
  if (!label) return undefined;
  const trimmed = label.trim();
  if (!trimmed) return undefined;
  const normalized = trimmed
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLocaleLowerCase()
    .replace(/[.,:;!?]/g, '')
    .replace(/\s+/g, ' ');
  const normalizedWorkTitle = workTitle?.trim().normalize('NFD').replace(/\p{M}+/gu, '').toLocaleLowerCase().replace(/[.,:;!?]/g, '').replace(/\s+/g, ' ');
  // “Anonymous” is the established author name of the medieval chronicle,
  // not a placeholder, for this one canonical work.
  if (normalized === 'anonymous' && normalizedWorkTitle === 'gesta hungarorum') return label;
  if (/^(?:anon|anonymous|anonim(?:a)?|unknown(?: author)?|author unknown|autor necunoscut|fara autor|n ?\/ ?a|[-?])$/.test(normalized)) {
    return undefined;
  }
  return label;
}
