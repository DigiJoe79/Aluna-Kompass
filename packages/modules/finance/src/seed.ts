import { assignRole, changeOwnPassword, createFollowUp, createRole, createUser, resetStartPassword, getDashboardLayout, getEffectivePermissions, isoDay, isoDayIn, login, paperDate, readSetting, schema, SEED_ADMIN_PASSWORD, seedClockAt, seedMoment, setDashboardLayout, setRolePermissions, todayIn, unwrap, waitForJob, type CallContext, type Deps } from '@kompass/core';
import { addContactRole, contactChannels, contactIdForUserInternal, contactRoles, contacts, createContact, endContactRole, hasLinkHistoryInternal, linkUserToContact, setContactChannels, updateContact } from '@kompass/module-contacts';
import { documents as dmsDocuments, receiptPdf, receiveDocument, textPdf } from '@kompass/module-dms';
import { projects } from '@kompass/module-projects';
import { and, asc, eq, gte, isNull, lte } from 'drizzle-orm';
import { completeFormat, guessCsvFormat, type CsvFormat } from './import/csv';
import { buildPaymentServiceCsv, buildSecondBankCsv } from './import/csv-fixture';
import { saveImportProfile } from './import/profiles';
import { linkContactIban } from './import/contact-ibans';
import { saveImportRule } from './import/rules';
import { markTransactionForeign } from './import/transit';
import { createAccount, setAccountActive } from './ledger/accounts';
import { createCategory, setCategoryActive } from './ledger/categories';
import { requestAllocationCorrection } from './ledger/corrections';
import { saveDraft, setReviewed } from './ledger/entries';
import { bookEntry } from './ledger/finalize';
import { createFirstFiscalYear, ensureFiscalYearFor, fiscalYearStatusInternal } from './ledger/fiscal-years';
import { createTaxPeriod, declarationDueOn, fileTaxPeriodDocument, saveTaxPeriodAnswers, taxPeriodOfYearInternal, updateTaxPeriod, type TaxPeriodDocumentSlot } from './ledger/tax-periods';
import { cancelOpenItem, createOpenItem } from './ledger/open-items';
import { markNotReturn, notReturnMarkInternal } from './ledger/not-return';
import { closeFiscalYear, justifyUndocumentedEntry, reopenFiscalYear } from './ledger/period';
import { accountStatementsForYearInternal, confirmAccountForYear, fileAccountStatementDocument } from './ledger/statement-documents';
import { assemblyOfYearInternal, getAssemblyResult, saveAssemblyResult } from './closing/assembly';
import { confirmClosingStep } from './closing/confirmations';
import { carryOverAuditFollowUp } from './closing/carry-over';
import { carryOverOfYearInternal } from './auditing/carry-over';
import { recordHandoverInterimReport, startHandover } from './closing/handover';
import { getClosingStatus } from './closing/status';
import type { ClosingStepKey } from './closing/types';
import { setProjectFinance } from './ledger/project-settings';
import { createPurpose, fulfillPurpose } from './ledger/purposes';
import { reverseEntry } from './ledger/reverse';
import { attachDocument, uploadVoucher, revokeVoucher } from './ledger/vouchers';
import { setDatedValue } from './ledger/dated-values';
import { fileVatFilingDocument, recordVatFiling } from './reporting/vat-filing';
import { vatFormFor } from './reporting/vat-forms';
import { saveVatSettings } from './ledger/vat-settings';
import { declineReverseCharge, saveContactTaxDetails } from './allocation/contact-tax-details';
import { installFinance } from './install';
import { SEED_CLOSED_YEARS, seedStoryYear } from './seed-calendar';
import { finalizeFinanceReport } from './reporting/finalize';
import { dataExportSlot, startDataExport } from './reporting/export/run';
import { sweepDataExports } from './reporting/export/sweep';
import { saveAuditor } from './auditing/auditors';
import { markSectionReviewed, setSample } from './auditing/samples';
import { answerAuditRemark, createAuditRemark, resolveAuditRemark } from './auditing/remarks';
import { createAuditReportDraft, currentReportInternal, lastFiledReportInternal, loadReport, markAuditReportReadyToSign, saveAuditReportExamination, saveAuditReportResult } from './auditing/report';
import { fileAuditReportScan } from './auditing/filing';
import { printAuditReportBlank } from './auditing/print';
import { countCash } from './ledger/cash';
import { saveOtherAsset } from './reporting/other-assets';
import { seedDirectDebit } from './direct-debit/seed';
import { checkConfirmable } from './donations/check';
import { attachSignedConfirmation, issueConfirmation, recordConfirmationDispatch, voidConfirmation } from './donations/confirmations';
import { saveInKindDetails } from './donations/in-kind';
import { saveSigner, uploadFacsimile } from './donations/machine';
import { saveNotice, supersedeNotice } from './donations/notices';
import { continueConfirmationRun, dispatchRunConfirmations, startConfirmationRun } from './donations/runs';
import { setExpenseWaiverBasisText, setFinanceSwitch } from './ledger/setup';
import { saveExpenseDraft, submitExpenseClaim, uploadExpenseReceipt } from './allocation/expenses';
import { approveExpenseClaim, approvePartnerPayment, rejectExpenseClaim } from './allocation/approvals';
import { attachSignedWaiver, createWaiverDeclaration } from './allocation/waiver';
import { savePartnerNotice, savePartnerProfile } from './allocation/partners';
import { copyPartnerPayment, rejectPartnerPayment, savePartnerPaymentDraft, submitPartnerPayment } from './allocation/partner-payments';
import { addEvidenceUpload, acknowledgeEvidence } from './allocation/evidence';
import { freeReserveCap, recordReserveMovement, saveReserve } from './allocation/reserves';
import { approvePurposeTransfer, requestPurposeTransfer } from './allocation/transfers';
import { buildCamt053Bytes } from './import/camt-fixture';
import { accountBalancesAt } from './ledger/queries';
import { buildForeignInvoicePdf, buildOfficeInvoicePdf, buildVetInvoicePdf } from './import/zugferd-fixture';
import { discardRun } from './import/discard';
import { importStatement } from './import/runs';
import {
  financeAccounts,
  financeAllocationCorrections,
  financeAllocationLines,
  financeCategories,
  financeEntries,
  financeDatedValues,
  financeVatFilings,
  financeEntryDocuments,
  financeDataExports,
  financeFiscalYears,
  financeAuditAuditors,
  financeAuditRemarks,
  financeAuditSamples,
  financeCashCountWitnesses,
  financeReports,
  financeOtherAssets,
  financeImportRules,
  financeImportRuns,
  financeMoneyLines,
  financeOpenItems,
  financeConfirmationLines,
  financeConfirmationRuns,
  financeConfirmations,
  financeExpensePositions,
  financeNotices,
  financePartnerPayments,
  financePartnerNotices,
  financePartnerProfiles,
  financeProjectSettings,
  financePurposes,
  financePurposeTransfers,
  financeReserves,
  financeReserveMovements,
  financeRawTransactions,
  financeSigners,
  financeCashCounts,
  financeHandovers,
} from './schema';


async function ensureAccount(deps: Deps, ctx: CallContext, name: string, input: Record<string, unknown>): Promise<{ id: string } | null> {
  const existing = deps.db.select({ id: financeAccounts.id }).from(financeAccounts).where(eq(financeAccounts.name, name)).get();
  if (existing) return existing;
  return unwrap(await createAccount(deps, ctx, { name, ...input }));
}

/**
 * Ein Dokument entsteht an seinem Tag (Joe, 2026-10-06): der Dienstaufruf läuft unter einer Uhr, die auf `isoDay`
 * 10:00 UTC steht, nie nach jetzt. Nur für Aufrufe, deren Dokumentdatum der Seed selbst nennt — siehe
 * „Ausnahmen“ in Plan 2b, Task 7.
 */
const on = (deps: Deps, isoDay: string): Deps => seedClockAt(deps, seedMoment(deps, isoDay, '10:00'));

/** Gibt einem Konto einmal ein CSV-Format — erraten wie im Assistenten, gespeichert über `saveImportProfile` — und lädt einmal einen Auszug (F4b). */
async function ensureCsvAccountWithRun(deps: Deps, ctx: CallContext, accountName: string, formatName: string, fileName: string, bytes: Uint8Array): Promise<void> {
  let account = accountByName(deps, accountName);
  if (!account.importProfileId) {
    const guess = guessCsvFormat(bytes);
    const none: CsvFormat['columns'] = { bookingDate: '', valueDate: null, amount: null, debit: null, credit: null, debitCreditIndicator: null, counterpartyName: null, counterpartyIban: null, purpose: null, reference: null, fee: null, balance: null, currency: null, pending: null };
    const format = completeFormat(guess, { columns: { ...none, ...guess.columns } as CsvFormat['columns'], invertSign: false, dateFormat: guess.dateFormat!, decimalSeparator: guess.decimalSeparator! });
    unwrap(await saveImportProfile(deps, ctx, { accountId: account.id, name: formatName, format, confirmFormatChange: true }));
    account = accountByName(deps, accountName);
  }
  const hasRun = deps.db.select({ id: financeImportRuns.id }).from(financeImportRuns).where(eq(financeImportRuns.accountId, account.id)).limit(1).get();
  if (!hasRun) unwrap(await importStatement(deps, ctx, { accountId: account.id, fileName, bytes }));
}

async function ensurePurpose(deps: Deps, ctx: CallContext, name: string, input: Record<string, unknown>): Promise<{ id: string } | null> {
  const existing = deps.db.select({ id: financePurposes.id }).from(financePurposes).where(eq(financePurposes.name, name)).get();
  if (existing) return existing;
  return unwrap(await createPurpose(deps, ctx, { name, ...input }));
}

async function ensureCategory(deps: Deps, ctx: CallContext, key: string, input: Record<string, unknown>): Promise<void> {
  const existing = deps.db.select({ id: financeCategories.id }).from(financeCategories).where(eq(financeCategories.key, key)).get();
  if (existing) return;
  unwrap(await createCategory(deps, ctx, { key, ...input }));
}

function categoryByKey(deps: Deps, key: string) {
  const row = deps.db.select().from(financeCategories).where(eq(financeCategories.key, key)).get();
  if (!row) throw new Error(`Startplan-Kategorie fehlt: ${key}`);
  return row;
}

function accountByName(deps: Deps, name: string) {
  const row = deps.db.select().from(financeAccounts).where(eq(financeAccounts.name, name)).get();
  if (!row) throw new Error(`Geldkonto fehlt: ${name}`);
  return row;
}

/**
 * Das Projekt, an dem die Finanz-Beispiele hängen: „winterhilfe“ aus dem Projekte-Seed, sonst das erste nach
 * Reihenfolge — nie ein beliebiges (bis 0.2.6 `limit(1)` ohne Ordnung, Spec 2026-10-06 § 4).
 */
function seedProject(deps: Deps): { id: string } | undefined {
  return (
    deps.db.select({ id: projects.id }).from(projects).where(eq(projects.slug, 'winterhilfe')).get() ??
    deps.db.select({ id: projects.id }).from(projects).orderBy(asc(projects.sortOrder), asc(projects.createdAt)).limit(1).get()
  );
}

function purposeByName(deps: Deps, name: string) {
  const row = deps.db.select().from(financePurposes).where(eq(financePurposes.name, name)).get();
  if (!row) throw new Error(`Zweck fehlt: ${name}`);
  return row;
}

/** Legt eine Buchung nur an, wenn noch keine mit diesem Text besteht — idempotent, ohne eigene Zähltabelle. */
async function ensureEntry(deps: Deps, text: string, create: () => Promise<unknown>): Promise<void> {
  const exists = deps.db.select({ id: financeEntries.id }).from(financeEntries).where(eq(financeEntries.text, text)).get();
  if (exists) return;
  await create();
}

function entryByText(deps: Deps, text: string) {
  const row = deps.db.select().from(financeEntries).where(eq(financeEntries.text, text)).get();
  if (!row) throw new Error(`Buchung fehlt: ${text}`);
  return row;
}

function firstAllocationLineOf(deps: Deps, entryId: string) {
  const row = deps.db.select().from(financeAllocationLines).where(eq(financeAllocationLines.entryId, entryId)).orderBy(asc(financeAllocationLines.position)).get();
  if (!row) throw new Error(`Zuordnungszeile fehlt: ${entryId}`);
  return row;
}

/** Alle Aufteilungszeilen einer Buchung, in ihrer Reihenfolge — für F3a-N: „Korrigieren“ erreicht jede Zeile. */
function allocationLinesOf(deps: Deps, entryId: string) {
  return deps.db.select().from(financeAllocationLines).where(eq(financeAllocationLines.entryId, entryId)).orderBy(asc(financeAllocationLines.position)).all();
}

/** Belegt eine Buchung nur, wenn sie noch keinen Beleg trägt — idempotent über `uploadVoucher` hinweg. Ohne `bytes` ein Platzhalter-PDF mit Titel und Tag — je Beleg eigener Inhalt, sonst wären alle derselbe Nachweis (266). */
async function ensureVoucher(deps: Deps, ctx: CallContext, entry: { id: string }, typeKey: string, documentDate: string, title?: string, bytes?: Uint8Array): Promise<{ linkId: string; documentId: string } | null> {
  const existing = deps.db.select().from(financeEntryDocuments).where(eq(financeEntryDocuments.entryId, entry.id)).all();
  if (existing.length > 0) return { linkId: existing[0]!.id, documentId: existing[0]!.documentId ?? '' };
  // Der Beleg entsteht an seinem Tag (Plan 2b, Task 7, 3m).
  const res = unwrap(await uploadVoucher(on(deps, documentDate), ctx, { entryId: entry.id, bytes: bytes ?? textPdf(['Beleg', title ?? '', documentDate, '', 'Erfundenes Beispiel für die Entwicklung.']), typeKey, documentDate, title }));
  return { linkId: res.linkId, documentId: res.documentId };
}

/** Ein offener Posten je Zahlungsreferenz — idempotent, `paymentReference` dient als Fundstelle. */
async function ensureOpenItem(deps: Deps, ctx: CallContext, paymentReference: string, input: Record<string, unknown>): Promise<{ id: string } | null> {
  const existing = deps.db.select({ id: financeOpenItems.id }).from(financeOpenItems).where(eq(financeOpenItems.paymentReference, paymentReference)).get();
  if (existing) return existing;
  return unwrap(await createOpenItem(deps, ctx, { paymentReference, ...input }));
}

/** Eine Zuordnungskorrektur je Zeile — idempotent, egal ob sie wartet oder schon entschieden ist. */
async function ensureCorrection(deps: Deps, lineId: string, request: () => Promise<unknown>): Promise<void> {
  const existing = deps.db.select({ id: financeAllocationCorrections.id }).from(financeAllocationCorrections).where(eq(financeAllocationCorrections.lineId, lineId)).get();
  if (existing) return;
  await request();
}

/**
 * Zwei erfundene Spender, sofern der Kontakte-Seed keine passenden
 * Rolleninhaber liefert. Läuft mit `contacts.manage`, unabhängig davon, ob
 * der Aufrufer dieses Recht selbst mitbringt — wie `seedDevelopment`s
 * Systemkontext es täte.
 */
async function ensureDonors(deps: Deps, ctx: CallContext, since: string): Promise<[{ id: string }, { id: string }]> {
  const existing = deps.db.select({ contactId: contactRoles.contactId }).from(contactRoles).where(eq(contactRoles.role, 'donor')).all();
  if (existing.length >= 2) return [{ id: existing[0]!.contactId }, { id: existing[1]!.contactId }];
  const contactCtx: CallContext = { ...ctx, permissions: new Set([...ctx.permissions, 'contacts.manage']) };
  const invented: [{ id: string }, { id: string }] = [{ id: '' }, { id: '' }];
  for (const [index, [firstName, lastName]] of [['Petra', 'Wagner'], ['Uwe', 'Kruse']].entries()) {
    const contact = unwrap(await createContact(deps, contactCtx, { kind: 'person', firstName, lastName }));
    unwrap(await addContactRole(deps, contactCtx, { id: contact.id, role: 'donor', since }));
    invented[index] = { id: contact.id };
  }
  return invented;
}

/**
 * Das Stichjahr dieses Seeds: Gibt es schon ein Geschäftsjahr, ist das erste davon das älteste abgeschlossene Jahr der
 * Geschichte (`SEED_CLOSED_YEARS` vor dem Stichjahr) —
 * ein zweiter Lauf bleibt so in der Geschichte des ersten, auch wenn der Kalender inzwischen ein neues Stichjahr
 * nennt (sonst stünde sie doppelt da, und der Abschluss fände die Entwürfe des alten Stichjahrs). Ohne
 * Geschäftsjahr gilt der Kalender (`seedStoryYear`).
 */
function storyYearOf(deps: Deps): number {
  const first = deps.db.select({ startsOn: financeFiscalYears.startsOn }).from(financeFiscalYears).orderBy(asc(financeFiscalYears.startsOn)).limit(1).get();
  return first ? Number(first.startsOn.slice(0, 4)) + SEED_CLOSED_YEARS : seedStoryYear(todayIn(deps));
}

/**
 * Ein erfundenes Vereinsjahr mit allen Stammdaten von F1: die Geschäftsjahre
 * des Vor- und des Stichjahrs (dazu das laufende, liegt heute schon danach),
 * vier Geldkonten (eines stillgelegt), vier Zwecke, eine eigene Kategorie
 * neben dem Startplan, eine Überschreibung eines datierten Werts. Frei
 * erfunden (keine Tier- und keine Aluna-Begriffe), idempotent — ein zweiter
 * Lauf verdoppelt nichts, auch nicht in einem anderen Stichjahr.
 */
