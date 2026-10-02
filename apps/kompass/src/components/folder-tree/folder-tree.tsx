'use client';

import { dragAndDropFeature, hotkeysCoreFeature, syncDataLoaderFeature, type DragTarget } from '@headless-tree/core';
import { useTree } from '@headless-tree/react';
import { Keyboard, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Fragment, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type FocusEvent as ReactFocusEvent, type DragEvent as ReactDragEvent, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import { KeyChip } from '@/components/key-chip';
import { cn } from '@/lib/utils';
import { useFinePointer } from '@/lib/use-fine-pointer';
import type { ActionState } from '@/lib/actions';
import { FOLDER_MIME, MEDIA_MIME, currentDrag, isOutsideUpload } from '@/lib/drag-types';
import {
  TREE_ROOT,
  MAX_FOLDER_DEPTH,
  ancestorsOf,
  buildFolderTree,
  deleteBlock,
  isWithin,
  nameOf,
  validateFolderName,
  validateFolderPlacement,
  validateFolderTarget,
  type FolderNameError,
  type BlockReason,
  type DragItem,
  type FolderEntry,
  type FolderNode,
} from '@/lib/folder-tree-model';
import { announceCancelled, announceNotDropped, announceOpened, announcePickUp, announceTarget, blockText, clause } from './announcements';
import { setDragPreview } from './drag-preview';
import { FixedEntry, PickFixedEntry, type FolderTreeFixedEntry } from './fixed-entry';
import { DENSITY, FolderTreeRow, accessibleName, type FolderTreeDensity, type FolderTreeUnit, type RowDrop, type RowPick } from './folder-tree-row';
import { FolderTreeKeyHelp } from './key-help';
import { NameInputRow } from './name-input-row';
import { RowMenu, type RowMenuTarget } from './row-menu';
import { TYPE_AHEAD_MS, nextTypeAheadMatch } from './type-ahead';
import { useEdgeScroll } from './use-edge-scroll';
import { useFolderTreeExpanded, type FolderTreeStorageKey } from './use-folder-tree-expanded';

export type { FolderTreeFixedEntry } from './fixed-entry';
export type { BlockReason, DragItem } from '@/lib/folder-tree-model';

/** Was der Baum beim Anlegen und Umbenennen mitgibt: `quiet` fragt, ob die Eingabezeile den Fehler selbst nennt (dann kein Toast). */
export interface FolderCallOptions {
  quiet: () => boolean;
}

export interface FolderTreeProps {
  folders: FolderEntry[];
  /**
   * `navigate`: Zeilen sind Links (`hrefFor`), mit Pflege und Ziehen.
   * `pick` (Dialog „Verschieben nach…“, Auswahldialog): Klick und Enter wählen
   * (`onPick`), kein Link, kein „…“, kein Ziehen, `aria-selected` statt
   * `aria-current`; gesperrte Ziele nach `blocked`, Marken nach `marks`.
   */
  mode: 'navigate' | 'pick';
  /** Pfad des gewählten Ordners; `null`, wenn ein fester Eintrag gewählt ist (oder im Modus `pick` noch nichts). */
  selected: string | null;
  fixed: FolderTreeFixedEntry[];
  /** Pflicht im Modus `navigate`. */
  hrefFor?: (path: string) => string;
  /** MIME des eigenen Ziehguts (`@/lib/drag-types`): Dokumente der Akte oder Medien. Im Modus `pick` ohne Bedeutung. */
  acceptsItems?: string;
  /**
   * Modus `pick`: ein Ordner oder (`null`) ein fester Eintrag wurde gewählt.
   * `fixedKey` nennt den festen Eintrag — zwei ohne Ordner, etwa „Alle
   * Dateien“ und „Ohne Ordner“ im Auswahldialog, sind sonst nicht zu trennen.
   */
  onPick?: (path: string | null, fixedKey?: string) => void;
  /** Modus `pick`: Marke statt Zahl, „liegt hier“ oder „3 liegen hier“; Schlüssel `''` ist der feste Eintrag ohne Ordner. */
  marks?: Record<string, string>;
  /** Modus `pick`: Warum ein Ziel nicht wählbar ist (`null` = fester Eintrag ohne Ordner). */
  blocked?: (path: string | null) => BlockReason | null;
  /** Modus `pick`: Häkchen statt Zahl am Gewählten (Vorgabe); `false` im Auswahldialog, wo der Baum filtert und zählt (Artboard 8). */
  pickCheck?: boolean;
  /** Modus `pick`: Name des Verschobenen für den Grund „Einen Ordner „…“ gibt es dort schon“. */
  blockedName?: string;
  /** Ohne `storageKey`: was beim Einhängen aufgeklappt ist. */
  initialExpanded?: readonly string[];
  /** Modus `pick`: wohin der Fokus beim Einhängen geht; `null` = fester Eintrag ohne Ordner. */
  initialFocus?: string | null;
  /** Ordner pflegen, also auch ziehen (Akte `dms.manage`, Mediathek `media.upload`). */
  canManage?: boolean;
  /** Inhalte (Dokumente, Medien, Dateien) ablegen. */
  canDrop?: boolean;
  /** Ersetzt die eingebaute Prüfung (`validateFolderTarget` samt Rechten). */
  validateDrop?: (item: DragItem, target: string | null) => BlockReason | null;
  /** Verschiebt Ordner, Dokumente oder Medien; `null` = Eingangskorb bzw. oberste Ebene. */
  onMove?: (item: DragItem, target: string | null) => Promise<ActionState>;
  onDropFiles?: (target: string | null, files: FileList) => void;
  /** Wofür der Zähler steht: Dokument/Dokumente, Datei/Dateien — für den zugänglichen Namen. */
  unit: FolderTreeUnit;
  /** Wo der Aufklappzustand im Browser liegt (`kompass.<Schlüssel>`, von allen Bäumen geteilt); `null` im Dialog (nur für dessen Dauer). */
  storageKey: FolderTreeStorageKey | null;
  /** `touch` im Sheet am Telefon: 44-px-Zeilen, 16-px-Schrift (HANDOFF § 2). */
  density?: FolderTreeDensity;
  /** Legt einen Ordner an (`parent` `null` = oberste Ebene); „Neuer Ordner“ und „Neuer Unterordner“. */
  onCreate?: (parent: string | null, name: string, options: FolderCallOptions) => Promise<ActionState>;
  /** Benennt einen Ordner um; `name` ist das neue letzte Segment. */
  onRename?: (path: string, name: string, options: FolderCallOptions) => Promise<ActionState>;
  /** Löscht einen leeren Ordner, ohne Rückfrage (Spec § 5.4). */
  onDelete?: (path: string) => Promise<ActionState>;
  /** Öffnet „Verschieben nach…“ für diesen Ordner. */
  onRequestMove?: (path: string) => void;
  /** Weitere Einträge im Menü, nach „Verschieben nach…“ (Akte: „Als Paket exportieren“). */
  extraMenuItems?: (path: string) => ReactNode;
  /** Ziele, an denen eine Änderung unterwegs ist: Ihre Zeile zeigt „wird gespeichert“ (README § 3, Artboard 3). */
  saving?: readonly string[];
  /** Ein Satz unter dem Baum, etwa warum er kurz ist (Bereichsrechte, Artboard 9b). */
  note?: string;
  /** Der Satz im Leerzustand, wenn die Wörter der Akte nicht passen (Mediathek: Dateien statt Dokumente). */
  emptyHint?: string;
}

/** Was gerade benannt wird: ein neuer Ordner unter `parent` (`null` = oberste Ebene) oder ein bestehender. */
type Editing = { kind: 'create'; parent: string | null } | { kind: 'rename'; path: string };

/** Ein laufendes Ziehen, das den Baum betrifft. */
type Drag = { item: DragItem; mode: 'mouse' | 'keyboard' };
type DragHandler = ((e: ReactDragEvent) => void) | undefined;

const isOrdered = (target: DragTarget<FolderNode>) => 'childIndex' in target;
/** `useLayoutEffect` im Browser; auf dem Server gibt es kein Layout (und keine Warnung). */
const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;
/** Wie lange das Ziehen auf einem zugeklappten Ziel verweilt, bevor es aufklappt (README § 5). */
const OPEN_DELAY = 800;

function readIds(transfer: DataTransfer, mime: string): string[] {
  try {
    const value: unknown = JSON.parse(transfer.getData(mime));
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

const sameIds = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((id, i) => id === b[i]);

/** Dasselbe Ziehgut? Beim Überfahren entsteht es je Ereignis neu; neu gesetzt wird nur, was sich geändert hat. */
function sameItem(a: DragItem, b: DragItem): boolean {
  if (a.kind === 'folder' || b.kind === 'folder') return a.kind === b.kind && a.kind === 'folder' && b.kind === 'folder' && a.path === b.path;
  if (a.kind === 'files' || b.kind === 'files') return a.kind === b.kind;
  return a.kind === b.kind && sameIds(a.ids, b.ids) && sameIds(a.sources.map(String), b.sources.map(String));
}

/** Die sichtbaren Knoten in Baumreihenfolge — für den Platzhalter vor der Hydration. */
function visibleNodes(nodes: Record<string, FolderNode>, expanded: readonly string[]): FolderNode[] {
  const open = new Set(expanded);
  const out: FolderNode[] = [];
  const walk = (path: string) => {
    for (const child of nodes[path]?.children ?? []) {
      const node = nodes[child];
      if (!node) continue;
      out.push(node);
      if (open.has(child)) walk(child);
    }
  };
  walk(TREE_ROOT);
  return out;
}

/**
 * Der Ordnerbaum: aufklappen, navigieren, Ordner ziehen, Dokumentzeilen und
 * Dateien annehmen. Headless Tree liefert Rollen, Tastatur und das Ziehen mit
 * der Maus; die Auswahl kommt aus der URL, nicht aus der Bibliothek (Spec § 3,
 * Falle 5), die Sprung-Suche ist eigen (Spec § 9: kein `searchFeature`).
 *
 * Wohin abgelegt wird, entscheidet die Zeile unter dem Zeiger, nicht die
 * Bibliothek: Lehnt deren `canDrop` ein Ziel ab, weicht sie bei
 * `canReorder: false` still auf den Elternordner aus (`getDragTarget`), und
 * ein gesperrtes Ziel landete eine Ebene höher. Darum nimmt die Bibliothek
 * jede Zeile an, und die eigene Prüfung sperrt — sichtbar und beim Ablegen.
 *
 * Das Ziehen per Tastatur ist ebenfalls eigen: Das der Bibliothek überspringt
 * den eigenen Teilbaum, statt ihn als gesperrt zu zeigen (Artboard 6c), und
 * kennt `canReorder: false` nicht (Issue 196). Nur für Ordner (Spec § 9).
 */
export function FolderTree({
  folders,
  selected,
  fixed,
  mode,
  hrefFor,
  acceptsItems = '',
  onPick,
  marks,
  blocked,
  blockedName = '',
  pickCheck = true,
  initialExpanded,
  initialFocus,
  canManage = false,
  canDrop = false,
  validateDrop,
  onMove,
  onDropFiles,
  unit,
  storageKey,
  density = 'default',
  onCreate,
  onRename,
  onDelete,
  onRequestMove,
  extraMenuItems,
  saving,
  note,
  emptyHint,
}: FolderTreeProps) {
  const t = useTranslations('folderTree');
  const nodes = useMemo(() => buildFolderTree(folders), [folders]);
  const existing = useMemo(() => new Set(Object.keys(nodes)), [nodes]);
  // Gemerkter Zustand plus der Weg zum gewählten Ordner, der immer offen ist (Spec § 5.2).
  const pick = mode === 'pick';
  const { expanded, setExpanded, renamePrefix } = useFolderTreeExpanded(storageKey, existing, selected, initialExpanded);
  // Diese Ordner bleiben offen, solange der gewählte darin liegt (README § 5) — nur beim Navigieren, im Dialog klappt alles.
  const lockedOpen = useMemo(() => new Set(pick ? [] : ancestorsOf(selected ?? '')), [selected, pick]);
  const uid = useId();

  const [overFixed, setOverFixed] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const typed = useRef({ buffer: '', at: 0 });

  const [drag, setDrag] = useState<Drag | null>(null);
  /** Zeile unter dem Zeiger beim Ziehen mit der Maus. */
  const [over, setOver] = useState<string | null>(null);
  /** Was die Live-Region sagt. */
  const [message, setMessage] = useState('');
  // Synchron neben dem Zustand: `dragenter`, `dragover` und `drop` kommen
  // mitunter im selben Takt, ohne Rendern dazwischen.
  const dragRef = useRef<Drag | null>(null);
  const expandedRef = useRef(expanded);
  expandedRef.current = expanded;
  /** Nur fürs Ziehen aufgeklappt; nach dem Ziehen wieder zu (README § 5). */
  const openedByDrag = useRef(new Set<string>());
  const treeRef = useRef<HTMLDivElement>(null);
  useEdgeScroll(treeRef);

  const [menu, setMenu] = useState<RowMenuTarget | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  /** Diese Zeile bekommt den Fokus, sobald es sie gibt — nach Esc sofort, nach dem Anlegen erst nach dem Neuladen. */
  const [focusAfter, setFocusAfter] = useState<string | null>(pick && typeof initialFocus === 'string' ? initialFocus : null);
  /** Wohin der Fokus geht, wenn das Menü schließt: zurück auf die Zeile, außer eine Eingabezeile hat ihn. */
  const menuReturn = useRef<{ path: string; toRow: boolean } | null>(null);

  const canDragNode = (node: FolderNode) => !pick && canManage && node.created;
  /** Mit der Maus nur bei feinem Zeiger; am Telefon verschiebt „Verschieben nach…“ (Spec § 5.6), die Tastatur bleibt. */
  const fine = useFinePointer();
  const canMouseDrag = (node: FolderNode) => fine && canDragNode(node);
  /**
   * Menü und F2 nur mit Pflegerecht und an Ordnern, die es gibt: Einen nur
   * ergänzten Weg kennt der Server nicht — umbenennen, löschen, verschieben
   * oder darin anlegen ginge dort ins Leere, also kein „…“ (Ruling).
   */
  const hasMenu = (node: FolderNode | undefined) =>
    !!node && !pick && canManage && node.created && (!!onCreate || !!onRename || !!onDelete || !!onRequestMove || !!extraMenuItems);
  const validate = (item: DragItem, target: string | null): BlockReason | null =>
    validateDrop ? validateDrop(item, target) : validateFolderTarget(nodes, item, target, { canManage, canDrop });
  const dragName = (item: DragItem) => (item.kind === 'folder' ? nameOf(item.path) : '');
  const reasonText = (item: DragItem, reason: BlockReason) => blockText(t, reason, dragName(item));

  /** Modus `pick`: gesperrt mit Grund. Sichtbar nur in der obersten gesperrten Zeile eines Teilbaums und nie bei „liegt hier“ (die Marke sagt es). */
  const pickFor = (path: string | null): RowPick | undefined => {
    if (!pick) return undefined;
    const reason = blocked?.(path) ?? null;
    if (!reason) return { blocked: null, check: pickCheck };
    const node = path === null ? undefined : nodes[path];
    const parent = node ? (node.parent === TREE_ROOT ? null : node.parent) : undefined;
    const sameAsParent = parent !== undefined && parent !== null && blocked?.(parent) === reason;
    return {
      blocked: { id: `${uid}-why-${path === null ? '' : encodeURIComponent(path)}`, text: blockText(t, reason, blockedName), showReason: reason !== 'here' && !sameAsParent },
      check: pickCheck,
    };
  };
  /** Modus `pick`: wählt, was nicht gesperrt ist. */
  const choose = (path: string | null, fixedKey?: string) => {
    if (!pick || blocked?.(path)) return;
    if (fixedKey === undefined) onPick?.(path);
    else onPick?.(path, fixedKey);
  };
  const markFor = (path: string | null) => (pick ? marks?.[path ?? ''] : undefined);
  const fixedRef = useRef<HTMLUListElement>(null);
  const createFirstRef = useRef<HTMLButtonElement>(null);
  // Im Dialog liegt der Fokus beim Öffnen auf dem aktuellen Ort — hier dem festen Eintrag ohne Ordner.
  useEffect(() => {
    if (!pick || initialFocus !== null) return;
    fixedRef.current?.querySelector<HTMLElement>('[data-fixed]')?.focus();
    // Nur beim Einhängen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Ohne Empfänger kein Ziel: Wer keine Dateien annimmt, bekommt auch keine Zeile, die so tut.
  // `Files` aus einem Zug, der in der Seite begann, ist ein mitgegebenes Bild, kein Hochladen.
  const accepts = (types: readonly string[]) => !pick && ((!!acceptsItems && types.includes(acceptsItems)) || (!!onDropFiles && isOutsideUpload(types)));

  /**
   * Was gezogen wird. Beim Überfahren gibt der Browser nur die Typen heraus;
   * Herkunft und Bezeichnung kommen dann aus `currentDrag()` der Liste, die
   * IDs erst beim Ablegen (`reading`).
   */
  const dragItemFor = (transfer: DataTransfer | null, reading: boolean): DragItem | null => {
    const own = dragRef.current;
    if (own?.item.kind === 'folder' && own.mode === 'mouse') return own.item;
    if (!transfer) return null;
    const types = Array.from(transfer.types ?? []);
    if (types.includes(acceptsItems)) {
      const kind = acceptsItems === MEDIA_MIME ? 'assets' : 'documents';
      const known = currentDrag(types);
      const match = known && known.kind === kind ? known : null;
      if (!reading) return match ?? { kind, ids: [], sources: [], label: '' };
      const ids = readIds(transfer, acceptsItems);
      return match && sameIds(match.ids, ids) ? match : { kind, ids, sources: [], label: '' };
    }
    // Eigenes Ziehgut geht oben vor; was hier ankommt und in der Seite begann,
    // ist kein Upload — höchstens ein Bild, das der Browser beigelegt hat.
    if (onDropFiles && isOutsideUpload(types)) {
      // Safari nennt beim Überfahren nicht einmal die Anzahl (README, Artboard 2f).
      return { kind: 'files', count: reading ? transfer.files.length : transfer.items?.length || null };
    }
    return null;
  };

  const startDrag = (next: Drag) => {
    dragRef.current = next;
    openedByDrag.current = new Set();
    setDrag(next);
  };

  /**
   * Ziehen vorbei. Was nur dafür aufklappte, klappt wieder zu — nach einem
   * Ablegen bleibt der Weg zum Ziel offen. Ohne Ziel: abgebrochen oder
   * anderswo abgelegt.
   */
  /** Setzt den Ziehzustand von Headless Tree zurück; gefüllt, sobald es den Baum gibt. */
  const resetLibrary = useRef<() => void>(() => {});
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const endDrag = useCallback(
    (target?: string | null) => {
      clearTimeout(leaveTimer.current);
      if (!dragRef.current) return;
      dragRef.current = null;
      // Die Bibliothek räumt nach einem `dragend` mit `dropEffect: 'none'`
      // (Esc, gesperrtes Ziel) nur über ihren Fensterhorcher auf; hier
      // sicherheitshalber selbst, sonst zählte das nächste fremde Ziehgut als
      // der alte Ordner.
      resetLibrary.current();
      const opened = openedByDrag.current;
      openedByDrag.current = new Set();
      if (opened.size > 0) {
        const keep = (path: string) => !opened.has(path) || (typeof target === 'string' && isWithin(target, path));
        setExpanded(expandedRef.current.filter(keep));
      }
      setDrag(null);
      setOver(null);
      setOverFixed(null);
    },
    [setExpanded]
  );

  const tree = useTree<FolderNode>({
    rootItemId: TREE_ROOT,
    getItemName: (item) => item.getItemData().name,
    isItemFolder: (item) => item.getItemData().children.length > 0,
    dataLoader: {
      getItem: (id) => nodes[id] ?? nodes[TREE_ROOT]!,
      getChildren: (id) => nodes[id]?.children ?? [],
    },
    // Muss eine stabile Referenz sein: `useTree` baut neu, sobald sich die
    // Identität ändert, und ein frisches Feld je Rendern liefe im Kreis.
    state: { expandedItems: expanded },
    // Wer mit Tab in den Baum kommt, landet auf dem gewählten Ordner (APG) —
    // nur, wenn es ihn gibt; sonst hätte keine Zeile `tabIndex=0`.
    initialState: pick
      ? typeof initialFocus === 'string' && nodes[initialFocus]
        ? { focusedItem: initialFocus }
        : {}
      : selected && nodes[selected]
        ? { focusedItem: selected }
        : {},
    setExpandedItems: (next) => {
      // Die Bibliothek reicht hier immer schon den fertigen Wert durch; ein Updater käme nur von außen.
      const value = typeof next === 'function' ? next(expanded) : next;
      if (dragRef.current) {
        // Beim Ziehen aufgeklappt (Verweilen oder →): merken und ansagen.
        const added = value.filter((path) => !expandedRef.current.includes(path));
        for (const path of added) openedByDrag.current.add(path);
        const node = nodes[added.at(-1) ?? ''];
        if (node) setMessage(announceOpened(t, node.name, node.children.length));
      }
      setExpanded(value);
    },
    canDrag: (items) => items.every((item) => canMouseDrag(item.getItemData())),
    canReorder: false,
    // Jede Zeile ist für die Bibliothek ein Ziel (siehe oben); nur in, nicht
    // zwischen — `canReorder: false` allein gilt nur für die Maus (Issue 196).
    // Die Wurzel nie: Was neben die Zeilen fällt, geht ans Fenster.
    canDrop: (_items, target) => !pick && !isOrdered(target) && target.item.getId() !== TREE_ROOT,
    canDragForeignDragObjectOver: (transfer) => accepts(transfer.types),
    canDropForeignDragObject: (transfer, target) => !isOrdered(target) && target.item.getId() !== TREE_ROOT && accepts(transfer.types),
    openOnDropDelay: OPEN_DELAY,
    hotkeys: {
      // ← wie bei Headless Tree, nur: Ein Vorfahr des gewählten Ordners lässt
      // sich nicht zuklappen, also verhält er sich wie ein zugeklappter und
      // gibt den Fokus an seinen Elternordner (APG) — statt still nichts zu tun.
      collapseOrUp: {
        hotkey: 'ArrowLeft',
        canRepeat: true,
        handler: (_e, tree) => {
          const item = tree.getFocusedItem();
          if (item.isFolder() && item.isExpanded() && !lockedOpen.has(item.getId())) {
            item.collapse();
            return;
          }
          if (item.getItemMeta().level === 0) return;
          item.getParent()?.setFocused();
          tree.updateDomFocus();
        },
      },
    },
    indent: DENSITY[density].indent,
    features: [syncDataLoaderFeature, hotkeysCoreFeature, dragAndDropFeature],
  });

  resetLibrary.current = () => tree.applySubStateUpdate('dnd', null);

  // Neue oder verschwundene Ordner nach `router.refresh()`: Die Bibliothek
  // liest den Datenlader nur beim Neubau — vor dem Zeichnen, damit kein Takt
  // mit den alten Zeilen sichtbar wird.
  useIsomorphicLayoutEffect(() => {
    tree.rebuildTree();
  }, [tree, nodes]);

  // Bis zum Neubau kennt die Bibliothek noch verschwundene Ordner; die zeigte
  // `getItem` als Wurzel (Name leer, Zahl = Summe aller). Nur, was es gibt.
  const items = tree.getItems().filter((item) => nodes[item.getId()] !== undefined);

  // Verschwindet die fokussierte Zeile (gelöscht, verschoben, zugeklappt),
  // zeigte der Tab-Halt ins Leere: dann die erste Zeile.
  const focusedId = tree.getState().focusedItem;
  const visibleKey = items.map((item) => item.getId()).join('\n');
  useEffect(() => {
    if (focusedId === null) return;
    const list = tree.getItems();
    if (list.length > 0 && !list.some((item) => item.getId() === focusedId)) list[0]!.setFocused();
  }, [tree, focusedId, visibleKey]);

  // Fokus auf eine Zeile, sobald es sie gibt: nach Esc in der Eingabezeile, nach Anlegen und Umbenennen.
  useEffect(() => {
    if (!focusAfter || editing) return;
    if (!tree.getItems().some((item) => item.getId() === focusAfter)) return;
    tree.getItemInstance(focusAfter).setFocused();
    tree.updateDomFocus();
    setFocusAfter(null);
  }, [tree, focusAfter, editing, visibleKey]);

  // Verschwindet beim Neuladen der Ordner, der gerade umbenannt wird, dessen
  // Menü offen ist oder auf den der Fokus wartet, hinge der Zustand im Leeren:
  // Menü und F2 blieben gesperrt. Dann zurücksetzen, Fokus auf eine Zeile, die es gibt.
  const previousNodes = useRef(nodes);
  useIsomorphicLayoutEffect(() => {
    const before = previousNodes.current;
    previousNodes.current = nodes;
    if (before === nodes) return;
    const gone = (path: string | null | undefined): path is string => !!path && !!before[path] && !nodes[path];
    const fallback = (path: string) =>
      [...ancestorsOf(path)].reverse().find((p) => nodes[p]) ?? (selected && nodes[selected] ? selected : (nodes[TREE_ROOT]?.children[0] ?? null));
    let refocus: string | null | undefined;
    const lost = editing ? (editing.kind === 'rename' ? editing.path : editing.parent) : null;
    if (gone(lost)) {
      setEditing(null);
      refocus = fallback(lost);
    }
    const menuPath = menu?.path;
    if (gone(menuPath)) {
      menuReturn.current = null;
      setMenu(null);
      refocus ??= fallback(menuPath);
    }
    if (gone(focusAfter)) {
      setFocusAfter(null);
      refocus ??= fallback(focusAfter);
    }
    if (refocus) setFocusAfter(refocus);
    // Nur beim Neuladen (`nodes`); die übrigen Werte sind der Stand davor.
  }, [nodes]);

  /** Das anstehende Ziel: beim Ziehen per Tastatur die fokussierte Zeile, sonst die unter dem Zeiger. */
  const target = drag ? (drag.mode === 'keyboard' ? focusedId : over) : null;
  const source = drag?.item.kind === 'folder' ? drag.item.path : null;

  /** Was eine Zeile zeigt; die aufgenommene selbst ist kein Ziel, nur gedämpft. */
  const dropFor = (path: string): RowDrop | null => {
    if (!drag || path !== target || path === source) return null;
    const reason = validate(drag.item, path);
    const node = nodes[path];
    // Was die Bibliothek nicht annimmt (der eigene Teilbaum), klappt auch nicht auf.
    const opening = !!node && node.children.length > 0 && !expanded.includes(path) && reason !== 'self';
    return reason ? { state: 'blocked', reason: reasonText(drag.item, reason), opening } : { state: 'target', opening };
  };

  // Für Wirkungen, die nur beim Wechsel von Ziehgut oder Ziel laufen, aber
  // die aktuellen Regeln und Texte brauchen.
  const latest = useRef({ validate, reasonText, nodes, t, tree });
  latest.current = { validate, reasonText, nodes, t, tree };

  // Ansage beim neuen Ziel (README § 5): gültig, zugeklappt oder gesperrt.
  useEffect(() => {
    const current = dragRef.current;
    if (!current || !target || target === source) return;
    const { validate, reasonText, nodes, t } = latest.current;
    const node = nodes[target];
    if (!node) return;
    const reason = validate(current.item, target);
    const opening = node.children.length > 0 && !expandedRef.current.includes(target) && reason !== 'self';
    setMessage(announceTarget(t, node.name, opening, reason ? reasonText(current.item, reason) : null));
  }, [drag, target, source]);

  // Verweilen beim Ziehen per Tastatur: Nach 0,8 s klappt das Ziel auf; mit der Maus macht das die Bibliothek.
  useEffect(() => {
    const current = dragRef.current;
    if (current?.mode !== 'keyboard' || !target || target === source) return;
    const { validate, nodes, tree } = latest.current;
    if (!nodes[target]?.children.length || expandedRef.current.includes(target) || validate(current.item, target) === 'self') return;
    const timer = setTimeout(() => tree.getItemInstance(target).expand(), OPEN_DELAY);
    return () => clearTimeout(timer);
  }, [drag, target, source]);

  // Mausziehen endet am Fenster: anderswo abgelegt, abgebrochen, oder neben die Zeilen.
  useEffect(() => {
    const end = () => {
      if (dragRef.current?.mode === 'mouse') endDrag();
    };
    window.addEventListener('dragend', end);
    window.addEventListener('drop', end);
    return () => {
      window.removeEventListener('dragend', end);
      window.removeEventListener('drop', end);
      clearTimeout(leaveTimer.current);
    };
  }, [endDrag]);

  // Beim Server-Rendern (und im ersten Client-Durchlauf) ist der Baum leer —
  // die Bibliothek baut ihn erst im Effekt (Spec § 3, Falle 7). Bis dahin
  // dieselben Zeilen statisch, damit nichts springt.
  const placeholder = items.length === 0 ? visibleNodes(nodes, expanded) : [];

  const pickUp = () => {
    const node = tree.getFocusedItem().getItemData();
    // Ein Mausziehen, das nie zu Ende kam (Dateien vom Schreibtisch kennen kein `dragend`), hält nicht auf.
    if (dragRef.current?.mode === 'mouse') endDrag();
    if (dragRef.current || !node || !canDragNode(node)) return;
    startDrag({ item: { kind: 'folder', path: node.path, total: node.total }, mode: 'keyboard' });
    setMessage(announcePickUp(t, node.name));
  };

  /**
   * Verschiebt über den Rückruf. Ein Ordner bleibt danach an seinem neuen Ort
   * so aufgeklappt wie vorher (die gemerkten Pfade ziehen mit). Wirft der
   * Rückruf (Netz weg, Server-Absturz), sagt die Live-Region es an, statt
   * eine unbehandelte Ablehnung zu hinterlassen.
   */
  const move = async (item: DragItem, target: string | null) => {
    if (!onMove) return;
    try {
      const result = await onMove(item, target);
      if (result.status === 'success' && item.kind === 'folder') {
        const name = nameOf(item.path);
        renamePrefix(item.path, target === null ? name : `${target}/${name}`);
      }
    } catch {
      setMessage(t('error.unexpected'));
    }
  };

  const dropByKeyboard = (current: Drag) => {
    const path = tree.getFocusedItem().getId();
    const reason = validate(current.item, path);
    if (reason) {
      // Bleibt aufgenommen: Ein anderes Ziel geht noch.
      setMessage(announceNotDropped(t, dragName(current.item), reasonText(current.item, reason)));
      return;
    }
    endDrag(path);
    void move(current.item, path);
  };

  /** Abbrechen: mit Esc (Fokus zurück auf den Ordner) oder weil der Fokus den Baum verließ (dann bleibt er, wo er hinging). */
  const cancelByKeyboard = (current: Drag, refocus = true) => {
    endDrag();
    if (current.item.kind !== 'folder') return;
    const node = nodes[current.item.path];
    const parent = node && node.parent !== TREE_ROOT ? (nodes[node.parent]?.name ?? null) : null;
    setMessage(announceCancelled(t, dragName(current.item), parent));
    if (!refocus) return;
    tree.getItemInstance(current.item.path).setFocused();
    tree.updateDomFocus();
  };

  const rowElement = (path: string) =>
    Array.from(treeRef.current?.querySelectorAll<HTMLElement>('[data-folder]') ?? []).find((el) => el.dataset.folder === path) ?? null;

  /** Öffnet das Menü am Ordner; `false`, wenn er keins hat. Am „…“ der Zeile, auch per Rechtsklick und Tastatur. */
  const openMenu = (path: string): boolean => {
    if (dragRef.current || editing || !hasMenu(nodes[path])) return false;
    const row = rowElement(path);
    const anchor = row?.querySelector('[data-row-menu]') ?? row;
    if (!anchor) return false;
    tree.getItemInstance(path).setFocused();
    menuReturn.current = { path, toRow: true };
    setMenu({ path, anchor });
    return true;
  };

  const startRename = (path: string) => {
    if (menuReturn.current) menuReturn.current.toRow = false;
    setEditing({ kind: 'rename', path });
  };

  const startCreate = (parent: string | null) => {
    if (menuReturn.current) menuReturn.current.toRow = false;
    // Der Elternordner geht auf und bleibt offen (README § 3, Artboard 4).
    if (parent !== null && !expanded.includes(parent)) setExpanded([...expanded, parent]);
    setEditing({ kind: 'create', parent });
  };

  const nameErrorText = (error: Exclude<FolderNameError, 'empty'>, name: string) =>
    error === 'exists' ? t('nameExists', { name }) : t(error === 'slash' ? 'nameSlash' : error === 'tooLong' ? 'nameTooLong' : 'nameInvalid');

  /** Fehler zum Namen unter `parent`, beim Umbenennen gegen die Geschwister außer sich selbst. */
  const checkName = (parent: string | null, name: string, renaming?: string): string | null => {
    const siblings = (nodes[parent ?? TREE_ROOT]?.children ?? []).map(nameOf);
    const error = validateFolderName(siblings, name, renaming ? nameOf(renaming) : undefined);
    if (error && error !== 'empty') return nameErrorText(error, name);
    const placement = validateFolderPlacement(nodes, parent, name, renaming);
    return placement ? `${clause(blockText(t, placement, name))}.` : null;
  };

  const parentOf = (path: string) => ancestorsOf(path).at(-1) ?? null;

  /** Fokus gleich auf eine vorhandene Zeile; `updateDomFocus` wartet, bis sie wieder im DOM steht. */
  const focusNow = (path: string | null) => {
    if (!path || !nodes[path]) return;
    tree.getItemInstance(path).setFocused();
    tree.updateDomFocus();
  };

  const cancelEditing = (refocus: boolean) => {
    const current = editing;
    setEditing(null);
    if (!refocus || !current) return;
    const back = current.kind === 'rename' ? current.path : (current.parent ?? focusedId);
    if (back) setFocusAfter(back);
    // Ohne Ordner zurück auf „Ersten Ordner anlegen“.
    else createFirstRef.current?.focus();
  };

  const commitCreate = async (parent: string | null, name: string, isOpen: () => boolean): Promise<ActionState> => {
    const result = onCreate ? await onCreate(parent, name, { quiet: isOpen }) : { status: 'idle' as const };
    if (result.status === 'error') return result;
    setEditing(null);
    // Bis der neue Ordner im Baum steht (nach dem Neuladen), wartet der Fokus auf der Zeile davor.
    focusNow(parent ?? focusedId);
    setFocusAfter(parent === null ? name : `${parent}/${name}`);
    setMessage(t('announce.created', { name }));
    return result;
  };

  const commitRename = async (path: string, name: string, isOpen: () => boolean): Promise<ActionState> => {
    const result = onRename ? await onRename(path, name, { quiet: isOpen }) : { status: 'idle' as const };
    if (result.status === 'error') return result;
    const parent = parentOf(path);
    const to = parent === null ? name : `${parent}/${name}`;
    renamePrefix(path, to);
    setEditing(null);
    focusNow(path);
    setFocusAfter(to);
    return result;
  };

  const deleteFolder = async (path: string) => {
    if (!onDelete) return;
    // Danach steht der Fokus auf der Zeile davor (oder danach), nicht im Leeren.
    const list = tree.getItems().map((item) => item.getId());
    const at = list.indexOf(path);
    const neighbour = list.slice(0, at).reverse().find((id) => !isWithin(id, path)) ?? list.slice(at + 1).find((id) => !isWithin(id, path)) ?? null;
    try {
      const result = await onDelete(path);
      if (result.status !== 'error' && neighbour) setFocusAfter(neighbour);
    } catch {
      setMessage(t('error.unexpected'));
    }
  };

  /**
   * Tasten, die Headless Tree ohne Such-Feature nicht belegt: „?“ öffnet die
   * Hilfe, Enter öffnet den Ordner (die Zeile ist kein Link mehr), einzelne
   * Buchstaben springen zum Namen (APG, Puffer 500 ms). Dazu Strg+Umschalt+D,
   * Enter und Esc beim Verschieben.
   */
  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.target instanceof HTMLInputElement) return;
    // Strg auch am Mac: Cmd+Umschalt+D ist in Safari und Chrome belegt (Spec § 9).
    if (e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey && e.code === 'KeyD') {
      e.preventDefault();
      pickUp();
      return;
    }
    const current = dragRef.current;
    if (current?.mode === 'keyboard' && (e.key === 'Enter' || e.key === 'Escape')) {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Enter') dropByKeyboard(current);
      else cancelByKeyboard(current);
      return;
    }
    // F2 und das Menü nicht, solange ein Ordner aufgenommen ist (dort zählen nur Pfeile, Enter, Esc).
    if (!current) {
      const plain = !e.ctrlKey && !e.metaKey && !e.altKey;
      // Die Zeile, auf der die Taste fiel — nicht unbedingt die, die Headless Tree für fokussiert hält.
      const at = e.target instanceof HTMLElement ? e.target.closest<HTMLElement>('[data-folder]')?.dataset.folder : undefined;
      const focused = at ? nodes[at] : tree.getFocusedItem().getItemData();
      if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey && plain)) {
        if (openMenu(focused?.path ?? '')) e.preventDefault();
        return;
      }
      if (e.key === 'F2' && plain && !e.shiftKey) {
        if (onRename && hasMenu(focused)) {
          e.preventDefault();
          startRename(focused!.path);
        }
        return;
      }
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (pick && (e.key === 'Enter' || e.key === ' ')) {
      const at = e.target instanceof HTMLElement ? e.target.closest<HTMLElement>('[data-folder]')?.dataset.folder : undefined;
      if (at !== undefined) {
        e.preventDefault();
        choose(at);
      }
      return;
    }
    if (e.key === '?' && !pick) {
      // Im Baum gilt die Baumhilfe; die Seitenhilfe der Shell hört am Fenster mit.
      e.preventDefault();
      e.stopPropagation();
      setHelpOpen(true);
      return;
    }
    const row = e.target instanceof HTMLElement ? e.target.closest('[role="treeitem"]') : null;
    if (e.key === 'Enter') {
      row?.querySelector('a')?.click();
      return;
    }
    if (e.key.length !== 1 || e.key === ' ') return;
    const now = Date.now();
    const state = typed.current;
    state.buffer = now - state.at > TYPE_AHEAD_MS ? e.key : state.buffer + e.key;
    state.at = now;
    const list = tree.getItems();
    const from = list.findIndex((item) => item.isFocused());
    const id = nextTypeAheadMatch(list.map((item) => ({ id: item.getId(), name: item.getItemName() })), from, state.buffer);
    if (!id) return;
    e.preventDefault();
    tree.getItemInstance(id).setFocused();
    tree.updateDomFocus();
  };

  /**
   * Fremdes Ziehgut verlässt Baum oder feste Einträge. Dateien vom
   * Schreibtisch melden danach kein `dragend`, wenn sie anderswo fallen oder
   * mit Esc abgebrochen werden — ohne dieses Ende bliebe das Ziehen stehen.
   * Verzögert, weil `dragleave` auch beim Wechsel zwischen Zeilen kommt
   * (Safari dann ohne `relatedTarget`); das nächste `dragover` hebt es auf.
   */
  const leave = (e: ReactDragEvent<HTMLElement>) => {
    if (e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget)) return;
    const current = dragRef.current;
    if (current?.mode !== 'mouse' || current.item.kind === 'folder') return;
    clearTimeout(leaveTimer.current);
    leaveTimer.current = setTimeout(() => {
      if (dragRef.current === current) endDrag();
    }, 100);
  };

  /** Ziehgut über einem Ziel: merken, und gesperrt heißt für den Browser „hier nicht“. */
  const hover = (e: ReactDragEvent, folder: string | null, item: DragItem) => {
    clearTimeout(leaveTimer.current);
    const current = dragRef.current;
    if (!current || (current.mode === 'mouse' && !sameItem(current.item, item))) startDrag({ item, mode: 'mouse' });
    if (item.kind === 'folder' && folder === item.path) return;
    if (validate(item, folder)) e.dataTransfer.dropEffect = 'none';
  };

  /**
   * Ablegen auf einem Ziel. Synchron gelesen (nach dem Ereignis gibt der
   * Browser den Inhalt nicht mehr heraus) und gegen genau dieses Ziel
   * geprüft; ein gesperrtes schluckt den Zug, statt ihn weiterzugeben.
   * `false`: kein Ziehgut, das der Baum kennt.
   */
  const dropOn = (e: ReactDragEvent, folder: string | null, refuse?: (item: DragItem) => BlockReason | null): boolean => {
    const item = dragItemFor(e.dataTransfer, true);
    if (!item) return false;
    e.preventDefault();
    e.stopPropagation();
    const reason = item.kind === 'folder' && folder === item.path ? 'self' : (refuse?.(item) ?? validate(item, folder));
    if (reason) {
      endDrag();
      return true;
    }
    endDrag(folder);
    if (item.kind === 'files') {
      if (e.dataTransfer.files.length > 0) onDropFiles?.(folder, e.dataTransfer.files);
    } else if (item.kind === 'folder' || item.ids.length > 0) {
      void move(item, folder);
    }
    return true;
  };

  const fixedDrop = (entry: FolderTreeFixedEntry) =>
    entry.dropTarget
      ? {
          onDragOver: (e: ReactDragEvent) => {
            const item = dragItemFor(e.dataTransfer, false);
            // Feste Einträge nehmen Inhalte an, keine Ordner.
            if (!item || item.kind === 'folder') return;
            e.preventDefault();
            hover(e, entry.folder, item);
            setOver(null);
            setOverFixed(entry.key);
          },
          onDragLeave: (e: ReactDragEvent<HTMLElement>) => {
            setOverFixed(null);
            leave(e);
          },
          onDrop: (e: ReactDragEvent) => {
            if (dragRef.current?.item.kind === 'folder') return;
            dropOn(e, entry.folder, entry.refuse);
          },
        }
      : {};

  const fixedState = (entry: FolderTreeFixedEntry): RowDrop | null => {
    if (!drag || overFixed !== entry.key || drag.item.kind === 'folder') return null;
    const reason = entry.refuse?.(drag.item) ?? validate(drag.item, entry.folder);
    return reason ? { state: 'blocked', reason: reasonText(drag.item, reason) } : { state: 'target' };
  };

  const containerProps = tree.getContainerProps(t('label'));
  const menuNode = menu ? nodes[menu.path] : undefined;
  const deleteReason = (node: FolderNode): string | null => {
    const block = deleteBlock(node);
    if (!block) return null;
    return block.reason === 'hasItems'
      ? t('deleteBlocked', { count: block.count, unit: block.count === 1 ? unit.one : unit.many })
      : t('deleteHasChildren', { count: block.count });
  };
  const keyboardDrag = drag?.mode === 'keyboard' ? drag : null;
  const keyboardReason = keyboardDrag && target && target !== source ? validate(keyboardDrag.item, target) : null;

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <div className={cn('mb-1 flex items-center gap-2 pr-1 pl-2', density === 'touch' ? 'h-11' : 'h-7', pick && 'hidden')}>
        <p className="flex-1 text-[11px] font-bold tracking-[0.08em] text-muted-ink">{t('heading')}</p>
        {canManage && onCreate ? (
          // Legt immer auf der obersten Ebene an; im Ordner anlegen geht über „Neuer Unterordner“ (Artboard 4d).
          <button
            type="button"
            onClick={() => startCreate(null)}
            className={cn(
              'inline-flex h-7 items-center gap-[5px] rounded-sm border border-line-strong bg-active px-[9px] text-[13px] font-medium whitespace-nowrap text-ink hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus',
              // Am Telefon 44 px Klickfläche bei gleicher Optik (HANDOFF § 6).
              density === 'touch' && 'relative after:absolute after:-inset-x-px after:-inset-y-[9px]'
            )}
          >
            <Plus className="size-3.5" strokeWidth={2.2} aria-hidden />
            {t('newFolder')}
          </button>
        ) : null}
      </div>

      {fixed.length > 0 ? (
        <>
          <ul ref={fixedRef} className="flex flex-col gap-px">
            {fixed.map((entry) => (
              <li key={entry.key}>
                {pick ? (
                  <PickFixedEntry entry={entry} mark={markFor(entry.folder)} blocked={pickFor(entry.folder)?.blocked ?? null} density={density} check={pickCheck} onPick={() => choose(entry.folder, entry.key)} />
                ) : (
                  <FixedEntry entry={entry} state={fixedState(entry)} density={density} drop={fixedDrop(entry)} />
                )}
              </li>
            ))}
          </ul>
          <div aria-hidden className="mx-1 my-2 h-px bg-line" />
        </>
      ) : null}

      {!pick && nodes[TREE_ROOT]?.children.length === 0 ? (
        // Leerzustand (README § 3, Artboard 10): klein in der Spalte, die Liste daneben ist ja nicht leer.
        <div className="flex flex-col items-start gap-1.5 px-2 py-1 text-[13px] leading-[1.45] text-ink-2">
          <p className="font-semibold text-ink">{t('empty')}</p>
          <p className="text-pretty">{emptyHint ?? (canManage && onCreate ? t('emptyManage') : t('emptyRead'))}</p>
          {canManage && onCreate ? (
            <button
              ref={createFirstRef}
              type="button"
              onClick={() => startCreate(null)}
              className="mt-1 inline-flex h-7 items-center gap-[5px] rounded-sm border border-line-strong bg-active px-[9px] text-[13px] font-medium whitespace-nowrap text-ink hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus"
            >
              <Plus className="size-3.5" strokeWidth={2.2} aria-hidden />
              {t('createFirst')}
            </button>
          ) : null}
        </div>
      ) : null}

      {keyboardDrag ? (
        // Leiste beim Verschieben per Tastatur (Artboard 6b und 6c): was aufgenommen ist und was jetzt zählt.
        <div className="mb-2 flex flex-col gap-1 rounded-md bg-info-bg px-2.5 py-2 text-[13px] leading-[1.45] text-ink">
          <span>{t.rich('moving', { name: dragName(keyboardDrag.item), strong: (chunks) => <strong className="font-semibold">{chunks}</strong> })}</span>
          {keyboardReason ? (
            <span className="text-[12px] text-ink-2">{t('dragBar.blocked', { reason: clause(reasonText(keyboardDrag.item, keyboardReason)) })}</span>
          ) : (
            <span className="flex flex-wrap gap-x-2 gap-y-1 text-[12px] text-ink-2">
              <span className="inline-flex items-center gap-[3px]">
                <KeyChip label={t('keyNames.up')}>↑</KeyChip>
                <KeyChip label={t('keyNames.down')}>↓</KeyChip>
                {t('dragBar.target')}
              </span>
              <span className="inline-flex items-center gap-[3px]">
                <KeyChip>{t('keyNames.enter')}</KeyChip>
                {t('dragBar.drop')}
              </span>
              <span className="inline-flex items-center gap-[3px]">
                <KeyChip>{t('keyNames.esc')}</KeyChip>
                {t('dragBar.cancel')}
              </span>
            </span>
          )}
        </div>
      ) : null}

      <div ref={treeRef}>
        <div
          {...containerProps}
          onKeyDown={onKeyDown}
          onBlur={(e: ReactFocusEvent<HTMLDivElement>) => {
            // Wer beim Verschieben per Tastatur den Baum verlässt (Tab, Klick daneben), bricht ab wie mit Esc.
            const current = dragRef.current;
            if (current?.mode !== 'keyboard') return;
            if (!(e.relatedTarget instanceof Node) || e.currentTarget.contains(e.relatedTarget)) return;
            cancelByKeyboard(current, false);
          }}
          onDragOver={(e: ReactDragEvent<HTMLDivElement>) => {
            (containerProps.onDragOver as DragHandler)?.(e);
            clearTimeout(leaveTimer.current);
            // Zwischen den Zeilen ist kein Ziel; über einer Zeile kommt dieses Ereignis nicht an.
            setOver(null);
          }}
          onDragLeave={(e: ReactDragEvent<HTMLDivElement>) => {
            if (e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget)) return;
            setOver(null);
            leave(e);
          }}
          className="flex flex-col gap-px"
        >
          {placeholder.map((node) => (
            <FolderTreeRow
              key={node.path}
              node={node}
              level={node.depth}
              isFolder={node.children.length > 0}
              isExpanded={expanded.includes(node.path)}
              isSelected={node.path === selected}
              href={pick ? undefined : hrefFor?.(node.path)}
              badge={markFor(node.path)}
              density={density}
            />
          ))}
          {editing?.kind === 'create' && editing.parent === null ? (
            <NameInputRow
              key="create:top"
              level={0}
              density={density}
              check={(name) => checkName(null, name)}
              onCommit={(name, isOpen) => commitCreate(null, name, isOpen)}
              onCancel={cancelEditing}
            />
          ) : null}
          {items.map((item) => {
            const node = item.getItemData();
            const path = node.path;
            const level = item.getItemMeta().level;
            if (editing?.kind === 'rename' && editing.path === path) {
              return (
                <NameInputRow
                  key={`rename:${item.getKey()}`}
                  level={level}
                  density={density}
                  initial={node.name}
                  chevron={item.isFolder() ? (item.isExpanded() ? 'open' : 'closed') : null}
                  check={(name) => checkName(parentOf(path), name, path)}
                  onCommit={(name, isOpen) => commitRename(path, name, isOpen)}
                  onCancel={cancelEditing}
                />
              );
            }
            const createHere = editing?.kind === 'create' && editing.parent === path;
            // Die Bibliothek klappt beim Klick auf; hier navigiert der Link, und
            // auf- und zugeklappt wird nur über den Pfeil oder ←/→.
            const { onClick: _toggle, onDrop, onDragOver, onDragStart, draggable: _draggable, ...rest } = item.getProps();
            return (
              <Fragment key={item.getKey()}>
                <FolderTreeRow
                  node={node}
                  level={level}
                  isFolder={item.isFolder()}
                  isExpanded={item.isExpanded()}
                  isSelected={path === selected}
                  drop={dropFor(path)}
                  dimmed={!!source && isWithin(path, source)}
                  badge={keyboardDrag && path === source ? t('movingBadge') : markFor(path)}
                  saving={saving?.includes(path)}
                  isLockedOpen={lockedOpen.has(path)}
                  href={pick ? undefined : hrefFor?.(path)}
                  pick={pickFor(path)}
                  density={density}
                  label={markFor(path) ? t('accessibleNameMark', { label: accessibleName(t, node, unit), mark: markFor(path)! }) : accessibleName(t, node, unit)}
                  menu={
                    hasMenu(node) && !drag && !editing
                      ? { visible: path === selected || density === 'touch' ? 'always' : 'hover', open: menu?.path === path, onOpen: () => openMenu(path) }
                      : null
                  }
                  itemProps={{
                    ...rest,
                    'aria-haspopup': hasMenu(node) ? 'menu' : undefined,
                    // Rechtsklick öffnet dasselbe Menü wie „…“; ohne Menü bleibt das des Browsers.
                    onContextMenu: (e: ReactMouseEvent) => {
                      if (openMenu(path)) e.preventDefault();
                    },
                    draggable: canMouseDrag(node),
                    onDragStart: (e: ReactDragEvent) => {
                      if (!canMouseDrag(node)) {
                        e.preventDefault();
                        return;
                      }
                      (onDragStart as DragHandler)?.(e);
                      e.dataTransfer.setData(FOLDER_MIME, path);
                      e.dataTransfer.effectAllowed = 'move';
                      setDragPreview(e.dataTransfer, { kind: 'folder', title: node.name, detail: `${node.total} ${node.total === 1 ? unit.one : unit.many}` });
                      startDrag({ item: { kind: 'folder', path, total: node.total }, mode: 'mouse' });
                    },
                    onDragOver: (e: ReactDragEvent) => {
                      (onDragOver as DragHandler)?.(e);
                      const dragged = dragItemFor(e.dataTransfer, false);
                      if (!dragged) return;
                      hover(e, path, dragged);
                      setOverFixed(null);
                      setOver(path);
                    },
                    onDrop: (e: ReactDragEvent) => {
                      // Eine Datei, die niemand annimmt, darf der Browser nicht selbst öffnen.
                      if (!dropOn(e, path) && e.dataTransfer.types.includes('Files')) e.preventDefault();
                      // Die Bibliothek räumt nur noch auf; abgelegt ist schon (kein `onDrop` in der Konfiguration).
                      (onDrop as DragHandler)?.(e);
                    },
                  }}
                  onToggle={() => {
                    item.setFocused();
                    if (item.isExpanded()) item.collapse();
                    else item.expand();
                  }}
                  onRowClick={(e) => {
                    item.setFocused();
                    e.currentTarget.focus();
                    if (pick) {
                      choose(path);
                      return;
                    }
                    // Ein Klick neben den Namen öffnet den Ordner ebenso.
                    if (!(e.target instanceof Element && e.target.closest('a'))) e.currentTarget.querySelector('a')?.click();
                  }}
                />
                {createHere ? (
                  // Erstes Kind des Elternordners; nach Enter rückt der neue an seinen alphabetischen Platz.
                  <NameInputRow level={level + 1} density={density} check={(name) => checkName(path, name)} onCommit={(name, isOpen) => commitCreate(path, name, isOpen)} onCancel={cancelEditing} />
                ) : null}
              </Fragment>
            );
          })}
        </div>
      </div>

      {note ? <p className="mx-2 mt-3 text-[12px] leading-[1.5] text-pretty text-muted-ink">{note}</p> : null}

      {/* Eine Region je Baum, höflich (HANDOFF): Sie unterbricht nicht, was gerade vorgelesen wird. */}
      <div aria-live="polite" className="sr-only">
        {message}
      </div>

      <button
        type="button"
        onClick={() => setHelpOpen(true)}
        className={cn('mt-auto flex items-center gap-1.5 self-start px-2 pt-2.5 text-[12px] text-muted-ink hover:text-ink-2', density === 'touch' && 'min-h-11', pick && 'hidden')}
      >
        <Keyboard className="size-3.5" aria-hidden />
        <span className="border-b border-line-strong">{t('keyHelp')}</span>
        <KeyChip>?</KeyChip>
      </button>

      <FolderTreeKeyHelp open={helpOpen} onOpenChange={setHelpOpen} canManage={canManage} />

      <RowMenu
        target={menu}
        onClose={() => setMenu(null)}
        finalFocus={() => {
          const back = menuReturn.current;
          menuReturn.current = null;
          return (back?.toRow && rowElement(back.path)) || false;
        }}
        {...(menuNode
          ? {
              onNewSubfolder: onCreate ? () => startCreate(menuNode.path) : undefined,
              // Eine Ebene tiefer als 8 nimmt der Server nicht an.
              newSubfolderBlocked: menuNode.depth + 2 > MAX_FOLDER_DEPTH ? `${clause(blockText(t, 'depth', menuNode.name))}.` : null,
              onRename: onRename ? () => startRename(menuNode.path) : undefined,
              onMove: onRequestMove ? () => onRequestMove(menuNode.path) : undefined,
              extra: extraMenuItems?.(menuNode.path),
              onDelete: onDelete ? () => void deleteFolder(menuNode.path) : undefined,
              deleteBlocked: deleteReason(menuNode),
            }
          : {})}
      />
    </div>
  );
}
