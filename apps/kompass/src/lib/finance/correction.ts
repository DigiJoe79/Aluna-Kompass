/**
 * Reine Bausteine des Korrigieren-Dialogs (Finanz-Spec 5.4, F3a-N Task 1):
 * welche Aufteilungszeile sich wählen lässt, was sich an ihr wirklich
 * geändert hat, und welcher der beiden Wege folgt.
 */
export interface CorrectableLine {
  id: string;
  contactId: string | null;
  projectId: string | null;
  purposeId: string | null;
  abroad: boolean;
  /** Eine wartende Korrektur macht die Zeile unwählbar, bis sie entschieden ist. */
  pendingCorrectionId: string | null;
}

export type CorrectionChanges = { contactId?: string | null; projectId?: string | null; purposeId?: string | null; abroad?: boolean };

/** Nur Felder, die sich gegenüber der Zeile wirklich geändert haben; `{}` = nichts geändert. */
export function changesOf(
  line: CorrectableLine,
  edited: { contactId: string | null; projectId: string | null; purposeId: string | null; abroad: boolean },
): CorrectionChanges {
  const changes: CorrectionChanges = {};
  if (edited.contactId !== line.contactId) changes.contactId = edited.contactId;
  if (edited.projectId !== line.projectId) changes.projectId = edited.projectId;
  if (edited.purposeId !== line.purposeId) changes.purposeId = edited.purposeId;
  if (edited.abroad !== line.abroad) changes.abroad = edited.abroad;
  return changes;
}

/** Aufteilungszeilen ohne wartende Korrektur. */
export function selectableLines(lines: CorrectableLine[]): CorrectableLine[] {
  return lines.filter((l) => l.pendingCorrectionId === null);
}

/** Sobald eine Zahl gewählt ist, gilt „Buchung zurücknehmen“ — auch wenn zusätzlich eine Zuordnung angekreuzt ist. */
export function correctionPath(picked: { allocation: string[]; numbers: string[] }): 'allocation' | 'reverse' | null {
  if (picked.numbers.length > 0) return 'reverse';
  if (picked.allocation.length > 0) return 'allocation';
  return null;
}