export async function seedFinance(deps: Deps, ctx: CallContext): Promise<void> {
  // Damit der Startplan sicher steht, auch wenn ein Aufrufer `installFinance` noch nicht selbst gerufen hat.
  deps.db.transaction((tx) => installFinance(tx, deps, ctx));

  // Die Geschichte spielt im Stichjahr und den abgeschlossenen Jahren davor (`seed-calendar.ts`) — nie in der Zukunft.
  const storyYear = storyYearOf(deps);
  const previousYear = storyYear - 1;
  const firstYear = storyYear - SEED_CLOSED_YEARS;

  const hasFiscalYear = deps.db.select({ id: financeFiscalYears.id }).from(financeFiscalYears).limit(1).get();
  if (!hasFiscalYear) {
    unwrap(await createFirstFiscalYear(deps, ctx, { startsOn: `${firstYear}-01-01`, endsOn: `${firstYear}-12-31` }));
    // `ensureFiscalYearFor` legt nur den unmittelbaren Nachfolger an: Jahr für Jahr bis zum Stichjahr, dann — liegt
    // heute schon im Jahr danach — das laufende. Ein Dienst, der „heute“ bucht, findet so immer sein Geschäftsjahr.
    const days = [...Array.from({ length: SEED_CLOSED_YEARS }, (_, i) => `${firstYear + i + 1}-01-01`), todayIn(deps)];
    for (const day of days) unwrap(deps.db.transaction((tx) => ensureFiscalYearFor(tx, deps, ctx, day)));
  }

  await ensureAccount(deps, ctx, 'Vereinskonto', {
    kind: 'bank',
    iban: 'DE23999999990000202051',
    bic: 'BEISDEX0XXX',
    bankName: 'Beispielbank',
    isMain: true,
    openingBalanceCents: 125000,
    openingDate: `${previousYear}-01-01`,
    importFormat: 'camt053',
  });
  await ensureAccount(deps, ctx, 'Barkasse', { kind: 'cash' });
  // Eigens für die Barkassen-E2E (F3b Task 2): Zählungen und Bargeldbewegungen laufen hier, nie auf „Barkasse“ —
  // sonst kippen die Bestände, die `finance.spec.ts` schon auf „Barkasse“ voraussetzt.
  await ensureAccount(deps, ctx, 'Zählkasse', { kind: 'cash', openingBalanceCents: 20000, openingDate: `${previousYear}-01-01` });
  // IBAN erfunden (BLZ 99999999) — F4 Task 7: nur mit IBAN lässt sich der Formatwechsel csv -> camt053 überhaupt zeigen.
  await ensureAccount(deps, ctx, 'Spendenplattform', { kind: 'paymentService', iban: 'DE32999999990301059999', importFormat: null });
  // F4b: CSV entsteht nur über ein gespeichertes Format — auch im Seed derselbe Weg wie im Assistenten:
  // Kompass errät das Format, der Mensch beantwortet nur das Vorzeichen, dann ein Auszug.
  await ensureCsvAccountWithRun(deps, ctx, 'Spendenplattform', 'Spendenplattform CSV', `aktivitaeten-${storyYear}-03.csv`, buildPaymentServiceCsv(storyYear));
  await ensureAccount(deps, ctx, 'Zweitbank CSV', { kind: 'bank', iban: 'DE48999999990000404040', isMain: false });
  await ensureCsvAccountWithRun(deps, ctx, 'Zweitbank CSV', 'Zweitbank CSV', `umsaetze-${storyYear}-03.csv`, buildSecondBankCsv(storyYear));
  // IBAN erfunden (BLZ 99999) — N2: die frühere Beispielnummer trug die echte österreichische BLZ 19043.
  const oldSavings = await ensureAccount(deps, ctx, 'Altes Sparbuch', { kind: 'bank', iban: 'AT939999900001234567', isMain: false });
  if (oldSavings) {
    const row = deps.db.select().from(financeAccounts).where(eq(financeAccounts.id, oldSavings.id)).get();
    if (row?.isActive) unwrap(await setAccountActive(deps, ctx, { id: oldSavings.id, isActive: false, expectedVersion: row.updatedAt }));
  }

  await ensurePurpose(deps, ctx, 'Dachsanierung Vereinsheim', { targetCents: 800000, description: 'Zusage von Frau Erika Beispiel über 2.000 €' });
  const existingProject = seedProject(deps);
  await ensurePurpose(deps, ctx, 'Jugendfreizeit', existingProject ? { projectId: existingProject.id } : {});
  await ensurePurpose(deps, ctx, 'Partnerprojekt Ausland', { abroad: true });
  await ensurePurpose(deps, ctx, 'Flutlicht', {});
  // F2c: ein Zweck im Minus — mehr Ausgaben, als je eingegangen ist (Spec 5.6, Warnung, keine Sperre).
  await ensurePurpose(deps, ctx, 'Sommerfest', {});

  await ensureCategory(deps, ctx, 'room-rental', { name: 'Raumvermietung', direction: 'income', sphere: 'assetManagement', incomeKind: 'fees' });

  const mileageFrom = `${storyYear}-01-01`;
  const mileage = deps.db.select().from(financeDatedValues).where(and(eq(financeDatedValues.key, 'mileageRate'), eq(financeDatedValues.validFrom, mileageFrom))).get();
  if (!mileage) unwrap(await setDatedValue(deps, ctx, { key: 'mileageRate', validFrom: mileageFrom, value: 25 }));

  // Buchungen in jedem Zustand (Spec 11.3) — über die Dienste, damit Trigger, Kassenprüfung und Nummernvergabe mitlaufen.
  const bank = accountByName(deps, 'Vereinskonto');
  const cash = accountByName(deps, 'Barkasse');
  const platform = accountByName(deps, 'Spendenplattform');
  const donationsCat = categoryByKey(deps, 'donations');
  const bankFeesCat = categoryByKey(deps, 'bank-fees');
  const officeCat = categoryByKey(deps, 'office');
  const paymentFeesCat = categoryByKey(deps, 'payment-fees');
  const programCostsCat = categoryByKey(deps, 'program-costs');
  const inKindCat = categoryByKey(deps, 'in-kind-donations');
  const inKindExpenseCat = categoryByKey(deps, 'program-in-kind');
  const dachsanierung = purposeByName(deps, 'Dachsanierung Vereinsheim');
  const partnerAusland = purposeByName(deps, 'Partnerprojekt Ausland');

  const [donorA, donorB] = await ensureDonors(deps, ctx, `${previousYear}-01-01`);

  // Plan seed-mehrjahre: die abgeschlossenen Jahre vor dem Vorjahr, je mit vollem Jahresabschluss — vor jeder Buchung des
  // Vorjahres, weil jedes Jahr nur nach seinem Vorgänger schließt. Der Vorstandswechsel steht vorher: Die MV jedes Jahres
  // entlastet, wer in ihm im Vorstand war.
  await seedBoardHistory(deps, ctx, storyYear);
  for (let year = storyYear - SEED_CLOSED_YEARS; year <= storyYear - 2; year++) await seedEarlyYear(deps, ctx, year, storyYear);

  await ensureEntry(deps, 'Spende Sommerfest', () =>
    bookEntry(on(deps, `${previousYear}-03-10`), ctx, { entryDate: `${previousYear}-03-10`, text: 'Spende Sommerfest', moneyLines: [{ accountId: bank.id, amountCents: 8000 }], allocationLines: [{ categoryId: donationsCat.id, amountCents: 8000 }] }).then(unwrap),
  );
  await ensureEntry(deps, 'Kontoführung April', () =>
    bookEntry(on(deps, `${previousYear}-04-15`), ctx, { entryDate: `${previousYear}-04-15`, text: 'Kontoführung April', moneyLines: [{ accountId: bank.id, amountCents: -450 }], allocationLines: [{ categoryId: bankFeesCat.id, amountCents: -450 }] }).then(unwrap),
  );
  // Das Wort „Büromaterial“ trägt den Kategorievorschlag der Freigabe (`bySimilarEntry`, E2E finance-approvals).
  await ensureEntry(deps, 'Büromaterial Mai', () =>
    bookEntry(on(deps, `${previousYear}-05-20`), ctx, { entryDate: `${previousYear}-05-20`, text: 'Büromaterial Mai', moneyLines: [{ accountId: bank.id, amountCents: -3200 }], allocationLines: [{ categoryId: officeCat.id, amountCents: -3200 }] }).then(unwrap),
  );

  // F3a-N Task 1: eine festgeschriebene, geteilte Buchung im Vorjahr — nach dessen Abschluss wartet die
  // Korrektur einer ihrer beiden Zeilen auf Freigabe, die andere bleibt wählbar.
  await ensureEntry(deps, 'Sponsoring Vereinsfest', () =>
    bookEntry(on(deps, `${previousYear}-06-01`), ctx, {
      entryDate: `${previousYear}-06-01`,
      text: 'Sponsoring Vereinsfest',
      moneyLines: [{ accountId: bank.id, amountCents: 9000 }],
      allocationLines: [
        { categoryId: donationsCat.id, amountCents: 6000 },
        { categoryId: donationsCat.id, amountCents: 3000 },
      ],
    }).then(unwrap),
  );

  await ensureEntry(deps, 'Spende mit Zweck', () =>
    bookEntry(deps, ctx, {
      entryDate: `${storyYear}-02-01`,
      text: 'Spende mit Zweck',
      moneyLines: [{ accountId: bank.id, amountCents: 15000 }],
      allocationLines: [{ categoryId: donationsCat.id, amountCents: 15000, contactId: donorA.id, purposeId: dachsanierung.id }],
    }).then(unwrap),
  );

  // Prüfstein 2: Auszahlung des Zahlungsdiensts als Split über zwei Spender und eine Gebühr.
  await ensureEntry(deps, 'Auszahlung Spendenplattform', () =>
    bookEntry(deps, ctx, {
      entryDate: `${storyYear}-02-10`,
      text: 'Auszahlung Spendenplattform',
      moneyLines: [{ accountId: platform.id, amountCents: 48500 }],
      allocationLines: [
        { categoryId: donationsCat.id, amountCents: 20000, contactId: donorA.id, purposeId: partnerAusland.id },
        { categoryId: donationsCat.id, amountCents: 20000, contactId: donorB.id, purposeId: partnerAusland.id },
        { categoryId: donationsCat.id, amountCents: 10000 },
        { categoryId: paymentFeesCat.id, amountCents: -1500 },
      ],
    }).then(unwrap),
  );

  await ensureEntry(deps, 'Abhebung Barkasse', () =>
    bookEntry(deps, ctx, {
      entryDate: `${storyYear}-02-15`,
      text: 'Abhebung Barkasse',
      moneyLines: [
        { accountId: bank.id, amountCents: -10000 },
        { accountId: cash.id, amountCents: 10000 },
      ],
      allocationLines: [],
    }).then(unwrap),
  );

  await ensureEntry(deps, 'Bar-Ausgabe Fahrtkosten', () =>
    bookEntry(deps, ctx, { entryDate: `${storyYear}-02-20`, text: 'Bar-Ausgabe Fahrtkosten', moneyLines: [{ accountId: cash.id, amountCents: -1500 }], allocationLines: [{ categoryId: programCostsCat.id, amountCents: -1500 }] }).then(unwrap),
  );

  await ensureEntry(deps, 'Sachspende Werkzeug', () =>
    bookEntry(deps, ctx, {
      entryDate: `${storyYear}-02-25`,
      text: 'Sachspende Werkzeug',
      moneyLines: [],
      allocationLines: [
        { categoryId: inKindCat.id, amountCents: 6000 },
        { categoryId: inKindExpenseCat.id, amountCents: -6000 },
      ],
    }).then(unwrap),
  );

  // F2c: ein erfüllter Zweck, der noch Restmittel hält (Spec 5.6, Warnung „erfüllt mit Restmitteln“).
  const floodlight = purposeByName(deps, 'Flutlicht');
  await ensureEntry(deps, 'Spende Flutlicht', () =>
    bookEntry(deps, ctx, { entryDate: `${storyYear}-02-12`, text: 'Spende Flutlicht', moneyLines: [{ accountId: bank.id, amountCents: 12000 }], allocationLines: [{ categoryId: donationsCat.id, amountCents: 12000, purposeId: floodlight.id }] }).then(unwrap),
  );
  {
    const row = deps.db.select().from(financePurposes).where(eq(financePurposes.id, floodlight.id)).get();
    if (row && !row.fulfilledAt) unwrap(await fulfillPurpose(deps, ctx, { id: floodlight.id }));
  }

  // F2c: ein Zweck im Minus — die Ausgabe übersteigt, was je für ihn einging.
  const sommerfest = purposeByName(deps, 'Sommerfest');
  await ensureEntry(deps, 'Ausgabe Sommerfest', () =>
    bookEntry(deps, ctx, { entryDate: `${storyYear}-02-14`, text: 'Ausgabe Sommerfest', moneyLines: [{ accountId: bank.id, amountCents: -8000 }], allocationLines: [{ categoryId: programCostsCat.id, amountCents: -8000, purposeId: sommerfest.id }], reason: 'Vorschuss aus freien Mitteln, der Zuschuss der Gemeinde ist zugesagt' }).then(unwrap),
  );

  await ensureEntry(deps, 'Fehlerhafte Spendenbuchung', async () => {
    const booked = unwrap(
      await bookEntry(deps, ctx, { entryDate: `${storyYear}-03-01`, text: 'Fehlerhafte Spendenbuchung', moneyLines: [{ accountId: bank.id, amountCents: 5000 }], allocationLines: [{ categoryId: donationsCat.id, amountCents: 5000 }] }),
    );
    unwrap(await reverseEntry(deps, ctx, { id: booked.id }));
  });

  await ensureEntry(deps, 'Entwurf geprüft', async () => {
    const draft = unwrap(
      await saveDraft(deps, ctx, { entryDate: `${storyYear}-03-05`, text: 'Entwurf geprüft', moneyLines: [{ accountId: bank.id, amountCents: 2500 }], allocationLines: [{ categoryId: donationsCat.id, amountCents: 2500 }] }),
    );
    unwrap(await setReviewed(deps, ctx, { id: draft.id, reviewed: true }));
  });

  await ensureEntry(deps, 'Entwurf ungeprüft', () =>
    saveDraft(deps, ctx, { entryDate: `${storyYear}-03-06`, text: 'Entwurf ungeprüft', moneyLines: [{ accountId: bank.id, amountCents: 1800 }], allocationLines: [{ categoryId: donationsCat.id, amountCents: 1800 }] }).then(unwrap),
  );

  // F3a: ein zweiter ausgeglichener, ungeprüfter Entwurf — das Journal braucht zwei für die Mehrfachauswahl.
  await ensureEntry(deps, 'Entwurf ungeprüft zwei', () =>
    saveDraft(deps, ctx, { entryDate: `${storyYear}-03-09`, text: 'Entwurf ungeprüft zwei', moneyLines: [{ accountId: bank.id, amountCents: 2200 }], allocationLines: [{ categoryId: donationsCat.id, amountCents: 2200 }] }).then(unwrap),
  );

  // Unausgeglichen: der Agent hat die Zuordnung noch nicht vollständig — ein Mensch prüft und ergänzt sie.
  await ensureEntry(deps, 'Entwurf vom Agenten', () =>
    saveDraft(deps, { ...ctx, channel: 'mcp' as const }, { entryDate: `${storyYear}-03-07`, text: 'Entwurf vom Agenten', moneyLines: [{ accountId: bank.id, amountCents: 4000 }], allocationLines: [{ categoryId: donationsCat.id, amountCents: 3500 }] }).then(unwrap),
  );

  // --- Kontoauszüge (F4 Task 8, Spec 6.1): eigenes Konto „Importkonto“ mit erfundener IBAN
  // (BLZ 99999999), damit kein anderer Test dieselben Kontoauszüge sieht. Zwei fertige Läufe
  // (der zweite mit Lücke), ein offener Kandidat, ein verworfener und ein fehlgeschlagener Lauf;
  // ein Kontoumsatz gebucht, mehrere offen. Über die Dienste, nicht per Insert — ein Lauf ist eine
  // Tatsache, die nur `importStatement`/`discardRun` selbst herstellen dürfen.
  const IMPORTKONTO_IBAN = 'DE60999999990201051234';
  const importkonto = await ensureAccount(deps, ctx, 'Importkonto', { kind: 'bank', iban: IMPORTKONTO_IBAN, isMain: false, openingBalanceCents: 100000, openingDate: `${storyYear}-01-01` });
  if (importkonto) {
    const hasImportRuns = deps.db.select({ id: financeImportRuns.id }).from(financeImportRuns).where(eq(financeImportRuns.accountId, importkonto.id)).limit(1).get();
    if (!hasImportRuns) {
      // Lauf A: der erste Import, ohne Vorgänger — keine Lücke.
      const runA = unwrap(
        await importStatement(deps, ctx, {
          accountId: importkonto.id,
          fileName: `kontoauszug-${storyYear}-01.xml`,
          bytes: buildCamt053Bytes({
            iban: IMPORTKONTO_IBAN,
            from: `${storyYear}-01-01`,
            to: `${storyYear}-01-31`,
            openingCents: 100000,
            lines: [
              { bookingDate: `${storyYear}-01-05`, amountCents: 20000, counterpartyName: 'Erika Beispiel', counterpartyIban: 'DE66999999991234567890', purpose: 'Spende', bankReference: 'IMP-0001' },
              { bookingDate: `${storyYear}-01-10`, amountCents: -3500, counterpartyName: 'Buerobedarf Muster GmbH', counterpartyIban: 'DE12999999990000112233', purpose: 'Bueromaterial', bankReference: 'IMP-0002' },
            ],
          }),
        }),
      ).runs[0]!;

      // Lauf B: ein zweiter Auszug, dessen Anfangsbestand nicht zum Ende von Lauf A passt — die Lücke.
      unwrap(
        await importStatement(deps, ctx, {
          accountId: importkonto.id,
          fileName: `kontoauszug-${storyYear}-02.xml`,
          bytes: buildCamt053Bytes({
            iban: IMPORTKONTO_IBAN,
            from: `${storyYear}-02-10`,
            to: `${storyYear}-02-28`,
            openingCents: 130000,
            lines: [{ bookingDate: `${storyYear}-02-15`, amountCents: 5000, counterpartyName: 'Foerderverein Musterstadt e. V.', counterpartyIban: 'DE22999999995566778899', purpose: 'Zuschuss', bankReference: 'IMP-0003' }],
          }),
        }),
      );

      // Lauf C: ein neuer Umsatz und, ohne Bankreferenz, dieselben Kerndaten wie die Büromaterial-Zeile
      // aus Lauf A in einem nicht überlappenden Zeitraum — ein Kandidat, kein sicherer Treffer (Spec 6.1/6.3).
      unwrap(
        await importStatement(deps, ctx, {
          accountId: importkonto.id,
          fileName: `kontoauszug-${storyYear}-04.xml`,
          bytes: buildCamt053Bytes({
            iban: IMPORTKONTO_IBAN,
            from: `${storyYear}-04-01`,
            to: `${storyYear}-04-30`,
            openingCents: 135000,
            lines: [
              { bookingDate: `${storyYear}-04-05`, amountCents: 7500, counterpartyName: 'Erika Beispiel', counterpartyIban: 'DE66999999991234567890', purpose: 'Spende April', bankReference: 'IMP-0004' },
              { bookingDate: `${storyYear}-01-10`, amountCents: -3500, counterpartyName: 'Buerobedarf Muster GmbH', counterpartyIban: 'DE12999999990000112233', purpose: 'Bueromaterial' },
            ],
          }),
        }),
      );

      // Lauf D: ein Auszug, der versehentlich geladen und gleich wieder verworfen wird — bleibt als Tatsache stehen.
      const runD = unwrap(
        await importStatement(deps, ctx, {
          accountId: importkonto.id,
          fileName: `kontoauszug-${storyYear}-05-versehentlich.xml`,
          bytes: buildCamt053Bytes({
            iban: IMPORTKONTO_IBAN,
            from: `${storyYear}-05-01`,
            to: `${storyYear}-05-31`,
            openingCents: 139000,
            lines: [{ bookingDate: `${storyYear}-05-10`, amountCents: 2000, counterpartyName: 'Erika Beispiel', counterpartyIban: 'DE66999999991234567890', purpose: 'Testbuchung falsch', bankReference: 'IMP-0005' }],
          }),
        }),
      ).runs[0]!;
      unwrap(await discardRun(deps, ctx, { id: runD.id, note: 'Versehentlich den falschen Auszug hochgeladen' }));

      // Lauf E: eine Datei, deren Summenprobe nicht aufgeht — schreibt nur einen fehlgeschlagenen Lauf, keine Zeilen.
      const failedResult = await importStatement(deps, ctx, {
        accountId: importkonto.id,
        fileName: `kontoauszug-${storyYear}-06-kaputt.xml`,
        bytes: buildCamt053Bytes({ iban: IMPORTKONTO_IBAN, from: `${storyYear}-06-01`, to: `${storyYear}-06-30`, openingCents: 141000, closingCents: 999999, lines: [{ bookingDate: `${storyYear}-06-05`, amountCents: 1000 }] }),
      });
      if (failedResult.ok) throw new Error(`Seed: kontoauszug-${storyYear}-06-kaputt.xml haette als fehlgeschlagener Lauf enden muessen`);

      // Ein Kontoumsatz gebucht (die Spende aus Lauf A), die übrigen bleiben offen (E8).
      const donationRaw = deps.db
        .select()
        .from(financeRawTransactions)
        .where(and(eq(financeRawTransactions.runId, runA.id), eq(financeRawTransactions.amountCents, 20000)))
        .get()!;
      unwrap(
        await bookEntry(deps, ctx, {
          entryDate: `${storyYear}-01-06`,
          text: 'Spende aus Kontoauszug',
          moneyLines: [{ accountId: importkonto.id, amountCents: 20000, rawTransactionId: donationRaw.id }],
          allocationLines: [{ categoryId: donationsCat.id, amountCents: 20000 }],
        }),
      );
    }
  }

  // --- Arbeitsliste (F5, aus Task 9 vorgezogen für die E2E von Task 7): alles auf „Importkonto“.
  if (importkonto) await seedWorkList(deps, ctx, importkonto.id, storyYear);

  // --- Belege (F2b, Spec 5.2): drei festgeschriebene Buchungen mit hochgeladenem PDF; eine davon
  // widerrufen und ersetzt; „Spende Sommerfest“ bleibt bewusst ohne Beleg (der Rohumsatz allein reicht
  // für Spenden erst mit F4/F5).
  const bueromaterial = entryByText(deps, 'Büromaterial Mai');
  const fahrtkosten = entryByText(deps, 'Bar-Ausgabe Fahrtkosten');
  const bankgebuehr = entryByText(deps, 'Kontoführung April');

  await ensureVoucher(deps, ctx, bueromaterial, 'voucher-invoice', `${previousYear}-05-20`, 'Rechnung Büromaterial');
  const fahrtkostenVoucher = await ensureVoucher(deps, ctx, fahrtkosten, 'voucher-receipt', `${storyYear}-02-20`);
  const bankgebuehrVoucher = await ensureVoucher(deps, ctx, bankgebuehr, 'voucher-own', `${previousYear}-04-15`);

  if (bankgebuehrVoucher && fahrtkostenVoucher) {
    // Erst nach dem zweiten Beleg kann es zwei Zeilen geben; ohne Sortiergarantie der Datenbank
    // zählt für die Wiederholbarkeit nur, ob überhaupt schon einmal widerrufen wurde — nicht, welche
    // der Zeilen `ensureVoucher` zufällig zuerst zurückgab.
    const bankgebuehrLinks = deps.db.select().from(financeEntryDocuments).where(eq(financeEntryDocuments.entryId, bankgebuehr.id)).all();
    if (!bankgebuehrLinks.some((l) => l.revokedAt !== null)) {
      unwrap(
        await revokeVoucher(deps, ctx, {
          linkId: bankgebuehrVoucher.linkId,
          note: 'Falscher Anhang hochgeladen, richtige Quittung liegt vor',
          replacementDocumentId: fahrtkostenVoucher.documentId,
        }),
      );
    }
  }

  // --- Offene Posten (F2b, Spec 5.3): außerhalb des Journals — eine Verbindlichkeit offen, eine
  // teilbezahlt, eine Forderung erledigt, ein Posten ohne Zahlung erledigt.
  // Jeder offene Posten mit Gegenüber, damit die Übergabeliste es nennt (Designer Runde 7, 268; Befund 23e).
  const printer = await ensurePartnerContact(deps, ctx, 'Druckerei Beispielfeld GmbH');
  const applicant = await ensurePartnerContact(deps, ctx, 'Kinderhilfe Regional e.V.');
  const payableOpen = await ensureOpenItem(deps, ctx, `RE-${storyYear}-041`, { kind: 'payable', itemDate: `${storyYear}-01-10`, amountCents: 12000, dueOn: `${storyYear}-02-10`, contactId: printer });
  const payablePartial = await ensureOpenItem(deps, ctx, `RE-${storyYear}-055`, { kind: 'payable', itemDate: `${storyYear}-01-15`, amountCents: 20000, dueOn: `${storyYear}-02-15`, contactId: printer });
  const receivableSettled = await ensureOpenItem(deps, ctx, `SP-${storyYear}-003`, { kind: 'receivable', itemDate: `${storyYear}-01-20`, amountCents: 5000, dueOn: `${storyYear}-02-20` });
  const payableCancelled = await ensureOpenItem(deps, ctx, `RE-${storyYear}-060`, { kind: 'payable', itemDate: `${storyYear}-01-25`, amountCents: 3000 });
  // F3b Task 3 (A6): ein Posten mit Herkunft — „Erledigt ohne Zahlung“ bietet er nicht an, er verweist auf
  // seinen Vorgang. `originType` ist erfunden (kein Fachmodul liefert vor F8a/F7 echte Vorgänge).
  await ensureOpenItem(deps, ctx, `ANT-${storyYear}-014`, { kind: 'payable', itemDate: `${storyYear}-02-01`, amountCents: 4500, dueOn: `${storyYear}-03-01`, contactId: applicant, originType: 'demoProcess', originId: 'demo-1' });
  void payableOpen; // bleibt bewusst unbeglichen — nichts weiter zu tun.

  if (payablePartial) {
    await ensureEntry(deps, 'Teilzahlung Lieferant', () =>
      bookEntry(deps, ctx, {
        entryDate: `${storyYear}-02-01`,
        text: 'Teilzahlung Lieferant',
        moneyLines: [{ accountId: bank.id, amountCents: -8000, settlements: [{ openItemId: payablePartial.id, amountCents: 8000 }] }],
        allocationLines: [{ categoryId: programCostsCat.id, amountCents: -8000 }],
      }).then(unwrap),
    );
  }
  if (receivableSettled) {
    await ensureEntry(deps, 'Ausgleich Forderung', () =>
      bookEntry(deps, ctx, {
        entryDate: `${storyYear}-02-05`,
        text: 'Ausgleich Forderung',
        moneyLines: [{ accountId: bank.id, amountCents: 5000, settlements: [{ openItemId: receivableSettled.id, amountCents: 5000 }] }],
        allocationLines: [{ categoryId: donationsCat.id, amountCents: 5000 }],
      }).then(unwrap),
    );
  }
  if (payableCancelled) {
    const row = deps.db.select().from(financeOpenItems).where(eq(financeOpenItems.id, payableCancelled.id)).get();
    if (row && row.cancelledAt === null) {
      unwrap(await cancelOpenItem(deps, ctx, { id: payableCancelled.id, note: 'Doppelt erfasst, storniert vor Zahlung' }));
    }
  }

  // --- Zuordnungskorrektur (F2b, Spec 5.4, E18): eine angewandte im laufenden Jahr, eine wartende
  // im abgeschlossenen Vorjahr.
  const spendeMitZweck = entryByText(deps, 'Spende mit Zweck');
  const spendeMitZweckLine = firstAllocationLineOf(deps, spendeMitZweck.id);
  await ensureCorrection(deps, spendeMitZweckLine.id, () =>
    requestAllocationCorrection(deps, ctx, { lineId: spendeMitZweckLine.id, changes: { abroad: true }, note: 'Auslandsbezug bei der Erfassung übersehen' }).then(unwrap),
  );

  // F2c: Finanzfelder eines vorhandenen Projekts aus dem Projekte-Seed.
  if (existingProject) {
    const projectFinance = deps.db.select().from(financeProjectSettings).where(eq(financeProjectSettings.projectId, existingProject.id)).get();
    if (!projectFinance) unwrap(await setProjectFinance(deps, ctx, { projectId: existingProject.id, targetCents: 250000, defaultPurposeId: dachsanierung.id }));
    // Vor `seedMittel`: Der Höchstbetrag der freien Rücklage zählt diese Einnahme mit.
    await seedProjectBookings(deps, ctx, existingProject.id, storyYear);
  }

  // F6a Task 9: eine Spende im Vorjahr, bestätigt auf dem später ersetzten § 60a-Bescheid — gebucht und
  // belegt, solange das Jahr noch offen ist.
  await seedProvisionalNoticeDonation(deps, ctx, storyYear);

  // F6b Task 9: die Buchungen für den Serienlauf des Vorjahrs — vor dem Abschluss, solange das Jahr
  // noch offen ist. Der Lauf selbst startet erst später (`seedConfirmationRun`), wenn Bescheid,
  // Unterzeichner und Aufwandsspenden-Schalter stehen (aus `seedDonations`).
  await seedRunDonationEntries(deps, ctx, previousYear);

  const previousFiscalYear = deps.db.select().from(financeFiscalYears).where(eq(financeFiscalYears.designation, String(previousYear))).get();
  if (previousFiscalYear) {
    // Rechenschaft A2: sonstiges Vermögen vor dem Abschluss — es geht in den Kassenbericht ein, und der Prüfstand beim
    // Abschluss soll denselben Datenstand tragen wie die spätere Festschreibung (Plan D1d Task 4, Befund MCP 5).
    await seedOtherAssets(deps, ctx, previousYear);
    const alreadyClosed = fiscalYearStatusInternal(deps.db, previousFiscalYear.id) === 'closed';
    if (!alreadyClosed) {
      // „Spende Sommerfest“ bleibt bewusst ohne Beleg (siehe oben) — der Abschluss verlangt dafür eine Begründung.
      const spendeAltjahrForJustify = entryByText(deps, 'Spende Sommerfest');
      // Das Vorjahr schließt im Januar des Stichjahres, die Begründungen kurz davor (Designer Runde 5, 1.3 Nr. 1).
      unwrap(await justifyUndocumentedEntry(on(deps, `${storyYear}-01-08`), ctx, { entryId: spendeAltjahrForJustify.id, note: 'Kleinbetrag bar erhalten, kein Beleg ausgestellt' }));
      // F3a-N Task 1: „Sponsoring Vereinsfest“ bleibt ebenfalls ohne Beleg — nur ihre geteilte Zuordnung zählt hier.
      const sponsoringAltjahrForJustify = entryByText(deps, 'Sponsoring Vereinsfest');
      unwrap(await justifyUndocumentedEntry(on(deps, `${storyYear}-01-08`), ctx, { entryId: sponsoringAltjahrForJustify.id, note: 'Sponsoringzusage ohne Rechnung erhalten' }));
      // F6b Task 9: „Spende Jan Moser“ bleibt ohne Anschrift und ohne Beleg — genau die Zeile, die
      // der Serienlauf später als „Anschrift fehlt“ überspringt.
      const janMoserForJustify = entryByText(deps, 'Spende Jan Moser');
      unwrap(await justifyUndocumentedEntry(on(deps, `${storyYear}-01-08`), ctx, { entryId: janMoserForJustify.id, note: 'Anschrift fehlt noch, Nachweis liegt bei den Unterlagen' }));
      // Rechenschaft B1: eine Zweckkorrektur im Januar des Stichjahres an einer Vorjahresbuchung, solange das Vorjahr
      // noch offen ist — so tragen Prüfstand und festgeschriebene Berichte des Vorjahres schon den korrigierten Stand.
      await seedPriorYearPurposeCorrection(deps, ctx, previousYear, storyYear);
      await seedPriorYearReverseCharge(deps, ctx, previousYear);
      await seedPreviousYearStatement(on(deps, `${storyYear}-01-05`), ctx, previousYear);
      // Plan seed-mehrjahre Task 6: die letzte Zuführung vor dem Kauf, bevor das Vorjahr schließt (Zeile 54).
      await seedReplacementReserveYear(deps, ctx, previousYear, storyYear);
      // Rechenschaft C Schritt 2: die Kasse am Stichtag gezählt, bevor das Jahr schließt.
      await seedYearEndCashCount(deps, ctx, previousYear);
      unwrap(await closeFiscalYear(on(deps, `${storyYear}-01-20`), ctx, { id: previousFiscalYear.id }));
    }

    const spendeAltjahr = entryByText(deps, 'Spende Sommerfest');
    const spendeAltjahrLine = firstAllocationLineOf(deps, spendeAltjahr.id);
    await ensureCorrection(deps, spendeAltjahrLine.id, () =>
      requestAllocationCorrection(deps, ctx, { lineId: spendeAltjahrLine.id, changes: { contactId: donorA.id }, note: 'Spenderin nachträglich zugeordnet' }).then(unwrap),
    );

    // F3a-N Task 1: von den zwei Zeilen der „Sponsoring Vereinsfest“ wartet nur die erste auf Freigabe — die
    // zweite bleibt im Korrigieren-Dialog wählbar. Nur ein Projektwechsel: er löst nie § 153 aus, egal ob
    // eine Steuererklärung schon als abgegeben gilt (F3a-N Task 2 setzt das am selben Vorjahr).
    if (existingProject) {
      const sponsoringAltjahr = entryByText(deps, 'Sponsoring Vereinsfest');
      const sponsoringLines = allocationLinesOf(deps, sponsoringAltjahr.id);
      const sponsoringFirstLine = sponsoringLines[0];
      if (sponsoringFirstLine) {
        await ensureCorrection(deps, sponsoringFirstLine.id, () =>
          requestAllocationCorrection(deps, ctx, {
            lineId: sponsoringFirstLine.id,
            changes: { projectId: existingProject.id },
            note: 'Projektzuordnung nachträglich korrigieren',
          }).then(unwrap),
        );
      }
    }

    // Rechenschaft D1 (Spec § D1, Seed): Das abgeschlossene Vorjahr wird geprüft, bevor der Kassenbericht
    // festgeschrieben wird — Prüfer, Prüfstand, Stichproben, Vermerke, Zählung im Beisein, Bericht abgelegt; die
    // Ablage gibt das Jahr mit `auditReport` frei (die Freigabe „mündlicher Bericht“ aus A1 entfällt).
    await grantAuditorRoleToMiraKlein(deps, ctx);
    // Geprüft im Februar: Zählung am 15., Bericht am 20. abgelegt (1.3 Nr. 1).
    await seedAudit(on(deps, `${storyYear}-02-20`), ctx, previousFiscalYear.id, previousYear, storyYear);

    // Rechenschaft A2: der Kassenbericht des Vorjahres, festgeschrieben wie in der Oberfläche — mit Freigabe, Probe 0.
    // Einmal: nach einer Fassung (auch storniert) des Jahres.
    // Rechenschaft C Schritt 1: ohne Kontoauszug als PDF je Bankkonto schreibt Kompass keinen Bericht fest.
    await seedStatementPdfs(deps, ctx, previousFiscalYear.id);
    await seedCashReport(on(deps, `${storyYear}-02-25`), ctx, previousFiscalYear.id);
    // Rechenschaft C: der Jahresabschluss des Vorjahres bis Schritt 12, dann die Amtsübergabe im Stichjahr. Vorher der
    // Vorstandswechsel: Bernd Hagedorn war das ganze Vorjahr im Vorstand und gehört in die Entlastung (E2E C2).
    await seedBoardHistory(deps, ctx, storyYear);
    await seedClosing(deps, ctx, previousFiscalYear.id, storyYear);
    await seedHandover(deps, ctx, storyYear);
  }

  // F3a: „Mira Klein“ aus dem Kernseed (Rolle „Interne Revision“, kein Finanzrecht) bekommt zusätzlich
  // die Rolle „Kassenprüfer“ (finance.read, finance.overview, finance.audit — nie entriesFinalize): eine Person, an
  // der sich zeigt, dass „Korrigieren“ ohne das Recht fehlt. Existiert die Person nicht (isolierte Modul-Tests, andere
  // Installation), bleibt der Schritt aus — der Kern erfindet keine Nutzer. Ohne Vorjahr hier, sonst schon oben.
  await grantAuditorRoleToMiraKlein(deps, ctx);

  // F3a-N Task 2: „Jonas Feld“ (Kernseed-Rolle „Geschäftsstelle“, ohne Finanzrechte) bekommt zusätzlich
  // die Finanzrolle „Freigeber Finanzen“ — sonst gibt es außer der geschützten Verwaltung niemanden mit
  // `finance.approve`, und der Korrigieren-Dialog könnte nie zeigen, wer eine wartende Änderung freigeben
  // kann.
  await grantApproverRoleToJonasFeld(deps, ctx);

  // F3b Schritt 0: eine erfundene Person mit `finance.entriesFinalize`, aber ohne `contacts.view` — an ihr
  // zeigt sich, dass die Barkasse statt des Zähl-Dialogs den Sperrzustand mit dem fehlenden Recht und
  // seinen Vergebern nennt. Keiner der drei Kernseed-Nutzer eignet sich: Jede/r trägt in einem anderen
  // Modultest schon die Rolle „ohne X“ oder „mit contacts.view“ — eine eigene, ad-hoc angelegte Rolle
  // (nicht Grundausstattung, `installFinance` liefert genau fünf) hält das getrennt.
  await ensureCashOnlyPerson(deps, ctx);

  // F6a (aus Task 9 vorgezogen): Bescheid, maschinelles Verfahren, Bestätigungen in ihren Zuständen.
  await seedDonations(deps, ctx, storyYear);

  // F3a-N Task 2, seit D2 über den Erklärungszeitraum (Abgabe im Mai): die Steuererklärung des Vorjahrs gilt als
  // abgegeben — erst nach den zwei wartenden Korrekturen oben, damit sie ohne § 153 entstehen; von hier an löst jede
  // Partei-, Auslands- oder Zweckänderung im Vorjahr die Kenntnisnahme nach § 153 AO aus. Nach Bescheid und
  // Serienlauf, damit die festgeschriebene Fassung deren Stand trägt und nicht gleich veraltet.
  if (previousFiscalYear) await seedTaxReturn(deps, ctx, previousFiscalYear.id, storyYear);

  // F8a Task 7: Anträge in jedem Zustand — nach `seedDonations`, weil der Verzicht den eingeschalteten
  // Aufwandsspenden-Schalter braucht, den `seedDonations` setzt.
  await seedExpenseClaims(deps, ctx, storyYear);

  // F7 Task 7: Partner und ihre Zahlungen in jedem Zustand — nach `grantApproverRoleToJonasFeld`, weil
  // Jonas Feld hier freigibt oder ablehnt.
  await seedPartners(deps, ctx, storyYear);

  // F8b Task 7: Rücklagen, Umwidmungen, Pauschalen an Vorstand und Nahestehende — nach
  // `grantApproverRoleToJonasFeld`, weil Jonas Feld die Umwidmung freigibt.
  await seedMittel(deps, ctx, storyYear);

  // Spec 2026-10-06 § 4: Clara Neumann kommt bei der Mitgliederversammlung in den Vorstand, Bernd Hagedorn geht.
  await seedBoardHistory(deps, ctx, storyYear);

  // Plan L1 Task 7: Lastschrift mit Testkennung, Mandaten in jedem Zustand und zwei Zusagen.
  await seedDirectDebit(deps, ctx, storyYear, seedProject(deps)?.id ?? null);

  // Rechenschaft B1: eine Ausgabe nach § 13b und eine Rechnung, deren Beleg an zwei Teilzahlungen hängt.
  await seedVatObligations(deps, ctx, storyYear);
  await seedReusedVoucher(deps, ctx, storyYear);

  // Rechenschaft B2: zwei Datenexporte des Vorjahres — einer zum Herunterladen, einer nach 30 Tagen gelöscht.
  await seedDataExports(deps, ctx, previousYear);
}

