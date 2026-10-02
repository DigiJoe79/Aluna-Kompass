'use client';

import { createContext, useContext } from 'react';

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

export const DocumentMovesContext = createContext<DocumentMoves | null>(null);

/** `null` außerhalb der Arbeitsfläche: Dann gibt es nichts anzukreuzen. */
export function useDocumentMoves(): DocumentMoves | null {
  return useContext(DocumentMovesContext);
}
