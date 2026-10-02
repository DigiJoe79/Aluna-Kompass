'use client';

import { useSyncExternalStore } from 'react';

const FINE = '(pointer: fine)';

function subscribe(onChange: () => void) {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {};
  const media = window.matchMedia(FINE);
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
}

/**
 * Ob mit Maus oder Trackpad bedient wird. Gezogen wird nur dann: Am Telefon
 * startet iOS das native Ziehen zwar, aber der Ordnerbaum liegt zu im Sheet —
 * verschoben wird dort über „Verschieben nach…“ (Spec Ordnerbaum § 5.6,
 * Befund 0.2.4/11). Wo der Browser es nicht sagt, und auf dem Server, gilt
 * Maus — so bleibt der Schreibtisch, wie er war.
 */
export function useFinePointer(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => typeof window.matchMedia !== 'function' || window.matchMedia(FINE).matches,
    () => true
  );
}
