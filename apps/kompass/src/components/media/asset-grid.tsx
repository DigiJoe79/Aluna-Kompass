'use client';

import { useTranslations } from 'next-intl';
import { useCallback } from 'react';
import { useAssetDrag } from './use-asset-drag';
import { StatusBadge } from '@/components/status-badge';
import { AiKindBadge } from './ai-kind-badge';
import type { AiKind } from '@kompass/core';

export interface GridItem {
  id: string;
  filename: string;
  mimeType: string;
  used: boolean;
  /** Wofür die Datei steht (erste Verwendung, z. B. „Team: Mira“); ohne sie heißt die Karte nach dem Dateinamen (10 A6). */
  caption?: string;
  /** Der Ort unter dem geöffneten Ordner, als Namen mit „›“; leer oder weggelassen = keine Zeile (Spec § 9). */
  place?: string;
  /** Wo die Datei liegt (`null` = ohne Ordner) — beim Ziehen sagt der Baum damit schon beim Überfahren „Liegt schon hier“. */
  folder?: string | null;
  aiKind?: AiKind;
}

/** Beschriftung aus den Verwendungen: die erste, und wie viele es noch gibt (10 A6). */
export function useMediaCaption(): (references: readonly { label: string }[]) => string | undefined {
  const t = useTranslations('media');
  return useCallback(
    (references: readonly { label: string }[]) =>
      references.length === 0 ? undefined : references.length === 1 ? references[0]!.label : t('captionMore', { label: references[0]!.label, count: references.length - 1 }),
    [t],
  );
}

/**
 * Die Kacheln der Mediathek — Vorschau, Verwendung als Beschriftung, Dateiname, Marke „nicht verwendet“. Dieselbe
 * Komponente zeigt die Mediathek-Seite und der Auswahl-Dialog; der Dialog gibt
 * `selected` mit, damit angehakte Kacheln als solche erscheinen. Mit
 * `draggable` lässt sich jede Kachel einzeln auf einen Ordner ziehen
 * (`application/x-kompass-media`, JSON-Liste mit einer ID; keine
 * Mehrfachauswahl im Raster, Spec § 9).
 */
export function AssetGrid({
  items,
  selected,
  onOpen,
  previewSrc = (id) => `/media/${id}/preview`,
  draggable = false,
  blocked,
}: {
  items: GridItem[];
  selected?: ReadonlySet<string>;
  onOpen: (item: GridItem) => void;
  previewSrc?: (id: string) => string;
  draggable?: boolean;
  /**
   * Gesperrte Kacheln (der Auswahldialog an seiner Grenze): nicht wählbar, mit dem Grund per
   * `aria-describedby` — die ID eines Elements, das der Aufrufer zeigt.
   */
  blocked?: { ids: ReadonlySet<string>; reasonId: string };
}) {
  const t = useTranslations('media');
  /** Die Kachel, die gerade gezogen wird, bleibt blass an ihrem Platz (Artboard 7a). */
  const { dragging, dragProps } = useAssetDrag(draggable);
  return (
    <ul className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
      {items.map((it) => {
        const isSelected = selected?.has(it.id) ?? false;
        const isBlocked = blocked?.ids.has(it.id) ?? false;
        return (
          <li key={it.id}>
            <button
              type="button"
              data-asset-id={it.id}
              onClick={() => onOpen(it)}
              aria-pressed={selected ? isSelected : undefined}
              disabled={isBlocked || undefined}
              aria-describedby={isBlocked ? blocked?.reasonId : undefined}
              {...dragProps(it)}
              className={`flex h-full w-full flex-col overflow-hidden rounded-md border bg-surface text-left hover:border-line-strong disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-line ${
                dragging === it.id ? 'border-2 border-dashed border-line-strong opacity-50' : isSelected ? 'border-brand border-2' : 'border-line'
              }`}
            >
              {/* 145: ein festes Format für alle Vorschaubilder (4:3, zugeschnitten); das Bild liegt absolut, damit ein hohes
                  Foto die Fläche nicht streckt — so sind alle Karten einer Zeile gleich hoch (`h-full`). Kein Layout-Test. */}
              <span data-asset-thumb className="relative grid aspect-[4/3] min-h-0 grid-rows-[minmax(0,1fr)] place-items-center overflow-hidden bg-surface-2">
                {it.mimeType.startsWith('image/') ? (
                  // Nicht selbst ziehbar: Sonst zieht der Browser das Bild und legt es als Datei bei.
                  <img src={previewSrc(it.id)} alt="" loading="lazy" draggable={false} className="size-full object-cover" />
                ) : (
                  <span className="text-[20px] font-semibold uppercase text-ink-2">{it.filename.split('.').at(-1)}</span>
                )}
                {/* 147: „Ausgewählt“ auf dem Bild oben rechts, statt den Titel zu kürzen. */}
                {selected && isSelected ? (
                  <StatusBadge tone="neutral" className="absolute top-1.5 right-1.5">
                    {t('chooser.selected')}
                  </StatusBadge>
                ) : null}
                {it.aiKind && it.aiKind !== 'none' ? (
                  <span className={`absolute ${selected && isSelected ? 'top-1.5 left-1.5' : 'top-1.5 right-1.5'}`}>
                    <AiKindBadge kind={it.aiKind} />
                  </span>
                ) : null}
              </span>
              <span className="flex items-center gap-1 px-2 py-1.5 text-hint">
                {/* 144/145: Titel ist der Dateiname, die Verwendung steht gedämpft darunter (vorher umgekehrt, 10 A6). */}
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-ink">{it.filename}</span>
                  {/* 10 B30: Nur die Abweichung trägt eine Marke; sie steht an der Stelle der Verwendung, die eine unverwendete
                      Datei nicht hat, damit der Name die ganze Breite behält (Designer 2026-10-22). `py-px` hält sie auf
                      Zeilenhöhe, nur hier. */}
                  {it.caption ? (
                    <span className="truncate text-muted-ink">{it.caption}</span>
                  ) : !it.used && !(selected && isSelected) ? (
                    <StatusBadge tone="neutral" className="self-start py-px">
                      {t('unused')}
                    </StatusBadge>
                  ) : null}
                  {it.place ? (
                    <span data-folder-cell className="truncate text-hint text-ink-2">
                      {it.place}
                    </span>
                  ) : null}
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
