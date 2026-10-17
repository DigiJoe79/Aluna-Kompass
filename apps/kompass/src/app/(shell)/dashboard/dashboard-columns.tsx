'use client';

import type { ReactNode } from 'react';
import { useLayoutEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { calmLast, figureBlocks, mergeThirds, type TileArt } from './columns';

export interface PlacedTile {
  id: string;
  art: TileArt;
}

/**
 * Ab dieser Breite des Behälters stehen drei gleiche Spalten nebeneinander, darunter zwei (Briefing § 1: „ab 1440 px“).
 * Gemessen wird der Behälter, nicht das Fenster (Vorgaben Teil M, 6): Bei 1440 px Fenster sind es neben Schiene und
 * Polster rund 1290 px; eine offene Hilfe-Spalte nimmt ihm 360–400 px, dann stehen zwei.
 */
const THREE_COLUMNS_FROM = 1280;
/** Darunter das Telefon: die Spalten nacheinander (CSS `max-md`), ohne Zusammenlegen. */
const PHONE_BELOW = '(max-width: 47.999rem)';

/**
 * Die Startseite in Spalten (Briefing Startseite § 1, § 2): Jede Spalte stapelt ihre Widgets für sich (`items-start`),
 * zwischen den Spalten 16 px, zwischen den Widgets 12 px. Aufeinanderfolgende Zahl-Widgets bilden ein Raster
 * `repeat(auto-fill, minmax(170px, 1fr))`, je Zeile gleich hoch. Kein Widget reicht über zwei Spalten.
 *
 * - **2:1** bleibt 2:1 bis zum Telefon.
 * - **Drei gleiche Spalten** stehen im schmaleren Behälter als zwei: Spalte 3 abwechselnd an 1 und 2 (`mergeThirds`).
 *   Vor der ersten Messung (Server, Hydration) stehen drei.
 * - **Ruhe-Zeilen** stehen am Ende ihrer Spalte (`calmLast`), in der Reihenfolge des Nutzers (Designer 2026-10-17).
 * - **Telefon** (unter `md`): Die Spalten lösen sich auf (`contents`), die Widgets stehen in der Folge Spalte 1, 2, 3;
 *   Warnungen rücken mit `order-first` nach oben, Ruhe-Zeilen mit `order-last` ans Ende der Seite. Zahl-Widgets
 *   stehen zu zweit je Zeile (`repeat(2, minmax(0, 1fr))`, Designer 2026-10-17, Frage 2). Kein doppeltes DOM.
 *
 * Die Widgets rendert der Server (`TileCard`); hier werden sie nur in Spalten gestellt.
 */
export function DashboardColumns({ layout, columns, tiles }: { layout: 'thirds' | 'wide-narrow'; columns: PlacedTile[][]; tiles: Record<string, ReactNode> }) {
  const ref = useRef<HTMLDivElement>(null);
  const [merge, setMerge] = useState(false);
  // Joe 2026-10-17: Bis zur ersten Messung bleibt „drei gleiche Spalten“ unsichtbar — sonst sprangen drei Spalten unter
  // 1440 px nach dem Laden sichtbar auf zwei. 2:1 und das Telefon messen nichts und stehen sofort da.
  const [measured, setMeasured] = useState(layout !== 'thirds');

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || layout !== 'thirds') {
      setMerge(false);
      setMeasured(true);
      return;
    }
    const phone = matchMedia(PHONE_BELOW);
    const update = () => {
      setMerge(!phone.matches && element.getBoundingClientRect().width < THREE_COLUMNS_FROM);
      setMeasured(true);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    phone.addEventListener('change', update);
    return () => {
      observer.disconnect();
      phone.removeEventListener('change', update);
    };
  }, [layout]);

  const shown = merge ? mergeThirds(columns) : columns;
  const widthOf = (index: number) => (layout === 'wide-narrow' ? (index === 0 ? 'md:flex-2' : 'md:flex-1') : 'md:flex-1');

  return (
    <div ref={ref} data-testid="dashboard-columns" data-layout={layout} data-columns={shown.length} className={cn('flex flex-col gap-3 md:flex-row md:items-start md:gap-4', !measured && 'invisible')}>
      {shown.map((column, index) => (
        <div key={index} data-testid={`dashboard-column-${index}`} className={cn('flex min-w-0 flex-col gap-3 max-md:contents', widthOf(index))}>
          {figureBlocks(calmLast(column, (tile) => tile.art), (tile) => tile.art).map((block) =>
            block.kind === 'figures' ? (
              <div key={block.items[0]!.id} className="grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-3 max-md:grid-cols-2">
                {block.items.map((tile) => (
                  <div key={tile.id} className="min-w-0">
                    {tiles[tile.id]}
                  </div>
                ))}
              </div>
            ) : (
              <div key={block.item.id} className={cn('min-w-0', block.item.art === 'warning' && 'max-md:order-first', block.item.art === 'calm' && 'max-md:order-last')}>
                {tiles[block.item.id]}
              </div>
            ),
          )}
        </div>
      ))}
    </div>
  );
}
