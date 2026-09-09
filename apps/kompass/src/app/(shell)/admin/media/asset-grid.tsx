'use client';

import { useTranslations } from 'next-intl';
import type { Item } from './types';

export function AssetGrid({ items, onOpen }: { items: Item[]; onOpen: (item: Item) => void }) {
  const t = useTranslations('media');
  return (
    <ul className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
      {items.map((it) => (
        <li key={it.id}>
          <button
            type="button"
            onClick={() => onOpen(it)}
            className="flex w-full flex-col overflow-hidden rounded-md border border-line bg-surface text-left hover:border-line-strong"
          >
            <span className="grid aspect-square place-items-center bg-surface-2">
              {it.mimeType.startsWith('image/') ? (
                <img src={`/media/${it.id}`} alt="" className="size-full object-cover" />
              ) : (
                <span className="text-[20px] font-semibold uppercase text-ink-2">{it.filename.split('.').at(-1)}</span>
              )}
            </span>
            <span className="flex items-center justify-between gap-1 px-2 py-1.5 text-[12px]">
              <span className="truncate font-mono">{it.filename}</span>
              <span
                className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] ${it.references.length > 0 ? 'bg-neutral-badge text-neutral-badge-ink' : 'text-ink-2'}`}
              >
                {it.references.length > 0 ? t('used') : t('unused')}
              </span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
