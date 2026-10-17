'use client';

import { Select } from '@base-ui/react/select';
import { ArrowDown, ArrowUp, ArrowUpDown, Check, ChevronDown } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useTransition } from 'react';
import { createPortal } from 'react-dom';
import { type ColumnRole, TableHead, useTableContext } from '@/components/ui/table';
import type { SortDirection } from '@/lib/sort';
import { cn } from '@/lib/utils';

function useSortUrl() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [, startTransition] = useTransition();
  const current = { field: params.get('sort'), direction: (params.get('dir') === 'asc' ? 'asc' : 'desc') as SortDirection };
  const go = (field: string, direction: SortDirection) => {
    const next = new URLSearchParams(params.toString());
    next.set('sort', field);
    // Eine neue Reihenfolge fängt auf der ersten Seite an (`ListPager`).
    next.delete('page');
    next.set('dir', direction);
    startTransition(() => router.replace(`${pathname}?${next.toString()}`));
  };
  return { current, go };
}

export function SortableHead({ field, label, className, col }: { field: string; label: string; className?: string; col?: ColumnRole }) {
  const t = useTranslations('common');
  const { current, go } = useSortUrl();
  const table = useTableContext();
  const registerSort = table?.registerSort;
  const setAmountLabel = table?.setAmountLabel;

  useEffect(() => registerSort?.({ field, label }), [registerSort, field, label]);
  useEffect(() => {
    if (col === 'amount') setAmountLabel?.(label);
  }, [col, label, setAmountLabel]);

  const active = current.field === field;
  const direction: SortDirection = active ? current.direction : 'desc';

  // Erster Klick: absteigend (wie die Vorgabe der Listen), zweiter: aufsteigend.
  const toggle = () => go(field, active && direction === 'desc' ? 'asc' : 'desc');

  const Icon = !active ? ArrowUpDown : direction === 'asc' ? ArrowUp : ArrowDown;
  // Am Telefon fehlt der Tabellenkopf; die erste sortierbare Spalte stellt den Sortierknopf über die Kartenliste.
  const menuHere = table?.cards && table.sortSlot && table.sorts[0]?.field === field;

  return (
    <TableHead col={col} className={cn('', className)} aria-sort={active ? (direction === 'asc' ? 'ascending' : 'descending') : 'none'}>
      {/* Versalien am Knopf: Der Browser setzt die Versalien des Kopfs an `<button>` zurück — ohne stand ein sortierbarer Kopf in
          gemischter Schreibung neben den Versalien der übrigen (03 B9, 04 B7). Kein Layout-Test (AGENTS.md). */}
      <button type="button" onClick={toggle} className="inline-flex items-center gap-1 uppercase hover:text-ink" aria-label={t('sortBy', { column: label })}>
        {label}
        <Icon className={cn('size-3', !active && 'opacity-50')} aria-hidden />
      </button>
      {menuHere ? createPortal(<SortMenu />, table.sortSlot!) : null}
    </TableHead>
  );
}

/**
 * Sortierknopf der Kartenliste (E1-Notiz „Kopf und Sortierung“): „Sortieren: Datum ↓“, öffnet eine Liste
 * (`listbox`) mit jeder sortierbaren Spalte in beiden Richtungen, die gewählte mit Haken.
 */
function SortMenu() {
  const tMenu = useTranslations('common.sortMenu');
  const table = useTableContext();
  const { current, go } = useSortUrl();
  const options = (table?.sorts ?? []).flatMap(({ field, label }) =>
    (['desc', 'asc'] as const).map((direction) => ({ value: `${field}:${direction}`, field, direction, label: tMenu(direction, { column: label }) })),
  );
  const selected = current.field ? `${current.field}:${current.direction}` : null;
  const activeLabel = table?.sorts.find((o) => o.field === current.field)?.label;
  const Arrow = current.direction === 'asc' ? ArrowUp : ArrowDown;
  return (
    <Select.Root
      value={selected}
      onValueChange={(value) => {
        const option = options.find((o) => o.value === value);
        if (option) go(option.field, option.direction);
      }}
    >
      <Select.Trigger
        aria-label={activeLabel ? tMenu('current', { column: activeLabel }) : tMenu('none')}
        className="inline-flex min-h-11 items-center gap-1 rounded-md px-2 text-meta text-ink-2 hover:bg-row-hover"
      >
        {activeLabel ? (
          <>
            {tMenu('current', { column: activeLabel })}
            <Arrow className="size-3" aria-hidden />
          </>
        ) : (
          tMenu('none')
        )}
        <ChevronDown className="size-3.5 text-muted-ink" aria-hidden />
      </Select.Trigger>
      <Select.Portal>
        <Select.Positioner align="end" sideOffset={4} alignItemWithTrigger={false} className="z-50">
          <Select.Popup className="min-w-56 rounded-md bg-surface p-1 text-ink shadow-md ring-1 ring-line outline-none">
            <Select.List>
              {options.map((option) => (
                <Select.Item
                  key={option.value}
                  value={option.value}
                  className="flex min-h-11 cursor-default items-center justify-between gap-3 rounded-md px-3 text-meta outline-none data-highlighted:bg-row-hover data-selected:bg-selected"
                >
                  <Select.ItemText>{option.label}</Select.ItemText>
                  <Select.ItemIndicator>
                    <Check className="size-4 text-brand" aria-hidden />
                  </Select.ItemIndicator>
                </Select.Item>
              ))}
            </Select.List>
          </Select.Popup>
        </Select.Positioner>
      </Select.Portal>
    </Select.Root>
  );
}