/**
 * Die Buchungen eines frühen Jahres (Plan seed-mehrjahre): klein, alles bar über die „Barkasse“ — bis zum Konto bei der
 * Beispielbank (eröffnet zum Vorjahr) lief der Verein bar. So braucht das Jahr keinen Kontoauszug, und die Bankbestände
 * ab dem Vorjahr bleiben, wie sie sind. Je Jahr erfunden; `late` ist die Buchung, die nach der Prüfung nachkommt.
 */
const EARLY_YEAR_ENTRIES: Record<number, { text: string; day: string; cents: number; category: string; purpose?: string; voucher: string; late?: true }[]> = {
  3: [
    { text: 'Beiträge bar Jahrestreffen', day: '03-15', cents: 21000, category: 'membership-fees', voucher: 'Liste Beiträge Jahrestreffen' },
    { text: 'Bewirtung Jahrestreffen', day: '03-15', cents: -2400, category: 'member-care', voucher: 'Kassenbon Bewirtung Jahrestreffen' },
    { text: 'Druck Einladungen Jahrestreffen', day: '03-20', cents: -1900, category: 'office', voucher: 'Rechnung Druck Einladungen' },
    { text: 'Sammlung Stadtteilfest', day: '07-02', cents: 6500, category: 'donations', voucher: 'Zählliste Sammlung Stadtteilfest' },
  ],
  2: [
    { text: 'Beiträge bar Mitgliederabend', day: '03-12', cents: 24000, category: 'membership-fees', voucher: 'Liste Beiträge Mitgliederabend' },
    { text: 'Zutaten Frühlingsmarkt', day: '04-18', cents: -3500, category: 'business-costs', voucher: 'Kassenbon Zutaten Frühlingsmarkt' },
    { text: 'Kuchenverkauf Frühlingsmarkt', day: '04-20', cents: 12000, category: 'events', voucher: 'Zählliste Kuchenverkauf Frühlingsmarkt' },
    { text: 'Spende bar Dachsanierung', day: '06-08', cents: 10000, category: 'donations', purpose: 'Dachsanierung Vereinsheim', voucher: 'Quittung Spende Dachsanierung' },
    { text: 'Versand Jahresbrief', day: '09-15', cents: -2800, category: 'office', voucher: 'Quittung Versand Jahresbrief' },
    { text: 'Nachbuchung Quittung Dezember', day: '12-29', cents: -1500, category: 'program-costs', voucher: 'Quittung Material Dezember', late: true },
  ],
};

/** Ein Beschluss als PDF-Ablage für Rücklagen (wie in `seedMittel`), am Tag des Beschlusses. */
const reserveMinutes = (title: string, documentDate: string) => ({ bytes: textPdf([title, '', 'Erfundenes Beispiel für die Entwicklung.']), fileName: `${title}.pdf`, documentDate });
const reserveWriteCtx = (ctx: CallContext): CallContext => ({ ...ctx, permissions: new Set([...ctx.permissions, 'finance.setup', 'finance.entriesWrite', 'finance.read', 'dms.view', 'dms.create']) });
const reserveNamedInternal = (deps: Deps, name: string) => deps.db.select({ id: financeReserves.id }).from(financeReserves).where(eq(financeReserves.name, name)).get();
const movementsOf = (deps: Deps, reserveId: string) => deps.db.select().from(financeReserveMovements).where(eq(financeReserveMovements.reserveId, reserveId)).all();

/** Wirtschaftsgut der Wiederbeschaffungsrücklage für Zeile 54 der Anlage Gem (erfunden, Joe F8). */
const REPLACEMENT_ASSET = { asset: 'Kleintransporter für Vereinsfahrten', expectedCostCents: 2400000, regularDepreciationCents: 400000 } as const;
/** Zuführung je Jahr vor dem Stichjahr, ältestes zuerst (Joe F8: angespart über die drei Jahre, aufgelöst beim Kauf). */
const REPLACEMENT_ALLOCATIONS = [10000, 10000, 20000] as const;

/**
 * „Ersatz Transporter“ (Plan seed-mehrjahre Task 6): angelegt im Januar des ersten Seed-Jahres, je abgeschlossenem Jahr
 * eine Zuführung im Dezember, bevor das Jahr schließt; aufgelöst wird sie im Stichjahr beim Kauf (`seedMittel`). Je Jahr
 * einmal.
 */
async function seedReplacementReserveYear(deps: Deps, ctx: CallContext, year: number, storyYear: number): Promise<void> {
  const index = year - (storyYear - SEED_CLOSED_YEARS);
  const amountCents = REPLACEMENT_ALLOCATIONS[REPLACEMENT_ALLOCATIONS.length - SEED_CLOSED_YEARS + index];
  if (amountCents === undefined) return;
  const writeCtx = reserveWriteCtx(ctx);
  const known = reserveNamedInternal(deps, 'Ersatz Transporter');
  const reserve = known ?? unwrap(await saveReserve(on(deps, `${year}-01-14`), writeCtx, { kind: 'replacement', name: 'Ersatz Transporter', purposeText: 'Ersatz des Vereinsfahrzeugs', resolutionUpload: reserveMinutes('Protokoll Ersatz Transporter', `${year}-01-14`) }));
  if (movementsOf(deps, reserve.id).some((m) => m.movementDate.startsWith(String(year)))) return;
  const day = `${year}-12-15`;
  unwrap(await recordReserveMovement(on(deps, day), writeCtx, { reserveId: reserve.id, kind: 'allocate', movementDate: day, amountCents, resolutionUpload: reserveMinutes(`Protokoll Zuführung Ersatz Transporter ${year}`, day) }));
}

/**
 * Die freie Rücklage entsteht im Jahr vor dem Vorjahr (Joe F2) mit einer Zuführung für dieses Jahr zur Hälfte des
 * Höchstbetrags — im Stichjahr kommt auf dieselbe Rücklage die Zuführung zu 85 % (`seedMittel`). Einmal.
 */
async function seedEarlyFreeReserve(deps: Deps, ctx: CallContext, fiscalYearId: string, year: number): Promise<void> {
  const writeCtx = reserveWriteCtx(ctx);
  const known = reserveNamedInternal(deps, 'Freie Rücklage');
  if (known && movementsOf(deps, known.id).some((m) => m.forFiscalYearId === fiscalYearId)) return;
  const free = known ?? unwrap(await saveReserve(on(deps, `${year}-11-20`), writeCtx, { kind: 'free', name: 'Freie Rücklage', resolutionUpload: reserveMinutes('Protokoll Freie Rücklage', `${year}-11-20`) }));
  const cap = unwrap(await freeReserveCap(deps, writeCtx, { fiscalYearId })).capCents;
  const amountCents = Math.floor(cap / 2);
  if (amountCents <= 0) return;
  const day = `${year}-12-20`;
  unwrap(await recordReserveMovement(on(deps, day), writeCtx, { reserveId: free.id, kind: 'allocate', movementDate: day, amountCents, forFiscalYearId: fiscalYearId, resolutionUpload: reserveMinutes(`Protokoll Zuführung Freie Rücklage ${year}`, day) }));
}

/** Holger Brandt, erfunden: prüft auf Papier, ohne Vorstandsrolle. */
async function ensureHolgerBrandt(deps: Deps, ctx: CallContext): Promise<{ id: string }> {
  const contactCtx: CallContext = { ...ctx, permissions: new Set([...ctx.permissions, 'contacts.manage']) };
  const known = deps.db.select({ id: contacts.id }).from(contacts).where(and(eq(contacts.firstName, 'Holger'), eq(contacts.lastName, 'Brandt'))).get();
  return known ?? unwrap(await createContact(deps, contactCtx, { kind: 'person', salutation: 'Herr', firstName: 'Holger', lastName: 'Brandt', street: 'Am Mühlbach 12', postalCode: '12347', city: 'Musterstadt' }));
}

/** Die Berichte der Gruppe MV eines Jahres, je Bericht nur, solange keine gültige Fassung besteht (nach Wiederöffnen neu). */
async function finalizeAssemblyReports(deps: Deps, ctx: CallContext, fiscalYearId: string, day: string): Promise<void> {
  for (const key of ['cashReport', 'incomeStatement', 'assetOverview', 'purposeFunds'] as const) {
    const valid = deps.db.select({ id: financeReports.id }).from(financeReports).where(and(eq(financeReports.reportKey, key), eq(financeReports.fiscalYearId, fiscalYearId), isNull(financeReports.voidedAt))).get();
    if (!valid) unwrap(await finalizeFinanceReport(on(deps, day), ctx, { report: key, params: { fiscalYearId } }));
  }
}

/**
 * Ein frühes Jahr mit vollem Jahresabschluss (Joe 2026-10-26, F4): Buchungen bar mit Beleg, Zählung am 31.12.,
 * Abschluss am 20.01., Prüfung auf Papier durch Holger Brandt (Bericht am 20.02. abgelegt), Berichte der MV am 25.02.
 * festgeschrieben, MV mit Einzelentlastung am 14.03., übrige Schritte am 20.03. Im Jahr vor dem Vorjahr kommt nach der
 * MV eine Quittung nach: Wiederöffnen im April, nachbuchen, neu abschließen und die Nachprüfung ins Folgejahr übernehmen
 * (`carryOverAuditFollowUp`) — so trägt der Kassenbericht des Vorjahres eine übernommene Buchung. Jeder Schritt für sich
 * idempotent; was einmal geschehen ist, bleibt.
 */
async function seedEarlyYear(deps: Deps, ctx: CallContext, year: number, storyYear: number): Promise<void> {
  const fiscalYear = deps.db.select().from(financeFiscalYears).where(eq(financeFiscalYears.designation, String(year))).get();
  if (!fiscalYear) return;
  const next = year + 1;
  const cash = accountByName(deps, 'Barkasse');
  const entries = EARLY_YEAR_ENTRIES[storyYear - year] ?? [];
  const book = async (e: (typeof entries)[number]) => {
    const date = `${year}-${e.day}`;
    const purposeId = e.purpose ? purposeByName(deps, e.purpose).id : undefined;
    await ensureEntry(deps, e.text, () =>
      bookEntry(on(deps, date), ctx, { entryDate: date, text: e.text, moneyLines: [{ accountId: cash.id, amountCents: e.cents }], allocationLines: [{ categoryId: categoryByKey(deps, e.category).id, amountCents: e.cents, ...(purposeId ? { purposeId } : {}) }] }).then(unwrap),
    );
    await ensureVoucher(deps, ctx, entryByText(deps, e.text), 'voucher-receipt', date, e.voucher);
  };

  if (fiscalYearStatusInternal(deps.db, fiscalYear.id) === 'open' && !carryOverOfYearInternal(deps.db, fiscalYear.id)) {
    for (const e of entries.filter((x) => !x.late)) await book(e);
    await seedReplacementReserveYear(deps, ctx, year, storyYear);
    if (year === storyYear - 2) await seedEarlyFreeReserve(deps, ctx, fiscalYear.id, year);
    await seedYearEndCashCount(deps, ctx, year);
    unwrap(await closeFiscalYear(on(deps, `${next}-01-20`), ctx, { id: fiscalYear.id }));
  }

  if (!lastFiledReportInternal(deps.db, fiscalYear.id)) {
    const holger = await ensureHolgerBrandt(deps, ctx);
    if (!deps.db.select({ id: financeAuditAuditors.id }).from(financeAuditAuditors).where(eq(financeAuditAuditors.fiscalYearId, fiscalYear.id)).get()) {
      unwrap(await saveAuditor(on(deps, `${next}-02-01`), ctx, { fiscalYearId: fiscalYear.id, contactId: holger.id, mode: 'paper', confidential: true, electedOn: `${year}-04-12` }));
    }
    const blank = unwrap(await printAuditReportBlank(on(deps, `${next}-02-18`), ctx, { fiscalYearId: fiscalYear.id }));
    unwrap(await fileAuditReportScan(on(deps, `${next}-02-20`), ctx, { reportId: blank.reportId, bytes: textPdf([`Prüfbericht ${year}`, 'Kassenprüfung auf Papier, unterschrieben', 'Erfundenes Beispiel für die Entwicklung.']), fileName: 'pruefbericht.pdf' }));
  }
  await seedStatementPdfs(deps, ctx, fiscalYear.id);
  await finalizeAssemblyReports(deps, ctx, fiscalYear.id, `${next}-02-25`);
  await seedClosing(deps, ctx, fiscalYear.id, next);

  // Die Quittung, die nach der MV auftaucht: nur einmal, solange keine Übernahme besteht.
  const late = entries.find((x) => x.late);
  if (late && !carryOverOfYearInternal(deps.db, fiscalYear.id)) {
    const april = `${next}-04-10`;
    if (fiscalYearStatusInternal(deps.db, fiscalYear.id) === 'closed') unwrap(await reopenFiscalYear(on(deps, april), ctx, { id: fiscalYear.id, note: 'Quittung vom Dezember nach der Mitgliederversammlung gefunden' }));
    await book(late);
    unwrap(await closeFiscalYear(on(deps, april), ctx, { id: fiscalYear.id }));
    unwrap(await carryOverAuditFollowUp(on(deps, april), ctx, { fiscalYearId: fiscalYear.id, note: `Korrektur geht in Prüfpaket und Kassenbericht ${next} und wird der nächsten Mitgliederversammlung berichtet` }));
    await finalizeAssemblyReports(deps, ctx, fiscalYear.id, april);
    await seedClosing(deps, ctx, fiscalYear.id, next);
  }
}

/**
 * Rechenschaft B1 (Zweckmittel): Im Vorjahr ein Zuschuss für die Dachsanierung und eine Ausgabe für die Dachrinne ohne
 * Zweck, beide belegt; im Januar des Stichjahres ordnet eine Korrektur die Ausgabe der Dachsanierung zu. Das Vorjahr
 * ist da noch offen, die Korrektur gilt sofort — im Bericht „Zweckmittel“ des Stichjahres steht sie unter
 * „Korrekturen“. Einmal (die Buchungen und die Korrektur je nur einmal).
 */
async function seedPriorYearPurposeCorrection(deps: Deps, ctx: CallContext, previousYear: number, storyYear: number): Promise<void> {
  const bank = accountByName(deps, 'Vereinskonto');
  const dach = purposeByName(deps, 'Dachsanierung Vereinsheim');
  const [grant, gutter] = ['Zuschuss Stiftung Dachsanierung', 'Dachrinne Vereinsheim'];
  await ensureEntry(deps, grant, () =>
    bookEntry(on(deps, `${previousYear}-10-01`), ctx, { entryDate: `${previousYear}-10-01`, text: grant, moneyLines: [{ accountId: bank.id, amountCents: 20000 }], allocationLines: [{ categoryId: categoryByKey(deps, 'purpose-income').id, amountCents: 20000, purposeId: dach.id }] }).then(unwrap),
  );
  await ensureVoucher(deps, ctx, entryByText(deps, grant), 'voucher-own', `${previousYear}-10-01`, 'Bewilligung Zuschuss Dachsanierung');
  await ensureEntry(deps, gutter, () =>
    bookEntry(on(deps, `${previousYear}-11-20`), ctx, { entryDate: `${previousYear}-11-20`, text: gutter, moneyLines: [{ accountId: bank.id, amountCents: -5000 }], allocationLines: [{ categoryId: categoryByKey(deps, 'program-costs').id, amountCents: -5000 }] }).then(unwrap),
  );
  await ensureVoucher(deps, ctx, entryByText(deps, gutter), 'voucher-invoice', `${previousYear}-11-18`, 'Rechnung Dachrinne');
  const line = firstAllocationLineOf(deps, entryByText(deps, gutter).id);
  await ensureCorrection(deps, line.id, () =>
    requestAllocationCorrection(on(deps, `${storyYear}-01-15`), ctx, { lineId: line.id, changes: { purposeId: dach.id }, note: 'Die Dachrinne gehört zur Dachsanierung' }).then(unwrap),
  );
}

/**
 * Rechenschaft B1 (Umsatzsteuer-Summen, Belegprüfung): ein Software-Abo eines erfundenen Anbieters in der EU nach
 * § 13b UStG — unter Kleinunternehmerschaft mit dem Hinweis auf die Jahreserklärung — und eine Rechnung der Druckerei,
 * in zwei Raten bezahlt, deren Beleg an beiden Buchungen hängt (erscheint unter „mehrfach verwendete Nachweise“).
 */
/**
 * E6a (Spec E6 § Seed, ohne die PayPal-Antwort aus E6b): Der Musterverein ist Kleinunternehmer und seit dem Vorjahr
 * umsatzsteuerlich Unternehmer mit (erfundener, prüfziffergültiger) USt-IdNr. Zwei erfundene Anbieter tragen das
 * Merkmal § 13b am Kontakt: Werbung aus Irland im Mai (Q2 abgegeben, Kz 46 = 200, Kz 47 = 38,00) und ein Software-Abo aus
 * dem Vereinigten Königreich im Juli mit Leistungsdatum (Q3 offen). Idempotent: Einstellung, Kontakte, Buchungen und
 * Abgabe nur, wenn es sie noch nicht gibt.
 */
/** Unternehmer mit USt-IdNr. seit dem 01.01. des Vorjahres (E6a), einmal. */
async function ensureVatSettings(deps: Deps, ctx: CallContext, previousYear: number): Promise<void> {
  if (!deps.db.select({ key: financeDatedValues.key }).from(financeDatedValues).where(eq(financeDatedValues.key, 'vatEntrepreneur')).get()) {
    unwrap(await saveVatSettings(on(deps, `${previousYear}-01-02`), ctx, { validFrom: `${previousYear}-01-01`, vatEntrepreneur: true, vatId: 'DE123456788' }));
  }
}

/** Ein erfundener Anbieter mit dem Merkmal § 13b am Kontakt, einmal je Name. */
async function ensureReverseChargeSupplier(deps: Deps, ctx: CallContext, name: string, country: string, reverseCharge: 'eu' | 'other'): Promise<{ id: string }> {
  const contactCtx: CallContext = { ...ctx, permissions: new Set([...ctx.permissions, 'contacts.manage']) };
  const known = deps.db.select({ id: contacts.id }).from(contacts).where(eq(contacts.name, name)).get();
  const contact = known ?? unwrap(await createContact(deps, contactCtx, { kind: 'organization', name, country }));
  if (!known) unwrap(await saveContactTaxDetails(deps, ctx, { contactId: contact.id, reverseCharge }));
  return contact;
}

/**
 * Joe 2026-10-26: Schon im Vorjahr eine Leistung nach § 13b — Werbung aus Irland im Oktober, die Voranmeldung Q4 im
 * Januar festgeschrieben und abgegeben, mit abgelegter Fassung wie Q2 (E11: Kennzahlen ab 2025), die Umsatzsteuer-Jahreserklärung des Vorjahres
 * bleibt offen. So nennt Schritt 12 des Vorjahres „Außerdem die Umsatzsteuer-Jahreserklärung … weil es Umsätze nach
 * § 13b gibt“ (Motiv 323). Vor dem Jahresauszug und dem Abschluss des Vorjahres, damit Auszug, Berichte und Hashes den
 * Stand tragen. Einmal.
 */
