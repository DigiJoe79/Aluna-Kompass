'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { startTransition, useEffect, useOptimistic, useRef } from 'react';
import { toast } from 'sonner';
import type { ActionState } from '@/lib/actions';
import { ancestorsOf, applyFolderChange, followFolder, isWithin, nameOf, type FolderChange, type FolderEntry } from '@/lib/folder-tree-model';
import { expandFolders, renameExpandedPrefix, type FolderTreeStorageKey } from './use-folder-tree-expanded';

/** Wie lange „Rückgängig“ im Toast steht (Spec § 5.3); sonner hält an, solange Zeiger oder Fokus darauf liegen. */
const UNDO_MS = 10_000;
/** Der Info-Toast nach „Rückgängig“ (README § 3, Artboard 3). */
const UNDONE_MS = 5_000;

type ErrorState = Extract<ActionState, { status: 'error' }>;
/**
 * Was Baum und Liste zeigen, solange eine Änderung unterwegs ist. `placed`:
 * wo ein Eintrag (Dokument, Datei) nach einem laufenden Zug liegt.
 */
type View = { folders: FolderEntry[]; selected: string | null; saving: string[]; placed: Record<string, string | null> };
/** Ein Eintrag auf dem Weg von `from` nach `to`. */
type ItemStep = { id: string; from: string | null; to: string | null };
/** Eine vorweggenommene Änderung; `saving` ist die Zeile, die „wird gespeichert“ zeigt. */
type Pending = ({ change: FolderChange } | { items: ItemStep[] }) & { saving: string | null };

/** Ein Eintrag, der verschoben wird: wo er liegt und wie er heißt (für den Toast). */
export interface UndoableItem {
  id: string;
  from: string | null;
  title: string;
}

/** Ein Zug, wie die Action ihn bekommt; `expectedFolder` nur beim „Rückgängig“ (Spec § 9). */
export type ItemMove = { id: string; folder: string | null; expectedFolder?: string | null };

/** Die Server Actions einer Seite. `moveItems` antwortet mit `data: { moved, skipped }`. */
export interface UndoableMoveActions {
  moveFolder(from: string, toParent: string | null): Promise<ActionState>;
  renameFolder(path: string, name: string): Promise<ActionState>;
  createFolder(parent: string | null, name: string): Promise<ActionState>;
  deleteFolder(path: string): Promise<ActionState>;
  moveItems(moves: ItemMove[]): Promise<ActionState>;
}

/**
 * Die Sätze für verschobene Einträge. Die Seite kennt ihre Wörter: Die Akte
 * unterscheidet Eingangskorb und „Kein Ordner“, die Mediathek „Ohne Ordner“.
 */
export interface ItemWording<I extends UndoableItem> {
  /** Wie die Einträge im Fehler-Toast heißen („„Titel““ oder „3 Dokumente“). */
  name(items: readonly I[]): string;
  /** Erfolg; `skipped` lagen schon in `target`. */
  moved(moved: readonly I[], skipped: number, target: string | null): string;
  /** Alles lag schon in `target`. */
  alreadyThere(skipped: number, items: readonly I[], target: string | null): string;
  /** Nach „Rückgängig“; `back` ist der gemeinsame alte Ort, `undefined` bei verschiedenen. */
  undone(moved: readonly I[], back: string | null | undefined): string;
  /** „Rückgängig“ abgelehnt, weil inzwischen woanders. */
  undoMovedAway(moved: readonly I[]): string;
}

/**
 * Ob der Aufrufer einen Fehler selbst nennt. Eine Funktion wird erst bei der
 * Antwort befragt: Die Eingabezeile beim Umbenennen ist dann vielleicht schon
 * zu (der Baum springt optimistisch um), und der Toast muss einspringen.
 */
export type Quiet = boolean | (() => boolean);
const isQuiet = (quiet: Quiet) => (typeof quiet === 'function' ? quiet() : quiet);

