'use client';

import { Ban, Check, ChevronRight, CornerDownRight, MoreHorizontal } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import type { CSSProperties, HTMLAttributes, MouseEvent as ReactMouseEvent } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { FolderNode } from '@/lib/folder-tree-model';
import { cn } from '@/lib/utils';

export type Translate = (key: string, values?: Record<string, string | number>) => string;
export type FolderTreeDensity = 'default' | 'touch';
export type FolderTreeUnit = { one: string; many: string };

/**
 * Maße je Dichte (HANDOFF § 2). Zeile = Polster + Zeilenhöhe + 2 × 2 px
 * Rahmen: 5 + 18 + 5 + 4 = 32 px, am Telefon 9 + 22 + 9 + 4 = 44 px.
 */
export const DENSITY = {
  default: { indent: 16, base: 4, chevron: 18 },
  touch: { indent: 20, base: 4, chevron: 24 },
} as const;

/** Was eine Baumzeile vorliest (README § 6): Name, Summe, und „davon direkt“ nur, wenn es sich unterscheidet. */
export function accessibleName(t: Translate, node: FolderNode, unit: FolderTreeUnit): string {
  if (node.total === 0) return t('accessibleNameEmpty', { name: node.name });
  const word = node.total === 1 ? unit.one : unit.many;
  if (node.direct === node.total) return t('accessibleNameAll', { name: node.name, total: node.total, unit: word });
  return t('accessibleName', { name: node.name, total: node.total, unit: word, direct: node.direct });
}

/** Die Zeilenklassen, die Baum, Platzhalter und feste Einträge teilen. */
export function rowClass(density: FolderTreeDensity) {
  return cn(
    // Rahmen 2 px auch im Ruhezustand, nur durchsichtig: Ablageziel und Sperre
    // färben ihn später ein, ohne dass die Zeile springt.
    'relative flex items-start gap-1 rounded-md border-2 border-transparent pr-1.5 text-ink-2',
    'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus',
    density === 'touch' ? 'min-h-11 py-[9px] text-base leading-[22px]' : 'min-h-8 py-[5px] text-sm leading-[18px]'
  );
}

export const ROW_SELECTED = 'bg-selected font-semibold text-selected-ink';
export const ROW_DROP = 'border-drop-ring bg-drop-bg font-semibold text-drop-ink';
/** Gesperrt: gestrichelt, schraffiert, Text in `ink` — kein Fehler, nur kein Ziel (README § 2). */
export const ROW_BLOCKED = 'border-dashed border-drop-blocked-ring bg-transparent font-normal text-ink';
export const HATCH: CSSProperties = {
  backgroundImage: 'repeating-linear-gradient(135deg, var(--color-drop-blocked-hatch) 0 2px, transparent 2px 7px)',
};

/** Was die Zeile beim Ziehen zeigt; nur die unter dem Zeiger bzw. im Fokus hat einen. */
export type RowDrop = { state: 'target' | 'blocked'; reason?: string; opening?: boolean };

/** Rechts in der Zeile: Pfeil in den Ordner oder ⊘. */
export function DropMark({ state }: { state: RowDrop['state'] }) {
  return state === 'target' ? (
    <CornerDownRight className="size-4 text-drop-ring" strokeWidth={2.4} aria-hidden />
  ) : (
    <Ban className="size-4 text-drop-blocked-ring" strokeWidth={2.4} aria-hidden />
  );
}

/** Zweite Zeile unter dem Namen: Sperrgrund (fett, `ink`) oder „Klappt gleich auf“. */
export function DropNote({ drop, opening }: { drop: RowDrop; opening: string }) {
  const text = drop.state === 'blocked' ? drop.reason : drop.opening ? opening : undefined;
  if (!text) return null;
  return (
    <span data-drop-note className={cn('text-[12px] leading-4 text-pretty', drop.state === 'blocked' ? 'font-semibold text-ink' : 'font-normal text-drop-ink')}>
      {text}
    </span>
  );
}

/**
 * Verweil-Balken (HANDOFF § 2): 3 px am unteren Rand, füllt sich in 0,8 s —
 * so lange, wie Headless Tree wartet, bevor es aufklappt (`openOnDropDelay`).
 */
