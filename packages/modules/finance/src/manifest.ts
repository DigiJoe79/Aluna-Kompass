import { defineModule, readSetting, todayIn, type FollowUpTargetInput, type ModuleManifest, type NavigationItem, type SettingDefinition } from '@kompass/core';
import { vatMenuShownInternal } from './ledger/vat-periods';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { FINANCE_DASHBOARD_TILES } from './dashboard';
import { cashCountTemplate } from './ledger/cash-count-template';
import { SEPA_SETTINGS } from './direct-debit/settings';
import { financeDocumentDispatched } from './donations/confirmations';
import { confirmationContactLock, confirmationEntryLock } from './donations/locks';
import { partnerPaidLineContactLock, partnerPaidLineEntryLock, partnerPayingEntryLock } from './allocation/locks';
import { collectiveConfirmationTemplate } from './donations/templates/collective';
import { inKindConfirmationTemplate } from './donations/templates/in-kind';
import { moneyConfirmationTemplate } from './donations/templates/money';
import { simplifiedReceiptTemplate } from './donations/templates/simplified';
import { mandateFormTemplate } from './direct-debit/templates/mandate-form';
import { prenotificationTemplate } from './direct-debit/templates/prenotification';
import { runSummaryTemplate } from './direct-debit/templates/run-summary';
import { waiverDeclarationTemplate } from './allocation/templates/waiver-declaration';
import { reportPersonalTemplate, reportTemplate } from './reporting/template';
import { auditReportPrintTemplate } from './auditing/report-template';
import { auditFolderTemplate } from './auditing/folder-template';
import { financeRecordDeleted, financeRecordReferences, financeRetentionDue, financeRetentionHolds } from './ledger/holds';
import { installFinance } from './install';
import { registerCashCountWitnessChecks, registerCloseHooks, registerEntryLocks, registerFinalStageNotes, registerReleaseAuditSources, registerReleaseFollowUpChecks, registerReopenGuards } from './locks';
import { carryOverStageNote } from './auditing/carry-over';
import { followUpStateInternal, releaseAuditFactsInternal } from './auditing/report';
import { registerAssemblyPersonSource } from './closing/assembly';
import { handoverAssemblyPersons } from './closing/handover';
import { handoverPrintTemplate } from './closing/handover-template';
import { auditWitnessCheck } from './auditing/cash-witnesses';
import { auditBaselineCloseHook, auditFollowUpReopenGuard } from './auditing/locks';
import { releaseReopenGuard, reportsReopenGuard } from './reporting/locks';
import { financeRecordLabels } from './ledger/record-labels';
import { taxPeriodInternal } from './ledger/tax-periods';
import { FINANCE_MCP_TOOLS } from './mcp-tools';
import { FINANCE_PERMISSIONS } from './permissions';
import { seedFinance } from './seed';
import { sweepDataExports } from './reporting/export/sweep';
import { financeEntries, financeFiscalYears } from './schema';

export { FINANCE_PERMISSIONS } from './permissions';

// F6a Task 5 (Spec 5.4): Eine gültige Bestätigung sperrt Storno und Kontaktkorrektur ihrer Buchung.
// `ledger/` kennt `donations/` nicht — die Verdrahtung steht hier, wo jedes Bundle sie lädt.
registerEntryLocks([confirmationEntryLock, confirmationContactLock]);
// F7 Task 4 (Spec 8.1, Annahme 15): eine nachträglich zugeordnete Zeile, oder die zahlende Buchung nach dem Anerkennen.
registerEntryLocks([partnerPaidLineEntryLock, partnerPaidLineContactLock, partnerPayingEntryLock]);
// Rechenschaft A1 (Spec § A): Wiederöffnen storniert festgeschriebene Berichte des Jahres und widerruft die Freigabe.
registerReopenGuards([reportsReopenGuard, releaseReopenGuard]);
// Rechenschaft D1 (Spec § D1 „Prüfstand“): Abschließen legt den Prüfstand der Kassenprüfung an.
registerCloseHooks([auditBaselineCloseHook]);
registerReopenGuards([auditFollowUpReopenGuard]);
// Rechenschaft D1 (Designer 12f): Zeugen der Kassenzählung sind Prüfer des gerade geprüften Jahres.
registerCashCountWitnessChecks([auditWitnessCheck]);
// Rechenschaft C (Joe 2026-10-24): nach einer Übernahme ins Folgejahr sagen danach festgeschriebene Berichte es im Kopf.
registerFinalStageNotes([carryOverStageNote]);
// Rechenschaft E2 (279 Telefon): Solange die Nachprüfung offen ist, stellt Schritt 10 die Freigabe wieder her.
registerReleaseFollowUpChecks([followUpStateInternal]);
registerReleaseAuditSources([releaseAuditFactsInternal]);
// Rechenschaft C: eine abgeschlossene Amtsübergabe trennt Von und An in der Entlastungsliste.
registerAssemblyPersonSource(handoverAssemblyPersons);

/**
 * Alle Einstellungen der Spec (5.1), auch die erst spätere Pläne lesen — eine
 * Einstellung nachzureichen kostet nichts, aber die Liste an einer Stelle zu
 * haben, erspart die Suche.
 */