async function seedPriorYearReverseCharge(deps: Deps, ctx: CallContext, previousYear: number): Promise<void> {
  await ensureVatSettings(deps, ctx, previousYear);
  const ads = await ensureReverseChargeSupplier(deps, ctx, 'Werbenetz Ireland Ltd.', 'IE', 'eu');
  const text = 'Werbeanzeigen Herbst';
  const day = `${previousYear}-10-14`;
  await ensureEntry(deps, text, () =>
    bookEntry(on(deps, day), ctx, { entryDate: day, text, moneyLines: [{ accountId: accountByName(deps, 'Vereinskonto').id, amountCents: -15000 }], allocationLines: [{ categoryId: categoryByKey(deps, 'fundraising').id, amountCents: -15000, contactId: ads.id }] }).then(unwrap),
  );
  await ensureVoucher(deps, ctx, entryByText(deps, text), 'voucher-invoice', `${previousYear}-10-10`, 'Rechnung Werbenetz Herbst');
  const q4 = `${previousYear}-Q4`;
  const filedOn = `${previousYear + 1}-01-09`;
  // E11 (Befund 34 c): erst festschreiben, dann abgeben — wie Q2 des Stichjahres; vor den Festschreibungen des Vorjahres,
  // damit deren Stand die Fassung schon kennt. Liegt das Vorjahr vor 2025, kennt Kompass keine Kennzahlen: ohne Fassung.
  const hasForm = vatFormFor('advance', previousYear) !== null;
  if (hasForm && !deps.db.select({ id: financeReports.id }).from(financeReports).where(and(eq(financeReports.reportKey, 'vatAdvanceReturn'), eq(financeReports.params, JSON.stringify({ vatPeriod: q4 })))).get()) {
    unwrap(await finalizeFinanceReport(on(deps, filedOn), ctx, { report: 'vatAdvanceReturn', params: { vatPeriod: q4 } }));
  }
  if (!deps.db.select({ id: financeVatFilings.id }).from(financeVatFilings).where(eq(financeVatFilings.period, q4)).get()) {
    unwrap(await recordVatFiling(on(deps, filedOn), ctx, { period: q4, filedOn }));
  }
  const filing = deps.db.select().from(financeVatFilings).where(eq(financeVatFilings.period, q4)).get()!;
  if (filing.reportId && !filing.filedReturnDocumentId) {
    unwrap(await fileVatFilingDocument(on(deps, filedOn), ctx, { filingId: filing.id, slot: 'filedReturn', bytes: textPdf(['Umsatzsteuer-Voranmeldung, abgegebene Fassung', `4. Quartal ${previousYear}`, 'Platzhalter für das ELSTER-PDF', 'Erfundenes Beispiel für die Entwicklung.']), fileName: 'voranmeldung.pdf' }));
  }
  if (!filing.transmissionProtocolDocumentId) {
    unwrap(await fileVatFilingDocument(on(deps, filedOn), ctx, { filingId: filing.id, slot: 'transmissionProtocol', bytes: textPdf(['ELSTER-Übertragungsprotokoll', `Umsatzsteuer-Voranmeldung 4. Quartal ${previousYear}`, 'Erfundenes Beispiel für die Entwicklung.']), fileName: 'elster-protokoll.pdf' }));
  }
}

async function seedVatObligations(deps: Deps, ctx: CallContext, storyYear: number): Promise<void> {
  const previousYear = storyYear - 1;
  await ensureVatSettings(deps, ctx, previousYear);
  const contactCtx: CallContext = { ...ctx, permissions: new Set([...ctx.permissions, 'contacts.manage']) };
  const supplier = (name: string, country: string, reverseCharge: 'eu' | 'other') => ensureReverseChargeSupplier(deps, ctx, name, country, reverseCharge);
  const ads = await supplier('Werbenetz Ireland Ltd.', 'IE', 'eu');
  const tools = await supplier('Codewerk Tools Ltd.', 'GB', 'other');
  const bank = accountByName(deps, 'Vereinskonto');

  const may = 'Werbeanzeigen Mai';
  await ensureEntry(deps, may, () =>
    bookEntry(on(deps, `${storyYear}-05-12`), ctx, { entryDate: `${storyYear}-05-12`, text: may, moneyLines: [{ accountId: bank.id, amountCents: -20000 }], allocationLines: [{ categoryId: categoryByKey(deps, 'fundraising').id, amountCents: -20000, contactId: ads.id }] }).then(unwrap),
  );
  await ensureVoucher(deps, ctx, entryByText(deps, may), 'voucher-invoice', `${storyYear}-05-10`, 'Rechnung Werbenetz Mai');
  // E6b (Spec § Seed): ein erfundener Zahlungsdienst in Luxemburg mit dem gemerkten Nein „steuerfreie Zahlungsabwicklung“.
  const zahlfixName = 'Zahlfix Europe S.à r.l.';
  const zahlfixKnown = deps.db.select({ id: contacts.id }).from(contacts).where(eq(contacts.name, zahlfixName)).get();
  const zahlfix = zahlfixKnown ?? unwrap(await createContact(deps, contactCtx, { kind: 'organization', name: zahlfixName, country: 'LU' }));
  const fee = 'Gebühr Zahlungsdienst';
  await ensureEntry(deps, fee, () =>
    bookEntry(on(deps, `${storyYear}-07-03`), ctx, { entryDate: `${storyYear}-07-03`, text: fee, moneyLines: [{ accountId: bank.id, amountCents: -490 }], allocationLines: [{ categoryId: categoryByKey(deps, 'payment-fees').id, amountCents: -490, contactId: zahlfix.id, taxCode: 'none' }] }).then(unwrap),
  );
  if (!zahlfixKnown) unwrap(await declineReverseCharge(on(deps, `${storyYear}-07-03`), ctx, { contactId: zahlfix.id, reason: 'paymentServices' }));
  // Designer Runde 8 (Fachlich 1): ein erfundener Anbieter in Österreich ohne Merkmal, ohne gemerktes Nein und ohne
  // Partnerangaben — an ihm stellt die Buchung die Prüffrage § 13b (Motive 073, 093, 094). „Hilfswerk International“ ist
  // Partner und wird nicht mehr gefragt.
  const printerName = 'Druckerei Alpenblick GmbH';
  if (!deps.db.select({ id: contacts.id }).from(contacts).where(eq(contacts.name, printerName)).get()) unwrap(await createContact(deps, contactCtx, { kind: 'organization', name: printerName, country: 'AT' }));

  // E6b: Q2 erst festgeschrieben (nach Ende des Zeitraums, im offenen Jahr), dann abgegeben — mit Kennzahlen, Fassung
  // und ELSTER-Protokoll. Gab es die Abgabe schon (Seed vor E6b), verknüpft das Festschreiben sie mit der Fassung.
  const q2 = `${storyYear}-Q2`;
  const filedQ2 = on(deps, `${storyYear}-07-08`);
  // Voranmeldungen nach Kennzahlen kennt Kompass ab 2025 (`vat-forms.ts`): Liegt das Stichjahr davor, bleibt Q2 ohne Fassung.
  const hasForm = vatFormFor('advance', storyYear) !== null;
  if (hasForm && !deps.db.select({ id: financeReports.id }).from(financeReports).where(and(eq(financeReports.reportKey, 'vatAdvanceReturn'), eq(financeReports.params, JSON.stringify({ vatPeriod: q2 })))).get()) {
    unwrap(await finalizeFinanceReport(filedQ2, ctx, { report: 'vatAdvanceReturn', params: { vatPeriod: q2 } }));
  }
  if (!deps.db.select({ id: financeVatFilings.id }).from(financeVatFilings).where(eq(financeVatFilings.period, q2)).get()) {
    unwrap(await recordVatFiling(filedQ2, ctx, { period: q2, filedOn: `${storyYear}-07-08` }));
  }
  const filing = deps.db.select().from(financeVatFilings).where(eq(financeVatFilings.period, q2)).get()!;
  // E9 (Board Umsatzsteuer 8b): Mit festgeschriebener Fassung liegt auch die abgegebene Fassung als PDF ab. Ohne Fassung
  // (Stichjahr vor 2025) lehnt der Dienst sie ab (`vatFilingNotFinalized`) — dann bleibt sie weg.
  if (filing.reportId && !filing.filedReturnDocumentId) {
    unwrap(await fileVatFilingDocument(filedQ2, ctx, { filingId: filing.id, slot: 'filedReturn', bytes: textPdf(['Umsatzsteuer-Voranmeldung, abgegebene Fassung', `2. Quartal ${storyYear}`, 'Platzhalter für das ELSTER-PDF', 'Erfundenes Beispiel für die Entwicklung.']), fileName: 'voranmeldung.pdf' }));
  }
  if (!filing.transmissionProtocolDocumentId) {
    unwrap(await fileVatFilingDocument(filedQ2, ctx, { filingId: filing.id, slot: 'transmissionProtocol', bytes: textPdf(['ELSTER-Übertragungsprotokoll', `Umsatzsteuer-Voranmeldung 2. Quartal ${storyYear}`, 'Erfundenes Beispiel für die Entwicklung.']), fileName: 'elster-protokoll.pdf' }));
  }

  const abo = 'Software-Abo Codewerk';
  await ensureEntry(deps, abo, () =>
    bookEntry(on(deps, `${storyYear}-07-03`), ctx, { entryDate: `${storyYear}-07-03`, text: abo, moneyLines: [{ accountId: bank.id, amountCents: -4900 }], allocationLines: [{ categoryId: categoryByKey(deps, 'office').id, amountCents: -4900, contactId: tools.id, serviceDate: `${storyYear}-07-01` }] }).then(unwrap),
  );
  await ensureVoucher(deps, ctx, entryByText(deps, abo), 'voucher-invoice', `${storyYear}-07-01`, 'Rechnung Software-Abo Codewerk');
}

/** Ein Beleg an zwei Buchungen (Belegprüfung „mehrfach verwendet“, B1). */
async function seedReusedVoucher(deps: Deps, ctx: CallContext, storyYear: number): Promise<void> {
  const bank = accountByName(deps, 'Vereinskonto');
  const program = categoryByKey(deps, 'program-costs');
  const [first, second] = ['Druckerei Vereinszeitung Rate 1', 'Druckerei Vereinszeitung Rate 2'];
  await ensureEntry(deps, first, () => bookEntry(deps, ctx, { entryDate: `${storyYear}-05-05`, text: first, moneyLines: [{ accountId: bank.id, amountCents: -12000 }], allocationLines: [{ categoryId: program.id, amountCents: -12000 }] }).then(unwrap));
  await ensureEntry(deps, second, () => bookEntry(deps, ctx, { entryDate: `${storyYear}-06-05`, text: second, moneyLines: [{ accountId: bank.id, amountCents: -12000 }], allocationLines: [{ categoryId: program.id, amountCents: -12000 }] }).then(unwrap));
  const invoice = await ensureVoucher(deps, ctx, entryByText(deps, first), 'voucher-invoice', `${storyYear}-05-02`, 'Rechnung Druckerei Vereinszeitung');
  const secondEntry = entryByText(deps, second);
  if (invoice && !deps.db.select({ id: financeEntryDocuments.id }).from(financeEntryDocuments).where(eq(financeEntryDocuments.entryId, secondEntry.id)).get()) {
    unwrap(await attachDocument(on(deps, `${storyYear}-06-05`), { ...ctx, permissions: new Set([...ctx.permissions, 'dms.view']) }, { entryId: secondEntry.id, documentId: invoice.documentId }));
  }
}

/**
 * Rechenschaft D1 — die Kassenprüfung des Vorjahres (Spec § D1, Plan D1a Task 11). Mira Klein (Kernseed, Rolle
 * Kassenprüfer) prüft in Kompass, mit ihrem eigenen Kontext; Holger Brandt (erfunden, ohne Vorstandsrolle) auf Papier.
 *
 * Keine Transaktion um das Ganze: Die Dienste sind asynchron und öffnen ihre eigene (better-sqlite3 kennt keine
 * asynchrone). Stattdessen setzt jeder Schritt dort fort, wo ein abgebrochener Lauf stehen blieb (Plan D1d Task 4) —
 * und ist der Bericht abgelegt, bleibt alles, wie es ist.
 */
async function seedAudit(deps: Deps, ctx: CallContext, previousFiscalYearId: string, previousYear: number, storyYear: number): Promise<void> {
  // Liegt ein Bericht ab (auch wenn danach eine Nachprüfung läuft), ist die Prüfung des Seeds getan.
  if (lastFiledReportInternal(deps.db, previousFiscalYearId)) return;
  const existingReport = currentReportInternal(deps.db, previousFiscalYearId, 'report');
  const mira = deps.db.select().from(schema.users).where(eq(schema.users.email, 'mira@kompass.local')).get();
  const usersCtx: CallContext = { ...ctx, permissions: new Set(deps.registry.permissionKeys) };
  const contactCtx: CallContext = { ...ctx, permissions: new Set([...ctx.permissions, 'contacts.manage']) };
  const auditors = () => deps.db.select().from(financeAuditAuditors).where(eq(financeAuditAuditors.fiscalYearId, previousFiscalYearId)).all();
  const holger = async () => {
    const known = deps.db.select({ id: contacts.id }).from(contacts).where(and(eq(contacts.firstName, 'Holger'), eq(contacts.lastName, 'Brandt'))).get();
    return known ?? unwrap(await createContact(deps, contactCtx, { kind: 'person', salutation: 'Herr', firstName: 'Holger', lastName: 'Brandt', street: 'Am Mühlbach 12', postalCode: '12347', city: 'Musterstadt' }));
  };
  const scan = () => textPdf([`Prüfbericht ${previousYear}`, 'Platzhalter für den unterschriebenen Scan']);
  if (!mira) {
    // Ohne Kernseed (isolierte Modul-Tests) gibt es Mira nicht: Dann prüft Holger Brandt allein auf Papier — Vordruck
    // drucken, Scan ablegen, wie es die Schatzmeisterin täte.
    if (!auditors().some((a) => a.mode === 'paper')) unwrap(await saveAuditor(deps, ctx, { fiscalYearId: previousFiscalYearId, contactId: (await holger()).id, mode: 'paper', confidential: true, electedOn: `${previousYear}-04-12` }));
    const blank = unwrap(await printAuditReportBlank(deps, ctx, { fiscalYearId: previousFiscalYearId }));
    unwrap(await fileAuditReportScan(deps, ctx, { reportId: blank.reportId, bytes: scan(), fileName: 'pruefbericht.pdf' }));
    return;
  }
  // Für die Abnahme mit Miras Nutzer: dasselbe Passwort wie die Verwaltung, auf dem Weg des Betriebs (wie bei Nadja).
  if (!mira.lastLoginAt) {
    const { startPassword } = unwrap(await resetStartPassword(deps, usersCtx, { id: mira.id }));
    const session = unwrap(await login(deps, { email: mira.email, password: startPassword, ipAddress: null, requestId: ctx.requestId }));
    unwrap(await changeOwnPassword(deps, { ...ctx, userId: mira.id, permissions: new Set() }, session.sessionId, { currentPassword: startPassword, newPassword: SEED_ADMIN_PASSWORD }));
  }
  let miraContactId = contactIdForUserInternal(deps.db, mira.id);
  if (!miraContactId) {
    miraContactId = unwrap(await createContact(deps, contactCtx, { kind: 'person', salutation: 'Frau', firstName: 'Mira', lastName: 'Klein', street: 'Lindenallee 7', postalCode: '12346', city: 'Musterstadt' })).id;
    unwrap(await linkUserToContact(deps, usersCtx, { userId: mira.id, contactId: miraContactId }));
  }
  const miraAuditor = auditors().find((a) => a.contactId === miraContactId) ?? unwrap(await saveAuditor(deps, ctx, { fiscalYearId: previousFiscalYearId, contactId: miraContactId, mode: 'kompass', confidential: true, electedOn: `${previousYear}-04-12` }));
  const paperAuditor = auditors().find((a) => a.mode === 'paper') ?? unwrap(await saveAuditor(deps, ctx, { fiscalYearId: previousFiscalYearId, contactId: (await holger()).id, mode: 'paper', confidential: true, electedOn: `${previousYear}-04-12` }));
  const paperContactId = paperAuditor.contactId;

  // Ab hier schreibt Mira selbst — mit ihren Rechten, nicht mit denen des Seeds (Prüfung ist eine persönliche Erklärung).
  const miraCtx: CallContext = { ...ctx, userId: mira.id, permissions: getEffectivePermissions(deps.db, deps.registry, mira.id) };
  const entries = deps.db.select({ id: financeEntries.id }).from(financeEntries).where(and(eq(financeEntries.fiscalYearId, previousFiscalYearId), eq(financeEntries.status, 'final'))).orderBy(asc(financeEntries.entryDate), asc(financeEntries.number)).all();
  if (!deps.db.select({ id: financeAuditSamples.id }).from(financeAuditSamples).where(eq(financeAuditSamples.auditorId, miraAuditor.id)).get()) {
    for (const entry of entries.slice(0, 3)) unwrap(await setSample(deps, miraCtx, { fiscalYearId: previousFiscalYearId, entryId: entry.id, sampled: true }));
  }
  // Schon durchgesehen: ein stummer Schritt.
  for (const section of ['journal', 'reconciliation', 'vouchers'] as const) unwrap(await markSectionReviewed(deps, miraCtx, { fiscalYearId: previousFiscalYearId, section }));

  // Vermerke in allen Zuständen: geklärt, beantwortet, offen, eine Feststellung, eine Frage für den Papier-Prüfer.
  if (!deps.db.select({ id: financeAuditRemarks.id }).from(financeAuditRemarks).where(eq(financeAuditRemarks.fiscalYearId, previousFiscalYearId)).get()) {
    const [first, second] = entries;
    if (first) {
      const resolved = unwrap(await createAuditRemark(deps, miraCtx, { fiscalYearId: previousFiscalYearId, kind: 'question', targetType: 'entry', targetId: first.id, text: 'Wofür war diese Zahlung? Der Verwendungszweck ist knapp.' }));
      unwrap(await answerAuditRemark(deps, ctx, { remarkId: resolved.id, text: 'Futter für die Pflegestelle Nord, Rechnung liegt als Beleg bei.' }));
      unwrap(await resolveAuditRemark(deps, miraCtx, { remarkId: resolved.id }));
    }
    if (second) {
      const answered = unwrap(await createAuditRemark(deps, miraCtx, { fiscalYearId: previousFiscalYearId, kind: 'question', targetType: 'entry', targetId: second.id, text: 'Gibt es zu dieser Buchung eine Quittung?' }));
      unwrap(await answerAuditRemark(deps, ctx, { remarkId: answered.id, text: 'Die Quittung reiche ich nach.' }));
    }
    unwrap(await createAuditRemark(deps, miraCtx, { fiscalYearId: previousFiscalYearId, kind: 'question', targetType: 'report', targetId: 'cashReport', text: 'Warum ist der Bestand der Zählkasse am Jahresende so hoch?' }));
    unwrap(await createAuditRemark(deps, miraCtx, { fiscalYearId: previousFiscalYearId, kind: 'finding', targetType: 'year', targetId: previousFiscalYearId, text: 'Zwei Buchungen ohne Beleg sind begründet, die Begründung ist knapp.' }));
    unwrap(await createAuditRemark(deps, miraCtx, { fiscalYearId: previousFiscalYearId, kind: 'question', targetType: 'year', targetId: previousFiscalYearId, text: 'Wurde die Spendendose im Dezember geleert?', onBehalfOfAuditorId: paperAuditor.id }));
  }

  // Die Zählkasse wird am Prüfungstag im Beisein beider Prüfer gezählt (Designer 12f) — ohne Abweichung.
  const examDay = `${storyYear}-02-15`;
  const kasse = accountByName(deps, 'Zählkasse');
  if (kasse && !deps.db.select({ id: financeCashCountWitnesses.countId }).from(financeCashCountWitnesses).where(eq(financeCashCountWitnesses.auditorId, miraAuditor.id)).get()) {
    const book = accountBalancesAt(deps.db, examDay).find((b) => b.accountId === kasse.id)?.balanceCents ?? 0;
    // Am Prüfungstag selbst angelegt, wie jedes Dokument des Seeds an seinem Datum (seed-story.test.ts).
    unwrap(await countCash(seedClockAt(deps, seedMoment(deps, examDay)), ctx, { accountId: kasse.id, countedOn: examDay, countedCents: book, counterOneContactId: miraContactId, counterTwoContactId: paperContactId, witnessAuditorIds: [miraAuditor.id, paperAuditor.id] }));
  }

  // Der Bericht: Mira schreibt, gibt zum Unterschreiben frei und legt den Scan ab (Platzhalter-PDF).
  const report = existingReport ?? loadReport(deps.db, unwrap(await createAuditReportDraft(deps, miraCtx, { fiscalYearId: previousFiscalYearId, kind: 'report' })).id)!;
  if (report.state === 'draft') {
    unwrap(await saveAuditReportExamination(deps, miraCtx, { reportId: report.id, dates: [examDay], place: 'Vereinsheim' }));
    unwrap(await saveAuditReportResult(deps, miraCtx, { reportId: report.id, result: 'withFindings', recommendation: 'discharge' }));
    unwrap(await markAuditReportReadyToSign(deps, miraCtx, { reportId: report.id }));
  }
  unwrap(await fileAuditReportScan(deps, miraCtx, { reportId: report.id, bytes: scan(), fileName: 'pruefbericht.pdf' }));
}

/** Erfundene Sachwerte und eine erhaltene Kaution im Vorjahr (ein Gegenstand, eine Verpflichtung); einmal je Bezeichnung. */
async function seedOtherAssets(deps: Deps, ctx: CallContext, previousYear: number): Promise<void> {
  const entries = [
    { kind: 'asset', label: 'Transportboxen (12 Stück)', valueCents: 36000, basis: 'Rechnung', recordedFrom: `${previousYear}-03-15` },
    { kind: 'liability', label: 'Erhaltene Kaution für ein Leihgerät', valueCents: 15000, basis: 'Vertrag', recordedFrom: `${previousYear}-09-01` },
  ] as const;
  for (const entry of entries) {
    if (deps.db.select({ id: financeOtherAssets.id }).from(financeOtherAssets).where(eq(financeOtherAssets.label, entry.label)).get()) continue;
    unwrap(await saveOtherAsset(deps, ctx, entry));
  }
}

/** Je Bankkonto des Vorjahres ohne deckenden Auszug ein Platzhalter-PDF bis zum 31.12., am Tag des Auszugs abgelegt. */
async function seedStatementPdfs(deps: Deps, ctx: CallContext, previousFiscalYearId: string): Promise<void> {
  const year = deps.db.select().from(financeFiscalYears).where(eq(financeFiscalYears.id, previousFiscalYearId)).get()!;
  for (const row of accountStatementsForYearInternal(deps.db, year.id).filter((r) => r.kind === 'bank' && r.needsPdf)) {
    const bytes = textPdf([`Kontoauszug ${row.name}`, `${paperDate(isoDay(year.startsOn))} bis ${paperDate(isoDay(year.endsOn))}`, 'Erfundenes Beispiel für die Entwicklung.']);
    unwrap(await fileAccountStatementDocument(on(deps, year.endsOn), ctx, { accountId: row.accountId, periodFrom: year.startsOn, periodTo: year.endsOn, bytes, fileName: 'kontoauszug.pdf' }));
  }
}

/** Die Schatzmeisterin des Seeds und ihre Nachfolgerin — erfunden; Schatzmeisterin seit Beginn des Vorjahres. */
async function seedTreasurers(deps: Deps, ctx: CallContext, storyYear: number): Promise<{ treasurer: string; successor: string }> {
  const contactCtx: CallContext = { ...ctx, permissions: new Set([...ctx.permissions, 'contacts.manage']) };
  const person = async (firstName: string, lastName: string): Promise<string> => {
    const found = deps.db.select({ id: contacts.id }).from(contacts).where(and(eq(contacts.firstName, firstName), eq(contacts.lastName, lastName))).get();
    return found?.id ?? unwrap(await createContact(deps, contactCtx, { kind: 'person', firstName, lastName })).id;
  };
  const treasurer = await person('Tanja', 'Gerber');
  const successor = await person('Lena', 'Brückner');
  if (!deps.db.select({ id: contactRoles.id }).from(contactRoles).where(and(eq(contactRoles.contactId, treasurer), eq(contactRoles.role, 'treasurer'))).get()) {
    unwrap(await addContactRole(deps, contactCtx, { id: treasurer, role: 'treasurer', since: `${storyYear - 1}-01-01` }));
  }
  return { treasurer, successor };
}

/** Je aktiver Kasse eine Zählung am 31.12. des Vorjahres ohne Abweichung (Schritt 2), einmal. */
async function seedYearEndCashCount(deps: Deps, ctx: CallContext, previousYear: number): Promise<void> {
  const endsOn = `${previousYear}-12-31`;
  const { treasurer, successor } = await seedTreasurers(deps, ctx, previousYear + 1);
  const balances = new Map(accountBalancesAt(deps.db, endsOn).map((b) => [b.accountId, b.balanceCents]));
  for (const account of deps.db.select().from(financeAccounts).where(and(eq(financeAccounts.kind, 'cash'), eq(financeAccounts.isActive, true))).all()) {
    if (deps.db.select({ id: financeCashCounts.id }).from(financeCashCounts).where(and(eq(financeCashCounts.accountId, account.id), eq(financeCashCounts.countedOn, endsOn))).get()) continue;
    unwrap(await countCash(on(deps, endsOn), ctx, { accountId: account.id, countedOn: endsOn, countedCents: Math.max(0, balances.get(account.id) ?? 0), counterOneContactId: treasurer, counterTwoContactId: successor }));
  }
}

/** Erfundene Begründungen der Bestätigungen im Jahresabschluss des Seeds. */
const CLOSING_NOTES: Partial<Record<ClosingStepKey, string | null>> = {
  statements: null,
  lists: 'Die Belege ohne Buchung gehören ins Folgejahr; fremdes Geld ist weitergeleitet.',
  openItems: 'Offene Zahlungen am Stichtag geprüft, im Januar beglichen.',
  purposes: 'Restmittel der Zwecke gehen ins Folgejahr.',
  reserves: 'Beschlüsse liegen ab, Zuführungen sind erfasst.',
  confirmations: 'Spenden ohne Bestätigung: vereinfachter Nachweis oder kein Wunsch der Spender.',
};

/**
 * Schritt 12 mit Grund statt Wiederholung des Ergebnisses (Designer Runde 5, 1.3 Nr. 3): Das Jahr liegt mitten im
 * dreijährigen Erklärungszeitraum, abgegeben wird erst nach dessen Ende. Erfunden.
 */