export function DwellBar({ left }: { left: number }) {
  return (
    <span aria-hidden className="pointer-events-none absolute right-2 bottom-px h-[3px] overflow-hidden rounded-sm bg-drop-bg" style={{ left }}>
      <span className="block h-full origin-left animate-dwell rounded-sm bg-drop-ring" />
    </span>
  );
}

interface FolderTreeRowProps {
  node: FolderNode;
  /** 0 = oberste Ebene. */
  level: number;
  isFolder: boolean;
  isExpanded: boolean;
  isSelected: boolean;
  /** Vorfahr des gewählten Ordners: bleibt offen, der Pfeil ist dann nur Anzeige. */
  isLockedOpen?: boolean;
  /** Ablageziel oder Sperre unter dem Zeiger bzw. im Fokus beim Ziehen per Tastatur. */
  drop?: RowDrop | null;
  /** Teilbaum eines gezogenen Ordners: vorab gedämpft (README § 2). */
  dimmed?: boolean;
  /** Marke statt Zahl, etwa „wird verschoben“ oder im Dialog „liegt hier“. */
  badge?: string;
  /** Eine Änderung an diesem Ziel ist unterwegs: kleiner Kreis vor der Zahl (README § 3, Artboard 3). */
  saving?: boolean;
  /** Im Modus `navigate` der Link des Namens; im Modus `pick` fehlt er (kein Link). */
  href?: string;
  /** Nur im Modus `pick`: gesperrt mit Grund (README § 6). */
  pick?: RowPick;
  density: FolderTreeDensity;
  /** Was Headless Tree an die Zeile hängt; fehlt beim Platzhalter vor der Hydration. */
  itemProps?: HTMLAttributes<HTMLDivElement> & Record<string, unknown>;
  label?: string;
  onToggle?: () => void;
  onRowClick?: (e: ReactMouseEvent<HTMLDivElement>) => void;
  /** „…“ am Ordner (README § 2): fehlt ohne Pflegerecht und an Ordnern, die es nur als Weg gibt. */
  menu?: RowMenuButton | null;
}

/**
 * Eine Zeile im Auswahlmodus: gesperrt heißt `aria-disabled` mit dem Grund
 * über `aria-describedby`. Der Grund steht sichtbar unter dem Namen
 * (`showReason`) oder nur für Vorleser — im Teilbaum eines gesperrten
 * Ordners stünde sonst in jeder Zeile derselbe Satz (Board, Artboard 5a).
 */
export type RowPick = {
  blocked: { id: string; text: string; showReason: boolean } | null;
  /** Häkchen statt Zahl am gewählten Eintrag; aus, wo der Baum filtert (Auswahldialog, Artboard 8). */
  check?: boolean;
};

/**
 * Der „…“-Knopf: `always` an der gewählten Zeile und am Telefon, sonst
 * erst bei Hover und Fokus (`hover`); offen, solange sein Menü offen ist.
 */
export type RowMenuButton = { visible: 'always' | 'hover'; open: boolean; onOpen: (anchor: HTMLElement) => void };

/**
 * Eine Baumzeile (HANDOFF § 3.2, Board K1): Führungslinien · Pfeil · Name ·
 * Summe. Die Zeile selbst ist das `treeitem` (ein `div`), darin der Pfeil als
 * Knopf und der Name als Link — kein Knopf im Link, und ein Mittelklick auf
 * den Namen öffnet den Ordner im neuen Tab.
 */
