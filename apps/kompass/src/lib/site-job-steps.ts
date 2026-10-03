import type { SiteJobStep } from '@kompass/module-site';

/** Welcher Satz aus `site.publish.job.count` zu einem Schritt gehört. */
export type CounterKey = 'count' | 'countFiles' | 'pages' | 'variants' | 'files' | 'number' | 'reusing';

const FILE_STEPS = new Set<SiteJobStep['key']>(['copyImages', 'checksums', 'transfer']);

/**
 * Der Zähler eines Schritts in Worten, ohne Text: Die Oberfläche übersetzt
 * `key` mit `values` (Zahlen laufen dort durch den Formatter, de-DE).
 * Laufend mit Gesamtzahl „342 von 1.533“, die Seiten des Baus zählen offen
 * („86 Seiten“), fertige Schritte nennen ihre Menge. Ohne Zählerstand gibt es
 * keinen Zähler.
 */
export function stepCounter(step: SiteJobStep): { key: CounterKey; values: Record<string, number> } | null {
  const { key, state, done, total } = step;
  const hasTotal = total !== undefined && total > 0;
  // Die übernommene Vorschau: Der Schritt entfällt, das Kopieren zählt, bis alles da ist.
  if (state === 'skipped') return key === 'build' && hasTotal && done !== undefined && done < total! ? { key: 'reusing', values: { done, total: total! } } : null;
  if (state === 'running') {
    if (done === undefined) return null;
    if (key === 'build') return { key: 'pages', values: { count: done } };
    if (key === 'targetFiles') return { key: 'files', values: { count: done } };
    if (hasTotal) {
      if (key === 'export' || key === 'images') return { key: 'count', values: { done, total } };
      if (FILE_STEPS.has(key)) return { key: 'countFiles', values: { done, total } };
    }
    return { key: 'number', values: { count: done } };
  }
  if (state === 'done') {
    if (key === 'build' && done !== undefined) return { key: 'pages', values: { count: done } };
    if (!hasTotal) return key === 'targetFiles' && done !== undefined ? { key: 'files', values: { count: done } } : null;
    if (key === 'images') return { key: 'variants', values: { count: total } };
    if (FILE_STEPS.has(key) || key === 'targetFiles') return { key: 'files', values: { count: total } };
  }
  return null;
}
