'use client';

import { Ban, Check, type LucideIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import type { DragEvent as ReactDragEvent } from 'react';
import type { BlockReason, DragItem } from '@/lib/folder-tree-model';
import { cn } from '@/lib/utils';
import { DropMark, DropNote, HATCH, PickReason, ROW_BLOCKED, ROW_DROP, ROW_SELECTED, rowClass, type FolderTreeDensity, type RowDrop, type RowPick } from './folder-tree-row';

/** Ein Eintrag über dem Baum: „Alle Dokumente“, „Eingangskorb“. */
export interface FolderTreeFixedEntry {
  key: string;
  label: string;
  icon: LucideIcon;
  count?: number;
  /** Im Modus `navigate` Pflicht; im Modus `pick` wählt ein Klick statt zu navigieren. */
  href?: string;
  /** Nimmt Ziehgut an (Eingangskorb), oder nicht („Alle Dokumente“). */
  dropTarget: boolean;
  /** Wohin Abgelegtes geht; `null` = Eingangskorb. */
  folder: string | null;
  /** Steht die Seite gerade auf diesem Eintrag? `selected` nennt nur Pfade. */
  current?: boolean;
  /**
   * Eine eigene Sperre dieses Ziels über die Regeln des Baums hinaus — der
   * Eingangskorb nimmt nur eingegangene Post; ein Ausgang ohne Ordner liegt
   * unter „Alle Dokumente“, nicht im Eingangskorb.
   */
  refuse?: (item: DragItem) => BlockReason | null;
}

export interface FixedEntryDrop {
  onDragOver?: (e: ReactDragEvent) => void;
  onDragLeave?: (e: ReactDragEvent<HTMLElement>) => void;
  onDrop?: (e: ReactDragEvent) => void;
}

/**
 * Fester Eintrag (HANDOFF § 3.3, Board K4): mit Symbol im Pfeilfeld, ohne
 * Pfeil, ohne Menü. Gleiche Zeilenmaße wie der Baum, damit Namen fluchten.
 */
export function FixedEntry({ entry, state, density, drop }: { entry: FolderTreeFixedEntry; state: RowDrop | null; density: FolderTreeDensity; drop: FixedEntryDrop }) {
  const t = useTranslations('folderTree');
  const Icon = entry.icon;
  const line = density === 'touch' ? 'h-[22px]' : 'h-[18px]';
  const box = density === 'touch' ? 'w-6' : 'w-[18px]';
  return (
    <Link
      href={entry.href ?? ''}
      aria-current={entry.current ? 'page' : undefined}
      data-fixed={entry.key}
      data-drop={state?.state}
      {...drop}
      className={cn(
        rowClass(density),
        'pl-1',
        entry.current && ROW_SELECTED,
        !entry.current && !state && 'hover:bg-hover',
        state?.state === 'target' && ROW_DROP,
        state?.state === 'blocked' && ROW_BLOCKED
      )}
      style={state?.state === 'blocked' ? HATCH : undefined}
    >
      <span className={cn('grid shrink-0 place-items-center', line, box)}>
        <Icon className="size-4" aria-hidden />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="wrap-anywhere">{entry.label}</span>
        {state ? <DropNote drop={state} opening={t('opening')} /> : null}
      </span>
      <span className={cn('flex shrink-0 items-center', line)}>
        {state ? (
          <DropMark state={state.state} />
        ) : entry.count !== undefined ? (
          <span className={cn('font-mono text-[12px] font-normal tabular-nums', entry.current ? 'text-current' : 'text-muted-ink')}>{entry.count}</span>
        ) : null}
      </span>
    </Link>
  );
}

/**
 * Fester Eintrag im Auswahlmodus (Artboard 5: „Oberste Ebene“, „Eingangskorb“,
 * „Ohne Ordner“): ein Knopf statt eines Links, gewählt über `aria-pressed`,
 * gesperrt wie eine Baumzeile über `aria-disabled` mit Grund.
 */
export function PickFixedEntry({
  entry,
  mark,
  blocked,
  density,
  check = true,
  onPick,
}: {
  entry: FolderTreeFixedEntry;
  mark?: string;
  blocked: RowPick['blocked'];
  density: FolderTreeDensity;
  /** Häkchen statt Zahl, wenn gewählt (siehe `RowPick.check`). */
  check?: boolean;
  onPick: () => void;
}) {
  const t = useTranslations('folderTree');
  const Icon = entry.icon;
  const line = density === 'touch' ? 'h-[22px]' : 'h-[18px]';
  const box = density === 'touch' ? 'w-6' : 'w-[18px]';
  const picked = !!entry.current;
  return (
    <button
      type="button"
      data-fixed={entry.key}
      aria-pressed={picked}
      aria-disabled={blocked ? true : undefined}
      aria-describedby={blocked ? blocked.id : undefined}
      aria-label={mark ? t('accessibleNameMark', { label: entry.label, mark }) : entry.label}
      onClick={() => {
        if (!blocked) onPick();
      }}
      className={cn(
        rowClass(density),
        'w-full pl-1 text-left',
        blocked ? 'cursor-default text-muted-ink' : 'cursor-pointer',
        picked && ROW_SELECTED,
        !picked && !blocked && 'hover:bg-hover'
      )}
    >
      <span className={cn('grid shrink-0 place-items-center', line, box)}>
        <Icon className="size-4" aria-hidden />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="wrap-anywhere">{entry.label}</span>
        {blocked ? <PickReason blocked={blocked} /> : null}
      </span>
      <span className={cn('flex shrink-0 items-center', line)}>
        {mark ? (
          <span aria-hidden className="rounded-sm bg-badge px-1.5 text-[11px] leading-4 font-semibold whitespace-nowrap text-badge-ink">
            {mark}
          </span>
        ) : blocked ? (
          <Ban className="size-4 text-drop-blocked-ring" strokeWidth={2.4} aria-hidden />
        ) : picked && check ? (
          <Check className="size-4 text-primary" strokeWidth={2.6} aria-hidden />
        ) : entry.count !== undefined ? (
          <span className={cn('font-mono text-[12px] font-normal tabular-nums', picked ? 'text-current' : 'text-muted-ink')}>{entry.count}</span>
        ) : null}
      </span>
    </button>
  );
}