export function FolderTreeRow({ node, level, isFolder, isExpanded, isSelected, drop = null, dimmed = false, badge, saving = false, isLockedOpen = false, href, pick, density, itemProps, label, onToggle, onRowClick, menu = null }: FolderTreeRowProps) {
  const t = useTranslations('folderTree');
  const { indent, base, chevron } = DENSITY[density];
  const placeholder = !itemProps;
  const isOver = drop?.state === 'target';
  const blocked = drop?.state === 'blocked';
  const locked = pick?.blocked ?? null;
  return (
    <div
      {...itemProps}
      aria-hidden={placeholder || undefined}
      aria-label={placeholder ? undefined : label}
      data-folder={placeholder ? undefined : node.path}
      // Navigation: der geöffnete Ordner ist die Seite (`aria-current`), ohne
      // `aria-selected` (APG Navigation Treeview); im Dialog nur ausgewählt (README § 6).
      aria-selected={placeholder || !pick ? undefined : isSelected}
      aria-current={isSelected && !placeholder && !pick ? 'page' : undefined}
      aria-disabled={locked && !placeholder ? true : undefined}
      aria-describedby={locked && !placeholder ? locked.id : undefined}
      data-drop={drop?.state}
      data-dimmed={dimmed || undefined}
      onClick={onRowClick}
      className={cn(
        rowClass(density),
        'group/row',
        locked ? 'cursor-default text-muted-ink' : 'cursor-pointer',
        isSelected && ROW_SELECTED,
        !isSelected && !drop && !locked && 'hover:bg-hover',
        dimmed && !drop && 'text-muted-ink',
        isOver && ROW_DROP,
        blocked && ROW_BLOCKED
      )}
      style={{ paddingLeft: base + level * indent, ...(blocked ? HATCH : {}) }}
    >
      {/* Führungslinien: je Vorfahr eine, mittig unter dessen Pfeil. Absolut
          und 3 px über den Rand hinaus (2 px Rahmen + 1 px Zeilenabstand),
          damit sie bei umbrochenen Namen und zwischen den Zeilen durchlaufen. */}
      {Array.from({ length: level }, (_, i) => (
        <span key={i} aria-hidden className="pointer-events-none absolute -top-[3px] -bottom-[3px] w-px bg-tree-guide" style={{ left: base + i * indent + chevron / 2 - 1 }} />
      ))}
      {isFolder && (isLockedOpen || placeholder) ? (
        // Kein Knopf, wo ein Klick nichts bewirken darf: Der Weg zum gewählten
        // Ordner lässt sich nicht zuklappen. Der Pfeil zeigt nur „offen“; ein
        // Klick darauf zählt wie ein Klick in die Zeile.
        <span aria-hidden className={cn('grid shrink-0 place-items-center', density === 'touch' ? 'h-[22px] w-6' : 'h-[18px] w-[18px]', isSelected ? 'text-selected-ink' : 'text-muted-ink')}>
          <ChevronRight className={cn('size-3.5', isExpanded && 'rotate-90')} strokeWidth={2.4} />
        </span>
      ) : isFolder ? (
        <button
          type="button"
          tabIndex={-1}
          aria-hidden
          data-toggle
          // Der Fokus bleibt auf der Zeile; der Pfeil ist nur für Maus und Finger.
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onToggle?.();
          }}
          className={cn(
            'relative grid shrink-0 place-items-center rounded-sm',
            // Klickfläche größer als das Sichtbare: am Schreibtisch die ganze
            // Zeilenhöhe, am Telefon 44 × 44 (HANDOFF § 2).
            density === 'touch' ? 'h-[22px] w-6 after:absolute after:-inset-x-2.5 after:-inset-y-[11px]' : 'h-[18px] w-[18px] after:absolute after:inset-x-0 after:-inset-y-[7px]',
            isSelected ? 'text-selected-ink' : isOver ? 'text-drop-ink' : 'text-muted-ink'
          )}
        >
          <ChevronRight className={cn('size-3.5 transition-transform', isExpanded && 'rotate-90')} strokeWidth={2.4} />
        </button>
      ) : (
        <span aria-hidden className="shrink-0" style={{ width: chevron }} />
      )}
      {placeholder ? (
        <span className="min-w-0 flex-1 wrap-anywhere">{node.name}</span>
      ) : (
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          {href === undefined ? (
            <span className="wrap-anywhere text-pretty">{node.name}</span>
          ) : (
            <Link href={href} tabIndex={-1} draggable={false} className="wrap-anywhere text-pretty outline-none">
              {node.name}
            </Link>
          )}
          {drop ? <DropNote drop={drop} opening={t('opening')} /> : null}
          {locked ? <PickReason blocked={locked} /> : null}
        </span>
      )}
      <span className={cn('flex shrink-0 items-center gap-1', density === 'touch' ? 'h-[22px]' : 'h-[18px]')}>
        {drop ? (
          <DropMark state={drop.state} />
        ) : badge ? (
          <span className="rounded-sm bg-badge px-1.5 text-[11px] leading-4 font-semibold whitespace-nowrap text-badge-ink">{badge}</span>
        ) : locked ? (
          <Ban className="size-4 text-drop-blocked-ring" strokeWidth={2.4} aria-hidden />
        ) : pick && pick.check !== false && isSelected ? (
          <Check className="size-4 text-brand" strokeWidth={2.6} aria-hidden />
        ) : (
          <>
            {saving ? <SavingMark /> : null}
            <Count node={node} tone={isSelected ? 'text-current' : node.total === 0 ? 'text-muted-ink-2' : dimmed ? 'text-muted-ink-2' : 'text-muted-ink'} />
          </>
        )}
        {menu && !drop ? <MenuDots menu={menu} density={density} /> : null}
      </span>
      {drop?.opening ? <DwellBar left={base + level * indent} /> : null}
    </div>
  );
}

