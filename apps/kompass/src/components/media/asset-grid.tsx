'use client';

import { useTranslations } from 'next-intl';

export interface GridItem {
  id: string;
  filename: string;
  mimeType: string;
  used: boolean;
}

/**
 * Die Kacheln der Mediathek — Vorschau, Dateiname, Verwendungs-Marke. Dieselbe
 * Komponente zeigt die Mediathek-Seite und der Auswahl-Dialog; der Dialog gibt
 * `selected` mit, damit angehakte Kacheln als solche erscheinen.
 */
export function AssetGrid({
  items,
  selected,
  onOpen,
  previewSrc = (id) => `/media/${id}/preview`,
}: {
  items: GridItem[];
  selected?: ReadonlySet<string>;
  onOpen: (item: GridItem) => void;
  previewSrc?: (id: string) => string;
}) {
  const t = useTranslations('media');
  return (
    <ul className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
      {items.map((it) => {
        const isSelected = selected?.has(it.id) ?? false;
        return (
          <li key={it.id}>
            <button
              type="button"
              onClick={() => onOpen(it)}
              aria-pressed={selected ? isSelected : undefined}
              className={`flex w-full flex-col overflow-hidden rounded-md border bg-surface text-left hover:border-line-strong ${isSelected ? 'border-brand border-2' : 'border-line'}`}
            >
              <span className="grid aspect-square place-items-center bg-surface-2">
                {it.mimeType.startsWith('image/') ? (
                  <img src={previewSrc(it.id)} alt="" loading="lazy" className="size-full object-cover" />
                ) : (
                  <span className="text-[20px] font-semibold uppercase text-ink-2">{it.filename.split('.').at(-1)}</span>
                )}
              </span>
              <span className="flex items-center justify-between gap-1 px-2 py-1.5 text-[12px]">
                <span className="truncate font-mono">{it.filename}</span>
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
