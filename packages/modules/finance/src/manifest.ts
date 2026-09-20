import { defineModule, type ModuleManifest } from '@kompass/core';
import { eq } from 'drizzle-orm';
import { requireFinanceRead } from './ledger/access';
import { installFinance } from './install';
import { financeFiscalYears } from './schema';

/**
 * Alle zehn Rechte stehen von Anfang an hier, auch die, deren Dienste erst
 * spätere Pläne bringen: Rollenvorschläge werden einmal ausgeliefert und nie
 * nachgefüllt (Vorarbeiten-Spec V4) — ein Recht, das erst mit F6a erschiene,
 * fehlte dem Schatzmeister für immer.
 */
export const FINANCE_PERMISSIONS = [
  'finance.read', 'finance.overview', 'finance.entriesWrite', 'finance.entriesFinalize', 'finance.periodClose',
  'finance.setup', 'finance.expensesSubmit', 'finance.approve', 'finance.donationsIssue', 'finance.reportsFinalize',
] as const;

export const financeModule: ModuleManifest = defineModule({
  key: 'finance',
  version: '0.1.0',
  // Hart, nicht optional: Spender sind Kontakte, Belege liegen in der Akte, Projekte sind Kostenstellen.
  dependsOn: ['contacts', 'dms', 'projects'],
  files: true,
  permissions: [...FINANCE_PERMISSIONS],
  // Dokumentarten mit diesem Bereich sieht nur, wer Finanzen mit Namen lesen darf — nicht jeder mit `dms.view`.
  documentAreas: [{ key: 'finance', permission: 'finance.read' }],
  /**
   * Alle `none`: Finanzen hält seine Kontakte über Buchungen und Bestätigungen
   * (ab F2c), nicht über die Rolle — eine laufende Rolle rechnete „ab heute“
   * und hielte für immer. `donor`, `grant-recipient`, `claimant` setzen die
   * Dienste beim ersten Vorgang; `board-member` und `related-party` pflegt ein
   * Mensch mit Zeitraum. Lieferanten nutzen die allgemeine Rolle `service`.
   */
  contactRoles: [
    { key: 'donor', retention: 'none' }, { key: 'grant-recipient', retention: 'none' }, { key: 'claimant', retention: 'none' },
    { key: 'board-member', retention: 'none' }, { key: 'related-party', retention: 'none' },
  ],
  // Platzhalter, bis Task 12 (`seedFinance`) das erfundene Vereinsjahr liefert —
  // AGENTS.md verlangt den Haken für jedes Modul von Anfang an.
  seed: async () => {},
  install: installFinance,
  followUpTargets: (deps, entityType, id) => {
    if (entityType !== 'financeFiscalYear') return null;
    const year = deps.db.select({ designation: financeFiscalYears.designation }).from(financeFiscalYears).where(eq(financeFiscalYears.id, id)).get();
    if (!year) return null;
    // Eine Seite gibt es erst mit F3; dort wird der Link nachgetragen.
    return { label: `Geschäftsjahr ${year.designation}`, href: null };
  },
  recordLabels: (deps, ctx, entityType, id) => {
    if (entityType !== 'financeFiscalYear') return null;
    const year = deps.db.select({ designation: financeFiscalYears.designation }).from(financeFiscalYears).where(eq(financeFiscalYears.id, id)).get();
    if (!year) return { label: '', href: null, state: 'missing' };
    const label = `Geschäftsjahr ${year.designation}`;
    const denied = requireFinanceRead(ctx, 'overview');
    // Das Label bleibt auch ohne Recht stehen — eine Jahresbezeichnung verrät nichts.
    return { label, href: null, state: denied ? 'forbidden' : 'ok' };
  },
});