const parentOf = (path: string) => ancestorsOf(path).at(-1) ?? null;
const join = (parent: string | null, name: string) => (parent === null ? name : `${parent}/${name}`);
/** Der Grund einer Ablehnung: der Satz zum Konflikt, sonst der Feldfehler, sonst die allgemeine Meldung. */
const reasonOf = (result: ErrorState) => result.detail ?? Object.values(result.fieldErrors)[0] ?? result.message;

/** Die Zähler nach einem Zug: je Eintrag eins weniger am alten Ort, eins mehr am neuen. */
function shiftCounts(folders: FolderEntry[], steps: ItemStep[]): FolderEntry[] {
  const delta = new Map<string, number>();
  for (const { from, to } of steps) {
    if (from === to) continue;
    if (from !== null) delta.set(from, (delta.get(from) ?? 0) - 1);
    if (to !== null) delta.set(to, (delta.get(to) ?? 0) + 1);
  }
  return folders.map((f) => (delta.has(f.path) ? { ...f, count: Math.max(0, f.count + delta.get(f.path)!) } : f));
}

function reduce(view: View, pending: Pending): View {
  const saving = pending.saving === null ? view.saving : [...view.saving, pending.saving];
  if ('items' in pending) {
    return {
      ...view,
      folders: shiftCounts(view.folders, pending.items),
      placed: { ...view.placed, ...Object.fromEntries(pending.items.map((step) => [step.id, step.to])) },
      saving,
    };
  }
  const { change } = pending;
  return {
    folders: applyFolderChange(view.folders, change),
    selected: change.kind === 'move' ? followFolder(view.selected, change.from, change.to) : view.selected,
    saving,
    placed: view.placed,
  };
}

/**
 * Ordner pflegen und Einträge verschieben, geteilt von Akte und Mediathek:
 * verschieben, umbenennen, löschen, anlegen — jedes sofort im Baum
 * (`useOptimistic`), mit Toast und, wo vorgesehen, „Rückgängig“ (Spec §§ 5.3,
 * 5.4). Lehnt der Server ab, springt der Baum zurück und ein Fehler-Toast
 * nennt den Grund; er bleibt bis zum Schließen.
 *
 * Betrifft eine Änderung den geöffneten Ordner oder einen seiner Vorfahren,
 * zieht die Adresse mit (`router.replace`, kein neuer Verlaufseintrag);
 * gelöscht springt die Seite in den Elternordner (README § 5). Was „geöffnet“
 * ist, gilt im Moment der Antwort — ein „Rückgängig“ zehn Sekunden später
 * sieht den Ordner, der dann offen ist, nicht den von damals.
 *
 * `unit` wählt die Wörter im Toast zum Ordner („mit 3 Dokumenten“, „mit 3
 * Dateien“); die Sätze zu Einträgen bringt die Seite mit (`wording`).
 */
