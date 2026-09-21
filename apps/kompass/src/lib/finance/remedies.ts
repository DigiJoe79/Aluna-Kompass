/** Ein Ausweg aus einer Ablehnung (Finanz-Spec 5.4: „Fehlerbilder mit Grund **und** Abhilfe“). */
export type Remedy = { labelKey: string } & ({ kind: 'action'; action: 'restIntoLastRow' | 'focusDate' | 'focusAccount' | 'confirmFormatChange' } | { kind: 'link'; href: string });

const REMEDIES: Record<string, Remedy[]> = {
  entryUnbalanced: [{ kind: 'action', action: 'restIntoLastRow', labelKey: 'finance.remedy.restIntoLastRow' }],
  cashWouldGoNegative: [
    { kind: 'action', action: 'focusDate', labelKey: 'finance.remedy.focusDate' },
    { kind: 'link', href: '/finance/entries/new?template=transfer', labelKey: 'finance.remedy.cashTransferFirst' },
  ],
  // F4 Task 7: die drei Ablehnungen beim Laden eines Kontoauszugs (Spec 6.1, Rückmeldung Phase 2).
  statementIbanMismatch: [{ kind: 'action', action: 'focusAccount', labelKey: 'finance.remedy.chooseOtherAccount' }],
  statementAlreadyImported: [{ kind: 'link', href: '/finance/imports#runs', labelKey: 'finance.remedy.goToExistingRun' }],
  statementFormatChange: [{ kind: 'action', action: 'confirmFormatChange', labelKey: 'finance.remedy.confirmFormatChange' }],
};

/** 1–3 Auswege je Fehlerschlüssel; ein unbekannter Code liefert keinen. */
export function remediesFor(code: string): Remedy[] {
  return REMEDIES[code] ?? [];
}
