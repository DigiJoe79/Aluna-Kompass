'use client';

import { useTranslations } from 'next-intl';
import { useMemo } from 'react';
import { useUndoableMoves, type ItemWording } from '@/components/folder-tree/use-undoable-moves';
import { nameOf, type FolderEntry } from '@/lib/folder-tree-model';
import { createFolderAction, deleteFolderAction, moveDocumentsAction, moveFolderAction, renameFolderAction } from './actions';

/** Ein Dokument, das verschoben wird: wo es liegt und wie es heißt (für den Toast). */
export interface DocumentMoveItem {
  id: string;
  from: string | null;
  title: string;
  /** Wie „ohne Ordner“ heißt: Eingangskorb für Eingänge, „Kein Ordner“ für Ausgänge. */
  direction: 'incoming' | 'outgoing';
}

const ACTIONS = {
  moveFolder: moveFolderAction,
  renameFolder: renameFolderAction,
  createFolder: createFolderAction,
  deleteFolder: deleteFolderAction,
  moveItems: moveDocumentsAction,
};

/**
 * Wie ein Ort im Toast heißt. Ohne Ordner zeigt der Eingangskorb nur
 * Eingänge; ein Ausgang liegt dann unter „Kein Ordner“, und eine gemischte
 * Auswahl bekommt einen neutralen Satz.
 */
function whereOf(folder: string | null, items: readonly DocumentMoveItem[]): { where: string; target: string } {
  if (folder !== null) return { where: 'folder', target: nameOf(folder) };
  const directions = new Set(items.map((item) => item.direction));
  const where = directions.size > 1 ? 'loose' : directions.has('outgoing') ? 'none' : 'inbox';
  return { where, target: '' };
}

/**
 * Ordner der Akte pflegen und Dokumente verschieben: die geteilte Hilfe
 * {@link useUndoableMoves} mit den Actions und Sätzen der Akte (Eingangskorb
 * oder „Kein Ordner“ je nach Richtung).
 */
export function useFolderMoves({ folders, selected, hrefFor }: { folders: FolderEntry[]; selected: string | null; hrefFor: (path: string | null) => string }) {
  const t = useTranslations('folderTree');
  const wording = useMemo<ItemWording<DocumentMoveItem>>(
    () => ({
      name: (items) => (items.length === 1 ? t('toast.quoted', { title: items[0]!.title }) : t('toast.documents', { count: items.length })),
      moved: (moved, skipped, target) => {
        const place = { place: t('toast.placeMoved', whereOf(target, moved)) };
        if (skipped > 0) return t('toast.movedDocumentsSkipped', { count: moved.length, skipped, ...place });
        return moved.length === 1 ? t('toast.movedDocument', { title: moved[0]!.title, ...place }) : t('toast.movedDocuments', { count: moved.length, ...place });
      },
      alreadyThere: (skipped, items, target) => t('toast.alreadyThere', { count: skipped, place: t('toast.placeLies', whereOf(target, items)) }),
      undone: (moved, back) => {
        if (back === undefined) return t('toast.undoneDocumentsMixed', { count: moved.length });
        const place = { place: t('toast.placeLies', whereOf(back, moved)) };
        return moved.length === 1 ? t('toast.undoneDocument', { title: moved[0]!.title, ...place }) : t('toast.undoneDocuments', { count: moved.length, ...place });
      },
      undoMovedAway: (moved) => t('toast.undoMovedAway', { count: moved.length, title: moved[0]!.title }),
    }),
    [t]
  );
  const { moveItems, ...rest } = useUndoableMoves({ folders, selected, hrefFor, storageKey: 'dmsTreeExpanded', actions: ACTIONS, unit: 'documents', wording });
  return { ...rest, moveDocuments: moveItems };
}