export function useUndoableMoves<I extends UndoableItem>({
  folders,
  selected,
  hrefFor,
  storageKey,
  actions,
  unit,
  wording,
}: {
  folders: FolderEntry[];
  selected: string | null;
  hrefFor: (path: string | null) => string;
  storageKey: FolderTreeStorageKey;
  actions: UndoableMoveActions;
  unit: 'documents' | 'files';
  wording: ItemWording<I>;
}) {
  const t = useTranslations('folderTree');
  const router = useRouter();
  const [view, apply] = useOptimistic<View, Pending>({ folders, selected, saving: [], placed: {} }, reduce);
  const latest = useRef({ folders, selected, hrefFor });
  useEffect(() => {
    latest.current = { folders, selected, hrefFor };
  });

  /** Nach einer bestätigten Änderung: Aufklappspeicher und Adresse nachziehen, sonst neu laden. */
  const follow = (pending: Pending) => {
    if (!('change' in pending)) {
      router.refresh();
      return;
    }
    const { change } = pending;
    const { selected: open, hrefFor: href } = latest.current;
    let next = open;
    if (change.kind === 'move') {
      // Auch nach dem Ziehen im Baum, der das selbst schon tut: doppelt schadet nicht.
      renameExpandedPrefix(storageKey, change.from, change.to);
      next = followFolder(open, change.from, change.to);
    } else if (change.kind === 'delete' && open !== null && isWithin(open, change.path)) {
      next = parentOf(change.path);
    }
    // Der Elternordner bleibt offen: Er war es als Weg zum gelöschten, und ein
    // wieder angelegter Ordner soll dort sichtbar sein, wo er verschwand.
    const parent = change.kind === 'move' ? null : parentOf(change.path);
    if (parent !== null) expandFolders(storageKey, [parent]);
    if (next !== open) router.replace(href(next));
    else router.refresh();
  };

  /** Nimmt die Änderung vorweg, ruft die Aktion und meldet das Ergebnis — alles in einem Übergang, damit der Baum bis zur Antwort steht. */
  const run = (pending: Pending, action: () => Promise<ActionState>, report: (result: ActionState) => void) =>
    new Promise<ActionState>((resolve) => {
      startTransition(async () => {
        apply(pending);
        let result: ActionState;
        try {
          result = await action();
        } catch {
          result = { status: 'error', message: t('error.unexpected'), fieldErrors: {} };
        }
        if (result.status === 'success') follow(pending);
        report(result);
        resolve(result);
      });
    });

  // R5 (MUSTER: Ausnahme): Beim Ziehen und Ablegen gibt es keinen Knopf, über dem die Ablehnung stehen könnte — sie bleibt als Toast, bis man sie schließt.
  const fail = (title: string, result: ErrorState) => toast.error(title, { description: reasonOf(result), duration: Infinity, closeButton: true });
  const withUndo = (message: string, undo: () => void) =>
    toast.success(message, { duration: UNDO_MS, action: { label: t('toast.undo'), onClick: undo } });
  const undone = (message: string) => toast.info(message, { duration: UNDONE_MS });

  /**
   * Verschiebt `from` unter `toParent` (`null` = oberste Ebene). `quiet`: Der
   * Aufrufer nennt einen Fehler selbst (Dialog „Verschieben nach…“).
   */
  const moveFolder = (from: string, toParent: string | null, { quiet = false }: { quiet?: boolean } = {}) => {
    const name = nameOf(from);
    const to = join(toParent, name);
    const back = parentOf(from);
    // Nur was der Nutzer lesen darf — dieselbe Zahl wie im Baum.
    const total = latest.current.folders.filter((f) => isWithin(f.path, from)).reduce((sum, f) => sum + f.count, 0);
    const undo = () =>
      void run({ change: { kind: 'move', from: to, to: from }, saving: back ?? from }, () => actions.moveFolder(to, back), (result) => {
        if (result.status === 'error') fail(t('toast.undoFailed', { name }), result);
        else if (result.status === 'success') undone(back === null ? t('toast.undoneFolderTop', { name }) : t('toast.undoneFolder', { name, target: nameOf(back) }));
      });
    return run({ change: { kind: 'move', from, to }, saving: toParent ?? to }, () => actions.moveFolder(from, toParent), (result) => {
      if (result.status === 'error') {
        if (!quiet) fail(t('toast.rejected', { name }), result);
        return;
      }
      if (result.status !== 'success') return;
      withUndo(toParent === null ? t('toast.movedFolderTop', { name, total, unit }) : t('toast.movedFolder', { name, total, unit, target: nameOf(toParent) }), undo);
    });
  };

  /** `quiet`: Die Eingabezeile nennt den Fehler selbst (F2, „Neuer Ordner“); eine Funktion sagt, ob sie das bei der Antwort noch kann. */
  const renameFolder = (path: string, newName: string, { quiet = false }: { quiet?: Quiet } = {}) => {
    const name = newName.trim();
    const old = nameOf(path);
    const to = join(parentOf(path), name);
    const undo = () =>
      void run({ change: { kind: 'move', from: to, to: path }, saving: path }, () => actions.renameFolder(to, old), (result) => {
        if (result.status === 'error') fail(t('toast.undoFailed', { name }), result);
        else if (result.status === 'success') undone(t('toast.undoneRename', { name: old }));
      });
    return run({ change: { kind: 'move', from: path, to }, saving: to }, () => actions.renameFolder(path, name), (result) => {
      if (result.status === 'error') {
        if (!isQuiet(quiet)) fail(t('toast.renameFailed', { name: old }), result);
      } else if (result.status === 'success') withUndo(t('toast.renamedFolder', { name: old, newName: name }), undo);
    });
  };

  /** Löscht ohne Rückfrage (Spec § 5.4); „Rückgängig“ legt den Ordner neu an. */
  const deleteFolder = (path: string) => {
    const name = nameOf(path);
    const parent = parentOf(path);
    const undo = () =>
      void run({ change: { kind: 'create', path }, saving: path }, () => actions.createFolder(parent, name), (result) => {
        if (result.status === 'error') fail(t('toast.undoFailed', { name }), result);
        else if (result.status === 'success') undone(t('toast.undoneDelete', { name }));
      });
    return run({ change: { kind: 'delete', path }, saving: null }, () => actions.deleteFolder(path), (result) => {
      if (result.status === 'error') fail(t('toast.deleteFailed', { name }), result);
      else if (result.status === 'success') withUndo(t('toast.deletedFolder', { name }), undo);
    });
  };

  /** Legt an; den Erfolg sagt der Baum selbst an („Ordner … angelegt“), ein Toast wäre doppelt. */
  const createFolder = (parent: string | null, newName: string, { quiet = false }: { quiet?: Quiet } = {}) => {
    const name = newName.trim();
    const path = join(parent, name);
    return run({ change: { kind: 'create', path }, saving: path }, () => actions.createFolder(parent, name), (result) => {
      if (result.status === 'error' && !isQuiet(quiet)) fail(t('toast.createFailed', { name }), result);
    });
  };

  /**
   * Verschiebt Einträge nach `target` (`null` = ohne Ordner), alles oder
   * nichts; was schon dort liegt, überspringt der Server und der Toast sagt
   * es. „Rückgängig“ schickt jeden zurück, wo er herkam — nur, solange er noch
   * in `target` liegt (Spec § 9). `quiet` wie bei {@link moveFolder}.
   */
  const moveItems = (items: I[], target: string | null, { quiet = false }: { quiet?: boolean } = {}) => {
    const undo = (moved: I[]) => () => {
      const origins = new Set(moved.map((item) => item.from));
      const back = origins.size === 1 ? [...origins][0]! : undefined;
      const steps = moved.map((item) => ({ id: item.id, from: target, to: item.from }));
      void run(
        { items: steps, saving: back ?? null },
        () => actions.moveItems(moved.map((item) => ({ id: item.id, folder: item.from, expectedFolder: target }))),
        (result) => {
          if (result.status === 'error') {
            if (result.code === 'movedInBetween') toast.error(wording.undoMovedAway(moved), { duration: Infinity, closeButton: true });
            else fail(t('toast.undoFailed', { name: wording.name(moved) }), result);
          } else if (result.status === 'success') {
            undone(wording.undone(moved, back));
          }
        }
      );
    };
    const steps = items.map((item) => ({ id: item.id, from: item.from, to: target }));
    return run(
      { items: steps, saving: target },
      () => actions.moveItems(items.map((item) => ({ id: item.id, folder: target }))),
      (result) => {
        if (result.status === 'error') {
          if (!quiet) fail(t('toast.rejected', { name: wording.name(items) }), result);
          return;
        }
        if (result.status !== 'success') return;
        const { moved: movedIds = [], skipped = [] } = (result.data ?? {}) as { moved?: string[]; skipped?: string[] };
        const moved = items.filter((item) => movedIds.includes(item.id));
        if (moved.length === 0) {
          toast.info(wording.alreadyThere(skipped.length, items, target), { duration: UNDONE_MS });
          return;
        }
        withUndo(wording.moved(moved, skipped.length, target), undo(moved));
      }
    );
  };

  return {
    folders: view.folders,
    selected: view.selected,
    saving: view.saving,
    placed: view.placed,
    moveFolder,
    renameFolder,
    deleteFolder,
    createFolder,
    moveItems,
  };
}
