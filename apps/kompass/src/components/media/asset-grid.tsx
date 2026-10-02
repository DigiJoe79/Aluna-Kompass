'use client';

import { useTranslations } from 'next-intl';
import { useAssetDrag } from './use-asset-drag';

export interface GridItem {
  id: string;
  filename: string;
  mimeType: string;
  used: boolean;
  /** Der Ort unter dem geöffneten Ordner, als Namen mit „›“; leer oder weggelassen = keine Zeile (Spec § 9). */
  place?: string;
  /** Wo die Datei liegt (`null` = ohne Ordner) — beim Ziehen sagt der Baum damit schon beim Überfahren „Liegt schon hier“. */
  folder?: string | null;
}

/**
 * Die Kacheln der Mediathek — Vorschau, Dateiname, Verwendungs-Marke. Dieselbe
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
              className={`flex w-full flex-col overflow-hidden rounded-md border bg-surface text-left hover:border-line-strong disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-line ${
                dragging === it.id ? 'border-2 border-dashed border-line-strong opacity-50' : isSelected ? 'border-brand border-2' : 'border-line'
              }`}
            >
              <span className="grid aspect-square place-items-center bg-surface-2">
                {it.mimeType.startsWith('image/') ? (
                  // Nicht selbst ziehbar: Sonst zieht der Browser das Bild und legt es als Datei bei.
                  <img src={previewSrc(it.id)} alt="" loading="lazy" draggable={false} className="size-full object-cover" />
                ) : (
                  <span className="text-[20px] font-semibold uppercase text-ink-2">{it.filename.split('.').at(-1)}</span>
                )}
              </span>
              <span className="flex items-center justify-between gap-1 px-2 py-1.5 text-[12px]">
                <span className="flex min-w-0 flex-col">
                  <span className="truncate font-mono">{it.filename}</span>
                  {it.place ? (
                    <span data-folder-cell className="truncate text-[11px] text-ink-2">
                      {it.place}
                    </span>
                  ) : null}
                </span>
                <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] ${it.used ? 'bg-neutral-badge text-neutral-badge-ink' : 'text-ink-2'}`}>
                  {selected && isSelected ? t('chooser.selected') : it.used ? t('used') : t('unused')}
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
