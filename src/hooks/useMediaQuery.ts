import { useEffect, useState } from 'react';

// Absent outside a real browser (server rendering, the unit tests' minimal
// window): the query then simply does not match.
const canMatch = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function';

/** Whether a CSS media query currently matches, following its changes. */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => canMatch() && window.matchMedia(query).matches);

  useEffect(() => {
    if (!canMatch()) return;
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, [query]);

  return matches;
}
