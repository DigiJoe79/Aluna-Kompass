/*
 * Browsertauglich (Unterpfad `@kompass/core/dashboard-arrangement`): nur reine Funktionen und ein Typ-Import, keine
 * Datenbank — die Seitenleiste „Anpassen“ legt damit eine eingeschaltete Kachel in die kürzeste Spalte.
 */
import type { DashboardKind } from './types';

/**
 * Die Regeln, nach denen der Kern Kacheln auf Spalten verteilt (Briefing Startseite § 1 und § 5, Plan 0.2.12 Teil L).
 * Reine Funktionen über beliebige Einträge mit einer geschätzten Länge — der Dienst reicht Kacheln hinein, die Tests
 * Namen. Wo ein Widget steht, entscheidet der Kern; das Modul liefert nur Art und Inhalt (Briefing § 7).
 */
export const DASHBOARD_LAYOUTS = ['thirds', 'wide-narrow'] as const;
export type DashboardLayoutKind = (typeof DASHBOARD_LAYOUTS)[number];

/** Drei gleiche Spalten oder breit und schmal (2:1). */
export function layoutColumnCount(layout: DashboardLayoutKind): number {
  return layout === 'thirds' ? 3 : 2;
}

export function otherLayout(layout: DashboardLayoutKind): DashboardLayoutKind {
  return layout === 'thirds' ? 'wide-narrow' : 'thirds';
}

/**
 * Die geschätzte Länge einer Kachel nach ihrer Form: Liste (auch Fällig und Arbeit) lang, Zahl und Status kurz.
 * Eine Schätzung, kein Maß — sie dient nur dem Ausgleich der Spalten.
 */
export function tileLength(kind: DashboardKind): number {
  return kind === 'list' ? 3 : 1;
}

const sum = <T>(items: readonly T[], length: (item: T) => number): number => items.reduce((s, item) => s + length(item), 0);

/**
 * Aus der Reihenfolge, abwechselnd und nach Länge ausgeglichen: Jede Kachel kommt in die bis dahin kürzeste Spalte,
 * bei Gleichstand in die linke. Bei lauter gleich langen Kacheln ist das genau „abwechselnd“.
 */
export function spreadByOrder<T>(items: readonly T[], length: (item: T) => number, count: number): T[][] {
  const columns: T[][] = Array.from({ length: count }, () => []);
  const lengths = new Array<number>(count).fill(0);
  for (const item of items) {
    let target = 0;
    for (let i = 1; i < count; i++) if (lengths[i]! < lengths[target]!) target = i;
    columns[target]!.push(item);
    lengths[target]! += length(item);
  }
  return columns;
}

/**
 * Die Spalte, in die eine eingeschaltete Kachel kommt (Vorgaben Teil M, Entscheidung 1): die mit der kleinsten
 * geschätzten Länge, bei Gleichstand die linke. Die Kachel steht dann an ihrem Ende.
 */
export function shortestColumn<T>(columns: readonly (readonly T[])[], length: (item: T) => number): number {
  let target = 0;
  let best = Number.POSITIVE_INFINITY;
  columns.forEach((column, i) => {
    const total = sum(column, length);
    if (total < best) {
      best = total;
      target = i;
    }
  });
  return target;
}

/**
 * Der erste Wechsel des Layouts (Briefing § 5):
 * - von 3 auf 2:1: erst Spalte 1, dann Spalte 2 in die breite Spalte; Spalte 3 wird die schmale.
 * - von 2:1 auf 3: die breite Spalte zusammenhängend an der Stelle geteilt, an der beide Teile am ehesten gleich lang
 *   sind (bei Gleichstand bekommt Spalte 1 mehr); die schmale wird Spalte 3. Zusammenhängend, damit der Weg
 *   2:1 → 3 → 2:1 wieder bei derselben Anordnung ankommt.
 */
export function deriveArrangement<T>(columns: readonly (readonly T[])[], from: DashboardLayoutKind, length: (item: T) => number): T[][] {
  if (from === 'thirds') return [[...(columns[0] ?? []), ...(columns[1] ?? [])], [...(columns[2] ?? [])]];
  const wide = columns[0] ?? [];
  const total = sum(wide, length);
  let best = 0;
  let bestDiff = Number.POSITIVE_INFINITY;
  let prefix = 0;
  for (let k = 0; k <= wide.length; k++) {
    const diff = Math.abs(prefix - (total - prefix));
    if (diff <= bestDiff) {
      best = k;
      bestDiff = diff;
    }
    if (k < wide.length) prefix += length(wide[k]!);
  }
  return [wide.slice(0, best), wide.slice(best), [...(columns[1] ?? [])]];
}

/**
 * Die Vorgabe ohne gespeicherte Anordnung: lange Kacheln (Listen, Arbeit) in die breite bzw. erste Spalte, kurze
 * (Zahl, Warnung) in die übrigen, dort nach Reihenfolge ausgeglichen. Gibt es nur lange oder nur kurze Kacheln,
 * verteilt sie die Reihenfolge über alle Spalten — sonst bliebe eine Spalte leer.
 */
export function defaultArrangement<T>(items: readonly T[], layout: DashboardLayoutKind, length: (item: T) => number): T[][] {
  const count = layoutColumnCount(layout);
  const long = items.filter((item) => length(item) > 1);
  const short = items.filter((item) => length(item) <= 1);
  if (long.length === 0 || short.length === 0) return spreadByOrder(items, length, count);
  return [long, ...spreadByOrder(short, length, count - 1)];
}

/**
 * Eine alte flache Liste (Format bis 0.2.11) oder die flache Form von `setDashboardLayout`: auf drei Spalten nach
 * Reihenfolge verteilt, für 2:1 danach nach der Ableitungsregel. Keine Kachel geht verloren.
 */
export function legacyArrangement<T>(items: readonly T[], layout: DashboardLayoutKind, length: (item: T) => number): T[][] {
  const thirds = spreadByOrder(items, length, 3);
  return layout === 'thirds' ? thirds : deriveArrangement(thirds, 'thirds', length);
}
