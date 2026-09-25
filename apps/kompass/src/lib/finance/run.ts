import type { RunCounts, RunPreview, RunPreviewItem } from '@kompass/module-finance';

/**
 * Serienlauf in der Oberfläche (F6b Task 7, README 3i). Nur Lesen und
 * Anordnen dessen, was `previewConfirmationRun` und `getConfirmationRun`
 * liefern — die Fachlogik (Auswahl, Prüfliste, Posten) steht im Dienst.
 */
export type RunStep = 'selection' | 'preview' | 'run' | 'result';
export const RUN_STEPS: readonly RunStep[] = ['selection', 'preview', 'run', 'result'];

/**
 * Die Gruppen der Vorschau, wie der Dienst sie bildet. Eine Zuwendung vor
 * Beginn der Steuerbefreiung ist ein gewöhnlich blockierter Posten
 * (`blockedBy: 'afterExemptionStart'`).
 */
export type RunGroupKey = RunPreviewItem['group'];
const GROUP_ORDER: readonly RunGroupKey[] = ['ready', 'needsSignature', 'addressMissing', 'blocked'];

type GroupedItem = Pick<RunPreviewItem, 'group' | 'blockedBy'>;

/** Die Posten je Gruppe in fester Reihenfolge; leere Gruppen fallen weg, die Reihenfolge der Posten bleibt die des Dienstes. */
export function groupRunItems<T extends GroupedItem>(items: readonly T[]): { key: RunGroupKey; items: T[] }[] {
  return GROUP_ORDER.map((key) => ({ key, items: items.filter((i) => i.group === key) })).filter((g) => g.items.length > 0);
}

/** Wie viele Bestätigungen der Start ausstellen würde: der Nummernbereich des Dienstes (bereit + braucht Unterschrift). */
export function runIssueCount(preview: Pick<RunPreview, 'numberRange'>): number {
  return preview.numberRange.count;
}

/** „ZWB-2026-004 bis ZWB-2026-047“: die erste und die letzte Nummer; bei einer Bestätigung nur die erste, bei keiner nichts. */
export function numberRangeText(from: string, count: number): { from: string; to: string | null } | null {
  if (count <= 0) return null;
  const match = /^(.*?)(\d+)$/.exec(from);
  if (count === 1 || !match) return { from, to: null };
  const [, prefix, digits] = match;
  const last = String(Number(digits) + count - 1).padStart(digits!.length, '0');
  return { from, to: `${prefix}${last}` };
}

/** Der aktive Schritt des Schrittkopfs: aus dem Lauf, wenn einer gewählt ist, sonst aus der Auswahl. */
export function runStep(state: { year: number | null; run: { finishedAt: string | null } | null }): RunStep {
  if (state.run) return state.run.finishedAt ? 'result' : 'run';
  return state.year === null ? 'selection' : 'preview';
}

export interface RunQuery {
  year: number | null;
  minCents: number | null;
  excluded: string[];
  followUp: string | null;
  runId: string | null;
}

const digitsOnly = (value: string | undefined) => (value && /^\d+$/.test(value) ? Number(value) : null);
const nonEmpty = (value: string | undefined) => (value && value.trim() ? value.trim() : null);

/** Die Auswahl steht in der Adresse, damit ein Neuladen dieselbe Vorschau zeigt: `?year=&min=&exclude=a,b&followUp=` oder `?run=`. */
export function parseRunQuery(query: { year?: string; min?: string; exclude?: string; followUp?: string; run?: string }): RunQuery {
  const year = digitsOnly(query.year);
  return {
    year: year !== null && year >= 2000 && year <= 9999 ? year : null,
    minCents: digitsOnly(query.min),
    excluded: [...new Set((query.exclude ?? '').split(',').map((s) => s.trim()).filter(Boolean))],
    followUp: nonEmpty(query.followUp),
    runId: nonEmpty(query.run),
  };
}

export function runQueryString(args: { year: number; minCents: number | null; excluded: readonly string[]; followUp: string | null }): string {
  const params = new URLSearchParams({ year: String(args.year) });
  if (args.minCents !== null) params.set('min', String(args.minCents));
  if (args.excluded.length > 0) params.set('exclude', args.excluded.join(','));
  if (args.followUp) params.set('followUp', args.followUp);
  return `?${params.toString()}`;
}

/** „{n} Spender fehlen noch“ im Ergebnis: jeder Kontakt einmal, gleich was ihn aufhält, nach Namen. */
export function missingDonors(items: readonly Pick<RunPreviewItem, 'contactId' | 'contactName'>[]): { count: number; names: string[] } {
  const byId = new Map(items.map((i) => [i.contactId, i.contactName] as const));
  const names = [...byId.values()].sort((a, b) => a.localeCompare(b, 'de'));
  return { count: byId.size, names };
}

/** Fortschritt des Laufs: erledigt (ausgestellt oder gescheitert) gegen alles, was auszustellen war — übersprungene Posten sind keine Arbeit. */
export function runProgress(counts: Pick<RunCounts, 'total' | 'pending' | 'issued' | 'failed' | 'skipped'>): { done: number; total: number } {
  return { done: counts.issued + counts.failed, total: counts.total - counts.skipped };
}