/**
 * Rechenschaft D2, seit Plan seed-mehrjahre über die drei abgeschlossenen Jahre: der Erklärungszeitraum vom ersten
 * Seed-Jahr bis zum Vorjahr — angefordert im Januar, alle Pflichtangaben (erfunden), die Werte für die Anlage Gem im April
 * festgeschrieben, im Mai abgegeben mit ELSTER-PDF und Übertragungsprotokoll, noch ohne Bescheid; dazu der offene
 * Zeitraum des Stichjahres ohne Angaben. Die Satzung wurde im Januar des mittleren Jahres neu gefasst (darauf der
 * § 60a-Bescheid vom 01.03.), die Beiträge beschloss das Jahrestreffen des ersten Jahres. Persönliches Festschreiben über
 * den Kanal des Seeds (`ui`). Die Kontoauszüge liegen vorher (sonst `reportStatementsMissing`). Einmal.
 */
async function seedTaxReturn(deps: Deps, ctx: CallContext, previousFiscalYearId: string, storyYear: number): Promise<void> {
  const prev = storyYear - 1;
  const first = storyYear - SEED_CLOSED_YEARS;
  // Für die Platzhalter-PDFs: `textPdf` kennt nur Latin-1, also „bis“ statt Halbgeviertstrich.
  const label = first === prev ? String(prev) : `${first} bis ${prev}`;
  if (!taxPeriodOfYearInternal(deps.db, previousFiscalYearId)) {
    await seedStatementPdfs(deps, ctx, previousFiscalYearId);
    const years = deps.db.select().from(financeFiscalYears).orderBy(asc(financeFiscalYears.startsOn)).all().filter((y) => y.startsOn >= `${first}-01-01` && y.endsOn <= `${prev}-12-31`);
    const replacementId = reserveNamedInternal(deps, 'Ersatz Transporter')?.id;
    const jan = on(deps, `${storyYear}-01-12`);
    const period = unwrap(await createTaxPeriod(jan, ctx, { firstFiscalYearId: years[0]!.id, lastFiscalYearId: previousFiscalYearId, requestedOn: `${storyYear}-01-12`, withTaxAdvisor: false, dueOn: declarationDueOn(prev, false) }));
    const file = (when: Deps, slot: TaxPeriodDocumentSlot, lines: string[]) => fileTaxPeriodDocument(when, ctx, { id: period.id, slot, bytes: textPdf([...lines, 'Erfundenes Beispiel für die Entwicklung.']), fileName: `${slot}.pdf` }).then(unwrap);
    await file(jan, 'request', [`Aufforderung zur Abgabe der Steuererklärung ${label}`]);
    unwrap(
      await saveTaxPeriodAnswers(on(deps, `${storyYear}-04-15`), ctx, {
        id: period.id,
        answers: {
          churchPurposes: false,
          charitablePurposes: false,
          statuteDate: `${storyYear - 2}-01-18`,
          statuteSubmission: 'onFile',
          feeResolution: { date: `${first}-03-15` },
          feeResolutionSubmission: 'onFile',
          welfare: false,
          hospital: false,
          sport: false,
          gratuitousBenefits: false,
          withholdingTax50a: false,
          // Zeile 54: das Wirtschaftsgut der Wiederbeschaffungsrücklage (F8).
          ...(replacementId ? { replacementAssets: { [replacementId]: { ...REPLACEMENT_ASSET } } } : {}),
          // Mitglieder am Jahresende, von Hand (F7): drei mehr je Jahr bis 37 im Vorjahr.
          memberCounts: Object.fromEntries(years.map((y, i) => [y.id, 37 - 3 * (years.length - 1 - i)])),
        },
      }),
    );
    unwrap(await finalizeFinanceReport(on(deps, `${storyYear}-04-20`), ctx, { report: 'taxReturnGem', params: { taxPeriodId: period.id } }));
    const may = on(deps, `${storyYear}-05-31`);
    await file(may, 'filedReturn', [`Körperschaftsteuererklärungen ${label} mit Anlage Gem`, 'Platzhalter für das ELSTER-PDF']);
    await file(may, 'transmissionProtocol', [`ELSTER-Übertragungsprotokoll ${label}`, 'Platzhalter']);
    unwrap(await updateTaxPeriod(may, ctx, { id: period.id, filedOn: `${storyYear}-05-31` }));
  }
  const storyFiscalYear = deps.db.select().from(financeFiscalYears).where(eq(financeFiscalYears.designation, String(storyYear))).get();
  if (storyFiscalYear && !taxPeriodOfYearInternal(deps.db, storyFiscalYear.id)) {
    unwrap(await createTaxPeriod(on(deps, `${storyYear}-06-01`), ctx, { firstFiscalYearId: storyFiscalYear.id, lastFiscalYearId: storyFiscalYear.id, withTaxAdvisor: false, dueOn: declarationDueOn(storyYear, false) }));
  }
}

/**
 * Der Jahresabschluss des Vorjahres bis zum Ende (Rechenschaft C): Bestätigungen, Zahlungsdienst „nicht abstimmbar“,
 * Ergebnis der MV mit Einzelentlastung, Schritt 12. Persönliche Schritte über den Kanal des Seeds (`ui`). Idempotent:
 * was schon bestätigt oder gespeichert ist, bleibt.
 */
async function seedClosing(deps: Deps, ctx: CallContext, previousFiscalYearId: string, storyYear: number): Promise<void> {
  await seedTreasurers(deps, ctx, storyYear);
  // Die Reihenfolge eines Vereinsjahres (Designer Runde 5, 1.3 Nr. 1): Berichte nach der Prüfung im Februar
  // festgeschrieben, die MV im März, danach die übrigen Bestätigungen.
  const feb = on(deps, `${storyYear}-02-25`);
  for (const key of ['incomeStatement', 'assetOverview', 'purposeFunds'] as const) {
    const finalized = deps.db.select({ id: financeReports.id }).from(financeReports).where(and(eq(financeReports.reportKey, key), eq(financeReports.fiscalYearId, previousFiscalYearId))).get();
    if (!finalized) unwrap(await finalizeFinanceReport(feb, ctx, { report: key, params: { fiscalYearId: previousFiscalYearId } }));
  }
  for (const row of accountStatementsForYearInternal(deps.db, previousFiscalYearId)) {
    if (row.kind === 'paymentService' && !row.importedBalance && !row.confirmation) unwrap(await confirmAccountForYear(on(deps, `${storyYear}-01-15`), ctx, { fiscalYearId: previousFiscalYearId, accountId: row.accountId, kind: 'notReconcilable' }));
  }
  if (!assemblyOfYearInternal(deps.db, previousFiscalYearId)) {
    const persons = unwrap(await getAssemblyResult(deps, ctx, { fiscalYearId: previousFiscalYearId })).persons;
    unwrap(await saveAssemblyResult(on(deps, `${storyYear}-03-14`), ctx, { fiscalYearId: previousFiscalYearId, assemblyOn: `${storyYear}-03-14`, accountsApproved: 'yes', dischargeMode: 'individual', discharges: persons.map((p) => ({ contactId: p.contactId, outcome: 'granted' })) }));
  }
  const status = unwrap(await getClosingStatus(deps, ctx, { fiscalYearId: previousFiscalYearId }));
  for (const step of status.steps) {
    const note = CLOSING_NOTES[step.key];
    if (step.done || !step.confirmable || step.confirmation || note === undefined) continue;
    unwrap(await confirmClosingStep(on(deps, `${storyYear}-03-20`), ctx, { fiscalYearId: previousFiscalYearId, step: step.key, ...(note ? { note } : {}) }));
  }
}

/**
 * Im Stichjahr (Rechenschaft C): die Wiedervorlage „Jahresabschluss vor der Mitgliederversammlung“ und eine
 * Amtsübergabe am 30.06. mit festgehaltenem Zwischenbericht — Zählung, Punkte und Protokoll bleiben offen. Einmal.
 */
async function seedHandover(deps: Deps, ctx: CallContext, storyYear: number): Promise<void> {
  const year = deps.db.select().from(financeFiscalYears).where(eq(financeFiscalYears.designation, String(storyYear))).get();
  if (!year) return;
  const followCtx: CallContext = { ...ctx, permissions: new Set([...ctx.permissions, 'followUps.view', 'followUps.manage']) };
  const title = 'Jahresabschluss vor der Mitgliederversammlung';
  if (!deps.db.select({ id: schema.followUps.id }).from(schema.followUps).where(and(eq(schema.followUps.entityType, 'financeFiscalYear'), eq(schema.followUps.entityId, year.id), eq(schema.followUps.title, title))).get()) {
    unwrap(await createFollowUp(deps, followCtx, { entityType: 'financeFiscalYear', entityId: year.id, dueAt: `${storyYear + 1}-02-28`, title }));
  }
  if (deps.db.select({ id: financeHandovers.id }).from(financeHandovers).where(eq(financeHandovers.fiscalYearId, year.id)).get()) return;
  const { treasurer, successor } = await seedTreasurers(deps, ctx, storyYear);
  const handover = unwrap(await startHandover(deps, ctx, { handoverOn: `${storyYear}-06-30`, fromContactId: treasurer, toContactId: successor }));
  unwrap(await recordHandoverInterimReport(deps, ctx, { id: handover.id }));
}

/** Der festgeschriebene Kassenbericht des Vorjahres. */
async function seedCashReport(deps: Deps, ctx: CallContext, previousFiscalYearId: string): Promise<void> {
  const finalized = deps.db.select({ id: financeReports.id }).from(financeReports).where(and(eq(financeReports.reportKey, 'cashReport'), eq(financeReports.fiscalYearId, previousFiscalYearId))).get();
  if (!finalized) unwrap(await finalizeFinanceReport(deps, ctx, { report: 'cashReport', params: { fiscalYearId: previousFiscalYearId } }));
}

async function grantAuditorRoleToMiraKlein(deps: Deps, ctx: CallContext): Promise<void> {
  const mira = deps.db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, 'mira@kompass.local')).get();
  if (!mira) return;
  const auditorRole = deps.db.select({ id: schema.roles.id }).from(schema.roles).where(eq(schema.roles.name, 'Kassenprüfer')).get();
  if (!auditorRole) return;
  const already = deps.db
    .select({ userId: schema.userRoles.userId })
    .from(schema.userRoles)
    .where(and(eq(schema.userRoles.userId, mira.id), eq(schema.userRoles.roleId, auditorRole.id)))
    .get();
  if (already) return;
  // Wie `ensureDonors`: die nötigen Rechte lokal dazugeben, unabhängig davon, was der Aufrufer selbst
  // mitbringt — `users.manage` fürs Vergeben, alle Rechte der Rolle selbst (`requireGrantableRole`).
  const usersCtx: CallContext = { ...ctx, permissions: new Set(deps.registry.permissionKeys) };
  unwrap(await assignRole(deps, usersCtx, { userId: mira.id, roleId: auditorRole.id }));
}

async function grantApproverRoleToJonasFeld(deps: Deps, ctx: CallContext): Promise<void> {
  const jonas = deps.db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, 'jonas@kompass.local')).get();
  if (!jonas) return;
  const approverRole = deps.db.select({ id: schema.roles.id }).from(schema.roles).where(eq(schema.roles.name, 'Freigeber Finanzen')).get();
  if (!approverRole) return;
  const already = deps.db
    .select({ userId: schema.userRoles.userId })
    .from(schema.userRoles)
    .where(and(eq(schema.userRoles.userId, jonas.id), eq(schema.userRoles.roleId, approverRole.id)))
    .get();
  if (already) return;
  const usersCtx: CallContext = { ...ctx, permissions: new Set(deps.registry.permissionKeys) };
  unwrap(await assignRole(deps, usersCtx, { userId: jonas.id, roleId: approverRole.id }));
}

/**
 * F3b Schritt 0: „Ines Brandt“ mit einer eigens angelegten, generischen Rolle
 * „Kassenassistenz“ (`finance.read`, `finance.entriesFinalize` — bewusst
 * ohne `contacts.view`). Idempotent über Name der Rolle und E-Mail der
 * Person, wie `grantAuditorRoleToMiraKlein`.
 */
async function ensureCashOnlyPerson(deps: Deps, ctx: CallContext): Promise<void> {
  const usersCtx: CallContext = { ...ctx, permissions: new Set(deps.registry.permissionKeys) };
  let role = deps.db.select({ id: schema.roles.id }).from(schema.roles).where(eq(schema.roles.name, 'Kassenassistenz')).get();
  if (!role) {
    const created = unwrap(await createRole(deps, usersCtx, { name: 'Kassenassistenz', description: 'Zählt und bewegt Bargeld, ohne Kontakte einzusehen.' }));
    unwrap(await setRolePermissions(deps, usersCtx, { roleId: created.id, permissionKeys: ['finance.read', 'finance.entriesFinalize'] }));
    role = { id: created.id };
  }
  let person = deps.db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, 'ines@kompass.local')).get();
  if (!person) {
    const created = unwrap(await createUser(deps, usersCtx, { name: 'Ines Brandt', email: 'ines@kompass.local', roleIds: [role.id] }));
    person = { id: created.user.id };
    return;
  }
  const already = deps.db.select({ userId: schema.userRoles.userId }).from(schema.userRoles).where(and(eq(schema.userRoles.userId, person.id), eq(schema.userRoles.roleId, role.id))).get();
  if (already) return;
  unwrap(await assignRole(deps, usersCtx, { userId: person.id, roleId: role.id }));
}

/**
 * Die Arbeitsliste (F5) auf „Importkonto“: eine Regel für die Büromaterial-Zeile
 * aus Lauf A, die IBAN von „Erika Beispiel“ an einem Kontakt, eine Handbuchung
 * ohne Kontoumsatz (Entwurf „Zuschuss“, einen Tag vor dem Zuschuss aus Lauf B —
 * Vorschlag 0 „passt zu Ihrer Buchung“) und ein Entwurf, den ein Agent über MCP
 * vorbereitet hat und der „Spende April“ bindet. Über die Dienste, jeder
 * Schritt für sich idempotent.
 */
/**
 * Spec 2026-10-06 § 4: Der Finanzabschnitt am Projekt zeigt Einnahmen und Ausgaben — bis 0.2.6 stand dort nur das
 * Ziel. Ein Zuschuss der Gemeinde und eine Ausgabe mit Kassenbon, beide mit `projectId`, beide belegt (sonst stünden
 * sie unter „Beleg fehlt“). Zwei Buchungen mehr: 47 im Journal, die „…Altjahr“-Zeilen bleiben auf Seite 1 (50).
 */
async function seedProjectBookings(deps: Deps, ctx: CallContext, projectId: string, year: number): Promise<void> {
  const bank = accountByName(deps, 'Vereinskonto');
  const grantDate = `${year}-01-12`;
  await ensureEntry(deps, 'Zuschuss Gemeinde Winterhilfe', () =>
    bookEntry(deps, ctx, { entryDate: grantDate, text: 'Zuschuss Gemeinde Winterhilfe', moneyLines: [{ accountId: bank.id, amountCents: 85000 }], allocationLines: [{ categoryId: categoryByKey(deps, 'public-grants').id, amountCents: 85000, projectId }] }).then(unwrap),
  );
  await ensureVoucher(deps, ctx, entryByText(deps, 'Zuschuss Gemeinde Winterhilfe'), 'voucher-own', grantDate, 'Bewilligung Zuschuss Winterhilfe', textPdf([
    'Gemeinde Musterstadt',
    'Fachbereich Soziales',
    '',
    'Bewilligung eines Zuschusses',
    '',
    'Für die Winterhilfe des Musterverein e.V. bewilligen wir einen',
    'Zuschuss von 850,00 EUR. Der Betrag wird überwiesen.',
    '',
    'Erfundenes Beispiel für die Entwicklung.',
  ]));
  const boxesDate = `${year}-01-26`;
  await ensureEntry(deps, 'Schlafboxen Winterhilfe', () =>
    bookEntry(deps, ctx, { entryDate: boxesDate, text: 'Schlafboxen Winterhilfe', moneyLines: [{ accountId: bank.id, amountCents: -42000 }], allocationLines: [{ categoryId: categoryByKey(deps, 'program-costs').id, amountCents: -42000, projectId }] }).then(unwrap),
  );
  await ensureVoucher(deps, ctx, entryByText(deps, 'Schlafboxen Winterhilfe'), 'voucher-receipt', boxesDate, 'Kassenbon Schlafboxen', receiptPdf({
    shop: ['Landhandel Kornblum', 'Feldweg 2', '12345 Musterstadt'],
    date: boxesDate,
    time: '11:20',
    receiptNo: '0815-3321',
    payment: 'EC-KARTE',
    items: [
      { text: 'Schlafbox isoliert 6 St.', cents: 33000 },
      { text: 'Strohballen 10 St.', cents: 6500, vat: 7 },
      { text: 'Fleecedecken 5 St.', cents: 2500 },
    ],
  }));
}

/**
 * Befund 34: Der Abschluss verlangt für jedes Bankkonto einen Auszug im Jahr.
 * Das Vereinskonto bekommt einen Jahresauszug ohne Zeilen — die Buchungen des
 * Vorjahrs sind von Hand erfasst —, mit dem festgeschriebenen Bestand als Saldo
 * (ohne Zeilen verlangt der Leser Anfangs- gleich Endsaldo).
 */
async function seedPreviousYearStatement(deps: Deps, ctx: CallContext, previousYear: number): Promise<void> {
  const account = accountByName(deps, 'Vereinskonto');
  // Je Jahr: ein Auszug des Kontos, der das Jahr berührt (Plan seed-mehrjahre Task 2).
  const hasRun = deps.db
    .select({ id: financeImportRuns.id })
    .from(financeImportRuns)
    .where(and(eq(financeImportRuns.accountId, account.id), lte(financeImportRuns.periodFrom, `${previousYear}-12-31`), gte(financeImportRuns.periodTo, `${previousYear}-01-01`)))
    .limit(1)
    .get();
  if (hasRun || !account.iban) return;
  const closingCents = accountBalancesAt(deps.db, `${previousYear}-12-31`).find((b) => b.accountId === account.id)?.balanceCents ?? 0;
  const bytes = buildCamt053Bytes({ iban: account.iban, from: `${previousYear}-01-01`, to: `${previousYear}-12-31`, openingCents: closingCents, closingCents, stmtId: `JAHR-${previousYear}`, lines: [] });
  unwrap(await importStatement(deps, ctx, { accountId: account.id, fileName: `jahresauszug-${previousYear}.xml`, bytes }));
}

async function seedWorkList(deps: Deps, ctx: CallContext, importkontoId: string, storyYear: number): Promise<void> {
  const contactCtx: CallContext = { ...ctx, permissions: new Set([...ctx.permissions, 'contacts.manage']) };
  let erika = deps.db.select({ id: contacts.id }).from(contacts).where(and(eq(contacts.firstName, 'Erika'), eq(contacts.lastName, 'Beispiel'))).get();
  if (!erika) erika = { id: unwrap(await createContact(deps, contactCtx, { kind: 'person', firstName: 'Erika', lastName: 'Beispiel' })).id };
  unwrap(await linkContactIban(deps, ctx, { contactId: erika.id, iban: 'DE66999999991234567890' }));

  const ruleExists = (name: string) => !!deps.db.select({ id: financeImportRules.id }).from(financeImportRules).where(eq(financeImportRules.name, name)).get();
  if (!ruleExists('Büromaterial')) {
    unwrap(await saveImportRule(deps, ctx, { name: 'Büromaterial', sortOrder: 2, accountId: importkontoId, direction: 'out', textContains: 'bueromaterial', categoryId: categoryByKey(deps, 'office').id, entryText: 'Büromaterial' }));
  }
  // Review Focus 2: eine Regel, deren Kategorie inzwischen stillgelegt ist. Sie greift vor „Büromaterial“,
  // trifft aber keinen Umsatz des Seeds — nur den Dezember-Auszug, den die E2E selbst lädt.
  await ensureCategory(deps, ctx, 'postage-old', { name: 'Porto (alt)', direction: 'expense', sphere: 'ideal', costFunction: 'administration' });
  if (!ruleExists('Bürobedarf Dezember')) {
    unwrap(await saveImportRule(deps, ctx, { name: 'Bürobedarf Dezember', sortOrder: 1, accountId: importkontoId, direction: 'out', textContains: 'dezember', categoryId: categoryByKey(deps, 'postage-old').id }));
  }
  const postageOld = categoryByKey(deps, 'postage-old');
  if (postageOld.isActive) unwrap(await setCategoryActive(deps, ctx, { id: postageOld.id, isActive: false, expectedVersion: postageOld.updatedAt }));

  await ensureEntry(deps, 'Zuschuss', async () =>
    unwrap(
      await saveDraft(deps, ctx, {
        entryDate: `${storyYear}-02-14`,
        text: 'Zuschuss',
        moneyLines: [{ accountId: importkontoId, amountCents: 5000 }],
        allocationLines: [{ categoryId: categoryByKey(deps, 'public-grants').id, amountCents: 5000 }],
      }),
    ),
  );

  await seedForeignMoneyAndVoucher(deps, ctx, importkontoId, storyYear);
  await seedZugferdInvoices(deps, ctx, storyYear);
  await seedCashDepositAndReturn(deps, ctx, importkontoId, storyYear);

  const april = deps.db.select().from(financeRawTransactions).where(and(eq(financeRawTransactions.accountId, importkontoId), eq(financeRawTransactions.bankReference, 'IMP-0004'))).get();
  const aprilBound = april ? deps.db.select({ id: financeMoneyLines.id }).from(financeMoneyLines).where(eq(financeMoneyLines.rawTransactionId, april.id)).get() : undefined;
  if (april && !aprilBound) {
    await ensureEntry(deps, 'Spende April', async () =>
      unwrap(
        await saveDraft(deps, { ...ctx, channel: 'mcp' as const }, {
          entryDate: april.bookingDate,
          text: 'Spende April',
          moneyLines: [{ accountId: importkontoId, amountCents: april.amountCents, rawTransactionId: april.id }],
          allocationLines: [{ categoryId: categoryByKey(deps, 'donations').id, amountCents: april.amountCents, contactId: erika.id }],
        }),
      ),
    );
  }
}

/**
 * F5 Task 8 (aus Task 9 vorgezogen): ein Juli-Auszug auf „Importkonto“ mit
 * einem Eingang, der dem Verein nicht gehört — eine Sammelbestellung Futter,
 * die für den Nachbarverein bezahlt wurde und noch weitergegeben werden muss —,
 * und eine Eingangsrechnung über 35,00 € in der Akte, noch ohne Buchung
 * („Beleg suchen“ findet sie über den Betrag der Büromaterial-Zeile). Jeder
 * Schritt über seinen Dienst und für sich idempotent.
 */
async function seedForeignMoneyAndVoucher(deps: Deps, ctx: CallContext, importkontoId: string, storyYear: number): Promise<void> {
  const JULY_FILE = `kontoauszug-${storyYear}-07.xml`;
  const hasJuly = deps.db.select({ id: financeImportRuns.id }).from(financeImportRuns).where(and(eq(financeImportRuns.accountId, importkontoId), eq(financeImportRuns.fileName, JULY_FILE))).get();
  if (!hasJuly) {
    unwrap(
      await importStatement(deps, ctx, {
        accountId: importkontoId,
        fileName: JULY_FILE,
        bytes: buildCamt053Bytes({
          iban: 'DE60999999990201051234',
          from: `${storyYear}-07-01`,
          to: `${storyYear}-07-31`,
          openingCents: 139000,
          lines: [{ bookingDate: `${storyYear}-07-06`, amountCents: 12000, counterpartyName: 'Max Muster', counterpartyIban: 'DE12999999990000112233', purpose: 'Sammelbestellung Futter, für Nachbarverein', bankReference: 'IMP-0007' }],
        }),
      }),
    );
  }
  const foreignRaw = deps.db.select().from(financeRawTransactions).where(and(eq(financeRawTransactions.accountId, importkontoId), eq(financeRawTransactions.bankReference, 'IMP-0007'))).get();
  const foreignBound = foreignRaw ? deps.db.select({ id: financeMoneyLines.id }).from(financeMoneyLines).where(eq(financeMoneyLines.rawTransactionId, foreignRaw.id)).get() : undefined;
  if (foreignRaw && !foreignBound) unwrap(await markTransactionForeign(deps, ctx, { rawTransactionId: foreignRaw.id, holder: 'Nachbarverein Beispielstadt', reviewed: false }));

  const INVOICE_SUBJECT = 'Rechnung Büromaterial über 35,00 €';
  const hasInvoice = deps.db.select({ id: dmsDocuments.id }).from(dmsDocuments).where(eq(dmsDocuments.subject, INVOICE_SUBJECT)).get();
  if (!hasInvoice) {
    const dmsCtx: CallContext = { ...ctx, permissions: new Set([...ctx.permissions, 'dms.view', 'dms.create']) };
    unwrap(
      await receiveDocument(on(deps, `${storyYear}-01-08`), dmsCtx, {
        filename: `${storyYear}-01-08 Rechnung Buerobedarf.pdf`,
        bytes: textPdf(['Buerobedarf Muster GmbH', `Rechnung Nr. ${storyYear}-0042`, '', 'Bueromaterial (Ordner, Papier, Stifte)', 'Rechnungsbetrag: 35,00 EUR']),
        typeKey: 'voucher-invoice',
        subject: INVOICE_SUBJECT,
        documentDate: `${storyYear}-01-08`,
        folder: null,
      }),
    );
  }
}

/**
 * F5b: zwei Eingangsrechnungen mit eingebetteter ZUGFeRD-XML, beide als
 * Finanzbeleg ohne Buchung — die Tierarzt-Rechnung über 119,00 € ist
 * unbezahlt (Karte „Aus der Rechnung“: „Offene Zahlung anlegen“), die über
 * 35,00 € von Bürobedarf Muster GmbH bezahlt: Ihre IBAN trägt die offene
 * Büromaterial-Zeile vom 10.01. des Stichjahrs auf „Importkonto“ (Lauf A). Je Rechnung
 * idempotent über den Betreff.
 */
