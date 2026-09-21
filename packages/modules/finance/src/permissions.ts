/**
 * Alle zehn Rechte, eigene Datei: `manifest.ts` definiert das Modul,
 * `ledger/setup.ts` baut daraus `getPermissionMatrix` — beide brauchen die
 * Liste, und eine eigene Datei vermeidet einen Ringimport zwischen ihnen.
 *
 * Auch die, deren Dienste erst spätere Pläne bringen, stehen von Anfang an
 * hier: Rollenvorschläge werden einmal ausgeliefert und nie nachgefüllt
 * (Vorarbeiten-Spec V4) — ein Recht, das erst mit F6a erschiene, fehlte dem
 * Schatzmeister für immer.
 */
export const FINANCE_PERMISSIONS = [
  'finance.read', 'finance.overview', 'finance.entriesWrite', 'finance.entriesFinalize', 'finance.periodClose',
  'finance.setup', 'finance.expensesSubmit', 'finance.approve', 'finance.donationsIssue', 'finance.reportsFinalize',
] as const;
