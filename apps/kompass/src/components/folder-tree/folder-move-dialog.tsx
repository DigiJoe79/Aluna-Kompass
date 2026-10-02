'use client';

import { CircleSlash, Folder, Inbox } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo, useState, useSyncExternalStore, useTransition } from 'react';
import { Notice } from '@/components/notice';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { ActionState } from '@/lib/actions';
import { TREE_ROOT, ancestorsOf, buildFolderTree, nameOf, validateFolderTarget, type DragItem, type FolderEntry, type FolderNode } from '@/lib/folder-tree-model';
import { cn } from '@/lib/utils';
import { FolderTree } from './folder-tree';
import type { FolderTreeUnit } from './folder-tree-row';

export type FolderMoveSubject =
  | { kind: 'folder'; path: string; total: number }
  /** `sources`: wie viele je Ordner liegen; Schlüssel `''` = ohne Ordner (Eingangskorb). */
  | { kind: 'documents' | 'assets'; ids: string[]; title: string; sources: Record<string, number> };

export interface FolderMoveDialogProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  subject: FolderMoveSubject;
  folders: FolderEntry[];
  /** „Oberste Ebene“ (Ordner) bzw. „Eingangskorb“ (Dokumente) bzw. „Ohne Ordner“ (Medien). */
  rootLabel: string;
  /** Was die Wurzel ist, für den Satz „Liegt im Eingangskorb.“ bzw. „Liegt in keinem Ordner.“; Vorgabe `none`. */
  rootKind?: 'inbox' | 'none';
  /** Verschiebt; bei einem Fehler bleibt der Dialog offen und nennt den Grund. */
  onConfirm(target: string | null): Promise<ActionState>;
  /** Statt des Titels aus dem Gegenstand, etwa im Ordnerfeld „Verschieben nach…“. */
  title?: string;
  /** Wofür die Zahlen stehen; Vorgabe nach dem Gegenstand (Medien: Dateien, sonst Dokumente). Ein Ordner der Mediathek gibt Dateien an. */
  unit?: FolderTreeUnit;
  /**
   * Die Zeile unter dem Titel, wo Dokumente oder Dateien heute liegen
   * (Artboard 5b/5c). Aus, wo noch nichts abgelegt ist (Ordnerfeld im
   * Empfangsdialog).
   */
  showLocation?: boolean;
  /**
   * `move` (Vorgabe): Es wird verschoben — der Knopf sagt „Nach „X“
   * verschieben“, der aktuelle Ort ist gesperrt. `pick`: Es wird nur ein Ort
   * für etwas noch nicht Gespeichertes gewählt (Empfangsdialog) — der Knopf
   * sagt „„X“ übernehmen“, der aktuelle Ort trägt „gewählt“ und bleibt
   * wählbar, denn ihn noch einmal zu wählen schadet nicht.
   */
  verb?: 'move' | 'pick';
}

/** Bis zu so vielen Orten nennt die Zeile unter dem Titel jeden; darüber nur die Zahl. */
const LOCATION_LIST_MAX = 3;

/** Unter `sm` (640 px) ganzseitig mit 44-px-Zeilen (Artboard 5, 390 px). */
const NARROW = '(max-width: 639px)';

function subscribeNarrow(onChange: () => void) {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {};
  const media = window.matchMedia(NARROW);
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
}

function useNarrow(): boolean {
  return useSyncExternalStore(
    subscribeNarrow,
    () => typeof window.matchMedia === 'function' && window.matchMedia(NARROW).matches,
    () => false
  );
}

/** Die Ordner in Baumreihenfolge, damit der Fokus beim Öffnen auf dem obersten aktuellen Ort liegt. */
function treeOrder(nodes: Record<string, FolderNode>): string[] {
  const out: string[] = [];
  const walk = (path: string) => {
    for (const child of nodes[path]?.children ?? []) {
      out.push(child);
      walk(child);
    }
  };
  walk(TREE_ROOT);
  return out;
}

