import { defineModule, type ModuleManifest, type SettingDefinition } from '@kompass/core';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { FINANCE_DASHBOARD_TILES } from './dashboard';
import { requireFinanceRead } from './ledger/access';
import { cashCountTemplate } from './ledger/cash-count-template';
import { financeRecordDeleted, financeRecordReferences, financeRetentionDue, financeRetentionHolds } from './ledger/holds';
import { installFinance } from './install';
import { FINANCE_MCP_TOOLS } from './mcp-tools';
import { FINANCE_PERMISSIONS } from './permissions';
import { seedFinance } from './seed';
import { financeEntries, financeFiscalYears } from './schema';

export { FINANCE_PERMISSIONS } from './permissions';

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
  // Task 4 (Einrichtungsstand): Zeitpunkt der Bestätigung, keine Freigabe — daher normale Einstellungen, kein `uiOnly`.
  { key: 'finance.setupCategoriesConfirmedAt', schema: z.string().nullable(), default: null },
  { key: 'finance.setupTaxConfirmedAt', schema: z.string().nullable(), default: null },
  // F5 — Vorschläge der Arbeitsliste (Spec 6.4): Paar-Erkennung, Gebührentoleranz, Fenster für „passt zu einer Buchung“, Bar-Kennung.
  { key: 'finance.pairMatchDays', schema: z.number().int().min(0).max(30), default: 3 },
  { key: 'finance.pairFeeToleranceCents', schema: z.number().int().min(0), default: 500 },
  { key: 'finance.matchEntryDays', schema: z.number().int().min(0).max(30), default: 5 },
  { key: 'finance.cashKeywords', schema: z.array(z.string()), default: ['Bareinzahlung', 'Barauszahlung', 'Einzahlung Bargeld', 'Auszahlung Bargeld', 'Geldautomat'] },
];

