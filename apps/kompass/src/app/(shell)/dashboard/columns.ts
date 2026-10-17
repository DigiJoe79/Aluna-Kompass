import type { DashboardTileView } from '@kompass/core';

/**
 * Die Art eines Widgets der Startseite (Briefing Startseite § 4, Vorgaben Teil M): Zahl, Liste, Fällig, Arbeit,
 * Warnung — dazu `info` (wartende Arbeit als Satz, aufgebaut wie eine Zahl), der Ruhezustand und ein Ladefehler.
 * Der Kern liefert Form (`kind`), Merkmal (`variant`) und Inhalt; die Art folgt daraus und aus den Daten.
 */
export type TileArt = 'count' | 'info' | 'list' | 'due' | 'work' | 'warning' | 'calm' | 'error';

export function tileArt(view: Pick<DashboardTileView, 'variant' | 'content' | 'error'>): TileArt {
  const content = view.content;
  if (view.error || !content) return 'error';
  if (content.kind === 'count') return content.count === 0 ? 'calm' : 'count';
  if (content.kind === 'status') return content.tone === 'warning' ? 'warning' : content.tone === 'info' ? 'info' : 'calm';
  if (content.total === 0) return 'calm';
  if (view.variant) return view.variant;
  return content.lines.length === 0 ? 'count' : 'list';
}

/** Arten, die als Zahl-Widget im gemeinsamen Raster stehen (Briefing § 2). */
const FIGURES: ReadonlySet<TileArt> = new Set(['count', 'info']);

/** Die Kacheln nach ihrer Spalte im aktiven Layout, in Reihenfolge; Spalten ohne Kachel bleiben als leere stehen. */
export function viewColumns<T extends { column: number }>(items: readonly T[], count: number): T[][] {
  const columns: T[][] = Array.from({ length: count }, () => []);
  for (const item of items) columns[Math.min(Math.max(item.column, 0), count - 1)]!.push(item);
  return columns;
}

/**
 * Drei gleiche Spalten in einem Behälter unter 1440 px (Briefing § 1): zwei Spalten; Spalte 3 kommt nach Reihenfolge
 * abwechselnd ans Ende von Spalte 1 und 2. Nur die Ansicht — gespeichert bleiben drei.
 */
export function mergeThirds<T>(columns: readonly (readonly T[])[]): T[][] {
  if (columns.length < 3) return columns.map((column) => [...column]);
  const merged = [[...columns[0]!], [...columns[1]!]];
  columns[2]!.forEach((item, i) => merged[i % 2]!.push(item));
  return merged;
}

/**
 * Ruhe-Zeilen ans Ende (Designer 2026-10-17, Frage 1): In jeder Spalte stehen ruhige Widgets hinter allen anderen, beide
 * Gruppen in der Reihenfolge des Nutzers — so zerreißt eine Ruhe-Zeile kein Zahl-Paar. Nur die Anzeige; die gespeicherte
 * Anordnung und „Anpassen“ bleiben, wie sie sind. Am Telefon stehen sie am Ende der ganzen Seite (`max-md:order-last`
 * in `dashboard-columns.tsx`). Ein Ladefehler sieht gedämpft aus, ist aber keine Ruhe und bleibt an seinem Platz.
 */
export function calmLast<T>(column: readonly T[], art: (item: T) => TileArt): T[] {
  return [...column.filter((item) => art(item) !== 'calm'), ...column.filter((item) => art(item) === 'calm')];
}

export type TileBlock<T> = { kind: 'figures'; items: T[] } | { kind: 'single'; item: T };

/** Aufeinanderfolgende Zahl-Widgets einer Spalte bilden ein Raster (`minmax(170px, 1fr)`), alles andere steht allein. */
export function figureBlocks<T>(column: readonly T[], art: (item: T) => TileArt): TileBlock<T>[] {
  const blocks: TileBlock<T>[] = [];
  for (const item of column) {
    const last = blocks[blocks.length - 1];
    if (FIGURES.has(art(item))) {
      if (last?.kind === 'figures') last.items.push(item);
      else blocks.push({ kind: 'figures', items: [item] });
    } else blocks.push({ kind: 'single', item });
  }
  return blocks;
}