async function seedZugferdInvoices(deps: Deps, ctx: CallContext, storyYear: number): Promise<void> {
  const dmsCtx: CallContext = { ...ctx, permissions: new Set([...ctx.permissions, 'dms.view', 'dms.create']) };
  const invoices = [
    { subject: `Rechnung TM-${storyYear}-0042 Tierarztpraxis Muster`, filename: `${storyYear}-04-01 Rechnung Tierarztpraxis.pdf`, documentDate: `${storyYear}-04-01`, bytes: () => buildVetInvoicePdf(storyYear) },
    { subject: 'Rechnung BM-7781 Bürobedarf Muster GmbH', filename: `${storyYear}-01-08 Rechnung BM-7781.pdf`, documentDate: `${storyYear}-01-08`, bytes: () => buildOfficeInvoicePdf(storyYear) },
    // Joe 2026-10-26: ein Anbieter aus den Niederlanden ohne deutsche Steuer (Kategorie AE) — der Rechnungsleser setzt
    // § 13b als Vorgabe aus der Rechnung, ohne Prüffrage (Designer Runde 8, Fachlich 2).
    { subject: `Rechnung CW-${storyYear}-118 Cloudwerk B.V.`, filename: `${storyYear}-06-03 Rechnung Cloudwerk.pdf`, documentDate: `${storyYear}-06-03`, bytes: () => buildForeignInvoicePdf(storyYear) },
  ];
  for (const invoice of invoices) {
    const exists = deps.db.select({ id: dmsDocuments.id }).from(dmsDocuments).where(eq(dmsDocuments.subject, invoice.subject)).get();
    if (exists) continue;
    unwrap(
      await receiveDocument(on(deps, invoice.documentDate), dmsCtx, {
        filename: invoice.filename,
        bytes: invoice.bytes(),
        typeKey: 'voucher-invoice',
        subject: invoice.subject,
        documentDate: invoice.documentDate,
        folder: null,
      }),
    );
  }
}

/**
 * F5 Task 9: ein August-Auszug auf „Importkonto“, der an den Juli anschließt.
 * Darin eine Bareinzahlung aus der Spendendose (die Bar-Kennung schlägt die
 * Umbuchung gegen die Barkasse vor — Prüfstein „Bareinzahlung bei der Bank“),
 * ein Mitgliedsbeitrag per Lastschrift, der gleich festgeschrieben wird, und
 * dessen Rückgabe mit Rückgabe-Code `AC04` (Vorschlag: zurückgegebene Zahlung
 * mit `originLineId`). Der Lauf und die Buchung sind je für sich idempotent.
 */
async function seedCashDepositAndReturn(deps: Deps, ctx: CallContext, importkontoId: string, storyYear: number): Promise<void> {
  const AUGUST_FILE = `kontoauszug-${storyYear}-08.xml`;
  const PAYER_IBAN = 'DE30999999990000505050';
  const hasAugust = deps.db.select({ id: financeImportRuns.id }).from(financeImportRuns).where(and(eq(financeImportRuns.accountId, importkontoId), eq(financeImportRuns.fileName, AUGUST_FILE))).get();
  if (!hasAugust) {
    unwrap(
      await importStatement(deps, ctx, {
        accountId: importkontoId,
        fileName: AUGUST_FILE,
        bytes: buildCamt053Bytes({
          iban: 'DE60999999990201051234',
          from: `${storyYear}-08-01`,
          to: `${storyYear}-08-31`,
          // Endsaldo des Juli-Auszugs: 1.390,00 € + 120,00 € fremdes Geld.
          openingCents: 151000,
          lines: [
            { bookingDate: `${storyYear}-08-04`, amountCents: 2500, counterpartyName: 'Paula Probe', counterpartyIban: PAYER_IBAN, purpose: 'Mitgliedsbeitrag August', bankReference: 'IMP-0008' },
            { bookingDate: `${storyYear}-08-10`, amountCents: 20000, purpose: 'Bareinzahlung Spendendose', bankReference: 'IMP-0009' },
            { bookingDate: `${storyYear}-08-20`, amountCents: -2500, counterpartyName: 'Paula Probe', counterpartyIban: PAYER_IBAN, purpose: 'Mitgliedsbeitrag August, Lastschrift zurueckgegeben', bankReference: 'IMP-0010', returnCode: 'AC04' },
          ],
        }),
      }),
    );
  }
  const fee = deps.db.select().from(financeRawTransactions).where(and(eq(financeRawTransactions.accountId, importkontoId), eq(financeRawTransactions.bankReference, 'IMP-0008'))).get();
  const feeBound = fee ? deps.db.select({ id: financeMoneyLines.id }).from(financeMoneyLines).where(eq(financeMoneyLines.rawTransactionId, fee.id)).get() : undefined;
  if (fee && !feeBound) {
    unwrap(
      await bookEntry(deps, ctx, {
        entryDate: fee.bookingDate,
        text: 'Mitgliedsbeitrag August',
        moneyLines: [{ accountId: importkontoId, amountCents: fee.amountCents, rawTransactionId: fee.id }],
        allocationLines: [{ categoryId: categoryByKey(deps, 'membership-fees').id, amountCents: fee.amountCents }],
      }),
    );
  }
}

/**
 * Ein erfundenes Faksimile: eine Wellenlinie, 96 × 32 Pixel, Graustufen-PNG.
 * Die Bytes stehen im Code, damit der Seed ohne Datei auskommt; die Vorlage
 * bindet es wie jedes hochgeladene Faksimile ein.
 */
const SEED_FACSIMILE_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAGAAAAAgCAAAAADIqyKIAAAAoUlEQVR42u2WUQ6AIAxD3/0vrSYashgoK8KX7BO7tsxtyrE42AJbICCvWCdACZcfj95USOIDzJLIGnqB0go3Oy5/WuGBMfCWrHtj2s/2RklkhL+vENtihL+nEBJVPWWt9TMyo0DPZcoYTR76dc4Yo8WE0SlyLhvAkRmvnlEHetOqthu1c8x9o3wxY2MqX0zZ+SKR718tnUfrvr7G/m35rcAJzhP2lpJRxHQAAAAASUVORK5CYII=';

type SeedContact = { kind: 'person'; firstName: string; lastName: string } | { kind: 'organization'; name: string };

/** Einen erfundenen Kontakt finden oder anlegen; die Anschrift nur, wo sie gegeben ist — sonst bleibt er „ohne Anschrift“. */
async function ensureDonationContact(deps: Deps, ctx: CallContext, who: SeedContact, address?: { street: string; postalCode: string; city: string }): Promise<string> {
  const contactCtx: CallContext = { ...ctx, permissions: new Set([...ctx.permissions, 'contacts.manage']) };
  const existing =
    who.kind === 'person'
      ? deps.db.select().from(contacts).where(and(eq(contacts.firstName, who.firstName), eq(contacts.lastName, who.lastName))).get()
      : deps.db.select().from(contacts).where(eq(contacts.name, who.name)).get();
  if (!existing) return unwrap(await createContact(deps, contactCtx, { ...who, ...(address ?? {}) })).id;
  if (address && !existing.street) unwrap(await updateContact(deps, contactCtx, { id: existing.id, ...address }));
  return existing.id;
}

/** Die Zeile mit dem positiven Betrag (Einnahme) einer Buchung — bei Sach- und Aufwandsspende steht daneben der Aufwand. */
function incomeLineOf(deps: Deps, entryText: string) {
  const line = allocationLinesOf(deps, entryByText(deps, entryText).id).find((l) => l.amountCents > 0);
  if (!line) throw new Error(`Einnahmezeile fehlt: ${entryText}`);
  return line;
}

/** Eine Bestätigung nur, wenn auf der Zeile noch keine liegt und die Prüfliste nichts sperrt — idempotent. */
async function ensureConfirmation(deps: Deps, ctx: CallContext, lineId: string, issuedOn?: string): Promise<void> {
  if (deps.db.select({ id: financeConfirmationLines.id }).from(financeConfirmationLines).where(eq(financeConfirmationLines.lineId, lineId)).get()) return;
  const check = unwrap(await checkConfirmable(deps, ctx, { lineIds: [lineId], ...(issuedOn ? { issuedOn } : {}) }));
  if (!check.ok) return;
  unwrap(await issueConfirmation(deps, ctx, { lineIds: [lineId], ...(issuedOn ? { issuedOn } : {}) }));
}

/** Die Bestätigung, die auf einer Zeile liegt (auch eine zurückgenommene). */
function confirmationOfLine(deps: Deps, lineId: string) {
  return deps.db
    .select()
    .from(financeConfirmationLines)
    .innerJoin(financeConfirmations, eq(financeConfirmationLines.confirmationId, financeConfirmations.id))
    .where(eq(financeConfirmationLines.lineId, lineId))
    .get()?.finance_confirmations;
}

const organizationAddressComplete = (deps: Deps) => (['street', 'postalCode', 'city'] as const).every((field) => String(readSetting(deps, `organization.${field}`) ?? '').trim());

// N8 (Befundliste 0.2.0): Genitiv ohne „Förderung“ — die Sätze setzen das Wort selbst davor; § 60a braucht zusätzlich den Akkusativ.
// Spec 2026-10-06 § 4: dieselben Zwecke wie der Bescheid in der Akte (`dms/src/seed.ts`). Bis 0.2.6 „Sport und
// Jugendhilfe“ — neben Hunden und Winterhilfe ein Widerspruch. Der Wortwächter (`tests/seed.test.ts`, „uses no
// animal …“) gilt Konten und Zwecken, nicht dem Bescheid.
const NOTICE_TAX_OFFICE = {
  taxOffice: 'Finanzamt Musterstadt',
  taxNumber: '99/999/99999',
  purposesText: 'des Tierschutzes (§ 52 Abs. 2 Satz 1 Nr. 14 AO) und der Jugendhilfe (§ 52 Abs. 2 Satz 1 Nr. 4 AO)',
  purposesTextAccusative: 'den Tierschutz (§ 52 Abs. 2 Satz 1 Nr. 14 AO) und die Jugendhilfe (§ 52 Abs. 2 Satz 1 Nr. 4 AO)',
} as const;

/** Der Kassenbon zur eingereichten Auslage „Büromaterial für die Infotheke“ (18,90 €) — erfundener Laden. */
const officeSupplyReceipt = (date: string) =>
  receiptPdf({
    shop: ['Papierhaus Lindner', 'Marktstraße 14', '12345 Musterstadt'],
    date,
    time: '10:42',
    receiptNo: '4711-0815',
    payment: 'EC-KARTE',
    items: [
      { text: 'Flipchartpapier 2 Blöcke', cents: 1190 },
      { text: 'Klebeband transparent', cents: 249 },
      { text: 'Namensschilder 50 St.', cents: 451 },
    ],
  });
/**
 * Die Spende, die auf dem § 60a-Bescheid bestätigt wird — im Vorjahr der Geschichte, wie die Bescheide (`seedNotices`).
 * Bestätigt wird sie erst im Stichjahr: Die Akte vergibt die Nummer im Jahr des Ausstellens, ein Datum im Vorjahr
 * stünde neben „ZWB-‹Stichjahr›-001“ (Runde 3, 205, Joe 2026-10-17). Der Seed stellt sie aus, bevor der
 * Freistellungsbescheid den § 60a-Bescheid ersetzt; „zu korrigieren“ folgt aus dem Ersetzen, nicht aus dem Datum.
 */
const provisionalDonation = (storyYear: number) => ({ text: 'Spende Greta Sommer März', entryDate: `${storyYear - 1}-03-14`, issuedOn: `${storyYear}-02-10`, amountCents: 12000 });

/**
 * F6a Task 9: Greta Sommer spendet im März des Vorjahrs — das Jahr, in dem der
 * Freistellungsbescheid den § 60a-Bescheid ablöst. Die Buchung entsteht nur,
 * solange dieses Geschäftsjahr besteht und offen ist (bei einem zweiten Seed
 * nach dem Abschluss bleibt sie aus).
 */
async function seedProvisionalNoticeDonation(deps: Deps, ctx: CallContext, storyYear: number): Promise<void> {
  const donation = provisionalDonation(storyYear);
  const year = deps.db.select().from(financeFiscalYears).where(eq(financeFiscalYears.designation, donation.entryDate.slice(0, 4))).get();
  if (!year || fiscalYearStatusInternal(deps.db, year.id) === 'closed') return;
  const greta = await ensureDonationContact(deps, ctx, { kind: 'person', firstName: 'Greta', lastName: 'Sommer' }, { street: 'Lindenallee 23', postalCode: '12343', city: 'Musterstadt' });
  const { text, entryDate, amountCents } = donation;
  await ensureEntry(deps, text, () =>
    bookEntry(on(deps, entryDate), ctx, { entryDate, text, moneyLines: [{ accountId: accountByName(deps, 'Vereinskonto').id, amountCents }], allocationLines: [{ categoryId: categoryByKey(deps, 'donations').id, amountCents, contactId: greta }] }).then(unwrap),
  );
  await ensureVoucher(deps, ctx, entryByText(deps, text), 'voucher-own', entryDate, `Spendeneingang ${text}`);
}

/**
 * Die Bescheide in ihrer Geschichte (Stichjahr 2026 in Klammern): erst der § 60a-Bescheid vom 01.03. zwei Jahre
 * vor dem Stichjahr (2024), darauf die Bestätigung für Greta Sommer (10.02.2026), dann der
 * Freistellungsbescheid vom 02.05. des Vorjahrs (2025), der den § 60a-Bescheid am selben Tag
 * ersetzt — Gretas Bestätigung ist damit „zu korrigieren“. Nur beim ersten
 * Lauf; die Reihenfolge ist Pflicht, weil ein § 60a-Bescheid nach einem
 * Freistellungsbescheid abgelehnt wird.
 */
async function seedNotices(deps: Deps, ctx: CallContext, storyYear: number): Promise<void> {
  if (deps.db.select({ id: financeNotices.id }).from(financeNotices).get()) return;
  const provisional = unwrap(await saveNotice(deps, ctx, { kind: 'section60a', ...NOTICE_TAX_OFFICE, noticeDate: `${storyYear - 2}-03-01`, exemptFrom: `${storyYear - 2}-01-01` }));
  await ensureSigner(deps, ctx, storyYear);
  const donation = provisionalDonation(storyYear);
  const greta = deps.db.select({ id: financeEntries.id }).from(financeEntries).where(eq(financeEntries.text, donation.text)).get();
  if (greta && organizationAddressComplete(deps)) await ensureConfirmation(deps, ctx, incomeLineOf(deps, donation.text).id, donation.issuedOn);
  // Der Freistellungsbescheid gilt dem Zeitraum vor den drei Jahren des Seeds: Auf einen Bescheid folgt der nächste
  // Erklärungszeitraum, die Befreiung wird spätestens alle drei Jahre überprüft (AEAO zu § 59 Nr. 3; Joe F1, Plan
  // seed-mehrjahre). Bis 0.4.0 stand hier der Veranlagungszeitraum `story-3` — derselbe, den der Zeitraum dann erklärte.
  unwrap(await saveNotice(deps, ctx, { kind: 'exemptionNotice', ...NOTICE_TAX_OFFICE, noticeDate: `${storyYear - 1}-05-02`, exemptFrom: `${storyYear - 6}-01-01`, assessmentPeriod: `${storyYear - 6}–${storyYear - 4}` }));
  unwrap(await supersedeNotice(deps, ctx, { id: provisional.id, supersededOn: `${storyYear - 1}-05-02` }));
}

/** Jonas Feld als Unterzeichner mit Faksimile und Anzeige — nur, wenn noch keiner besteht. */
async function ensureSigner(deps: Deps, ctx: CallContext, storyYear: number): Promise<void> {
  if (deps.db.select({ id: financeSigners.id }).from(financeSigners).get()) return;
  const signer = unwrap(await saveSigner(deps, ctx, { validFrom: `${storyYear - 1}-01-01`, signerName: 'Jonas Feld', notifiedOn: `${storyYear - 1}-06-02` }));
  unwrap(await uploadFacsimile(deps, ctx, { signerId: signer.id, bytes: new Uint8Array(Buffer.from(SEED_FACSIMILE_PNG, 'base64')), mimeType: 'image/png' }));
}

/**
 * F6a (Spec 11.3, aus Task 9 vorgezogen für die E2E von Task 7): der
 * Freistellungsbescheid eines erfundenen Finanzamts, Jonas Feld als
 * Unterzeichner mit Faksimile und Anzeige, und Zuwendungen in jedem Zustand:
 * gültig und maschinell (Erika Beispiel), „Unterschrift fehlt“ (eine
 * Aufwandsspende), eine Sachspende mit Angaben und Bestätigung (Prüfstein 5);
 * unbestätigt eine Spende ohne Anschrift (sperrt), eine einer Organisation
 * (warnt), eine zweite Aufwandsspende und eine Sachspende ohne Angaben. Die
 * Bestätigungen entstehen nur, wenn die Vereinsanschrift steht (sie kommt aus
 * dem Kern-Seed) — ein Modultest ohne sie bekommt Bescheid und Buchungen,
 * aber keine Bestätigung. Task 9 ergänzt „zu korrigieren“ (Greta Sommer, auf
 * dem ersetzten § 60a-Bescheid, `seedNotices`) und „zurückgenommen“ mit
 * Rückholspur (Henrik Brandt).
 */
async function seedDonations(deps: Deps, ctx: CallContext, storyYear: number): Promise<void> {
  await seedNotices(deps, ctx, storyYear);
  await ensureSigner(deps, ctx, storyYear);
  if (!readSetting<boolean>(deps, 'finance.expenseWaiversEnabled')) unwrap(await setFinanceSwitch(deps, ctx, { key: 'finance.expenseWaiversEnabled', value: true }));
  // F6b Task 9: der abgeschlossene Serienlauf des Vorjahrs mit Versandvermerk, dazu die Rücklastschrift einer Spende,
  // die in einer Sammelbestätigung stand (Prüfstein 6). Gleich nach Bescheid, Unterzeichner und Schalter, damit die
  // Nummern der Bestätigungen den Tagen folgen (N19).
  await seedConfirmationRun(deps, ctx, storyYear - 1, storyYear);

  const erika = await ensureDonationContact(deps, ctx, { kind: 'person', firstName: 'Erika', lastName: 'Beispiel' }, { street: 'Beispielstraße 7', postalCode: '54321', city: 'Beispielstadt' });
  const lukas = await ensureDonationContact(deps, ctx, { kind: 'person', firstName: 'Lukas', lastName: 'Hofmann' }, { street: 'Ulmenweg 12', postalCode: '12345', city: 'Musterstadt' });
  const clara = await ensureDonationContact(deps, ctx, { kind: 'person', firstName: 'Clara', lastName: 'Neumann' }, { street: 'Rosengasse 5', postalCode: '12347', city: 'Musterstadt' });
  const tobias = await ensureDonationContact(deps, ctx, { kind: 'person', firstName: 'Tobias', lastName: 'Adler' });
  const club = await ensureDonationContact(deps, ctx, { kind: 'organization', name: 'Sportfreunde Beispieltal e. V.' }, { street: 'Am Sportplatz 1', postalCode: '12349', city: 'Beispieltal' });
  // Plan U4 Task 3: ein Gemeinschaftskonto, von Hand — Clara Neumann und Tobias Adler tragen dieselbe IBAN (frei
  // erfunden, kein Umsatz des Seeds nutzt sie). Idempotent: Ein zweiter Lauf findet beide Zuordnungen schon vor.
  unwrap(await linkContactIban(deps, ctx, { contactId: clara, iban: 'DE59999999990000777777' }));
  unwrap(await linkContactIban(deps, ctx, { contactId: tobias, iban: 'DE59999999990000777777', mode: 'shared' }));

  const bank = accountByName(deps, 'Vereinskonto');
  const donations = categoryByKey(deps, 'donations');
  const waivers = categoryByKey(deps, 'expense-waivers');
  const travel = categoryByKey(deps, 'travel');
  const inKind = categoryByKey(deps, 'in-kind-donations');
  const inKindExpense = categoryByKey(deps, 'program-in-kind');

  const money = async (text: string, date: string, cents: number, contactId: string) => {
    await ensureEntry(deps, text, () => bookEntry(deps, ctx, { entryDate: date, text, moneyLines: [{ accountId: bank.id, amountCents: cents }], allocationLines: [{ categoryId: donations.id, amountCents: cents, contactId }] }).then(unwrap));
    await ensureVoucher(deps, ctx, entryByText(deps, text), 'voucher-own', date, `Spendeneingang ${text}`);
  };
  const withoutMoney = async (text: string, date: string, cents: number, contactId: string, income: { id: string }, expense: { id: string }) => {
    await ensureEntry(deps, text, () =>
      bookEntry(deps, ctx, { entryDate: date, text, moneyLines: [], allocationLines: [{ categoryId: income.id, amountCents: cents, contactId }, { categoryId: expense.id, amountCents: -cents }] }).then(unwrap),
    );
  };

  await money('Spende Erika Beispiel Juni', `${storyYear}-06-12`, 25000, erika);
  await money('Spende Tobias Adler', `${storyYear}-06-20`, 5000, tobias);
  await money('Spende Sportfreunde Beispieltal', `${storyYear}-07-05`, 10000, club);

  await withoutMoney('Aufwandsspende Fahrtkosten Mai', `${storyYear}-05-20`, 4800, lukas, waivers, travel);
  await ensureVoucher(deps, ctx, entryByText(deps, 'Aufwandsspende Fahrtkosten Mai'), 'voucher-own', `${storyYear}-05-20`, 'Verzichtserklärung Fahrtkosten Mai');
  await withoutMoney('Aufwandsspende Fahrtkosten Juli', `${storyYear}-07-15`, 3600, lukas, waivers, travel);
  await ensureVoucher(deps, ctx, entryByText(deps, 'Aufwandsspende Fahrtkosten Juli'), 'voucher-own', `${storyYear}-07-15`, 'Verzichtserklärung Fahrtkosten Juli');

  // Prüfstein 5: Sachspenden ohne Geldfluss. Die Wertunterlage liegt als Dokument in der Akte; die des Beamers wird
  // über die Angaben zum Beleg der Buchung, die des Laptops wartet — die E2E beschreibt ihn selbst.
  const dmsCtx: CallContext = { ...ctx, permissions: new Set([...ctx.permissions, 'dms.view', 'dms.create']) };
  const proof = async (subject: string, date: string) => {
    const found = deps.db.select({ id: dmsDocuments.id }).from(dmsDocuments).where(eq(dmsDocuments.subject, subject)).get();
    if (found) return found.id;
    return unwrap(await receiveDocument(on(deps, date), dmsCtx, { filename: `${date} ${subject}.pdf`, bytes: textPdf([subject, '', 'Erfundenes Beispiel für die Entwicklung.']), typeKey: 'voucher-own', subject, documentDate: date, folder: null })).id;
  };
  await withoutMoney('Sachspende Beamer', `${storyYear}-04-18`, 35000, clara, inKind, inKindExpense);
  const beamerProof = await proof('Wertnachweis Beamer', `${storyYear}-08-20`);
  await withoutMoney('Sachspende Laptop', `${storyYear}-08-03`, 20000, clara, inKind, inKindExpense);
  await proof('Wertnachweis Laptop', `${storyYear}-08-21`);

  const henrik = await ensureDonationContact(deps, ctx, { kind: 'person', firstName: 'Henrik', lastName: 'Brandt' }, { street: 'Birkenstraße 9', postalCode: '12344', city: 'Musterstadt' });
  // Eine E-Mail-Adresse, damit der Serienlauf im Schritt „Ergebnis“ eine Bestätigung per E-Mail zeigt (Handoff 2b E3); erfunden.
  const henrikChannels = deps.db.select({ id: contactChannels.id }).from(contactChannels).where(eq(contactChannels.contactId, henrik)).all();
  if (henrikChannels.length === 0) unwrap(await setContactChannels(deps, { ...ctx, permissions: new Set([...ctx.permissions, 'contacts.manage']) }, { id: henrik, channels: [{ kind: 'email', value: 'henrik.brandt@example.org', isPrimary: true }] }));
  await money('Spende Henrik Brandt März', `${storyYear}-03-20`, 7500, henrik);

  if (!organizationAddressComplete(deps)) return;

  const beamer = incomeLineOf(deps, 'Sachspende Beamer');
  if (!deps.db.select({ id: financeConfirmationLines.id }).from(financeConfirmationLines).where(eq(financeConfirmationLines.lineId, beamer.id)).get()) {
    unwrap(await saveInKindDetails(deps, ctx, { lineId: beamer.id, item: 'Beamer mit Tasche und Fernbedienung', condition: 'gebraucht, zwei Jahre alt, voll funktionsfähig', valuation: 'Preis vergleichbarer gebrauchter Geräte laut Wertnachweis', origin: 'private', proofDocumentId: beamerProof }));
  }
  // Zurückgenommen mit Rückholspur: per Post versandt, das Original kam zurück. Die Zeile ist danach wieder
  // bestätigbar und steht unter „Noch nicht bestätigt“.
  const henrikLine = incomeLineOf(deps, 'Spende Henrik Brandt März');
  // N19: ausgestellt nach der Spende und vor dem Versand am 27.03. — nicht am Tag des Seeds; vor den Bestätigungen
  // von heute, damit die Nummern den Tagen folgen.
  await ensureConfirmation(deps, ctx, henrikLine.id, `${storyYear}-03-25`);
  const henrikConfirmation = confirmationOfLine(deps, henrikLine.id);
  if (henrikConfirmation && !henrikConfirmation.voidedAt) {
    if (!henrikConfirmation.sentAt) unwrap(await recordConfirmationDispatch(deps, ctx, { id: henrikConfirmation.id, sentAt: `${storyYear}-03-27`, sentVia: 'post' }));
    unwrap(await voidConfirmation(deps, ctx, { id: henrikConfirmation.id, note: 'Betrag doppelt bestätigt', alreadySent: true, originalReturnedOn: `${storyYear}-04-09` }));
  }
  await ensureConfirmation(deps, ctx, incomeLineOf(deps, 'Spende Erika Beispiel Juni').id);
  await ensureConfirmation(deps, ctx, incomeLineOf(deps, 'Aufwandsspende Fahrtkosten Mai').id);
  await ensureConfirmation(deps, ctx, beamer.id);
  // Die Sachspende ist unterschrieben zurück — so steht unter „Unterschrift fehlt“ nur die Aufwandsspende.
  const beamerConfirmation = deps.db
    .select({ id: financeConfirmations.id, signedDocumentId: financeConfirmations.signedDocumentId })
    .from(financeConfirmationLines)
    .innerJoin(financeConfirmations, eq(financeConfirmationLines.confirmationId, financeConfirmations.id))
    .where(eq(financeConfirmationLines.lineId, beamer.id))
    .get();
  if (beamerConfirmation && !beamerConfirmation.signedDocumentId) {
    unwrap(await attachSignedConfirmation(deps, ctx, { id: beamerConfirmation.id, bytes: textPdf(['Zuwendungsbestätigung, unterschrieben', '', 'Erfundenes Beispiel für die Entwicklung.']), fileName: 'unterschrieben.pdf' }));
  }

}

