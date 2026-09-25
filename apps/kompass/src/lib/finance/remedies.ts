/** Ein Ausweg aus einer Ablehnung (Finanz-Spec 5.4: „Fehlerbilder mit Grund **und** Abhilfe“). */
export type RemedyAction = 'restIntoLastRow' | 'focusDate' | 'focusAccount' | 'confirmFormatChange' | 'openCsvAssistant' | 'reloadWork';
export type Remedy = { labelKey: string } & ({ kind: 'action'; action: RemedyAction } | { kind: 'link'; href: string });

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
  // F4b: kein Format-Wähler beim Upload — der Weg führt in den Assistenten des gewählten Kontos.
  statementNeedsCsvFormat: [{ kind: 'action', action: 'openCsvAssistant', labelKey: 'finance.remedy.setUpCsvFormat' }],
  statementCsvFormatMismatch: [
    { kind: 'link', href: '/help/finanzen/auszug-bei-der-bank-holen', labelKey: 'finance.remedy.fetchUsualFormat' },
    { kind: 'action', action: 'openCsvAssistant', labelKey: 'finance.remedy.newCsvFormat' },
  ],
  // F5 Task 7: die Arbeitsliste. Ein veralteter Vorschlag verschwindet mit dem Neuladen; eine stillgelegte Kategorie
  // wird in der Einrichtung wieder aktiv (oder in der Maske ersetzt).
  suggestionStale: [{ kind: 'action', action: 'reloadWork', labelKey: 'finance.remedy.reloadWork' }],
  transactionAlreadyBooked: [{ kind: 'link', href: '/finance/entries', labelKey: 'finance.remedy.openJournal' }],
  categoryInactive: [{ kind: 'link', href: '/admin/finance?panel=categories', labelKey: 'finance.remedy.setUpCategories' }],
  // F6a Task 7: eine gültige Bestätigung sperrt Rücknahme und Kontaktkorrektur — zuerst sie zurücknehmen.
  entryLockedByConfirmation: [{ kind: 'link', href: '/finance/donations', labelKey: 'finance.remedy.openConfirmations' }],
  contactLockedByConfirmation: [{ kind: 'link', href: '/finance/donations', labelKey: 'finance.remedy.openConfirmations' }],
};

/** 1–3 Auswege je Fehlerschlüssel; ein unbekannter Code liefert keinen. */
export function remediesFor(code: string): Remedy[] {
  return REMEDIES[code] ?? [];
}
