/** Ein Ausweg aus einer Ablehnung (Finanz-Spec 5.4: „Fehlerbilder mit Grund **und** Abhilfe“). */
export type Remedy = { labelKey: string } & ({ kind: 'action'; action: 'restIntoLastRow' | 'focusDate' } | { kind: 'link'; href: string });

const REMEDIES: Record<string, Remedy[]> = {
  entryUnbalanced: [{ kind: 'action', action: 'restIntoLastRow', labelKey: 'finance.remedy.restIntoLastRow' }],
  cashWouldGoNegative: [
    { kind: 'action', action: 'focusDate', labelKey: 'finance.remedy.focusDate' },
    { kind: 'link', href: '/finance/entries/new?template=transfer', labelKey: 'finance.remedy.cashTransferFirst' },
  ],
};

/** 1–3 Auswege je Fehlerschlüssel; ein unbekannter Code liefert keinen. */
export function remediesFor(code: string): Remedy[] {
  return REMEDIES[code] ?? [];
}
