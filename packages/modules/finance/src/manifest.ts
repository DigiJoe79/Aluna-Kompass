import { defineModule, type ModuleManifest, type SettingDefinition } from '@kompass/core';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { requireFinanceRead } from './ledger/access';
import { installFinance } from './install';
import { FINANCE_MCP_TOOLS } from './mcp-tools';
import { seedFinance } from './seed';
import { financeFiscalYears } from './schema';

/**
 * Alle Einstellungen der Spec (5.1), auch die erst spätere Pläne lesen — eine
 * Einstellung nachzureichen kostet nichts, aber die Liste an einer Stelle zu
 * haben, erspart die Suche.
 */
const FINANCE_SETTINGS: readonly SettingDefinition[] = [
  // E10: Ein Agent darf humanOnly-Dienste erst freigeschaltet über MCP nutzen — und das nur ein Mensch am Bildschirm.
  { key: 'finance.mcpHumanOnlyAllowed', schema: z.boolean(), default: false, uiOnly: true },
  { key: 'finance.membershipFeesCertifiable', schema: z.boolean(), default: true },
  { key: 'finance.expenseWaiversEnabled', schema: z.boolean(), default: true },
  { key: 'finance.isEntrepreneurOrHasVatId', schema: z.boolean(), default: false },
  { key: 'finance.proofGraceDays', schema: z.number().int().min(0).max(365), default: 30 },
  { key: 'finance.statementSufficesBelowCents', schema: z.number().int().min(0), default: 0 },
  { key: 'finance.cashDonationAlertCents', schema: z.number().int().min(0), default: 100000 },
  { key: 'finance.roundAmountFromCents', schema: z.number().int().min(0), default: 50000 },
  { key: 'finance.batchMinimumCents', schema: z.number().int().min(0), default: 0 },
  { key: 'finance.noticeExpiryWarnMonths', schema: z.number().int().min(1).max(24), default: 6 },
  { key: 'finance.uploadLimitMb', schema: z.number().int().min(1).max(10), default: 5 },
  { key: 'finance.lastStatementWarnDays', schema: z.number().int().min(1).max(365), default: 35 },
  { key: 'finance.voucherTypes', schema: z.array(z.string()), default: ['voucher-own', 'voucher-invoice', 'voucher-receipt', 'bank-statement'] },
];

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
  settings: FINANCE_SETTINGS,
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
  seed: seedFinance,
  install: installFinance,
  deletionRules: [
    { entity: 'financeAccount', deletable: true, reason: 'Arbeitsmaterial der Stammdaten.', guard: 'nur unbenutzt; sonst stilllegen', auditAction: 'finance.account.delete' },
    { entity: 'financeCategory', deletable: true, reason: 'Arbeitsmaterial der Stammdaten.', guard: 'nur unbenutzt; sonst stilllegen', auditAction: 'finance.category.delete' },
    { entity: 'financePurpose', deletable: true, reason: 'Arbeitsmaterial der Stammdaten.', guard: 'nur unbenutzt; sonst stilllegen', auditAction: 'finance.purpose.delete' },
    { entity: 'financeDatedValue', deletable: true, reason: 'Nur die eigene Überschreibung; die ausgelieferte Reihe ist Code.', guard: 'nur die Überschreibung des Vereins', auditAction: 'finance.datedValue.remove' },
    { entity: 'financeFiscalYear', deletable: false, reason: 'Geschäftsjahre und ihre Abschlüsse sind die Gliederung der Rechenschaft. Personenbezogene Inhalte eines Jahres werden nach Ablauf der Frist anonymisiert, nicht gelöscht.' },
    { entity: 'financePeriodEvent', deletable: false, reason: 'Geschäftsjahre und ihre Abschlüsse sind die Gliederung der Rechenschaft. Personenbezogene Inhalte eines Jahres werden nach Ablauf der Frist anonymisiert, nicht gelöscht.' },
  ],
  // F2a ergänzt: ablehnen (`hasFinalRecords`), sobald es eine festgeschriebene Buchung gibt — Finanzen hält Kontakte, Belege und Projekte.
  canDisable: () => null,
  mcpTools: FINANCE_MCP_TOOLS,
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