const FINANCE_SETTINGS: readonly SettingDefinition[] = [
  // E10: Ein Agent darf humanOnly-Dienste erst freigeschaltet über MCP nutzen — und das nur ein Mensch am Bildschirm.
  { key: 'finance.mcpHumanOnlyAllowed', schema: z.boolean(), default: false, uiOnly: true },
  { key: 'finance.membershipFeesCertifiable', schema: z.boolean(), default: true },
  { key: 'finance.expenseWaiversEnabled', schema: z.boolean(), default: false },
  // F8a (Spec 8.2): Anspruchsgrundlage der Aufwandsspenden — ein Vertrag oder die Satzung (BMF 25.11.2014). Leer, bis der
  // Verein sie hinterlegt; je Person überschreibbar (`finance_contact_waiver_terms`).
  { key: 'finance.expenseWaiverBasisText', schema: z.string().max(500), default: '', auditValue: 'redact' },
  /** Befund J: seit wann die Grundlage des Vereins gilt — Maßstab für „Anspruch vorab vereinbart“. Ein Datum ist kein Wortlaut, darum nicht geschwärzt. */
  { key: 'finance.expenseWaiverBasisAgreedOn', schema: z.string().date().nullable(), default: null },
  { key: 'finance.proofGraceDays', schema: z.number().int().min(0).max(365), default: 30 },
  { key: 'finance.statementSufficesBelowCents', schema: z.number().int().min(0), default: 0 },
  { key: 'finance.cashDonationAlertCents', schema: z.number().int().min(0), default: 100000 },
  { key: 'finance.roundAmountFromCents', schema: z.number().int().min(0), default: 50000 },
  { key: 'finance.batchMinimumCents', schema: z.number().int().min(0), default: 0 },
  { key: 'finance.noticeExpiryWarnMonths', schema: z.number().int().min(1).max(24), default: 6 },
  // Rechenschaft A2 — Kassenbericht: Satzungsfundstelle im Untertitel („Kassenteil des Jahresberichts nach …“) und eine
  // Unterschriftszeile auf Wunsch. Darstellung des Papiers, nicht Teil des Datenstands.
  { key: 'finance.reports.statuteReference', schema: z.string().max(80), default: '' },
  { key: 'finance.reports.cashReportSignature', schema: z.boolean(), default: false },
  // Rechenschaft C: Ist der Schatzmeister Vorstand nach § 26 BGB? Steuert den Hinweis auf § 67 BGB im Übergabeprotokoll; `null` = nicht angegeben (Hinweis steht).
  { key: 'finance.reports.treasurerIsStatutoryBoard', schema: z.boolean().nullable(), default: null },
  { key: 'finance.uploadLimitMb', schema: z.number().int().min(1).max(10), default: 5 },
  { key: 'finance.lastStatementWarnDays', schema: z.number().int().min(1).max(365), default: 35 },
  { key: 'finance.voucherTypes', schema: z.array(z.string()), default: ['voucher-own', 'voucher-invoice', 'voucher-receipt', 'bank-statement'] },
  // Task 4 (Einrichtungsstand): Zeitpunkt der Bestätigung, keine Freigabe — daher normale Einstellungen, kein `uiOnly`.
  { key: 'finance.setupCategoriesConfirmedAt', schema: z.string().nullable(), default: null },
  { key: 'finance.setupTaxConfirmedAt', schema: z.string().nullable(), default: null },
  // E6a: Zeitpunkt, zu dem die Einstellung „Umsatzsteuer“ zuletzt gespeichert wurde (Einrichtungsschritt `vat`).
  { key: 'finance.setupVatConfirmedAt', schema: z.string().nullable(), default: null },
  // F5 — Vorschläge der Arbeitsliste (Spec 6.4): Paar-Erkennung, Gebührentoleranz, Fenster für „passt zu einer Buchung“, Bar-Kennung.
  { key: 'finance.pairMatchDays', schema: z.number().int().min(0).max(30), default: 3 },
  { key: 'finance.pairFeeToleranceCents', schema: z.number().int().min(0), default: 500 },
  { key: 'finance.matchEntryDays', schema: z.number().int().min(0).max(30), default: 5 },
  { key: 'finance.cashKeywords', schema: z.array(z.string()), default: ['Bareinzahlung', 'Barauszahlung', 'Einzahlung Bargeld', 'Auszahlung Bargeld', 'Geldautomat'] },
  // A1: Freitexte (Anspruchsgrundlage, Vergütungsgrundlage) protokolliert der Kern nur als „geändert“ — sie können
  // Namen und Beschlüsse tragen, und das Protokoll ist unlöschbar. Listen wie `cashKeywords` und `voucherTypes` sind
  // Schlüssel bzw. Suchwörter, keine Vereinbarungen.
  // F8b — Einrichtungspunkt „Vergütung des Vorstands“ (Annahme 10): ohne ihn warnt jede Pauschale an ein Vorstandsmitglied.
  { key: 'finance.boardRemunerationAllowed', schema: z.boolean(), default: false },
  { key: 'finance.boardRemunerationBasisText', schema: z.string().max(500), default: '', auditValue: 'redact' },
  { key: 'finance.boardRemunerationDocumentId', schema: z.string().nullable(), default: null },
  /** Befund AK: ab wann die Grundlage gilt — die Markierung „ohne Grundlage“ vergleicht mit dem Zahlungstag. */
  { key: 'finance.boardRemunerationValidFrom', schema: z.string().date().nullable(), default: null },
  /** Joe 11.9: der Tag der Entscheidung, ob ja oder nein — ohne ihn gilt der Schritt als offen (Bestand eingeschlossen). */
  { key: 'finance.boardRemunerationDecidedOn', schema: z.string().date().nullable(), default: null },
  // L1 — Lastschrift: Gläubiger-Daten, Fristen, Format der Mandatsreferenz (Spec Mitglieder und Lastschrift § 7.1).
  ...SEPA_SETTINGS,
];

/** Der Eintrag „Lastschrift“ (Handoff 2a § 1) — fest und, je nach Einstellung, aus `navigationFor`. */
/**
 * E6b: „Umsatzsteuer“ nach „Steuererklärung“ — nur, wenn der Verein heute umsatzsteuerlich Unternehmer ist (Designer
 * Umsatzsteuer 8). Fest ohne Recht (`[]` sieht niemand), `navigationFor` ersetzt den Eintrag an seiner Stelle mit
 * `finance.read`. Die Seite selbst ist immer erreichbar (§ 18 Abs. 4a UStG trifft jeden Verein; die Fristen verlinken).
 */
const VAT_NAV: NavigationItem = { key: 'finance.vat', href: '/finance/vat', icon: 'euro', group: 'finance', section: 'finance.accountability', permission: [] };

