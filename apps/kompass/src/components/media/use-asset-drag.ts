'use client';

import { useEffect, useState } from 'react';
import { setDragPreview } from '@/components/folder-tree/drag-preview';
import { MEDIA_MIME, beginDrag } from '@/lib/drag-types';
import { useFinePointer } from '@/lib/use-fine-pointer';

export interface DraggableAsset {
  id: string;
  filename: string;
  /** Wo die Datei liegt (`null` = ohne Ordner) — der Baum sagt damit schon beim Überfahren „Liegt schon hier“. */
  folder?: string | null;
}

/**
 * Das Ziehen einer Datei der Mediathek auf einen Ordner, für Kachel und
 * Listenzeile gleich: Ziehgut `application/x-kompass-media` (JSON-Liste mit
 * einer ID), Zug merken, Ziehbild setzen, Quelle als „gezogen“ führen. Die
 * Quelle bleibt blass an ihrem Platz, bis der Zug endet.
 *
 * Ende ist `dragend` oder ein `drop` irgendwo: Verschwindet die Quelle nach
 * dem Verschieben, erreicht ihr eigenes `dragend` das Fenster nie.
 *
 * Am Telefon zieht nichts (`useFinePointer`).
 */
export function useAssetDrag(enabled = true) {
  const [dragging, setDragging] = useState<string | null>(null);
  const fine = useFinePointer();

  useEffect(() => {
    if (dragging === null) return;
    const end = () => setDragging(null);
    window.addEventListener('dragend', end, true);
    window.addEventListener('drop', end, true);
    return () => {
      window.removeEventListener('dragend', end, true);
      window.removeEventListener('drop', end, true);
    };
  }, [dragging]);

  /** Die Attribute für das ziehbare Element (`<li>`-Kachel, `<tr>`-Zeile). */
  const dragProps = (it: DraggableAsset) =>
    enabled && fine
      ? {
          draggable: true as const,
          onDragStart: (e: React.DragEvent) => {
            const transfer = e.dataTransfer;
            transfer.setData(MEDIA_MIME, JSON.stringify([it.id]));
            transfer.effectAllowed = 'move';
            beginDrag({ kind: 'assets', ids: [it.id], sources: [it.folder ?? null], label: it.filename });
            setDragPreview(transfer, { kind: 'asset', title: it.filename });
            setDragging(it.id);
          },
          onDragEnd: () => setDragging(null),
        }
      : {};

  return { dragging, dragProps };
}