export const financeModule: ModuleManifest = defineModule({
  key: 'finance',
  version: '0.1.0',
  // Hart, nicht optional: Spender sind Kontakte, Belege liegen in der Akte, Projekte sind Kostenstellen.
  dependsOn: ['contacts', 'dms', 'projects'],
  files: true,
  permissions: [...FINANCE_PERMISSIONS],
  settings: FINANCE_SETTINGS,
  moduleIcon: 'euro',
  help: [
    { href: '/finance/imports/format', doc: 'finanzen/csv-format-einrichten' },
    { href: '/finance/imports', doc: 'finanzen/kontoauszug-laden' },
    { href: '/finance/entries', doc: 'finanzen/buchen' },
    { href: '/finance/accounts', doc: 'finanzen/konten-und-offene-zahlungen' },
    { href: '/finance/open-items', doc: 'finanzen/konten-und-offene-zahlungen' },
    { href: '/finance/cash', doc: 'finanzen/barkasse' },
    { href: '/admin/finance', doc: 'finanzen/einrichten' },
  ],
  navigation: [
    // F4 Task 7: ein eigener Abschnitt „Arbeit“ über „Buchungen“ — F5 stellt die Arbeitsliste davor.
    { key: 'finance.imports', href: '/finance/imports', icon: 'euro', group: 'finance', section: 'finance.work', permission: 'finance.read' },
    { key: 'finance.entries', href: '/finance/entries', icon: 'euro', group: 'finance', section: 'finance.entries', permission: 'finance.read' },
    { key: 'finance.accounts', href: '/finance/accounts', icon: 'euro', group: 'finance', section: 'finance.entries', permission: 'finance.read' },
    { key: 'finance.openItems', href: '/finance/open-items', icon: 'euro', group: 'finance', section: 'finance.entries', permission: 'finance.read' },
    { key: 'finance.cash', href: '/finance/cash', icon: 'euro', group: 'finance', section: 'finance.entries', permission: 'finance.read' },
  ],
  // Task 5 — eine Seite mit Panels nach dem Muster von /admin/dms, ?panel= reitert.
  adminNavigation: [{ key: 'finance.admin', href: '/admin/finance', icon: 'euro', permission: 'finance.setup' }],
  // Dokumentarten mit diesem Bereich sieht nur, wer Finanzen mit Namen lesen darf — nicht jeder mit `dms.view`.
  documentAreas: [{ key: 'finance', permission: 'finance.read' }],
  // Der Bezug als Berechtigung (VP2): Die Buchhalterin legt Belege im Namen einer Buchung ab, ohne dms.view.
  linkedDocumentAccess: [
    { entityType: 'financeEntry', readPermission: 'finance.read', receivePermission: 'finance.entriesWrite' },
    { entityType: 'financeOpenItem', readPermission: 'finance.read', receivePermission: 'finance.entriesWrite' },
    // Das Zählprotokoll (Task 1) — lesbar für alle mit finance.read, ausgestellt nur beim Festschreiben.
    { entityType: 'financeCashCount', readPermission: 'finance.read', receivePermission: 'finance.entriesFinalize' },
  ],
  documentTemplates: [cashCountTemplate],
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
  retentionHolds: financeRetentionHolds,
  recordReferences: financeRecordReferences,
  recordDeleted: financeRecordDeleted,
  retentionDue: financeRetentionDue,
  deletionRules: [
    { entity: 'financeAccount', deletable: true, reason: 'Arbeitsmaterial der Stammdaten.', guard: 'nur unbenutzt; sonst stilllegen', auditAction: 'finance.account.delete' },
    { entity: 'financeCategory', deletable: true, reason: 'Arbeitsmaterial der Stammdaten.', guard: 'nur unbenutzt; sonst stilllegen', auditAction: 'finance.category.delete' },
    { entity: 'financePurpose', deletable: true, reason: 'Arbeitsmaterial der Stammdaten.', guard: 'nur unbenutzt; sonst stilllegen', auditAction: 'finance.purpose.delete' },
    { entity: 'financeDatedValue', deletable: true, reason: 'Nur die eigene Überschreibung; die ausgelieferte Reihe ist Code.', guard: 'nur die Überschreibung des Vereins', auditAction: 'finance.datedValue.remove' },
    { entity: 'financeImportRule', deletable: true, reason: 'Arbeitsmaterial: Eine Regel wirkt nur nach vorn.', guard: 'keiner', auditAction: 'finance.importRule.delete' },
    { entity: 'financeContactBankAccount', deletable: true, reason: 'Arbeitsmaterial: die Zuordnung IBAN → Kontakt.', guard: 'keiner', auditAction: 'finance.contactIban.delete' },
    { entity: 'financeImportProfile', deletable: false, reason: 'Läufe zeigen darauf; ein CSV-Format ist unveränderlich, eine Änderung ist ein neues Format.' },
    { entity: 'financeFiscalYear', deletable: false, reason: 'Geschäftsjahre und ihre Abschlüsse sind die Gliederung der Rechenschaft. Personenbezogene Inhalte eines Jahres werden nach Ablauf der Frist anonymisiert, nicht gelöscht.' },
    { entity: 'financePeriodEvent', deletable: false, reason: 'Geschäftsjahre und ihre Abschlüsse sind die Gliederung der Rechenschaft. Personenbezogene Inhalte eines Jahres werden nach Ablauf der Frist anonymisiert, nicht gelöscht.' },
    { entity: 'financeEntryDraft', deletable: true, reason: 'Arbeitsmaterial ohne Nummer — erst das Festschreiben macht eine Buchung rechenschaftsrelevant.', guard: 'nur solange status = draft', auditAction: 'finance.entry.draftDelete' },
    {
      entity: 'financeEntry',
      deletable: false,
      reason: 'Festgeschriebenes wird nie gelöscht. Nach Ablauf der Frist werden die personenbezogenen Inhalte des Geschäftsjahres entfernt — Kontakt, Freitext —; Datum, Betrag, Nummer und Kategorie bleiben als Rechenschaft.',
    },
    {
      entity: 'financeOpenItem',
      deletable: false,
      reason: 'Festgeschriebenes wird nie gelöscht. Nach Ablauf der Frist werden die personenbezogenen Inhalte des Geschäftsjahres entfernt — Kontakt, Freitext —; Datum, Betrag, Nummer und Kategorie bleiben als Rechenschaft.',
    },
    {
      entity: 'financeAllocationCorrection',
      deletable: false,
      reason: 'Festgeschriebenes wird nie gelöscht. Nach Ablauf der Frist werden die personenbezogenen Inhalte des Geschäftsjahres entfernt — Kontakt, Freitext —; Datum, Betrag, Nummer und Kategorie bleiben als Rechenschaft.',
    },
    {
      entity: 'financeEntryDocument',
      deletable: false,
      reason: 'Festgeschriebenes wird nie gelöscht. Nach Ablauf der Frist werden die personenbezogenen Inhalte des Geschäftsjahres entfernt — Kontakt, Freitext —; Datum, Betrag, Nummer und Kategorie bleiben als Rechenschaft.',
    },
    {
      entity: 'financeEntryJustification',
      deletable: false,
      reason: 'Festgeschriebenes wird nie gelöscht. Nach Ablauf der Frist werden die personenbezogenen Inhalte des Geschäftsjahres entfernt — Kontakt, Freitext —; Datum, Betrag, Nummer und Kategorie bleiben als Rechenschaft.',
    },
    { entity: 'financeProjectSettings', deletable: true, reason: 'Geht mit dem Projekt — kein eigener Nachweis.', guard: 'keiner; verschwindet mit dem Projekt', auditAction: 'finance.projectSettings.delete' },
    {
      entity: 'financeCashCount',
      deletable: false,
      reason: 'Eine Kassenzählung ist eine gespeicherte Tatsache für die Kontenabstimmung (Spec 5.5) und wird nie gelöscht.',
    },
    {
      entity: 'financeYearPersonalData',
      deletable: true,
      reason: 'Personenbezug eines Geschäftsjahres wird nach Ablauf der gesetzlichen Frist entfernt (DSGVO Art. 17); die Buchungen selbst bleiben als Rechenschaft.',
      guard:
        'Anker ist der spätere aus Periodenabschluss und jüngstem Vorgang an Zeilen des Jahres. Entfernt Kontakt, Freitext und Sachspendendetails — nie Beträge. Vor dem Entfernen fragt Kompass, ob für das Jahr ein Bescheid offen oder angefochten ist (§ 147 Abs. 3 S. 5 AO).',
      auditAction: 'finance.personalData.redact',
      retentionClass: 'statutory10Y',
    },
    {
      entity: 'financeImportPersonalData',
      deletable: true,
      reason: 'Personenbezug importierter Kontoumsätze eines Geschäftsjahres wird nach Ablauf der gesetzlichen Frist entfernt (DSGVO Art. 17); Datum, Betrag, Zähler und Prüfsumme bleiben als Rechenschaft.',
      guard:
        'Anker ist das Ende des Geschäftsjahres des Umsatzdatums, unabhängig vom Abschlussstand. Entfernt Gegenpartei, IBAN, Verwendungszweck, Rohdaten und die Originaldatei; der Dublettenschlüssel wird durch einen nicht rückrechenbaren Wert ersetzt.',
      auditAction: 'finance.importData.redact',
      retentionClass: 'statutory8Y',
    },
  ],
  // Sobald eine Buchung festgeschrieben ist, hält Finanzen Kontakte, Belege und Projekte — dann bleibt das Modul an.
  canDisable: (deps) => {
    const hasFinal = !!deps.db.select({ id: financeEntries.id }).from(financeEntries).where(eq(financeEntries.status, 'final')).limit(1).get();
    return hasFinal ? 'hasFinalRecords' : null;
  },
  mcpTools: FINANCE_MCP_TOOLS,
  dashboardTiles: FINANCE_DASHBOARD_TILES,
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
