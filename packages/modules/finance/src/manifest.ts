import { defineModule, type ModuleManifest, type SettingDefinition } from '@kompass/core';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { FINANCE_DASHBOARD_TILES } from './dashboard';
import { cashCountTemplate } from './ledger/cash-count-template';
import { confirmationContactLock, confirmationEntryLock } from './donations/locks';
import { partnerPaidLineContactLock, partnerPaidLineEntryLock, partnerPayingEntryLock } from './allocation/locks';
import { collectiveConfirmationTemplate } from './donations/templates/collective';
import { inKindConfirmationTemplate } from './donations/templates/in-kind';
import { moneyConfirmationTemplate } from './donations/templates/money';
import { simplifiedReceiptTemplate } from './donations/templates/simplified';
import { waiverDeclarationTemplate } from './allocation/templates/waiver-declaration';
import { financeRecordDeleted, financeRecordReferences, financeRetentionDue, financeRetentionHolds } from './ledger/holds';
import { installFinance } from './install';
import { registerEntryLocks } from './locks';
import { financeRecordLabels } from './ledger/record-labels';
import { FINANCE_MCP_TOOLS } from './mcp-tools';
import { FINANCE_PERMISSIONS } from './permissions';
import { seedFinance } from './seed';
import { financeEntries, financeFiscalYears } from './schema';

export { FINANCE_PERMISSIONS } from './permissions';

