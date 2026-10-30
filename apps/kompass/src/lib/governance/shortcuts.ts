export type LiveShortcut = 'unanimous' | 'count' | 'accept' | 'attendance' | 'prev' | 'next';

const KEYS: Record<string, LiveShortcut> = { e: 'unanimous', z: 'count', j: 'accept', a: 'attendance' };

/**
 * Tastenkürzel des Mitlaufs (N5, Freigabe Joe 2026-10-28): `E` einstimmig, `Z` auszählen, `J` nimmt an, `A`
 * Anwesenheit, `Alt ↑/↓` Punkt wechseln. Nie mit Meta/Strg und nie mit Fokus in einem Textfeld — dort tippt man
 * (wie `shell-frame.tsx`). Enter bleibt beim fokussierten Knopf.
 */
export function liveShortcut(event: Pick<KeyboardEvent, 'key' | 'altKey' | 'metaKey' | 'ctrlKey' | 'target'>): LiveShortcut | null {
  if (event.metaKey || event.ctrlKey) return null;
  const target = event.target as Element | null;
  if (target && typeof target.closest === 'function' && target.closest('input, textarea, select, [contenteditable]')) return null;
  if (event.altKey) {
    if (event.key === 'ArrowDown') return 'next';
    if (event.key === 'ArrowUp') return 'prev';
    return null;
  }
  return KEYS[event.key.toLowerCase()] ?? null;
}