/**
 * F6b Task 9: die Buchungen für den Serienlauf des Vorjahrs — zwei
 * maschinelle Geldspenden (Nora Lehmann, Paul Winter), eine Aufwandsspende
 * mit Unterschriftsfeld (Sina Krüger) und eine Spende ohne Anschrift (Jan
 * Moser, bleibt „Anschrift fehlt“). Läuft vor dem Abschluss des Vorjahrs
 * (`seedFinance`), solange darin noch gebucht werden darf; der Lauf selbst
 * startet erst in `seedConfirmationRun`, wenn Bescheid, Unterzeichner und
 * Aufwandsspenden-Schalter stehen.
 */
async function seedRunDonationEntries(deps: Deps, ctx: CallContext, previousYear: number): Promise<void> {
  const bank = accountByName(deps, 'Vereinskonto');
  const donations = categoryByKey(deps, 'donations');
  const waivers = categoryByKey(deps, 'expense-waivers');
  const travel = categoryByKey(deps, 'travel');

  const nora = await ensureDonationContact(deps, ctx, { kind: 'person', firstName: 'Nora', lastName: 'Lehmann' }, { street: 'Kastanienweg 4', postalCode: '12341', city: 'Musterstadt' });
  const paul = await ensureDonationContact(deps, ctx, { kind: 'person', firstName: 'Paul', lastName: 'Winter' }, { street: 'Ahornstraße 11', postalCode: '12342', city: 'Musterstadt' });
  const sina = await ensureDonationContact(deps, ctx, { kind: 'person', firstName: 'Sina', lastName: 'Krüger' }, { street: 'Fliederweg 6', postalCode: '12346', city: 'Musterstadt' });
  // Bewusst ohne Anschrift — der Serienlauf überspringt diese Zeile mit „Anschrift fehlt“.
  const jan = await ensureDonationContact(deps, ctx, { kind: 'person', firstName: 'Jan', lastName: 'Moser' });

  await ensureEntry(deps, 'Spende Nora Lehmann', () =>
    bookEntry(on(deps, `${previousYear}-09-10`), ctx, {
      entryDate: `${previousYear}-09-10`,
      text: 'Spende Nora Lehmann',
      moneyLines: [{ accountId: bank.id, amountCents: 6000 }],
      allocationLines: [{ categoryId: donations.id, amountCents: 6000, contactId: nora }],
    }).then(unwrap),
  );
  await ensureVoucher(deps, ctx, entryByText(deps, 'Spende Nora Lehmann'), 'voucher-own', `${previousYear}-09-10`, 'Spendeneingang Nora Lehmann');

  await ensureEntry(deps, 'Spende Paul Winter', () =>
    bookEntry(on(deps, `${previousYear}-10-02`), ctx, {
      entryDate: `${previousYear}-10-02`,
      text: 'Spende Paul Winter',
      moneyLines: [{ accountId: bank.id, amountCents: 9000 }],
      // Zwei Zeilen, damit der Serienlauf hier eine Sammelbestätigung ausstellt (eine einzige Zeile ergäbe eine Einzelbestätigung).
      allocationLines: [{ categoryId: donations.id, amountCents: 5000, contactId: paul }, { categoryId: donations.id, amountCents: 4000, contactId: paul }],
    }).then(unwrap),
  );
  await ensureVoucher(deps, ctx, entryByText(deps, 'Spende Paul Winter'), 'voucher-own', `${previousYear}-10-02`, 'Spendeneingang Paul Winter');

  await ensureEntry(deps, 'Aufwandsspende Fahrtkosten Sina Krüger', () =>
    bookEntry(on(deps, `${previousYear}-11-05`), ctx, {
      entryDate: `${previousYear}-11-05`,
      text: 'Aufwandsspende Fahrtkosten Sina Krüger',
      moneyLines: [],
      allocationLines: [{ categoryId: waivers.id, amountCents: 3200, contactId: sina }, { categoryId: travel.id, amountCents: -3200 }],
    }).then(unwrap),
  );
  await ensureVoucher(deps, ctx, entryByText(deps, 'Aufwandsspende Fahrtkosten Sina Krüger'), 'voucher-own', `${previousYear}-11-05`, 'Verzichtserklärung Fahrtkosten Sina Krüger');

  // Ohne Anschrift, bewusst ohne Beleg — der Abschluss des Vorjahrs verlangt dafür eine Begründung (siehe `seedFinance`).
  await ensureEntry(deps, 'Spende Jan Moser', () =>
    bookEntry(on(deps, `${previousYear}-11-20`), ctx, {
      entryDate: `${previousYear}-11-20`,
      text: 'Spende Jan Moser',
      moneyLines: [{ accountId: bank.id, amountCents: 4500 }],
      allocationLines: [{ categoryId: donations.id, amountCents: 4500, contactId: jan }],
    }).then(unwrap),
  );
}

/**
 * F6b Task 9: der abgeschlossene Serienlauf des Vorjahrs — zwei maschinelle
 * Bestätigungen, eine mit Unterschriftsfeld, eine übersprungen (Anschrift
 * fehlt), mit Versandvermerk für die maschinellen Posten (Annahme 8). Läuft
 * nach `seedDonations`, wenn Bescheid, Unterzeichner, Vereinsanschrift und
 * Aufwandsspenden-Schalter stehen; die Buchungen dafür liefert
 * `seedRunDonationEntries`, vor dem Abschluss des Vorjahrs. Dazu (Prüfstein
 * 6, Annahme 11): eine Rücklastschrift auf Nora Lehmanns maschinell
 * bestätigte Spende — ihre Sammelbestätigung steht danach „zu korrigieren“.
 */
async function seedConfirmationRun(deps: Deps, ctx: CallContext, previousYear: number, storyYear: number): Promise<void> {
  if (!organizationAddressComplete(deps)) return;

  // N19: Der Serienlauf des Vorjahrs läuft im Februar des Stichjahrs — nach Gretas Bestätigung vom 10.02. (die Nummern
  // folgen den Tagen), vor der Rücklastschrift vom 18.02., die Noras Sammelbestätigung „zu korrigieren“ macht, und nicht
  // am Tag des Seeds.
  const runDay = `${storyYear}-02-12`;
  let run = deps.db.select().from(financeConfirmationRuns).where(eq(financeConfirmationRuns.year, previousYear)).get();
  if (!run) {
    const started = unwrap(await startConfirmationRun(on(deps, runDay), ctx, { year: previousYear }));
    run = deps.db.select().from(financeConfirmationRuns).where(eq(financeConfirmationRuns.id, started.id)).get()!;
  }
  if (!run.finishedAt) {
    unwrap(await continueConfirmationRun(on(deps, runDay), ctx, { runId: run.id, max: 50 }));
    run = deps.db.select().from(financeConfirmationRuns).where(eq(financeConfirmationRuns.id, run.id)).get()!;
  }
  if (!run.dispatchedAt) unwrap(await dispatchRunConfirmations(on(deps, runDay), ctx, { runId: run.id, sentAt: runDay, sentVia: 'post' }));

  // Prüfstein 6: die Rücklastschrift auf Nora Lehmanns maschinell bestätigte Spende.
  const noraLine = incomeLineOf(deps, 'Spende Nora Lehmann');
  await ensureEntry(deps, 'Rücklastschrift Nora Lehmann', () =>
    bookEntry(deps, ctx, {
      entryDate: `${storyYear}-02-18`,
      text: 'Rücklastschrift Nora Lehmann',
      moneyLines: [{ accountId: accountByName(deps, 'Vereinskonto').id, amountCents: -6000 }],
      allocationLines: [{ categoryId: categoryByKey(deps, 'donations').id, amountCents: -6000, contactId: noraLine.contactId!, originLineId: noraLine.id }],
    }).then(unwrap),
  );
}

/**
 * F8a Task 7: „Nadja Vogt“ — eigens erfunden fürs Einreichen von Auslagen,
 * mit der mitgelieferten Rolle „Auslagen einreichen“ und einem eigenen,
 * gleich verknüpften Kontakt. Bewusst **keine** der drei Kernseed-Personen:
 * Peter Lang bleibt in `home.spec.ts` als „ohne jede Kachel“ geprüft, Jonas
 * Feld trägt schon die Freigabe. Idempotent über die E-Mail-Adresse.
 */
async function ensureExpenseClerkPerson(deps: Deps, ctx: CallContext): Promise<string | null> {
  const usersCtx: CallContext = { ...ctx, permissions: new Set(deps.registry.permissionKeys) };
  const clerkRole = deps.db.select({ id: schema.roles.id }).from(schema.roles).where(eq(schema.roles.name, 'Auslagen einreichen')).get();
  if (!clerkRole) return null;
  let person = deps.db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, 'nadja@kompass.local')).get();
  if (!person) {
    const created = unwrap(await createUser(deps, usersCtx, { name: 'Nadja Vogt', email: 'nadja@kompass.local', roleIds: [clerkRole.id] }));
    person = { id: created.user.id };
    // Spec 2026-10-06 § 5.5: Das Telefon-Bild „Auslage einreichen“ zeigt Nadja — die Pipeline meldet sich mit dem
    // Entwicklungs-Passwort an (wie die Verwaltung). Derselbe Weg wie im Betrieb: mit dem Startpasswort anmelden
    // und das eigene Passwort setzen — nie am Dienst vorbei in die Datenbank (Joe, 2026-10-06).
    const session = unwrap(await login(deps, { email: 'nadja@kompass.local', password: created.startPassword, ipAddress: null, requestId: ctx.requestId }));
    unwrap(await changeOwnPassword(deps, { ...ctx, userId: person.id, permissions: new Set() }, session.sessionId, { currentPassword: created.startPassword, newPassword: SEED_ADMIN_PASSWORD }));
  } else {
    const already = deps.db
      .select({ userId: schema.userRoles.userId })
      .from(schema.userRoles)
      .where(and(eq(schema.userRoles.userId, person.id), eq(schema.userRoles.roleId, clerkRole.id)))
      .get();
    if (!already) unwrap(await assignRole(deps, usersCtx, { userId: person.id, roleId: clerkRole.id }));
  }
  if (!hasLinkHistoryInternal(deps.db, person.id)) {
    const contactCtx: CallContext = { ...ctx, permissions: new Set([...ctx.permissions, 'contacts.manage']) };
    const existingContact = deps.db.select({ id: contacts.id }).from(contacts).where(and(eq(contacts.firstName, 'Nadja'), eq(contacts.lastName, 'Vogt'))).get();
    const contactId = existingContact?.id ?? unwrap(await createContact(deps, contactCtx, { kind: 'person', salutation: 'Frau', firstName: 'Nadja', lastName: 'Vogt', street: 'Ahornstraße 3', postalCode: '12348', city: 'Musterstadt' })).id;
    unwrap(await linkUserToContact(deps, { ...usersCtx, userId: person.id }, { userId: person.id, contactId }));
  }
  return person.id;
}

/**
 * F8a Task 7: Jonas Felds gespeicherte Startseiten-Anordnung (`seedDashboardLayout`
 * im Kern, vor jedem Modul-Seed geschrieben) kennt die neue Kachel „Wartet auf
 * Ihre Freigabe“ noch nicht — ohne diesen Nachtrag sieht er sie erst nach
 * „Vorgabe wiederherstellen“. Ergänzt seine bestehenden Kacheln, ersetzt sie
 * nicht; idempotent, ob die Kachel schon dabei ist.
 */
async function addApprovalsPendingTileForJonas(deps: Deps, ctx: CallContext, jonasUserId: string): Promise<void> {
  const jonasCtx: CallContext = { ...ctx, userId: jonasUserId, permissions: getEffectivePermissions(deps.db, deps.registry, jonasUserId) };
  const layout = unwrap(await getDashboardLayout(deps, jonasCtx));
  if (layout.columns.flat().some((t) => t.module === 'finance' && t.key === 'approvalsPending')) return;
  // Unten in die letzte Spalte des aktiven Layouts (0.2.12): eine Zahl gehört in die schmale bzw. dritte Spalte.
  const last = layout.columns.length - 1;
  const columns = layout.columns.map((column, index) => (index === last ? [...column, { module: 'finance', key: 'approvalsPending', options: {} }] : column));
  unwrap(await setDashboardLayout(deps, jonasCtx, { layout: layout.layout, columns }));
}

/** Ob schon eine Auslage mit dieser (erfundenen, eindeutigen) Positions-Beschreibung besteht — Idempotenz ohne eigene Zähltabelle. */
function expenseClaimSeeded(deps: Deps, marker: string): boolean {
  return !!deps.db.select({ id: financeExpensePositions.id }).from(financeExpensePositions).where(eq(financeExpensePositions.purpose, marker)).get();
}

/**
 * F8a Task 7 (Spec 11.3): Anträge in jedem Zustand — Entwurf ohne Beleg,
 * eingereicht mit Beleg und Fahrt (die Büromaterial-Position trifft später
 * den Kategorievorschlag über „Büromaterial Mai“, Annahme 8), freigegeben
 * mit offener Zahlung, ausgezahlt, abgelehnt mit Grund, und ein Verzicht
 * (Aufwandsspende) mit Verzichtserklärung und unterschriebener Fassung.
 * „Nadja Vogt“ reicht ein, „Jonas Feld“ (schon `finance.approve`, Task 2)
 * gibt frei oder lehnt ab — nie sich selbst, weil sein eigener Kontakt
 * fehlt. Ohne Jonas Feld (ein isolierter Modultest) bleibt der Schritt aus;
 * jeder Antrag ist über seine erfundene, eindeutige erste Position für sich
 * idempotent.
 */
async function seedExpenseClaims(deps: Deps, ctx: CallContext, storyYear: number): Promise<void> {
  const jonas = deps.db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, 'jonas@kompass.local')).get();
  if (!jonas) return;
  const clerkUserId = await ensureExpenseClerkPerson(deps, ctx);
  if (!clerkUserId) return;
  await addApprovalsPendingTileForJonas(deps, ctx, jonas.id);

  // Anspruchsgrundlage des Vereins für Aufwandsspenden — sonst scheitert das Erzeugen der
  // Verzichtserklärung an `waiverBasisMissing` (BMF 25.11.2014: Vertrag oder Satzung).
  if (!readSetting<string>(deps, 'finance.expenseWaiverBasisText')) {
    const setupCtx: CallContext = { ...ctx, permissions: new Set([...ctx.permissions, 'finance.setup']) };
    unwrap(await setExpenseWaiverBasisText(deps, setupCtx, { text: `Vereinbarung vom 02.01.${storyYear} nach § 14 der Satzung`, agreedOn: `${storyYear}-01-02` }));
  }

  const submitCtx: CallContext = { ...ctx, userId: clerkUserId, permissions: new Set([...ctx.permissions, 'finance.expensesSubmit']) };
  const approveCtx: CallContext = { ...ctx, userId: jonas.id, permissions: new Set([...ctx.permissions, 'finance.approve']) };
  const officeCat = categoryByKey(deps, 'office');
  const travelCat = categoryByKey(deps, 'travel');
  const bank = accountByName(deps, 'Vereinskonto');
  // Je Beleg ein eigener Inhalt: Gleiche Bytes wären derselbe Nachweis, und die Belegprüfung fände ihn mehrfach (Designer Runde 6, 266).
  const receiptBytes = (what: string) => textPdf(['Beleg', what, '', 'Erfundenes Beispiel für die Entwicklung.']);
  const IBAN = 'DE93999999990000000001';

  // 1) Entwurf ohne Beleg — unvollständig, wie ihn die laufende Sicherung zulässt.
  if (!expenseClaimSeeded(deps, 'Deko für den Infoabend')) {
    unwrap(await saveExpenseDraft(deps, submitCtx, { waiver: false, positions: [{ kind: 'receipt', purpose: 'Deko für den Infoabend' }] }));
  }

  // 2) Eingereicht, mit Beleg und Fahrt — bleibt in der Warteschlange (Kategorievorschlag, Annahme 8).
  if (!expenseClaimSeeded(deps, 'Büromaterial für die Infotheke')) {
    const draft = unwrap(
      await saveExpenseDraft(deps, submitCtx, {
        waiver: false,
        iban: IBAN,
        positions: [
          { kind: 'receipt', positionDate: `${storyYear}-06-05`, amountCents: 1890, purpose: 'Büromaterial für die Infotheke' },
          { kind: 'trip', positionDate: `${storyYear}-06-05`, tripFrom: 'Musterstadt', tripTo: 'Beispielstadt', tripReason: 'Infomaterial abgeholt', tripKm: 18 },
        ],
      }),
    );
    // Spec 2026-10-06 § 5.5: Diese Auslage zeigt die Freigabe — mit einem Bon statt „Erfundenes Beispiel“.
    unwrap(await uploadExpenseReceipt(on(deps, draft.positions[0]!.positionDate!), submitCtx, { claimId: draft.id, positionId: draft.positions[0]!.id, bytes: officeSupplyReceipt(draft.positions[0]!.positionDate!), fileName: 'beleg-bueromaterial.pdf' }));
    unwrap(await submitExpenseClaim(deps, submitCtx, { id: draft.id }));
  }

  // 3) Freigegeben, noch nicht ausgezahlt — offener Posten, Herkunft `financeExpenseClaim`.
  if (!expenseClaimSeeded(deps, 'Getränke für die Versammlung')) {
    const draft = unwrap(
      await saveExpenseDraft(deps, submitCtx, { waiver: false, iban: IBAN, positions: [{ kind: 'receipt', positionDate: `${storyYear}-06-12`, amountCents: 4200, purpose: 'Getränke für die Versammlung' }] }),
    );
    unwrap(await uploadExpenseReceipt(on(deps, draft.positions[0]!.positionDate!), submitCtx, { claimId: draft.id, positionId: draft.positions[0]!.id, bytes: receiptBytes('beleg-getraenke.pdf'), fileName: 'beleg-getraenke.pdf' }));
    const submitted = unwrap(await submitExpenseClaim(deps, submitCtx, { id: draft.id }));
    unwrap(await approveExpenseClaim(deps, approveCtx, { claimId: submitted.id, positions: [{ positionId: submitted.positions[0]!.id, categoryId: officeCat.id }] }));
  }

  // 4) Freigegeben und ausgezahlt — die Überweisung begleicht den offenen Posten voll.
  if (!expenseClaimSeeded(deps, 'Portokosten Mitgliederbrief')) {
    const draft = unwrap(
      await saveExpenseDraft(deps, submitCtx, { waiver: false, iban: IBAN, positions: [{ kind: 'receipt', positionDate: `${storyYear}-06-18`, amountCents: 2350, purpose: 'Portokosten Mitgliederbrief' }] }),
    );
    unwrap(await uploadExpenseReceipt(on(deps, draft.positions[0]!.positionDate!), submitCtx, { claimId: draft.id, positionId: draft.positions[0]!.id, bytes: receiptBytes('beleg-porto.pdf'), fileName: 'beleg-porto.pdf' }));
    const submitted = unwrap(await submitExpenseClaim(deps, submitCtx, { id: draft.id }));
    const approved = unwrap(await approveExpenseClaim(deps, approveCtx, { claimId: submitted.id, positions: [{ positionId: submitted.positions[0]!.id, categoryId: officeCat.id }] }));
    unwrap(
      await bookEntry(deps, ctx, {
        entryDate: `${storyYear}-07-02`,
        text: `Überweisung Auslage ${approved.number}`,
        moneyLines: [{ accountId: bank.id, amountCents: -2350, settlements: [{ openItemId: approved.openItemId!, amountCents: 2350 }] }],
        allocationLines: [{ categoryId: officeCat.id, amountCents: -2350 }],
      }),
    );
  }

  // 5) Abgelehnt, mit Grund — der Grund steht nur am Antrag, nie im Protokoll.
  if (!expenseClaimSeeded(deps, 'Blumenstrauß zum Jubiläum')) {
    const draft = unwrap(
      await saveExpenseDraft(deps, submitCtx, { waiver: false, iban: IBAN, positions: [{ kind: 'receipt', positionDate: `${storyYear}-06-20`, amountCents: 3500, purpose: 'Blumenstrauß zum Jubiläum' }] }),
    );
    unwrap(await uploadExpenseReceipt(on(deps, draft.positions[0]!.positionDate!), submitCtx, { claimId: draft.id, positionId: draft.positions[0]!.id, bytes: receiptBytes('beleg-blumen.pdf'), fileName: 'beleg-blumen.pdf' }));
    const submitted = unwrap(await submitExpenseClaim(deps, submitCtx, { id: draft.id }));
    unwrap(await rejectExpenseClaim(deps, approveCtx, { claimId: submitted.id, note: 'Kein Vereinszweck, bitte privat tragen' }));
  }

  // 6) Verzicht (Aufwandsspende) freigegeben — Verzichtserklärung erzeugt und unterschrieben zurück.
  if (!expenseClaimSeeded(deps, 'Fahrtkosten Pflegestelle Juli')) {
    const draft = unwrap(
      await saveExpenseDraft(deps, submitCtx, { waiver: true, positions: [{ kind: 'receipt', positionDate: `${storyYear}-07-01`, amountCents: 1600, purpose: 'Fahrtkosten Pflegestelle Juli' }] }),
    );
    unwrap(await uploadExpenseReceipt(on(deps, draft.positions[0]!.positionDate!), submitCtx, { claimId: draft.id, positionId: draft.positions[0]!.id, bytes: receiptBytes('beleg-fahrtkosten.pdf'), fileName: 'beleg-fahrtkosten.pdf' }));
    const submitted = unwrap(await submitExpenseClaim(deps, submitCtx, { id: draft.id }));
    unwrap(await createWaiverDeclaration(on(deps, `${storyYear}-07-10`), approveCtx, { claimId: submitted.id, declaredOn: `${storyYear}-07-10` }));
    unwrap(await attachSignedWaiver(on(deps, `${storyYear}-07-10`), approveCtx, { claimId: submitted.id, bytes: textPdf(['Verzichtserklärung, unterschrieben', '', 'Erfundenes Beispiel für die Entwicklung.']) }));
    unwrap(
      await approveExpenseClaim(deps, approveCtx, {
        claimId: submitted.id,
        positions: [{ positionId: submitted.positions[0]!.id, categoryId: travelCat.id }],
        waiver: { claimAgreedConfirmed: true, declaredOn: `${storyYear}-07-10` },
      }),
    );
  }

  // 7) Entwurf mit PDF-Beleg (Spec 2026-10-06 § 5.5, Telefon „Auslage einreichen“): gestern gekauft, Bon schon dran,
  //    noch nicht eingereicht — die Warteschlangen der Freigabe bleiben, wie die E2E sie zählen.
  if (!expenseClaimSeeded(deps, 'Druckerpatronen für die Geschäftsstelle')) {
    const boughtOn = isoDayIn(deps, deps.clock.now().getTime() - 86_400_000);
    const draft = unwrap(
      await saveExpenseDraft(deps, submitCtx, { waiver: false, iban: IBAN, positions: [{ kind: 'receipt', positionDate: boughtOn, amountCents: 3480, purpose: 'Druckerpatronen für die Geschäftsstelle' }] }),
    );
    unwrap(
      await uploadExpenseReceipt(on(deps, boughtOn), submitCtx, {
        claimId: draft.id,
        positionId: draft.positions[0]!.id,
        bytes: receiptPdf({
          shop: ['Bürobedarf Ostertag', 'Lindenplatz 3', '12345 Musterstadt'],
          date: boughtOn,
          time: '17:20',
          receiptNo: '2210-4471',
          payment: 'BAR',
          items: [
            { text: 'Druckerpatrone schwarz 2 St.', cents: 2390 },
            { text: 'Druckerpatrone farbig', cents: 1090 },
          ],
        }),
        fileName: 'kassenbon-druckerpatronen.pdf',
      }),
    );
  }
}

/** Ob schon eine Zahlung an Partner mit dieser (erfundenen, eindeutigen) Zweckangabe besteht — Idempotenz ohne eigene Zähltabelle. */
function partnerPaymentSeeded(deps: Deps, marker: string): boolean {
  return !!deps.db.select({ id: financePartnerPayments.id }).from(financePartnerPayments).where(eq(financePartnerPayments.purposeText, marker)).get();
}

/** Die Angaben eines Partners (nur die Id) — schon vorhanden bleibt unberührt, sonst neu über `savePartnerProfile`. */
async function ensurePartner(deps: Deps, ctx: CallContext, contactId: string, input: Record<string, unknown>): Promise<{ id: string }> {
  const existing = deps.db.select({ id: financePartnerProfiles.id }).from(financePartnerProfiles).where(eq(financePartnerProfiles.contactId, contactId)).get();
  if (existing) return existing;
  return unwrap(await savePartnerProfile(deps, ctx, { contactId, ...input }));
}

