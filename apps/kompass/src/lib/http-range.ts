/**
 * Ein `Range`-Kopf für eine Datei der Größe `size` (RFC 9110 § 14): genau ein Bereich `bytes=a-b`, `bytes=a-` oder
 * `bytes=-n`. `null` heißt ganze Datei — ohne Kopf, bei fremder Einheit, Unsinn oder mehreren Bereichen (die bräuchten
 * `multipart/byteranges`; ein Download-Manager kommt mit der ganzen Datei zurecht). `'unsatisfiable'` → 416.
 */
export function parseRange(header: string | null, size: number): { start: number; end: number } | 'unsatisfiable' | null {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;
  const [, from, to] = match as unknown as [string, string, string];
  if (from === '' && to === '') return null;
  if (from === '') {
    const suffix = Number(to);
    if (suffix === 0 || size === 0) return 'unsatisfiable';
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(from);
  const end = to === '' ? size - 1 : Math.min(Number(to), size - 1);
  if (to !== '' && Number(to) < start) return null;
  if (start >= size) return 'unsatisfiable';
  return { start, end };
}
