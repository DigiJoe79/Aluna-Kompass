'use client';

import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';
import { TableHead } from '@/components/ui/table';
import { cn } from '@/lib/utils';

export type SortDirection = 'asc' | 'desc';

/**
 * Sortierung lebt in der URL (`sort`, `dir`), damit sie Blättern und den
 * Zurück-Knopf überlebt. Serverseitig sortiert, weil die Listen blättern —
 * im Browser sortiert wäre nur die sichtbare Seite umgedreht.
 */
export function readSort<F extends string>(
  params: { sort?: string; dir?: string },
  allowed: readonly F[],
): { field: F; direction: SortDirection } | undefined {
  const field = params.sort;
  if (!field || !allowed.includes(field as F)) return undefined;
  return { field: field as F, direction: params.dir === 'asc' ? 'asc' : 'desc' };
}

export function SortableHead({ field, label, className }: { field: string; label: string; className?: string }) {
  const t = useTranslations('common');
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [, startTransition] = useTransition();

  const active = params.get('sort') === field;
  const direction: SortDirection = active && params.get('dir') === 'asc' ? 'asc' : 'desc';

  const toggle = () => {
    const next = new URLSearchParams(params.toString());
    next.set('sort', field);
    // Erster Klick: absteigend (wie die Vorgabe der Listen), zweiter: aufsteigend.
    next.set('dir', active && direction === 'desc' ? 'asc' : 'desc');
    startTransition(() => router.replace(`${pathname}?${next.toString()}`));
  };

  const Icon = !active ? ArrowUpDown : direction === 'asc' ? ArrowUp : ArrowDown;

  return (
    <TableHead className={cn('px-4', className)} aria-sort={active ? (direction === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button type="button" onClick={toggle} className="inline-flex items-center gap-1 hover:text-ink" aria-label={t('sortBy', { column: label })}>
        {label}
        <Icon className={cn('size-3', !active && 'opacity-50')} aria-hidden />
      </button>
    </TableHead>
  );
}
