/** Gleichmäßig teilen (HANDOFF § 2.1 „Rest hierher“/Gleichmäßig teilen): das Restcent geht auf die erste Zeile, die Summe bleibt exakt. */
export function splitEvenly(totalCents: number, n: number): number[] {
  if (n < 1) return [];
  const base = Math.trunc(totalCents / n);
  const remainder = totalCents - base * n;
  const parts = new Array<number>(n).fill(base);
  parts[0] = (parts[0] ?? 0) + remainder;
  return parts;
}