const DIRECT_DEBIT_NAV: NavigationItem = { key: 'finance.directDebit', href: '/finance/direct-debit', icon: 'euro', group: 'finance', section: 'finance.entries', permission: 'finance.directDebit' };

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
    { href: '/finance/work/foreign', doc: 'finanzen/arbeitsliste' },
    { href: '/finance/work/vouchers', doc: 'finanzen/arbeitsliste' },
    { href: '/finance/work/rules', doc: 'finanzen/arbeitsliste' },
    { href: '/finance/work', doc: 'finanzen/arbeitsliste' },
    { href: '/finance/imports/format', doc: 'finanzen/csv-format-einrichten' },
    { href: '/finance/imports', doc: 'finanzen/kontoauszug-laden' },
    { href: '/finance/entries', doc: 'finanzen/buchen' },
    { href: '/finance/accounts', doc: 'finanzen/konten-und-offene-zahlungen' },
    { href: '/finance/open-items', doc: 'finanzen/konten-und-offene-zahlungen' },
    { href: '/finance/direct-debit/runs', doc: 'finanzen/einzug' },
    { href: '/finance/direct-debit/mandates', doc: 'finanzen/mandate' },
    { href: '/finance/direct-debit/pledges', doc: 'finanzen/dauerspenden' },
    { href: '/finance/direct-debit', doc: 'finanzen/einzug' },
    { href: '/finance/cash', doc: 'finanzen/barkasse' },
    { href: '/finance/donations/run', doc: 'finanzen/spenden' },
    { href: '/finance/donations/book', doc: 'finanzen/spenden' },
    { href: '/finance/donations/notices', doc: 'finanzen/spenden' },
    { href: '/finance/donations', doc: 'finanzen/spenden' },
    { href: '/finance/expenses/new', doc: 'finanzen/auslagen' },
    { href: '/finance/expenses', doc: 'finanzen/auslagen' },
    { href: '/finance/approvals', doc: 'finanzen/auslagen' },
    { href: '/finance/partners', doc: 'finanzen/partner' },
    { href: '/finance/purposes', doc: 'finanzen/zwecke-und-ruecklagen' },
    { href: '/finance/reserves', doc: 'finanzen/zwecke-und-ruecklagen' },
    { href: '/finance/people', doc: 'finanzen/personen' },
    { href: '/finance/closing/handover', doc: 'finanzen/amtsuebergabe' },
    { href: '/finance/closing', doc: 'finanzen/jahresabschluss' },
    { href: '/finance/deadlines', doc: 'finanzen/fristen-und-schwellen' },
    { href: '/finance/audit', doc: 'finanzen/kassenpruefung' },
    { href: '/finance/reports', doc: 'finanzen/berichte' },
    { href: '/finance/fund-use', doc: 'finanzen/berichte' },
    { href: '/finance/other-assets', doc: 'finanzen/berichte' },
    { href: '/finance/tax', doc: 'finanzen/steuererklaerung' },
    { href: '/finance/vat', doc: 'finanzen/umsatzsteuer' },
    { href: '/admin/finance', doc: 'finanzen/einrichten' },
  ],
  navigation: [
    // Sechs Gruppen (Designer Stufe 2 Nr. 12, Nachtrag 2026-10-16): Arbeit · Buchungen · Zweckmittel · Spenden · Auslagen ·
    // Beteiligte. Reihenfolge der Gruppen = erstes Auftreten; Einträge, Rechte und Routen unverändert. Eine Gruppe ohne
    // sichtbaren Eintrag fällt samt Kopf weg (`sectionsFor`).
    // Arbeit folgt dem Tageslauf: hochladen, zuordnen, Regeln pflegen.
    { key: 'finance.work', href: '/finance/work', icon: 'euro', group: 'finance', section: 'finance.work', permission: 'finance.read' },
    { key: 'finance.workForeign', href: '/finance/work/foreign', icon: 'euro', group: 'finance', section: 'finance.work', permission: 'finance.read' },
    { key: 'finance.workVouchers', href: '/finance/work/vouchers', icon: 'euro', group: 'finance', section: 'finance.work', permission: 'finance.read' },
    { key: 'finance.imports', href: '/finance/imports', icon: 'euro', group: 'finance', section: 'finance.work', permission: 'finance.read' },
    { key: 'finance.rules', href: '/finance/work/rules', icon: 'euro', group: 'finance', section: 'finance.work', permission: 'finance.read' },
    // Buchungen: offene Zahlungen direkt hinter dem Journal, danach die Kontenseiten.
    { key: 'finance.entries', href: '/finance/entries', icon: 'euro', group: 'finance', section: 'finance.entries', permission: 'finance.read' },
    { key: 'finance.openItems', href: '/finance/open-items', icon: 'euro', group: 'finance', section: 'finance.entries', permission: 'finance.read' },
    // Handoff 2a § 1: Lastschrift nach „Offene Zahlungen“. Fest nur mit dem Recht zum Vorbereiten; ist die Lastschrift
    // eingeschaltet, sehen sie auch die Lesenden (`navigationFor` ersetzt den Eintrag an seiner Stelle).
    DIRECT_DEBIT_NAV,
    { key: 'finance.accounts', href: '/finance/accounts', icon: 'euro', group: 'finance', section: 'finance.entries', permission: 'finance.read' },
    { key: 'finance.cash', href: '/finance/cash', icon: 'euro', group: 'finance', section: 'finance.entries', permission: 'finance.read' },
    // Zweckmittel: Geld nach Zweck. Zwecke sieht auch, wer nur `finance.overview` hat (F8b Annahme 13).
    { key: 'finance.purposes', href: '/finance/purposes', icon: 'euro', group: 'finance', section: 'finance.allocation', permission: ['finance.read', 'finance.overview'] },
    { key: 'finance.reserves', href: '/finance/reserves', icon: 'euro', group: 'finance', section: 'finance.allocation', permission: 'finance.read' },
    { key: 'finance.donations', href: '/finance/donations', icon: 'euro', group: 'finance', section: 'finance.donations', permission: 'finance.read' },
    { key: 'finance.donationRun', href: '/finance/donations/run', icon: 'euro', group: 'finance', section: 'finance.donations', permission: 'finance.read' },
    { key: 'finance.donationBook', href: '/finance/donations/book', icon: 'euro', group: 'finance', section: 'finance.donations', permission: 'finance.read' },
    { key: 'finance.donationNotices', href: '/finance/donations/notices', icon: 'euro', group: 'finance', section: 'finance.donations', permission: 'finance.read' },
    // Auslagen bleibt eine eigene Gruppe: Wer nur einreicht, sieht genau sie.
    { key: 'finance.expenses', href: '/finance/expenses', icon: 'euro', group: 'finance', section: 'finance.expenses', permission: 'finance.expensesSubmit' },
    { key: 'finance.approvals', href: '/finance/approvals', icon: 'euro', group: 'finance', section: 'finance.expenses', permission: 'finance.approve' },
    // Beteiligte: die Gegenüber — Partner und Personen.
    { key: 'finance.partners', href: '/finance/partners', icon: 'euro', group: 'finance', section: 'finance.parties', permission: 'finance.read' },
    { key: 'finance.people', href: '/finance/people', icon: 'euro', group: 'finance', section: 'finance.parties', permission: 'finance.read' },
    // Rechenschaft (Spec 0.4.0 § Navigation, Schnitt nach dem Designer): Jahresabschluss, Steuererklärung,
    // Fristen und Schwellen kommen später; die Mittelverwendung steht schon da, gedämpft (N1).
    // Kassenprüfung (D1): lesen mit `finance.read` oder `finance.audit`; Prüfer sehen die Navigation nach ihren Rechten.
    { key: 'finance.closing', href: '/finance/closing', icon: 'euro', group: 'finance', section: 'finance.accountability', permission: 'finance.read' },
    { key: 'finance.audit', href: '/finance/audit', icon: 'euro', group: 'finance', section: 'finance.accountability', permission: ['finance.read', 'finance.audit'] },
    { key: 'finance.reports', href: '/finance/reports', icon: 'euro', group: 'finance', section: 'finance.accountability', permission: ['finance.read', 'finance.overview', 'finance.audit'] },
    { key: 'finance.otherAssets', href: '/finance/other-assets', icon: 'euro', group: 'finance', section: 'finance.accountability', permission: ['finance.read', 'finance.overview'] },
    { key: 'finance.tax', href: '/finance/tax', icon: 'euro', group: 'finance', section: 'finance.accountability', permission: 'finance.read' },
    VAT_NAV,
    { key: 'finance.deadlines', href: '/finance/deadlines', icon: 'euro', group: 'finance', section: 'finance.accountability', permission: ['finance.read', 'finance.overview'] },
    { key: 'finance.fundUse', href: '/finance/fund-use', icon: 'euro', group: 'finance', section: 'finance.accountability', permission: ['finance.read', 'finance.overview'], later: true },
  ],
  navigationFor: (deps) => [
    ...(readSetting<boolean>(deps, 'finance.sepa.enabled') ? [{ ...DIRECT_DEBIT_NAV, permission: ['finance.read', 'finance.directDebit'] }] : []),
    ...(vatMenuShownInternal(deps.db, todayIn(deps)) ? [{ ...VAT_NAV, permission: 'finance.read' }] : []),
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
    // F6a: unser Exemplar und die unterschriebene Fassung einer Bestätigung, das Dokument eines Bescheids.
    { entityType: 'financeConfirmation', readPermission: 'finance.read', receivePermission: 'finance.donationsIssue' },
    { entityType: 'financeNotice', readPermission: 'finance.read', receivePermission: 'finance.donationsIssue' },
    // F8a: Belege und Verzichtserklärung am Antrag — die einreichende Person legt ab, ohne Recht der Akte. Ihre eigenen
    // liest sie über den Dienst (Eigentümer-Weg), alle anderen brauchen finance.read.
    { entityType: 'financeExpenseClaim', readPermission: 'finance.read', receivePermission: 'finance.expensesSubmit' },
    // F7: Registernachweis und Rahmenvereinbarung am Partner, Nachweise am Vorgang.
    { entityType: 'financePartner', readPermission: 'finance.read', receivePermission: 'finance.entriesWrite' },
    { entityType: 'financePartnerPayment', readPermission: 'finance.read', receivePermission: 'finance.entriesWrite' },
    // F8b: der Beschluss (Protokoll), im Namen des zurückgelegten Geldes hochgeladen — auch für seine Vorgänge (Annahme 11).
    { entityType: 'financeReserve', readPermission: 'finance.read', receivePermission: 'finance.entriesWrite' },
    { entityType: 'financePurposeTransfer', readPermission: 'finance.read', receivePermission: 'finance.entriesWrite' },
    // L1: Formular und unterschriebene Fassung am Mandat.
    { entityType: 'financeMandate', readPermission: 'finance.read', receivePermission: 'finance.directDebit' },
    // L2: der Begleitzettel am Einzug.
    { entityType: 'financeDirectDebitRun', readPermission: 'finance.read', receivePermission: 'finance.directDebit' },
    // Rechenschaft A1: die festgeschriebene Fassung eines Berichts — ausgestellt nur beim Festschreiben.
    { entityType: 'financeReport', readPermission: 'finance.read', receivePermission: 'finance.reportsFinalize' },
    // Rechenschaft A3: der Scan des Prüfberichts am Geschäftsjahr — abgelegt, wer das Jahr abschließt.
    { entityType: 'financeFiscalYear', readPermission: 'finance.read', receivePermission: 'finance.periodClose' },
    // Rechenschaft D1: die Vertraulichkeitserklärung am Prüfer — abgelegt, wer die Prüfer pflegt.
    { entityType: 'financeAuditor', readPermission: 'finance.read', receivePermission: 'finance.periodClose' },
    // Rechenschaft D1: der unterschriebene Scan am Prüfbericht — ablegen dürfen auch die Prüfer (der Dienst prüft „Bearbeiter“).
    { entityType: 'financeAuditReport', readPermission: 'finance.read', receivePermission: 'finance.audit' },
    // Rechenschaft C Schritt 1: der Kontoauszug der Bank als PDF am Konto — ablegen darf, wer bucht.
    { entityType: 'financeAccount', readPermission: 'finance.read', receivePermission: 'finance.entriesWrite' },
    // Rechenschaft C: das unterschriebene Übergabeprotokoll an der Amtsübergabe.
    { entityType: 'financeHandover', readPermission: 'finance.read', receivePermission: 'finance.setup' },
    // Rechenschaft D2: Aufforderung, abgegebene Erklärung, Übertragungsprotokoll und Tätigkeitsbericht am Erklärungszeitraum.
    { entityType: 'financeTaxPeriod', readPermission: 'finance.read', receivePermission: 'finance.periodClose' },
    // E6b: abgegebene Fassung und ELSTER-Übertragungsprotokoll an der Abgabe einer Umsatzsteuer-Anmeldung.
    { entityType: 'financeVatFiling', readPermission: 'finance.read', receivePermission: 'finance.periodClose' },
  ],
  // F6b: der vereinfachte Nachweis — `filed: false`, ein Vordruck auf Abruf.
  documentTemplates: [cashCountTemplate, moneyConfirmationTemplate, inKindConfirmationTemplate, collectiveConfirmationTemplate, simplifiedReceiptTemplate, waiverDeclarationTemplate, mandateFormTemplate, prenotificationTemplate, runSummaryTemplate, reportTemplate, reportPersonalTemplate, auditReportPrintTemplate, auditFolderTemplate, handoverPrintTemplate],
  documentBases: ['a4-formular', 'a4-mit-briefkopf', 'a4-plain-slim', 'a4-quer-plain-slim'],
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
    // Rechenschaft C: wer die Kasse führt — Vorschlag „Von“ der Amtsübergabe, Person der Entlastung.
    { key: 'treasurer', retention: 'none' },
  ],
  seed: seedFinance,
  install: installFinance,
  /** Rechenschaft B2: ein Datenexport bleibt 30 Tage, dann löscht Kompass das ZIP. */
  housekeeping: (deps) => sweepDataExports(deps).then(() => undefined),
  retentionHolds: financeRetentionHolds,
  recordReferences: financeRecordReferences,
  recordDeleted: financeRecordDeleted,
  /** Versandvermerk der Akte am Dokument einer Bestätigung → Bestätigung versandt (Plan E1, Nacharbeit). */
  documentDispatched: financeDocumentDispatched,
  retentionDue: financeRetentionDue,
  /**
   * Aktionen des Änderungsprotokolls mit ihren Werten (Spec Protokoll § 3). Strenger als die übrigen Module (Spec
   * 10.3): nie eine Kontakt-ID (`financeAudit` wirft), nie ein Name, eine Begründung oder ein Verwendungszweck — nur
   * Nummern, Jahre, Zähler, Codes und Schalter. Eine ID, die nur den Datensatz wiederholt, ist kein Wert (die
   * Spalte „Objekt“ nennt ihn).
   */
  auditActions: {
    'finance.account.create': { params: [] },
    'finance.account.delete': { params: [] },
    'finance.account.setActive': { params: ['active'] },
    // Rechenschaft C — Kontoauszüge je Konto und Jahr.
    'finance.account.statementFile': { params: ['designation', 'documentNumber'] },
    'finance.account.statementLink': { params: ['designation', 'documentNumber'] },
    'finance.account.yearConfirm': { params: ['designation', 'kind'] },
    // Rechenschaft C — Jahresabschluss.
    'finance.closing.confirm': { params: ['designation', 'step'] },
    'finance.assembly.save': { params: ['designation', 'dischargeMode', 'granted', 'open'] },
    'finance.assembly.minutesFile': { params: ['designation', 'documentNumber'] },
    'finance.audit.carryOver': { params: ['designation', 'count'] },
    'finance.vatReturn.filed': { params: ['designation', 'filedOn'] },
    'finance.vatFiling.record': { params: ['period', 'filedOn', 'amendment'] },
    'finance.vatFiling.update': { params: ['period', 'filedOn'] },
    'finance.vatFiling.documentFile': { params: ['period', 'slot'] },
    'finance.vatFiling.documentLink': { params: ['period', 'slot'] },
    // Rechenschaft D2 — Erklärungszeitraum: der Zeitraum als Bezeichnung („2023–2025“), nie die Angaben.
    'finance.taxPeriod.create': { params: ['first', 'last', 'dueOn'] },
    'finance.taxPeriod.update': { params: ['period'] },
    'finance.taxPeriod.answers': { params: ['period'] },
    'finance.taxPeriod.documentFile': { params: ['period', 'slot', 'documentNumber'] },
    'finance.taxPeriod.documentLink': { params: ['period', 'slot', 'documentNumber'] },
    'finance.taxPeriod.filed': { params: ['period', 'filedOn'] },
    'finance.taxPeriod.noticeLink': { params: ['period'] },
    'finance.handover.start': { params: ['handoverOn'] },
    // Rechenschaft B2 — Datenexport für eine Außenprüfung: Jahre als Bezeichnungen, nie Namen oder Dateinamen.
    'finance.dataExport.create': { params: ['years', 'provisional'] },
    'finance.dataExport.download': { params: ['years'] },
    'finance.dataExport.expire': { params: ['years'] },
    'finance.handover.update': { params: ['handoverOn'] },
    'finance.handover.cancel': { params: ['handoverOn'] },
    'finance.handover.interimReport': { params: ['handoverOn', 'shortHash'] },
    'finance.handover.cashCount': { params: ['handoverOn', 'documentNumber'] },
    'finance.handover.items': { params: ['handoverOn', 'checked', 'total'] },
    'finance.handover.protocolFile': { params: ['handoverOn', 'documentNumber'] },
    'finance.account.update': { params: [] },
    'finance.cashCount.record': { params: ['documentNumber'] },
    'finance.category.create': { params: [] },
    'finance.category.delete': { params: [] },
    'finance.category.setActive': { params: ['active'] },
    'finance.category.update': { params: [] },
    'finance.confirmation.dispatch': { params: ['documentNumber'] },
    'finance.confirmation.issue': { params: ['documentNumber'] },
    'finance.confirmation.recall': { params: ['documentNumber'] },
    'finance.confirmation.signed': { params: ['signedNumber', 'documentNumber'] },
    'finance.confirmation.void': { params: ['documentNumber'] },
    'finance.confirmationRun.dispatch': { params: ['year', 'count'] },
    'finance.confirmationRun.finish': { params: ['year'] },
    'finance.confirmationRun.mail': { params: ['year', 'count'] },
    'finance.confirmationRun.item': { params: ['issued'] },
    'finance.confirmationRun.start': { params: ['year'] },
    'finance.confirmationRun.toPost': { params: ['year', 'count'] },
    'finance.confirmationRun.toEmail': { params: ['year', 'count'] },
    'finance.contactIban.delete': { params: ['withContact'] },
    'finance.contactIban.link': { params: [] },
    'finance.contactWaiverTerms.delete': { params: [] },
    'finance.contactWaiverTerms.save': { params: [] },
    'finance.contactTaxDetails.save': { params: [] },
    'finance.contactTaxDetails.delete': { params: [] },
    'finance.contactTaxDetails.reverseChargeDecline': { params: ['reason'] },
    'finance.contactTaxDetails.reverseChargeAsk': { params: [] },
    'finance.correction.apply': { params: ['taxCode', 'serviceOn'] },
    'finance.correction.reject': { params: [] },
    'finance.correction.request': { params: ['taxCode', 'serviceOn'] },
    'finance.datedValue.remove': { params: ['key', 'fromOn'] },
    'finance.datedValue.set': { params: ['key', 'fromOn'] },
    'finance.entry.documentAdd': { params: [] },
    'finance.entry.documentGone': { params: [] },
    'finance.entry.documentRevoke': { params: [] },
    'finance.entry.draftDelete': { params: [] },
    'finance.entry.draftSave': { params: [] },
    'finance.entry.finalize': { params: ['number'] },
    'finance.entry.justify': { params: ['number'] },
    'finance.entry.notReturn': { params: ['number', 'notReturn'] },
    'finance.entry.rawLink': { params: ['number'] },
    'finance.entry.reverse': { params: ['number', 'reversalNumber'] },
    'finance.entry.review': { params: ['reviewed'] },
    'finance.expenseClaim.approve': { params: ['number', 'waiver'] },
    'finance.expenseClaim.copy': { params: ['sourceNumber'] },
    'finance.expenseClaim.draftDelete': { params: ['withContact'] },
    'finance.expenseClaim.reject': { params: ['number'] },
    'finance.expenseClaim.saveDraft': { params: [] },
    'finance.expenseClaim.submit': { params: ['number'] },
    'finance.expenseClaim.waiverDeclaration': { params: ['documentNumber', 'number'] },
    'finance.expenseClaim.waiverSigned': { params: ['documentNumber', 'number'] },
    'finance.expensePosition.categorize': { params: ['position', 'number'] },
    'finance.expensePosition.receipt': { params: ['documentNumber', 'position', 'number'] },
    'finance.fiscalYear.autoCreate': { params: ['designation'] },
    'finance.fiscalYear.create': { params: ['designation'] },
    'finance.fiscalYear.update': { params: ['designation'] },
    'finance.import.candidateDecide': { params: ['decision'] },
    'finance.import.discard': { params: [] },
    'finance.import.fail': { params: ['failureCode'] },
    'finance.import.run': { params: [] },
    'finance.import.runBalance': { params: [] },
    'finance.importProfile.save': { params: [] },
    'finance.importRule.delete': { params: [] },
    // L1 — Mandate nennen ihre Referenz; Grund und Feld sind Codes.
    'finance.mandate.prepare': { params: ['reference'] },
    'finance.mandate.correct': { params: ['reference'] },
    'finance.mandate.activate': { params: ['reference', 'signedOn'] },
    'finance.mandate.amend': { params: ['reference', 'field'] },
    'finance.mandate.end': { params: ['reference', 'reason'] },
    'finance.mandate.form': { params: ['reference', 'documentNumber'] },
    // L1 — Zusagen ohne Betrag und ohne Spender in den Werten.
    'finance.pledge.save': { params: [] },
    'finance.pledge.pause': { params: ['fromOn', 'untilOn'] },
    'finance.pledge.end': { params: ['endedOn'] },
    // Plan N1 (M14): Raten, die sich beim Anlegen nicht mehr rechtzeitig ankündigen ließen.
    'finance.pledge.skipRates': { params: ['count'] },
    // L2 — Ankündigung und Einzug: Referenz, Tage, Zahlen; nie Zahler oder IBAN.
    'finance.prenotification.issue': { params: ['reference', 'count'] },
    'finance.directDebit.create': { params: ['collectionOn', 'count', 'sumCents'] },
    'finance.directDebit.removeItem': { params: ['collectionOn'] },
    'finance.directDebit.file': { params: ['collectionOn', 'count'] },
    'finance.directDebit.submit': { params: ['collectionOn'] },
    'finance.directDebit.resetSubmit': { params: ['collectionOn'] },
    'finance.directDebit.cancel': { params: ['collectionOn'] },
    // L3 — Rückgabe klären: Weg und Rückgabe-Code der Bank; nie Zahler oder Betrag.
    'finance.directDebit.returnResolve': { params: ['resolution', 'returnCode'] },
    'finance.importRule.save': { params: [] },
    'finance.inKindDetails.save': { params: ['created'] },
    'finance.notice.document': { params: ['documentNumber'] },
    'finance.notice.save': { params: ['created'] },
    'finance.notice.supersede': { params: ['supersededOn'] },
    'finance.notice.void': { params: [] },
    'finance.openItem.cancel': { params: [] },
    'finance.openItem.create': { params: [] },
    'finance.openItem.reschedule': { params: [] },
    'finance.openItem.reduce': { params: ['amountCents'] },
    'finance.openItem.update': { params: [] },
    'finance.partnerEvidence.add': { params: ['paymentNumber', 'way'] },
    'finance.partnerEvidence.documentGone': { params: [] },
    'finance.partnerEvidence.remove': { params: [] },
    'finance.partnerEvidence.update': { params: [] },
    'finance.partnerNotice.save': { params: ['created'] },
    'finance.partnerNotice.void': { params: [] },
    'finance.partnerPayment.acknowledge': { params: ['number'] },
    'finance.partnerPayment.approve': { params: ['number'] },
    'finance.partnerPayment.copy': { params: ['sourceNumber'] },
    'finance.partnerPayment.draftDelete': { params: ['withContact'] },
    'finance.partnerPayment.reject': { params: [] },
    'finance.partnerPayment.saveDraft': { params: [] },
    'finance.partnerPayment.submit': { params: [] },
    'finance.partnerProfile.delete': { params: ['withContact'] },
    'finance.partnerProfile.save': { params: ['created'] },
    'finance.partnerProfile.setActive': { params: ['active'] },
    'finance.period.close': { params: ['designation'] },
    'finance.period.reopen': { params: ['designation'] },
    'finance.report.finalize': { params: ['reportKey', 'documentNumber'] },
    'finance.report.void': { params: ['reportKey', 'documentNumber'] },
    'finance.report.release': { params: ['designation', 'basis'] },
    'finance.report.releaseRevoke': { params: ['designation'] },
    // Rechenschaft D1 — Kassenprüfung: Codes und Nummern, nie Namen oder Text.
    'finance.audit.baseline.create': { params: ['designation', 'kind'] },
    'finance.audit.auditor.save': { params: ['mode'] },
    'finance.audit.auditor.remove': { params: ['mode'] },
    'finance.audit.auditor.accessEnd': { params: [] },
    'finance.audit.auditor.confidentiality': { params: ['documentNumber'] },
    'finance.audit.report.create': { params: ['designation', 'kind'] },
    'finance.audit.report.examination': { params: ['designation', 'kind'] },
    'finance.audit.report.result': { params: ['designation', 'kind'] },
    'finance.audit.report.deviation': { params: ['designation', 'kind'] },
    'finance.audit.report.signatures': { params: ['designation', 'kind', 'mode'] },
    'finance.audit.report.ready': { params: ['designation', 'kind'] },
    'finance.audit.report.readyRevoke': { params: ['designation', 'kind'] },
    'finance.audit.report.print': { params: ['designation', 'kind', 'blank'] },
    'finance.audit.report.file': { params: ['designation', 'kind', 'scans', 'expected'] },
    'finance.audit.remark.create': { params: ['kind'] },
    'finance.audit.remark.answer': { params: ['kind'] },
    'finance.audit.remark.followUp': { params: ['kind'] },
    'finance.audit.remark.resolve': { params: ['kind'] },
    'finance.audit.sample.set': { params: ['number'] },
    'finance.audit.sample.unset': { params: ['number'] },
    'finance.audit.section.review': { params: ['section'] },
    'finance.audit.section.unreview': { params: ['section'] },
    'finance.otherAsset.save': { params: ['kind'] },
    'finance.otherAsset.end': { params: ['kind'] },
    'finance.otherAsset.revalue': { params: ['kind'] },
    'finance.projectSettings.delete': { params: [] },
    'finance.projectSettings.set': { params: [] },
    'finance.purpose.create': { params: [] },
    'finance.purpose.delete': { params: [] },
    'finance.purpose.dissolve': { params: [] },
    'finance.purpose.fulfill': { params: [] },
    'finance.purpose.reopen': { params: [] },
    'finance.purpose.setActive': { params: ['active'] },
    'finance.purpose.update': { params: [] },
    'finance.purposeTransfer.approve': { params: ['number'] },
    'finance.purposeTransfer.documentGone': { params: ['number'] },
    'finance.purposeTransfer.reject': { params: ['number'] },
    'finance.purposeTransfer.request': { params: ['number'] },
    'finance.reserve.carryForward': { params: [] },
    'finance.reserve.delete': { params: [] },
    'finance.reserve.documentGone': { params: ['carryForward'] },
    'finance.reserve.linkResolution': { params: [] },
    'finance.reserve.save': { params: ['created'] },
    'finance.reserve.setActive': { params: ['active'] },
    'finance.reserve.uploadResolution': { params: ['documentNumber'] },
    'finance.reserveMovement.documentGone': { params: [] },
    'finance.reserveMovement.record': { params: [] },
    'finance.setup.applyTaxDefaults': { params: [] },
    'finance.setup.boardRemuneration': { params: [] },
    'finance.setup.confirm': { params: ['step'] },
    'finance.setup.documentTypeProtectionArea': { params: [] },
    'finance.setup.limit': { params: ['key'] },
    'finance.setup.switch': { params: ['key'] },
    'finance.setup.waiverBasis': { params: [] },
    'finance.signer.facsimile': { params: [] },
    'finance.signer.save': { params: ['created'] },
    // Über `writeSettingInternal`: der Schlüssel der Einstellung.
    'finance.setup.setting': { params: ['key'] },
    'finance.notice': { params: ['key'] },
    'settings.financeMainAccount': { params: ['key'] },
  },
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
    {
      entity: 'financeNotReturnMark',
      deletable: false,
      reason: 'Festgeschriebenes wird nie gelöscht. Nach Ablauf der Frist werden die personenbezogenen Inhalte des Geschäftsjahres entfernt — Kontakt, Freitext —; Datum, Betrag, Nummer und Kategorie bleiben als Rechenschaft.',
    },
    { entity: 'financeProjectSettings', deletable: true, reason: 'Geht mit dem Projekt — kein eigener Nachweis.', guard: 'keiner; verschwindet mit dem Projekt', auditAction: 'finance.projectSettings.delete' },
    {
      entity: 'financeCashCount',
      deletable: false,
      reason: 'Eine Kassenzählung ist eine gespeicherte Tatsache für die Kontenabstimmung (Spec 5.5) und wird nie gelöscht.',
    },
    // Rechenschaft A1 — Berichte (Spec Rechenschaft 0.4.0 § A).
    { entity: 'financeReport', deletable: false, reason: 'Was der Mitgliederversammlung oder dem Finanzamt vorgelegt wurde, ist Beweismittel. Eine festgeschriebene Fassung wird storniert — beim Wiederöffnen des Jahres oder durch eine neue Fassung —, ihr Dokument bleibt lesbar in der Akte.' },
    { entity: 'financeOtherAsset', deletable: false, reason: 'Sonstiges Vermögen steht in festgeschriebenen Berichten zu früheren Stichtagen. Ein Eintrag wird beendet oder mit einem neuen Wert fortgeschrieben, nie gelöscht.' },
    // Rechenschaft D1 — Kassenprüfung.
    { entity: 'financeAuditBaseline', deletable: false, reason: 'Der Prüfstand hält fest, was die Kassenprüfer geprüft haben; Stichproben, Vermerke und der Prüfbericht beziehen sich auf ihn.' },
    { entity: 'financeAuditReport', deletable: false, reason: 'Der Prüfbericht und sein Scan sind die Rechenschaft der Kassenprüfer gegenüber der Mitgliederversammlung; ein Entwurf bleibt, auch wenn er nie abgelegt wird.' },
    { entity: 'financeAuditRemark', deletable: false, reason: 'Fragen und Feststellungen der Kassenprüfer und die Antworten darauf sind Teil der Prüfung; sie werden geklärt, nie gelöscht.' },
    { entity: 'financeAuditSample', deletable: true, reason: 'Ein Haken des Prüfers an seiner Arbeit; er nimmt ihn selbst wieder weg. Wann er ihn setzte und wegnahm, steht im Änderungsprotokoll.', guard: 'nur der Prüfer selbst, in der Oberfläche', auditAction: 'finance.audit.sample.unset' },
    { entity: 'financeAuditSectionReview', deletable: true, reason: 'Ein Haken des Prüfers an seiner Arbeit; er nimmt ihn selbst wieder weg. Wann er ihn setzte und wegnahm, steht im Änderungsprotokoll.', guard: 'nur der Prüfer selbst, in der Oberfläche', auditAction: 'finance.audit.section.unreview' },
    { entity: 'financeAuditAuditor', deletable: true, reason: 'Arbeitsmaterial, solange der Prüfer nichts in der Prüfung hinterlassen hat; wer wann eingetragen und ausgetragen wurde, steht im Änderungsprotokoll.', guard: 'nur ohne Vermerke, Stichproben, durchgesehene Abschnitte und Beiträge zum Prüfbericht', auditAction: 'finance.audit.auditor.remove' },
    { entity: 'financeAssemblyResult', deletable: false, reason: 'Das Ergebnis der Mitgliederversammlung mit den Entlastungen ist ein Beschluss; ein Nachtrag ändert es, gelöscht wird es nie.' },
    { entity: 'financeTaxPeriod', deletable: false, reason: 'Der Erklärungszeitraum hält fest, welche Jahre dem Finanzamt erklärt wurden, wann und mit welcher Fassung; § 153 AO und der Bescheid beziehen sich auf ihn.' },
    { entity: 'financeVatFiling', deletable: false, reason: 'Dass und wann eine Umsatzsteuer-Voranmeldung oder -Jahreserklärung abgegeben wurde, gehört zur Rechenschaft gegenüber dem Finanzamt.' },
    { entity: 'financeHandover', deletable: false, reason: 'Die Amtsübergabe ist die Rechenschaft des bisherigen Schatzmeisters (§§ 666, 667 BGB); eine abgebrochene bleibt als Zustand.' },
    { entity: 'financeReportRelease', deletable: false, reason: 'Die Freigabe zum Festschreiben wird beim Wiederöffnen des Jahres widerrufen, nicht gelöscht; wer sie wann mit welcher Begründung erteilt hat, steht im Änderungsprotokoll.' },
    // F6a — Spenden (Spec 10.3, Annahme 14).
    { entity: 'financeNotice', deletable: false, reason: 'Bescheide sind eine datierte Reihe: Bestätigungen berufen sich auf sie. Ein falscher Bescheid wird als irrtümlich erfasst gekennzeichnet, ein neuer ersetzt den alten.' },
    { entity: 'financeSigner', deletable: false, reason: 'Wer maschinell erstellte Bestätigungen unterzeichnet hat, bleibt nachvollziehbar; ein Amtsende beendet den Zeitraum.' },
    {
      entity: 'financeConfirmation',
      deletable: false,
      reason: 'Eine ausgestellte Zuwendungsbestätigung wird nie gelöscht, nur zurückgenommen — mit Rückholspur. Nach Ablauf der Frist wird der Personenbezug des Geschäftsjahres entfernt; Nummer, Datum und Betrag bleiben.',
    },
    { entity: 'financeConfirmationRun', deletable: false, reason: 'Der Lauf ist die Tatsache, wer wann was ausgestellt hat. Seine Bestätigungen werden einzeln zurückgenommen, der Lauf bleibt.' },
    { entity: 'financeConfirmationRunItem', deletable: false, reason: 'Der Lauf ist die Tatsache, wer wann was ausgestellt hat — der Posten sagt, für wen was ausgestellt wurde oder warum nicht.' },
    { entity: 'financeConfirmationLine', deletable: false, reason: 'Welche Zuwendung eine Bestätigung trägt, bleibt nachvollziehbar; eine Rücknahme gibt die Zeile frei, statt sie zu löschen.' },
    {
      entity: 'financeInKindDetails',
      deletable: false,
      reason: 'Die Angaben zur Sachspende hängen an einer festgeschriebenen Buchung. Nach Ablauf der Frist entfernt sie die Anonymisierung des Geschäftsjahres mit dem übrigen Freitext.',
    },
    // F8a — Auslagen (Spec 10.3, Annahme 14).
    { entity: 'financeExpenseClaimDraft', deletable: true, reason: 'Arbeitsmaterial ohne Nummer — erst das Einreichen macht einen Antrag rechenschaftsrelevant.', guard: 'nur solange state = draft', auditAction: 'finance.expenseClaim.draftDelete' },
    {
      entity: 'financeExpenseClaim',
      deletable: false,
      reason: 'Ein eingereichter Antrag wird nie gelöscht — freigegeben, abgelehnt oder offen, er ist der Nachweis der Erstattung. Nach Ablauf der Frist wird der Personenbezug entfernt; Nummer, Datum und Betrag bleiben.',
    },
    { entity: 'financeContactTaxDetails', deletable: true, reason: 'Arbeitsmaterial: Finanzamt, Steuernummer und Zweck einer Körperschaft; ein festgeschriebener Bericht trägt seine eigene Abschrift.', guard: 'keiner; geht mit dem Kontakt', auditAction: 'finance.contactTaxDetails.delete' },
    { entity: 'financeContactWaiverTerms', deletable: true, reason: 'Arbeitsmaterial: Der Antrag trägt seine eigene Abschrift der Anspruchsgrundlage.', guard: 'keiner; geht mit dem Kontakt', auditAction: 'finance.contactWaiverTerms.delete' },
    // F7 — Partner, Zahlungen an Partner, Nachweise (Spec 10.3, Annahme 15).
    { entity: 'financePartnerProfile', deletable: true, reason: 'Arbeitsmaterial ohne eigenen Nachweis, solange kein Vorgang und kein Bescheid daran hängt.', guard: 'nur ohne Vorgänge und ohne Bescheide', auditAction: 'finance.partnerProfile.delete' },
    { entity: 'financePartnerNotice', deletable: false, reason: 'Ein Bescheid des Partners ist eine datierte Reihe: Zahlungen berufen sich auf ihn. Ein falscher Bescheid wird als irrtümlich erfasst gekennzeichnet, ein neuer ersetzt den alten.' },
    { entity: 'financePartnerPaymentPosition', deletable: false, reason: 'Positionen gehören zum Vorgang; sie gehen nur mit seinem Entwurf.' },
    { entity: 'financePartnerPaymentDraft', deletable: true, reason: 'Arbeitsmaterial ohne Nummer — erst das Einreichen macht einen Vorgang rechenschaftsrelevant.', guard: 'nur solange state = draft', auditAction: 'finance.partnerPayment.draftDelete' },
    {
      entity: 'financePartnerPayment',
      deletable: false,
      reason: 'Ein eingereichter Vorgang wird nie gelöscht — freigegeben, abgelehnt oder wartend, er ist der Nachweis der Zahlung. Nach Ablauf der Frist wird der Personenbezug entfernt; Nummer, Datum und Betrag bleiben.',
    },
    { entity: 'financePartnerEvidence', deletable: true, reason: 'Arbeitsmaterial bis zum Anerkennen; danach ist der Nachweis Teil der Rechenschaft und bleibt als Grabstein.', guard: 'nur vor dem Anerkennen', auditAction: 'finance.partnerEvidence.remove' },
    // F8b — zurückgelegtes Geld, Zweck ändern (Umwidmung) (Spec 10.3, Annahme 14).
    { entity: 'financeReserve', deletable: true, reason: 'Arbeitsmaterial, solange kein Vorgang und kein Vortrag daran hängt.', guard: 'nur ohne Vorgänge und ohne Vortrag; sonst stilllegen', auditAction: 'finance.reserve.delete' },
    { entity: 'financeReserveMovement', deletable: false, reason: 'Ein Vorgang an zurückgelegtem Geld ist mit dem Beschluss die Rechenschaft, warum ein Bestand entstand oder wegging — er wird nie gelöscht.' },
    {
      entity: 'financePurposeTransfer',
      deletable: false,
      reason: 'Eine Umwidmung wird nie gelöscht — freigegeben, abgelehnt oder wartend, sie ist der Nachweis, warum sich ein Zweckbestand änderte. Nach Ablauf der Frist wird der Personenbezug entfernt; Nummer, Datum und Betrag bleiben.',
    },
    // L1 — Lastschrift (Trigger `finance_sepa_mandates_no_delete`, `finance_pledges_no_delete`).
    { entity: 'financeMandate', deletable: false, reason: 'Beleg der Einzüge; der Personenbezug fällt mit den Finanzdaten des Jahres weg.' },
    { entity: 'financePledge', deletable: false, reason: 'Vorgang, an dem Spenden hängen; der Personenbezug fällt mit den Finanzdaten weg.' },
    // L2 — Einzug und Ankündigung (Trigger `finance_direct_debit_runs_no_delete`, `…_items_no_delete`, `finance_sepa_prenotifications_no_delete`).
    { entity: 'financeDirectDebitRun', deletable: false, reason: 'Vorgang einer Einreichung bei der Bank; wird storniert, nie gelöscht. Der Begleitzettel in der Akte ist Beleg der Sammelbuchung.' },
    { entity: 'financeDirectDebitItem', deletable: false, reason: 'Posten eines Einzugs; herausgenommen wird er mit Zeitpunkt, damit die Referenz der Bank auffindbar bleibt.' },
    { entity: 'financePrenotification', deletable: false, reason: 'Nachweis, dass ein Einzug rechtzeitig angekündigt war.' },
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
  followUpTargets: (deps, entityType, id): FollowUpTargetInput | null => {
    if (entityType === 'financeTaxPeriod') {
      // Rechenschaft D2: die Wiedervorlage am Erklärungszeitraum (Hinweise des Bescheids) führt auf die Seite „Steuererklärung“.
      const period = taxPeriodInternal(deps.db, id);
      return period ? { label: { key: 'finance.records.taxPeriod', params: { period: period.label } }, href: `/finance/tax?period=${id}` } : null;
    }
    if (entityType !== 'financeFiscalYear') return null;
    const year = deps.db.select({ designation: financeFiscalYears.designation }).from(financeFiscalYears).where(eq(financeFiscalYears.id, id)).get();
    if (!year) return null;
    // Rechenschaft C: die Wiedervorlage am Jahr führt in den Jahresabschluss.
    return { label: { key: 'finance.records.fiscalYear', params: { designation: year.designation } }, href: `/finance/closing?year=${id}` };
  },
  recordLabels: financeRecordLabels,
});
