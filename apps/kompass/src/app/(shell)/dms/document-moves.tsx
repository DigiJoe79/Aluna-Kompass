'use client';

import { createContext, useContext } from 'react';
import type { ItemStep } from '@/components/folder-tree/use-undoable-moves';
import type { DocumentMoveItem } from './use-folder-moves';

/** Eine Zeile der Liste, so weit das Verschieben sie braucht. */
export interface MovableDocument {
  id: string;
  folder: string | null;
  subject: string;
  /** Ohne Ordner liegt ein Eingang im Eingangskorb, ein Ausgang unter „Kein Ordner“. */
  direction: 'incoming' | 'outgoing';
}

/**
 * Die Brücke zwischen Liste und Arbeitsfläche. Die Liste kommt als `children`
 * vom Server; Baum, Dialog und das vorweggenommene Verschieben hält die
 * Arbeitsfläche. Der Baum bekommt beim Ablegen nur IDs (aus dem DataTransfer)
 * und schlägt Ort und Betreff hier nach.
 */
export interface DocumentMoves {
  /** Wo ein Dokument nach einem laufenden Zug liegt — vorweggenommen, bis der Server antwortet. */
  placed: Record<string, string | null>;
  /** Merkt sich die Zeilen, die die Liste gerade zeigt. */
  remember(rows: readonly MovableDocument[]): void;
  /** Öffnet „Verschieben nach…“ für diese Dokumente. */
  requestMove(rows: readonly MovableDocument[]): void;
}

/**
 * Trägt den neuen Ort sofort in die gemerkten Zeilen ein, noch vor der Antwort des Servers — sonst nähme ein zweiter
 * Zug desselben Dokuments den alten Ort als Ziel für „Rückgängig“ (Backlog 45). Gibt zurück, was den alten Stand
 * wiederherstellt, wenn der Server ablehnt.
 */
export function placeRows(rows: Map<string, MovableDocument>, items: readonly DocumentMoveItem[], target: string | null): () => void {
  const before = items.map((item) => [item.id, rows.get(item.id)] as const);
  for (const item of items) rows.set(item.id, { id: item.id, folder: target, subject: item.title, direction: item.direction });
  return () => {
    for (const [id, row] of before) {
      if (row) rows.set(id, row);
      else rows.delete(id);
    }
  };
}

/**
 * Wie sich der Eingangskorb durch laufende Züge ändert, bis der Server neu zählt (Backlog 45): nur Eingänge zählen dort,
 * ein Ausgang ohne Ordner liegt unter „Kein Ordner“.
 */
export function inboxShift(steps: readonly ItemStep[], directionOf: (id: string) => MovableDocument['direction'] | undefined): number {
  let shift = 0;
  for (const step of steps) {
    if (step.from === step.to || directionOf(step.id) !== 'incoming') continue;
    if (step.from === null) shift -= 1;
    if (step.to === null) shift += 1;
  }
  return shift;
}

export const DocumentMovesContext = createContext<DocumentMoves | null>(null);

/** `null` außerhalb der Arbeitsfläche: Dann gibt es nichts anzukreuzen. */
export function useDocumentMoves(): DocumentMoves | null {
  return useContext(DocumentMovesContext);
}