/** Der Sperrgrund im Dialog: sichtbar als zweite Zeile (fett, `ink`) oder nur für Vorleser. */
export function PickReason({ blocked }: { blocked: NonNullable<RowPick['blocked']> }) {
  return (
    <span id={blocked.id} className={blocked.showReason ? 'text-[12px] leading-4 font-semibold text-pretty text-ink' : 'sr-only'}>
      {blocked.text}
    </span>
  );
}

/**
 * „…“ (Board K1, 24 px, am Telefon 32 px). Nur für Maus und Finger und ohne
 * eigenen Namen wie der Pfeil: Der Fokus bleibt auf der Zeile, die Tastatur
 * nimmt Umschalt+F10 oder die Menütaste.
 */
function MenuDots({ menu, density }: { menu: RowMenuButton; density: FolderTreeDensity }) {
  const shown = menu.visible === 'always' || menu.open;
  return (
    <button
      type="button"
      tabIndex={-1}
      aria-hidden
      data-row-menu
      data-visible={menu.visible}
      data-open={menu.open || undefined}
      onMouseDown={(e) => e.preventDefault()}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        menu.onOpen(e.currentTarget);
      }}
      className={cn(
        'grid shrink-0 place-items-center rounded-sm border border-transparent text-ink-2 hover:bg-hover',
        // Am Telefon 32 px sichtbar, 44 px Klickfläche (HANDOFF § 2); `after` misst ab der Innenkante des Rahmens.
        density === 'touch' ? 'relative -my-[5px] -mr-0.5 size-8 after:absolute after:-inset-2' : '-my-[3px] -mr-0.5 size-6',
        menu.open && 'border-line-strong bg-active hover:bg-active',
        // Unsichtbar heißt hier auch: nicht klickbar.
        !shown && 'pointer-events-none opacity-0 group-hover/row:pointer-events-auto group-hover/row:opacity-100 group-focus/row:pointer-events-auto group-focus/row:opacity-100'
      )}
    >
      <MoreHorizontal className="size-4" />
    </button>
  );
}

/** „Wird gespeichert“: ein kleiner offener Kreis, der sich dreht, bis der Server antwortet. */
function SavingMark() {
  const t = useTranslations('folderTree');
  return <span role="img" aria-label={t('saving')} data-saving className="size-2.5 shrink-0 animate-spin rounded-full border-[1.5px] border-current border-t-transparent opacity-70" />;
}

/** Die Summe; „direkt“ steht im Tooltip (README § 2, Zähler). */
function Count({ node, tone }: { node: FolderNode; tone: string }) {
  const t = useTranslations('folderTree');
  const number = <span className={cn('font-mono text-[12px] font-normal tabular-nums', tone)}>{node.total}</span>;
  return (
    <Tooltip>
      <TooltipTrigger render={number} />
      <TooltipContent>{t('countTooltip', { total: node.total, direct: node.direct })}</TooltipContent>
    </Tooltip>
  );
}
