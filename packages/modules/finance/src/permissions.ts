/**
 * Alle Rechte des Moduls, eigene Datei: `manifest.ts` definiert das Modul,
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
  // L1 (Spec Mitglieder und Lastschrift § 8): Mandate, Zusagen, Einzüge vorbereiten. Kommt nicht an vorhandene Rollen
  // (Backlog 29) — die Einrichtungs-Checkliste nennt es.
  'finance.directDebit',
  // Rechenschaft D1 (Spec 0.4.0 § D1): Vermerke, Stichproben, Prüfbericht. Bekommt nur die Rolle Kassenprüfer neuer
  // Installationen; vorhandene Rollen bleiben, wie sie sind (Backlog 29) — Handbuch und Release-Notes nennen es.
  'finance.audit',
] as const;