/**
 * Dialog „Verschieben nach…“ (HANDOFF § 3.4, README § 3 Artboard 5): derselbe
 * Baum im Modus `pick`. Der aktuelle Ort trägt „liegt hier“ und ist gesperrt;
 * liegen mehrere Dokumente in verschiedenen Ordnern, zählt die Marke („3
 * liegen hier“) und der Ordner bleibt wählbar. Für einen Ordner ist der eigene
 * Teilbaum gesperrt. Beim Öffnen ist der Weg zum aktuellen Ort offen und der
 * Fokus liegt darauf. Der Hauptknopf nennt das Ziel.
 */
export function FolderMoveDialog({ open, onOpenChange, ...rest }: FolderMoveDialogProps) {
  const narrow = useNarrow();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        layout="fixed-footer"
        // Den Fokus setzt der Baum selbst, sobald seine Zeilen stehen.
        initialFocus={false}
        className={cn(
          'bg-surface shadow-md sm:max-w-[440px]',
          // Unter `sm` ganzseitig, der Knopf unten fest (Artboard 5, 390 px).
          'max-sm:top-0 max-sm:left-0 max-sm:h-dvh max-sm:max-h-none max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-none max-sm:ring-0'
        )}
      >
        {open ? <MoveDialogBody {...rest} onOpenChange={onOpenChange} density={narrow ? 'touch' : 'default'} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function MoveDialogBody({
  subject,
  folders,
  rootLabel,
  rootKind = 'none',
  onConfirm,
  onOpenChange,
  title,
  unit: unitProp,
  showLocation = true,
  verb = 'move',
  density,
}: Omit<FolderMoveDialogProps, 'open'> & { density: 'default' | 'touch' }) {
  const t = useTranslations('moveDialog');
  const tree = useTranslations('folderTree');
  const tc = useTranslations('common');
  const nodes = useMemo(() => buildFolderTree(folders), [folders]);
  /** `undefined`: noch nichts gewählt; `null`: der feste Eintrag ohne Ordner. */
  const [picked, setPicked] = useState<string | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const item: DragItem = useMemo(
    () =>
      subject.kind === 'folder'
        ? subject
        : {
            kind: subject.kind,
            ids: subject.ids,
            label: subject.title,
            sources: Object.entries(subject.sources).flatMap(([path, count]) => Array.from({ length: count }, () => (path === '' ? null : path))),
          },
    [subject]
  );

  /** Wo es heute liegt: Pfad je Ort (`''` = ohne Ordner) mit Marke. */
  const marks = useMemo(() => {
    if (subject.kind === 'folder') return { [ancestorsOf(subject.path).at(-1) ?? '']: tree('here') };
    const entries = Object.entries(subject.sources).filter(([, count]) => count > 0);
    if (entries.length === 1) return { [entries[0]![0]]: tree(verb === 'pick' ? 'chosen' : 'here') };
    return Object.fromEntries(entries.map(([path, count]) => [path, tree('hereCount', { count })]));
  }, [subject, tree, verb]);

  /** Der Fokus beim Öffnen: der aktuelle Ort, bei mehreren der oberste; ohne Ordner der feste Eintrag. */
  const here = useMemo(() => {
    const places = Object.keys(marks);
    if (places.includes('')) return null;
    const order = treeOrder(nodes);
    return places.filter((p) => nodes[p]).sort((a, b) => order.indexOf(a) - order.indexOf(b))[0] ?? null;
  }, [marks, nodes]);

  // Einmal beim Öffnen: der Weg zu jedem aktuellen Ort.
  const [initialExpanded] = useState(() => {
    const places = Object.keys(marks).filter((p) => p !== '');
    const open = new Set(places.flatMap((p) => ancestorsOf(p)));
    // Für einen Ordner auch er selbst: Sein gesperrter Teilbaum ist zu sehen (Artboard 5a).
    if (subject.kind === 'folder') for (const p of [...places, subject.path]) open.add(p);
    return [...open];
  });
  const [initialFocus] = useState(here);

  const heading =
    title ??
    (subject.kind === 'folder'
      ? t('titleFolder', { name: nameOf(subject.path) })
      : subject.ids.length === 1
        ? t('titleOne', { title: subject.title })
        : t(subject.kind === 'assets' ? 'titleManyAssets' : 'titleMany', { count: subject.ids.length }));

  /** „Liegt in Finanzamt.“ · „3 liegen in Vereinsregister 2026, 2 in Finanzamt.“ — Namen, nie Wege. */
  const location = useMemo(() => {
    if (!showLocation || subject.kind === 'folder') return null;
    const places = Object.entries(subject.sources).filter(([, count]) => count > 0);
    if (places.length === 0) return null;
    const args = ([path, count]: [string, number]) => ({ count, place: nameOf(path) });
    const root = rootKind === 'inbox' ? 'Inbox' : 'None';
    const key = (entry: [string, number], form: 'one' | 'first' | 'next') => `location.${form}${entry[0] === '' ? root : ''}`;
    if (places.length === 1) return t(key(places[0]!, 'one'), args(places[0]!));
    if (places.length > LOCATION_LIST_MAX) return t('location.many', { count: places.length });
    const items = places.map((entry, i) => t(key(entry, i === 0 ? 'first' : 'next'), args(entry)));
    return t('location.list', { items: items.join(t('location.separator')) });
  }, [showLocation, subject, rootKind, t]);

  const RootIcon = subject.kind === 'folder' ? Folder : subject.kind === 'documents' ? Inbox : CircleSlash;
  const kind = subject.kind === 'assets' ? 'files' : 'documents';
  const unit = unitProp ?? { one: t(`unit.${kind}.one`), many: t(`unit.${kind}.many`) };

  const confirm = () => {
    if (picked === undefined) return;
    setError(null);
    start(async () => {
      try {
        const state = await onConfirm(picked);
        if (state.status === 'error') setError(state.detail ?? state.message);
        else onOpenChange(false);
      } catch {
        // Eine Ausnahme der Server Action ginge sonst an die Fehlergrenze; der Dialog bleibt offen.
        setError(tree('error.unexpected'));
      }
    });
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle className="font-heading text-[19px] leading-[1.3] text-pretty">{heading}</DialogTitle>
        {location ? <DialogDescription className="text-[13px] text-ink-2">{location}</DialogDescription> : null}
      </DialogHeader>
      <DialogBody className="flex flex-col gap-3 max-sm:px-2.5 max-sm:py-1">
        <div className="flex flex-col rounded-md sm:border sm:border-line sm:p-1.5">
          <FolderTree
            folders={folders}
            mode="pick"
            selected={picked ?? null}
            fixed={[{ key: 'root', label: rootLabel, icon: RootIcon, dropTarget: false, folder: null, current: picked === null }]}
            unit={unit}
            storageKey={null}
            density={density}
            onPick={(path) => {
              setError(null);
              setPicked(path);
            }}
            marks={marks}
            blocked={(target) => {
              const reason = validateFolderTarget(nodes, item, target);
              // Beim Wählen ist der aktuelle Ort ein gültiges Ziel; gesperrt bleibt, was es nur als Weg gibt.
              return verb === 'pick' && reason === 'here' ? null : reason;
            }}
            blockedName={subject.kind === 'folder' ? nameOf(subject.path) : ''}
            initialExpanded={initialExpanded}
            initialFocus={initialFocus}
          />
        </div>
        {error ? (
          <Notice level="refuse">
            <p>{error}</p>
          </Notice>
        ) : null}
      </DialogBody>
      <DialogFooter className="max-sm:px-4 max-sm:pt-3 max-sm:pb-5">
        <Button variant="ghost" className="max-sm:hidden" onClick={() => onOpenChange(false)}>
          {tc('cancel')}
        </Button>
        <Button data-confirm disabled={picked === undefined || pending} onClick={confirm} className="max-sm:h-[46px] max-sm:w-full max-sm:text-base">
          {verb === 'pick'
            ? picked === undefined
              ? tree('pickConfirmEmpty')
              : tree('pickConfirm', { target: picked === null ? rootLabel : nameOf(picked) })
            : picked === undefined
              ? t('confirmEmpty')
              : t('confirm', { target: picked === null ? rootLabel : nameOf(picked) })}
        </Button>
      </DialogFooter>
    </>
  );
}