// F6a Task 5 (Spec 5.4): Eine gültige Bestätigung sperrt Storno und Kontaktkorrektur ihrer Buchung.
// `ledger/` kennt `donations/` nicht — die Verdrahtung steht hier, wo jedes Bundle sie lädt.
registerEntryLocks([confirmationEntryLock, confirmationContactLock]);
// F7 Task 4 (Spec 8.1, Annahme 15): eine nachträglich zugeordnete Zeile, oder die zahlende Buchung nach dem Anerkennen.
registerEntryLocks([partnerPaidLineEntryLock, partnerPaidLineContactLock, partnerPayingEntryLock]);

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
  // A1: Freitexte (Anspruchsgrundlage, Vergütungsgrundlage) protokolliert der Kern nur als „geändert“ — sie können
  // Namen und Beschlüsse tragen, und das Protokoll ist unlöschbar. Listen wie `cashKeywords` und `voucherTypes` sind
  // Schlüssel bzw. Suchwörter, keine Vereinbarungen.
  // F8b — Einrichtungspunkt „Vergütung des Vorstands“ (Annahme 10): ohne ihn warnt jede Pauschale an ein Vorstandsmitglied.
  { key: 'finance.boardRemunerationAllowed', schema: z.boolean(), default: false },
  { key: 'finance.boardRemunerationBasisText', schema: z.string().max(500), default: '', auditValue: 'redact' },
  { key: 'finance.boardRemunerationDocumentId', schema: z.string().nullable(), default: null },
  /** Befund AK: ab wann die Grundlage gilt — die Markierung „ohne Grundlage“ vergleicht mit dem Zahlungstag. */
  { key: 'finance.boardRemunerationValidFrom', schema: z.string().date().nullable(), default: null },
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
    { href: '/finance/work/foreign', doc: 'finanzen/arbeitsliste' },
    { href: '/finance/work/vouchers', doc: 'finanzen/arbeitsliste' },
    { href: '/finance/work/rules', doc: 'finanzen/arbeitsliste' },
    { href: '/finance/work', doc: 'finanzen/arbeitsliste' },
    { href: '/finance/imports/format', doc: 'finanzen/csv-format-einrichten' },
    { href: '/finance/imports', doc: 'finanzen/kontoauszug-laden' },
    { href: '/finance/entries', doc: 'finanzen/buchen' },
    { href: '/finance/accounts', doc: 'finanzen/konten-und-offene-zahlungen' },
    { href: '/finance/open-items', doc: 'finanzen/konten-und-offene-zahlungen' },
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
    { href: '/admin/finance', doc: 'finanzen/einrichten' },
  ],
  navigation: [
    // F4 Task 7: ein eigener Abschnitt „Arbeit“ über „Buchungen“ — F5 stellt die Arbeitsliste davor.
    // F5 Task 6: die Arbeitsliste führt den Abschnitt an, ihre drei Nebenlisten folgen.
    { key: 'finance.work', href: '/finance/work', icon: 'euro', group: 'finance', section: 'finance.work', permission: 'finance.read' },
    { key: 'finance.workForeign', href: '/finance/work/foreign', icon: 'euro', group: 'finance', section: 'finance.work', permission: 'finance.read' },
    { key: 'finance.workVouchers', href: '/finance/work/vouchers', icon: 'euro', group: 'finance', section: 'finance.work', permission: 'finance.read' },
    { key: 'finance.rules', href: '/finance/work/rules', icon: 'euro', group: 'finance', section: 'finance.work', permission: 'finance.read' },
    { key: 'finance.imports', href: '/finance/imports', icon: 'euro', group: 'finance', section: 'finance.work', permission: 'finance.read' },
    { key: 'finance.entries', href: '/finance/entries', icon: 'euro', group: 'finance', section: 'finance.entries', permission: 'finance.read' },
    { key: 'finance.accounts', href: '/finance/accounts', icon: 'euro', group: 'finance', section: 'finance.entries', permission: 'finance.read' },
    { key: 'finance.openItems', href: '/finance/open-items', icon: 'euro', group: 'finance', section: 'finance.entries', permission: 'finance.read' },
    { key: 'finance.cash', href: '/finance/cash', icon: 'euro', group: 'finance', section: 'finance.entries', permission: 'finance.read' },
    // F6a Task 6: ein eigener Abschnitt „Spenden“ — Bestätigungen und Bescheide.
    { key: 'finance.donations', href: '/finance/donations', icon: 'euro', group: 'finance', section: 'finance.donations', permission: 'finance.read' },
    // F6b Task 6: Serienlauf und Spendenbuch zwischen Bestätigungen und Bescheiden.
    { key: 'finance.donationRun', href: '/finance/donations/run', icon: 'euro', group: 'finance', section: 'finance.donations', permission: 'finance.read' },
    { key: 'finance.donationBook', href: '/finance/donations/book', icon: 'euro', group: 'finance', section: 'finance.donations', permission: 'finance.read' },
    { key: 'finance.donationNotices', href: '/finance/donations/notices', icon: 'euro', group: 'finance', section: 'finance.donations', permission: 'finance.read' },
    // F8a Task 4: ein eigener Abschnitt „Auslagen“ — eigene Anträge und die Freigaben.
    { key: 'finance.expenses', href: '/finance/expenses', icon: 'euro', group: 'finance', section: 'finance.expenses', permission: 'finance.expensesSubmit' },
    { key: 'finance.approvals', href: '/finance/approvals', icon: 'euro', group: 'finance', section: 'finance.expenses', permission: 'finance.approve' },
    // F7 Task 5: ein eigener Abschnitt „Partner und Zweckmittel“.
    { key: 'finance.partners', href: '/finance/partners', icon: 'euro', group: 'finance', section: 'finance.allocation', permission: 'finance.read' },
    // F8b Task 5 (Annahme 13): Zwecke — reduziert offen für finance.overview (E3, Design Phase 4c).
    { key: 'finance.purposes', href: '/finance/purposes', icon: 'euro', group: 'finance', section: 'finance.allocation', permission: ['finance.read', 'finance.overview'] },
    { key: 'finance.reserves', href: '/finance/reserves', icon: 'euro', group: 'finance', section: 'finance.allocation', permission: 'finance.read' },
    { key: 'finance.people', href: '/finance/people', icon: 'euro', group: 'finance', section: 'finance.allocation', permission: 'finance.read' },
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
  ],
  // F6b: der vereinfachte Nachweis — `filed: false`, ein Vordruck auf Abruf.
  documentTemplates: [cashCountTemplate, moneyConfirmationTemplate, inKindConfirmationTemplate, collectiveConfirmationTemplate, simplifiedReceiptTemplate, waiverDeclarationTemplate],
  documentBases: ['a4-formular', 'a4-mit-briefkopf'],
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
    'finance.confirmationRun.item': { params: ['issued'] },
    'finance.confirmationRun.start': { params: ['year'] },
    'finance.contactIban.delete': { params: ['withContact'] },
    'finance.contactIban.link': { params: [] },
    'finance.contactWaiverTerms.delete': { params: [] },
    'finance.contactWaiverTerms.save': { params: [] },
    'finance.correction.apply': { params: [] },
    'finance.correction.reject': { params: [] },
    'finance.correction.request': { params: [] },
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
    'finance.importRule.save': { params: [] },
    'finance.inKindDetails.save': { params: ['created'] },
    'finance.notice.document': { params: ['documentNumber'] },
    'finance.notice.save': { params: ['created'] },
    'finance.notice.supersede': { params: ['supersededOn'] },
    'finance.notice.void': { params: [] },
    'finance.openItem.cancel': { params: [] },
    'finance.openItem.create': { params: [] },
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
    return { label: { key: 'finance.records.fiscalYear', params: { designation: year.designation } }, href: null };
  },
  recordLabels: financeRecordLabels,
});