/** Einen erfundenen Organisations-Kontakt finden oder anlegen, wahlweise mit Land — wie `ensureDonationContact`, aber mit `country` (Annahme 7, letzter Satz). */
async function ensurePartnerContact(deps: Deps, ctx: CallContext, name: string, country?: string): Promise<string> {
  const contactCtx: CallContext = { ...ctx, permissions: new Set([...ctx.permissions, 'contacts.manage']) };
  const existing = deps.db.select({ id: contacts.id }).from(contacts).where(eq(contacts.name, name)).get();
  if (existing) return existing.id;
  return unwrap(await createContact(deps, contactCtx, { kind: 'organization', name, ...(country ? { country } : {}) })).id;
}

/**
 * F7 Task 7 (Spec 11.3): Partner und ihre Zahlungen in jedem Zustand — ein
 * Entwurf ohne Einreichung, eine eingereichte (wartet in Jonas Felds
 * Warteschlange), eine freigegebene ohne Nachweis (Kachel und Zähler „ohne
 * Beleg“, Annahme 13), eine abgelehnte mit Grund, deren Kopie als neuer
 * Entwurf steht, und eine nachträgliche Freigabe auf eine schon gebuchte,
 * an den Partner gezahlte Zeile (Annahme 4), deren Nachweise gleich
 * anerkannt sind, weil eine nachträgliche Zahlung immer „passiert“ ist
 * (Annahme 10, 11). Ein Partner im Ausland (`foreignBody`) trägt eine
 * erfundene Nicht-DE-IBAN mit erfundener Bankleitzahl 99999 (wie „Altes
 * Sparbuch“, N2) und die Pflichtwahl der üblichen Art (Annahme 1). „Anna
 * Berger“ (die Verwaltung selbst, `ctx`) legt an und reicht ein; Jonas Feld
 * (schon `finance.approve`, oben) entscheidet — nie sich selbst. Ohne ihn
 * (ein isolierter Modultest) bleibt der Schritt aus; jede Zahlung ist über
 * ihre erfundene, eindeutige Zweckangabe für sich idempotent.
 */
async function seedPartners(deps: Deps, ctx: CallContext, storyYear: number): Promise<void> {
  const jonas = deps.db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, 'jonas@kompass.local')).get();
  if (!jonas) return;
  const approveCtx: CallContext = { ...ctx, userId: jonas.id, permissions: new Set([...ctx.permissions, 'finance.approve']) };
  const programCostsCat = categoryByKey(deps, 'program-costs');
  const bank = accountByName(deps, 'Vereinskonto');
  const dmsCtx: CallContext = { ...ctx, permissions: new Set([...ctx.permissions, 'dms.view', 'dms.create']) };
  const agreementDoc = async (subject: string, date: string): Promise<string> => {
    const found = deps.db.select({ id: dmsDocuments.id }).from(dmsDocuments).where(eq(dmsDocuments.subject, subject)).get();
    if (found) return found.id;
    return unwrap(await receiveDocument(on(deps, date), dmsCtx, { filename: `${date} ${subject}.pdf`, bytes: textPdf([subject, '', 'Erfundenes Beispiel für die Entwicklung.']), typeKey: 'voucher-own', subject, documentDate: date, folder: null })).id;
  };

  // 1) „Kinderhilfe Regional e.V.“ — ein Entwurf ohne Einreichung, dazu eine eingereichte Zahlung,
  // die in Jonas Felds Warteschlange wartet.
  const regionalContact = await ensurePartnerContact(deps, ctx, 'Kinderhilfe Regional e.V.');
  const regionalPartner = await ensurePartner(deps, ctx, regionalContact, { status: 'publicBody' });
  if (!partnerPaymentSeeded(deps, 'Zuschuss Spielgeräte Herbst')) {
    unwrap(
      await savePartnerPaymentDraft(deps, ctx, { partnerId: regionalPartner.id, basis: 'transfer58', purposeText: 'Zuschuss Spielgeräte Herbst', retroactive: false, positions: [{ kind: 'money', amountCents: 45000, categoryId: programCostsCat.id }] }),
    );
  }
  if (!partnerPaymentSeeded(deps, 'Zuschuss Ferienbetreuung')) {
    const draft = unwrap(
      await savePartnerPaymentDraft(deps, ctx, { partnerId: regionalPartner.id, basis: 'transfer58', purposeText: 'Zuschuss Ferienbetreuung', retroactive: false, positions: [{ kind: 'money', amountCents: 60000, categoryId: programCostsCat.id }] }),
    );
    unwrap(await submitPartnerPayment(deps, ctx, { id: draft.id, expectedVersion: draft.version }));
  }

  // 2) „Hilfswerk International e.V.“ — Partner im Ausland, erfundene Nicht-DE-IBAN (BLZ 99999); die
  // Zahlung ist freigegeben, aber noch ohne Nachweis.
  const internationalContact = await ensurePartnerContact(deps, ctx, 'Hilfswerk International e.V.', 'AT');
  unwrap(await linkContactIban(deps, ctx, { contactId: internationalContact, iban: 'AT479999900012345678' }));
  const internationalPartner = await ensurePartner(deps, ctx, internationalContact, { status: 'foreignBody', usualBasis: 'transfer58', usualProofMonths: 6 });
  // Design-Nachtrag Phase 4 (Entscheidung 3): die Anerkennung im Sitzland mit „gültig bis“ — ohne Prüfwirkung.
  if (!deps.db.select({ id: financePartnerNotices.id }).from(financePartnerNotices).where(eq(financePartnerNotices.partnerId, internationalPartner.id)).get()) {
    const recognition = await agreementDoc('Anerkennung im Sitzland Hilfswerk International', `${storyYear}-02-04`);
    unwrap(await savePartnerNotice(deps, dmsCtx, { partnerId: internationalPartner.id, kind: 'recognitionAbroad', noticeDate: `${storyYear - 1}-12-01`, validUntil: `${storyYear + 1}-12-31`, receivedOn: `${storyYear}-02-04`, documentId: recognition }));
  }
  if (!partnerPaymentSeeded(deps, 'Nothilfe Erdbebenregion')) {
    const agreementId = await agreementDoc('Vereinbarung Nothilfe Erdbebenregion', `${storyYear}-03-01`);
    const draft = unwrap(
      await savePartnerPaymentDraft(deps, ctx, { partnerId: internationalPartner.id, basis: 'transfer58', purposeText: 'Nothilfe Erdbebenregion', retroactive: false, agreementDocumentId: agreementId, positions: [{ kind: 'money', amountCents: 120000, categoryId: programCostsCat.id }] }),
    );
    const submitted = unwrap(await submitPartnerPayment(deps, ctx, { id: draft.id, expectedVersion: draft.version }));
    unwrap(await approvePartnerPayment(deps, approveCtx, { id: submitted.id, expectedVersion: submitted.version }));
  }

  // 3) „Nachbarschaftshilfe Ost e.V.“ — eine Zahlung, die Jonas Feld mit Grund ablehnt; ihre Kopie
  // steht danach als neuer Entwurf.
  const ostContact = await ensurePartnerContact(deps, ctx, 'Nachbarschaftshilfe Ost e.V.');
  const ostPartner = await ensurePartner(deps, ctx, ostContact, { status: 'publicBody' });
  if (!partnerPaymentSeeded(deps, 'Zweck der Herbstaktion')) {
    const draft = unwrap(
      await savePartnerPaymentDraft(deps, ctx, { partnerId: ostPartner.id, basis: 'transfer58', purposeText: 'Zweck der Herbstaktion', retroactive: false, positions: [{ kind: 'money', amountCents: 32000, categoryId: programCostsCat.id }] }),
    );
    const submitted = unwrap(await submitPartnerPayment(deps, ctx, { id: draft.id, expectedVersion: draft.version }));
    const rejected = unwrap(await rejectPartnerPayment(deps, approveCtx, { id: submitted.id, note: 'Verwendungszweck bitte genauer angeben' }));
    unwrap(await copyPartnerPayment(deps, ctx, { id: rejected.id }));
  }

  // 4) „Fördergemeinschaft Süd e.V.“ — nachträgliche Freigabe auf eine schon gebuchte, an sie gezahlte
  // Zeile; Nachweise gleich anerkannt, weil eine nachträgliche Zahlung immer „passiert“ ist.
  const suedContact = await ensurePartnerContact(deps, ctx, 'Fördergemeinschaft Süd e.V.');
  const suedPartner = await ensurePartner(deps, ctx, suedContact, { status: 'publicBody' });
  await ensureEntry(deps, 'Förderung Süd, bereits überwiesen', () =>
    bookEntry(deps, ctx, {
      entryDate: `${storyYear}-04-05`,
      text: 'Förderung Süd, bereits überwiesen',
      moneyLines: [{ accountId: bank.id, amountCents: -80000 }],
      allocationLines: [{ categoryId: programCostsCat.id, amountCents: -80000, contactId: suedContact }],
    }).then(unwrap),
  );
  if (!partnerPaymentSeeded(deps, 'Förderung, bereits überwiesen (Süd)')) {
    const paidLine = allocationLinesOf(deps, entryByText(deps, 'Förderung Süd, bereits überwiesen').id).find((l) => l.amountCents < 0)!;
    const draft = unwrap(
      await savePartnerPaymentDraft(deps, ctx, { partnerId: suedPartner.id, basis: 'transfer58', purposeText: 'Förderung, bereits überwiesen (Süd)', retroactive: true, positions: [], paidLineIds: [paidLine.id] }),
    );
    const submitted = unwrap(await submitPartnerPayment(deps, ctx, { id: draft.id, expectedVersion: draft.version }));
    const approved = unwrap(await approvePartnerPayment(deps, approveCtx, { id: submitted.id, expectedVersion: submitted.version }));
    unwrap(await addEvidenceUpload(deps, ctx, { paymentId: approved.id, kind: 'report', bytes: textPdf(['Bericht Förderung Süd', '', 'Erfundenes Beispiel für die Entwicklung.']), fileName: 'bericht-sued.pdf' }));
    unwrap(await addEvidenceUpload(deps, ctx, { paymentId: approved.id, kind: 'paymentProof', bytes: textPdf(['Zahlungsnachweis Förderung Süd', '', 'Erfundenes Beispiel für die Entwicklung.']), fileName: 'zahlungsnachweis-sued.pdf' }));
    unwrap(await acknowledgeEvidence(deps, approveCtx, { paymentId: approved.id }));
  }
}

/**
 * F8b Task 7 (Annahmen 1–10, Prüfstein 8 und 9): zurückgelegtes Geld in drei
 * Zuständen (Projektmittel mit Zweck und Protokoll, eine freie Rücklage nahe
 * dem Warnwert des Höchstbetrags, eine aufgelöste Wiederbeschaffung), ein
 * erfüllter Zweck mit Rest und einer freigegebenen Umwidmung in die freien
 * Mittel, eine wartende Umwidmung der Verwaltung (nie von Jonas Feld, der sie
 * freigeben soll), eine Pauschale an ein Vorstandsmitglied ohne bestätigten
 * Einrichtungspunkt und eine Zahlung an eine nahestehende Person, deren Rolle
 * im Jahr endet. Alles erfunden, jeder Schritt für sich idempotent.
 */
async function seedMittel(deps: Deps, ctx: CallContext, storyYear: number): Promise<void> {
  const jonas = deps.db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, 'jonas@kompass.local')).get();
  if (!jonas) return;
  const approveCtx: CallContext = { ...ctx, userId: jonas.id, permissions: new Set([...ctx.permissions, 'finance.approve']) };
  const writeCtx: CallContext = { ...ctx, permissions: new Set([...ctx.permissions, 'finance.setup', 'finance.entriesWrite', 'finance.read', 'dms.view', 'dms.create']) };
  const contactCtx: CallContext = { ...ctx, permissions: new Set([...ctx.permissions, 'contacts.manage']) };
  const bank = accountByName(deps, 'Vereinskonto');
  const donationsCat = categoryByKey(deps, 'donations');
  const programCostsCat = categoryByKey(deps, 'program-costs');
  // Spec 2026-10-06 § 4: Ein Beschluss trägt das Datum, an dem er gefasst wurde — bis 0.2.6 stand jeder auf „heute“
  // und alle neun oben in der Akte. Ohne Datum (nur die wartende Umwidmung, Ausnahme in Plan 2b, Task 7, 3m) bleibt
  // es beim Tag der Ablage. Der Dienst läuft unter der Uhr desselben Tages (`on`).
  const minutes = (title: string, documentDate?: string) => ({ bytes: textPdf([title, '', 'Erfundenes Beispiel für die Entwicklung.']), fileName: `${title}.pdf`, ...(documentDate ? { documentDate } : {}) });

  // 1) Erfüllter Zweck mit Rest (Prüfstein 9): 500 € eingegangen, 350 € verwendet, 100 € in die freien Mittel umgewidmet — 50 € Rest.
  await ensurePurpose(deps, ctx, 'Notfallhilfe Winter', { targetCents: 50000 });
  const winter = purposeByName(deps, 'Notfallhilfe Winter');
  await ensureEntry(deps, 'Spende Notfallhilfe Winter', () =>
    bookEntry(deps, ctx, { entryDate: `${storyYear}-01-20`, text: 'Spende Notfallhilfe Winter', moneyLines: [{ accountId: bank.id, amountCents: 50000 }], allocationLines: [{ categoryId: donationsCat.id, amountCents: 50000, purposeId: winter.id }] }).then(unwrap),
  );
  await ensureEntry(deps, 'Ausgabe Notfallhilfe Winter', () =>
    bookEntry(deps, ctx, { entryDate: `${storyYear}-02-20`, text: 'Ausgabe Notfallhilfe Winter', moneyLines: [{ accountId: bank.id, amountCents: -35000 }], allocationLines: [{ categoryId: programCostsCat.id, amountCents: -35000, purposeId: winter.id }] }).then(unwrap),
  );
  // Je Umwidmung und je Rücklage über ihren Grund bzw. Namen gesichert, nicht über „gibt es schon eine“: Frühere Jahre
  // und Vereinsdaten dürfen eigene haben (Plan seed-mehrjahre Task 2).
  const transferWith = (reason: string) => deps.db.select({ id: financePurposeTransfers.id }).from(financePurposeTransfers).where(eq(financePurposeTransfers.reason, reason)).get();
  if (!transferWith('Rest nach Abschluss der Hilfe')) {
    const row = deps.db.select().from(financePurposes).where(eq(financePurposes.id, winter.id)).get();
    if (row && !row.fulfilledAt) unwrap(await fulfillPurpose(deps, ctx, { id: winter.id, expectedVersion: row.updatedAt }));
    const rest = unwrap(
      await requestPurposeTransfer(on(deps, `${storyYear}-03-01`), writeCtx, { fromPurposeId: winter.id, toPurposeId: null, amountCents: 10000, transferDate: `${storyYear}-03-01`, reason: 'Rest nach Abschluss der Hilfe', documentUpload: minutes('Protokoll Umwidmung Notfallhilfe', `${storyYear}-03-01`) }),
    );
    unwrap(await approvePurposeTransfer(deps, approveCtx, { id: rest.id }));
  }
  // 2) Wartet auf Jonas Feld: aus den freien Mitteln in die Jugendfreizeit, angelegt von der Verwaltung.
  if (!transferWith('Zusage für die Herbstfahrt')) {
    const youth = purposeByName(deps, 'Jugendfreizeit');
    unwrap(
      await requestPurposeTransfer(deps, writeCtx, { fromPurposeId: null, toPurposeId: youth.id, amountCents: 20000, transferDate: `${storyYear}-03-05`, reason: 'Zusage für die Herbstfahrt', documentUpload: minutes('Protokoll Umwidmung Jugendfreizeit') }),
    );
  }

  // 3) Zurückgelegtes Geld — je Rücklage nur, solange es sie noch nicht gibt; ihre Bewegungen entstehen mit ihr.
  const reserveNamed = (name: string) => deps.db.select({ id: financeReserves.id }).from(financeReserves).where(eq(financeReserves.name, name)).get();
  const d = (monthDay: string) => `${storyYear}-${monthDay}`;
  if (!reserveNamed('Projektmittel Dach')) {
    const dach = purposeByName(deps, 'Dachsanierung Vereinsheim');
    const project = unwrap(await saveReserve(on(deps, d('02-09')), writeCtx, { kind: 'projectFunds', name: 'Projektmittel Dach', purposeText: 'Neues Vereinsheimdach', purposeId: dach.id, resolutionUpload: minutes('Protokoll Projektmittel Dach', d('02-09')) }));
    unwrap(await recordReserveMovement(on(deps, d('02-10')), writeCtx, { reserveId: project.id, kind: 'allocate', movementDate: d('02-10'), amountCents: 30000, resolutionUpload: minutes('Protokoll Zuführung Projektmittel Dach', d('02-10')) }));
  }
  // Seit Plan seed-mehrjahre angespart in den abgeschlossenen Jahren (`seedReplacementReserveYear`); im Stichjahr gekauft.
  {
    const known = reserveNamed('Ersatz Transporter');
    const replacement = known ?? unwrap(await saveReserve(on(deps, d('01-14')), writeCtx, { kind: 'replacement', name: 'Ersatz Transporter', purposeText: 'Ersatz des Vereinsfahrzeugs', resolutionUpload: minutes('Protokoll Ersatz Transporter', d('01-14')) }));
    const moves = movementsOf(deps, replacement.id);
    if (!moves.some((m) => m.kind === 'allocate')) unwrap(await recordReserveMovement(on(deps, d('01-15')), writeCtx, { reserveId: replacement.id, kind: 'allocate', movementDate: d('01-15'), amountCents: 20000, resolutionUpload: minutes('Protokoll Zuführung Ersatz Transporter', d('01-15')) }));
    if (!moves.some((m) => m.kind === 'dissolve')) unwrap(await recordReserveMovement(on(deps, d('03-20')), writeCtx, { reserveId: replacement.id, kind: 'dissolve', movementDate: d('03-20'), resolutionUpload: minutes('Protokoll Auflösung Ersatz Transporter', d('03-20')) }));
  }
  {
    // Die freie Rücklage nutzt 85 % des Höchstbetrags dieses Jahres — über dem Warnwert (80 %), unter der Grenze. Seit Plan
    // seed-mehrjahre besteht sie meist schon aus einem früheren Jahr; dann geht die Zuführung auf sie.
    const year = deps.db.select().from(financeFiscalYears).all().find((y) => y.startsOn <= `${storyYear}-03-15` && `${storyYear}-03-15` <= y.endsOn);
    const known = reserveNamed('Freie Rücklage');
    const free = known ?? unwrap(await saveReserve(on(deps, d('03-14')), writeCtx, { kind: 'free', name: 'Freie Rücklage', resolutionUpload: minutes('Protokoll Freie Rücklage', d('03-14')) }));
    const cap = year ? unwrap(await freeReserveCap(deps, writeCtx, { fiscalYearId: year.id })).capCents : 0;
    const amountCents = Math.floor((cap * 85) / 100);
    if (year && amountCents > 0 && !movementsOf(deps, free.id).some((m) => m.forFiscalYearId === year.id)) {
      unwrap(await recordReserveMovement(on(deps, d('03-15')), writeCtx, { reserveId: free.id, kind: 'allocate', movementDate: d('03-15'), amountCents, forFiscalYearId: year.id, resolutionUpload: minutes('Protokoll Zuführung Freie Rücklage', d('03-15')) }));
    }
  }

  // 4) Pauschale an ein Vorstandsmitglied — ohne bestätigten Einrichtungspunkt „Vergütung des Vorstands“ (Warnung in E21).
  const person = async (firstName: string, lastName: string): Promise<string> => {
    const found = deps.db.select({ id: contacts.id }).from(contacts).where(and(eq(contacts.firstName, firstName), eq(contacts.lastName, lastName))).get();
    return found?.id ?? unwrap(await createContact(deps, contactCtx, { kind: 'person', firstName, lastName })).id;
  };
  const helga = await person('Helga', 'Sommer');
  if (!deps.db.select({ id: contactRoles.id }).from(contactRoles).where(and(eq(contactRoles.contactId, helga), eq(contactRoles.role, 'board-member'))).get()) {
    unwrap(await addContactRole(deps, contactCtx, { id: helga, role: 'board-member', since: `${storyYear}-01-01` }));
  }
  const volunteerCat = categoryByKey(deps, 'volunteer-allowance');
  await ensureEntry(deps, 'Ehrenamtspauschale Vorstand', () =>
    bookEntry(deps, ctx, { entryDate: `${storyYear}-03-10`, text: 'Ehrenamtspauschale Vorstand', moneyLines: [{ accountId: bank.id, amountCents: -78000 }], allocationLines: [{ categoryId: volunteerCat.id, amountCents: -78000, contactId: helga }], reason: 'Satzungsänderung zur Vorstandsvergütung ist beantragt' }).then(unwrap),
  );

  // 5) Eine nahestehende Person, deren Rolle zur Jahresmitte endet — die Zahlung im März steht in E21.
  const paul = await person('Paul', 'Winter');
  if (!deps.db.select({ id: contactRoles.id }).from(contactRoles).where(and(eq(contactRoles.contactId, paul), eq(contactRoles.role, 'related-party'))).get()) {
    unwrap(await addContactRole(deps, contactCtx, { id: paul, role: 'related-party', since: `${storyYear}-01-01` }));
    const role = deps.db.select({ id: contactRoles.id }).from(contactRoles).where(and(eq(contactRoles.contactId, paul), eq(contactRoles.role, 'related-party'))).get()!;
    unwrap(await endContactRole(deps, contactCtx, { roleId: role.id, until: `${storyYear}-06-30` }));
  }
  await ensureEntry(deps, 'Honorar Werkstattkurs', () =>
    bookEntry(deps, ctx, { entryDate: `${storyYear}-03-12`, text: 'Honorar Werkstattkurs', moneyLines: [{ accountId: bank.id, amountCents: -12000 }], allocationLines: [{ categoryId: programCostsCat.id, amountCents: -12000, contactId: paul }] }).then(unwrap),
  );
  // AC: Paul hat auch gespendet — das Honorar ist ausdrücklich keine Rückgabe seiner Spende.
  const honorar = entryByText(deps, 'Honorar Werkstattkurs');
  if (!notReturnMarkInternal(deps.db, honorar.id)) unwrap(await markNotReturn(deps, ctx, { entryId: honorar.id, notReturn: true, note: 'Honorar für den Werkstattkurs, keine Rückzahlung' }));
}

/**
 * Der Vorstandswechsel aus dem Protokoll der Mitgliederversammlung (Akte, Stichjahr 29.04.): Bernd Hagedorn war drei
 * Jahre im Vorstand, Clara Neumann folgt. Beide kommen aus dem Kontakte-Seed; fehlen sie (Modultest), bleibt der
 * Schritt aus — der Finanz-Seed erfindet hier keine Personen. Idempotent über die vorhandene Rolle.
 */
async function seedBoardHistory(deps: Deps, ctx: CallContext, year: number): Promise<void> {
  const contactCtx: CallContext = { ...ctx, permissions: new Set([...ctx.permissions, 'contacts.manage']) };
  const find = (firstName: string, lastName: string) => deps.db.select({ id: contacts.id }).from(contacts).where(and(eq(contacts.firstName, firstName), eq(contacts.lastName, lastName))).get()?.id ?? null;
  const onBoard = (contactId: string) => !!deps.db.select({ id: contactRoles.id }).from(contactRoles).where(and(eq(contactRoles.contactId, contactId), eq(contactRoles.role, 'board-member'))).get();
  const bernd = find('Bernd', 'Hagedorn');
  if (bernd && !onBoard(bernd)) {
    const added = unwrap(await addContactRole(deps, contactCtx, { id: bernd, role: 'board-member', since: `${year - 3}-04-01` }));
    const open = added.roles.find((r) => r.role === 'board-member' && r.until === null);
    if (open) unwrap(await endContactRole(deps, contactCtx, { roleId: open.id, until: `${year}-04-28` }));
  }
  const clara = find('Clara', 'Neumann');
  if (clara && !onBoard(clara)) unwrap(await addContactRole(deps, contactCtx, { id: clara, role: 'board-member', since: `${year}-04-29` }));
}

/**
 * Rechenschaft B2: Datenexporte über das Vorjahr, erzeugt über den echten Lauf mit gestellter Uhr — einer vor fünf
 * Tagen (Liste, Herunterladen), einer vor 40 Tagen, den das Aufräumen gleich wieder löscht (Zeile mit
 * `file_deleted_at`, Protokoll `expire`). Bewusst relativ zu heute: Die Frist rechnet von heute. Ohne Datenverzeichnis
 * (Modultests, Skripte) gibt es keinen Platz für den Lauf; dann still nichts. Idempotent: nichts, wenn es schon Exporte gibt.
 */
async function seedDataExports(deps: Deps, ctx: CallContext, previousYear: number): Promise<void> {
  const dataPath = (deps as Deps & { dataPath?: string }).dataPath;
  if (!dataPath) return;
  if (deps.db.select({ id: financeDataExports.id }).from(financeDataExports).limit(1).get()) return;
  const year = deps.db.select({ id: financeFiscalYears.id }).from(financeFiscalYears).where(eq(financeFiscalYears.designation, String(previousYear))).get();
  if (!year) return;
  const slot = dataExportSlot(dataPath);
  for (const daysAgo of [40, 5]) {
    const at = new Date(deps.clock.now().getTime() - daysAgo * 86_400_000);
    const shifted: Deps = { ...deps, clock: { now: () => new Date(at.getTime()) } };
    const started = unwrap(await startDataExport(shifted, ctx, { fiscalYearIds: [year.id] }));
    if (started.started) await waitForJob(slot, started.runId);
  }
  await sweepDataExports(deps);
}
