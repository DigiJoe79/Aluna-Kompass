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
  /** E6a Task 11c: Kennzeichen und Leistungsdatum, korrigierbar innerhalb `none`/§ 13b/Erwerb an Ausgaben. */
  taxCode?: string;
  serviceDate?: string | null;
}

export type CorrectionChanges = { contactId?: string | null; projectId?: string | null; purposeId?: string | null; abroad?: boolean; taxCode?: string; serviceDate?: string | null };

/** Die Kennzeichen, zwischen denen die Zuordnungskorrektur an einer Ausgabe wechseln darf (Entscheidung 7). */
export const CORRECTABLE_TAX_CODES = ['none', 'rc13bEu', 'rc13bOther', 'icAcquisition'] as const;

/** Eine Ausgabezeile mit erlaubtem Kennzeichen — nur dort bietet der Dialog Umsatzsteuer und Leistungsdatum an. */
export function vatCorrectable(line: { amountCents: number; taxCode?: string }): boolean {
  return line.amountCents < 0 && (CORRECTABLE_TAX_CODES as readonly string[]).includes(line.taxCode ?? 'none');
}

/** Nur Felder, die sich gegenüber der Zeile wirklich geändert haben; `{}` = nichts geändert. */
export function changesOf(
  line: CorrectableLine,
  edited: { contactId: string | null; projectId: string | null; purposeId: string | null; abroad: boolean; taxCode?: string; serviceDate?: string | null },
): CorrectionChanges {
  const changes: CorrectionChanges = {};
  if (edited.contactId !== line.contactId) changes.contactId = edited.contactId;
  if (edited.projectId !== line.projectId) changes.projectId = edited.projectId;
  if (edited.purposeId !== line.purposeId) changes.purposeId = edited.purposeId;
  if (edited.abroad !== line.abroad) changes.abroad = edited.abroad;
  if (edited.taxCode !== undefined && edited.taxCode !== (line.taxCode ?? 'none')) changes.taxCode = edited.taxCode;
  if (edited.serviceDate !== undefined && edited.serviceDate !== (line.serviceDate ?? null)) changes.serviceDate = edited.serviceDate;
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
