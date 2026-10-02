'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { FolderField } from '@/components/folder-tree/folder-field';
import type { ActionState } from '@/lib/actions';
import type { FolderEntry } from '@/lib/folder-tree-model';
import { useFolderMoves } from '../use-folder-moves';

const folderHref = (path: string | null) => (path === null ? '/dms' : `/dms?folder=${encodeURIComponent(path)}`);

/**
 * Der Ort eines Dokuments: der Weg als Links in die Akte und „Verschieben
 * nach…“ (README § 3, Artboard 5). Verschoben wird über denselben Weg wie in
 * der Liste — Toast mit „Rückgängig“ —; lehnt der Server ab, bleibt der Dialog
 * offen und nennt den Grund. Steht in der `<dl>` der Metadaten: Die Wurzel ist
 * eine `<div>`-Gruppe aus `<dt>` und `<dd>`.
 */
export function FolderPanel({
  documentId,
  title,
  folder,
  folders,
  direction,
  canEdit,
}: {
  documentId: string;
  /** Der Betreff, für Dialogtitel und Toast. */
  title: string;
  folder: string | null;
  folders: FolderEntry[];
  /** Ohne Ordner heißt beim Eingang „Eingangskorb“, sonst schlicht „Kein Ordner“. */
  direction: 'incoming' | 'outgoing';
  canEdit: boolean;
}) {
  const t = useTranslations('dms');
  const tMove = useTranslations('moveDialog');
  const { folders: shown, moveDocuments } = useFolderMoves({ folders, selected: null, hrefFor: folderHref });
  // Wo es zuletzt bestätigt lag — Ausgangspunkt für „Rückgängig“, auch bevor
  // die Seite neu geladen ist. Ein neuer Stand vom Server gilt (Rückgängig, anderer Tab).
  const [at, setAt] = useState(folder);
  const [seen, setSeen] = useState(folder);
  if (folder !== seen) {
    setSeen(folder);
    setAt(folder);
  }

  const move = async (target: string | null): Promise<ActionState> => {
    // `quiet`: Den Fehler nennt der Dialog selbst; ein Toast daneben wäre doppelt.
    const result = await moveDocuments([{ id: documentId, from: at, title, direction }], target, { quiet: true });
    if (result.status === 'success') setAt(target);
    return result;
  };

  return (
    <FolderField
      value={at}
      folders={shown}
      label={t('columns.folder')}
      emptyLabel={direction === 'incoming' ? t('inbox') : t('noFolder')}
      rootKind={direction === 'incoming' ? 'inbox' : 'none'}
      dialogTitle={tMove('titleOne', { title })}
      linkToAkte
      labelAs="dt"
      readOnly={!canEdit}
      onChange={move}
    />
  );
}
