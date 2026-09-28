import { localizedConflict, requireHumanChannel, type CallContext, type Deps, type Failure } from '@kompass/core';

/**
 * Die Fehlerbilder des Moduls (Finanz-Spec 5.4: „Fehlerbilder sind `Result`-Werte mit Grund **und** Abhilfe“) —
 * je Code die Parameter, die der Dienst setzt, mit ihrer Art: `date` (`YYYY-MM-DD`), `cents` (Betrag in Cent) oder
 * `text`. Grund und Abhilfe selbst stehen in der Sprachdatei unter `finance.errors.<code>.reason`/`.remedy`
 * (A6); Oberfläche und MCP setzen daraus denselben Text zusammen und formatieren Datum und Betrag dort, an einer
 * Stelle (ICU). `financeConflict` ist die einzige Stelle im Modul, die einen Konflikt erzeugt (Wächter:
 * `tests/errors.test.ts`); `apps/kompass/tests/finance-error-messages.test.ts` hält Tabelle und Sprachdatei gleich.
 */
export const FINANCE_ERRORS = {
  // Befund 13: dieselbe Menschen-Sperre für jeden festschreibenden/freigebenden Dienst — Grund und Abhilfe statt des rohen Einstellungsschlüssels (Spec 10.2).
  humanOnly: {},
  accountInUse: {},
  mainAccountMustBeBank: {},
  mainAccountMustStayActive: {},
  categoryKeyTaken: { key: 'text' },
  categoryInUse: {},
  purposeInUse: {},
  purposeClosed: {},
  fiscalYearExists: {},
  designationLocked: {},
  designationTaken: { designation: 'text' },
  entryNotDraft: { number: 'text' },
  entryNotFinal: {},
  entryUnbalanced: { rest: 'cents', money: 'cents', allocated: 'cents' },
  entryEmpty: {},
  entryDateInFuture: { date: 'date', today: 'date' },
  // Befund AH: Pauschale an ein Vorstandsmitglied ohne Grundlage — Pflichtbegründung, kein Verbot.
  boardAllowanceNeedsReason: { contact: 'text', date: 'date' },
  // Befund Q: ein Zweck ginge ins Minus — Pflichtbegründung, kein Verbot.
  purposeGoesNegative: { purpose: 'text', balance: 'cents' },
  // Befund S: Zuführung zur freien Rücklage über dem Höchstbetrag des Jahres — Pflichtbegründung, kein Verbot.
  freeReserveCapExceeded: { cap: 'cents', over: 'cents' },
  accountInactive: { account: 'text' },
  categoryInactive: { category: 'text' },
  fiscalYearClosed: { year: 'text' },
  noFiscalYearForDate: { date: 'date', names: 'text' },
  cashDraftNotAllowed: {},
  cashWouldGoNegative: { account: 'text', date: 'date', amount: 'cents' },
  cashNegativeNeedsReason: { account: 'text', date: 'date', amount: 'cents' },
  entryAlreadyReversed: { number: 'text', by: 'text' },
  entryIsReversal: { number: 'text' },
  notReviewed: { count: 'text' },
  noTaxRateForDate: { date: 'date' },
  voucherTypeNotAllowed: { type: 'text' },
  documentNotFinal: {},
  documentVoided: {},
  voucherAlreadyLinked: {},
  voucherAlreadyRevoked: {},
  revokeNeedsReplacement: { year: 'text' },
  settlementExceedsLine: {},
  settlementWrongDirection: {},
  openItemCancelled: {},
  openItemInUse: {},
  openItemHasPayments: {},
  openItemHasOrigin: {},
  lineNotFinal: {},
  correctionChangesNothing: {},
  purposeChangeNeedsProof: {},
  ownCorrection: {},
  section153Unacknowledged: {},
  correctionNotPending: {},
  correctionPendingExists: {},
  draftsInPeriod: { count: 'text' },
  unbookedStatementLines: { count: 'text' },
  accountsWithoutStatement: { accounts: 'text' },
  undocumentedEntries: { count: 'text' },
  previousYearOpen: {},
  fiscalYearAlreadyClosed: { year: 'text' },
  fiscalYearNotEnded: { year: 'text' },
  fiscalYearNotClosed: { year: 'text' },
  laterYearClosed: {},
  cashCountNeedsNote: {},
  cashCountSameCounter: {},
  cashCountCounterNotPerson: {},
  cashCountNotCash: { account: 'text' },
  cashCountInFuture: {},
  cashCountDenominationsMismatch: { denominationSum: 'cents', countedCents: 'cents' },
  cashMoveNeedsOneCash: {},
  switchUiOnly: {},
  // F4 Task 3 — der Lauf.
  statementAccountNotBank: {},
  statementTooLarge: { limit: 'text' },
  statementUnreadable: {},
  statementUnreadableAtLine: { line: 'text' },
  statementIbanMismatch: { account: 'text' },
  statementFormatChange: { account: 'text' },
  // F4b — ein CSV-Format entsteht nur über den Assistenten (bzw. `saveImportProfile`), nie als bloßes Feld am Konto.
  accountCsvNeedsFormat: {},
  statementNeedsCsvFormat: { account: 'text' },
  statementCsvFormatMismatch: { account: 'text', format: 'text' },
  statementAlreadyImported: { account: 'text' },
  // N3 (W-1) — das Konto erkennt Kompass am Auszug; eine CAMT-Datei gehört dafür zu genau einem Konto.
  statementMultipleAccounts: { ibans: 'text' },
  // N2 — Kontostand nachtragen (genau einmal, Trigger finance_import_runs_balance_once).
  runHasBalance: {},
  runNotAmendable: {},
  // F4 Task 4 — Kandidaten entscheiden, Rohumsatz an der Geldzeile.
  rawTransactionMismatch: {},
  rawTransactionTaken: {},
  rawTransactionDiscarded: {},
  candidateAlreadyDecided: {},
  // F4 Task 5 — Auszug verwerfen.
  statementNotDiscardable: {},
  statementDiscardBlocked: {},
  // F5 — Arbeitsliste, Regeln, Kontakt über IBAN.
  ruleNeedsCondition: {},
  ruleCategoryInactive: { name: 'text' },
  suggestionStale: {},
  transactionAlreadyBooked: {},
  entryLineNotBindable: {},
  foreignNeedsHolder: {},
  // AF: mehr weitergegeben, als vom Eingang fremden Gelds offen ist.
  foreignMoneyOverpaid: { amount: 'cents', open: 'cents' },
  contactIbanTaken: { contact: 'text' },
  voucherSearchNeedsRead: {},
  // F5b — Rechnungen mit ZUGFeRD/Factur-X.
  openItemExistsForDocument: {},
  openItemExistsForInvoice: { reference: 'text', date: 'date' },
  invoiceProbablyPaidNeedsReason: { date: 'date' },
  invoiceCurrencyUnsupported: { currency: 'text' },
  invoiceToolsMissing: {},
  invoiceNotDraft: {},
  invoiceUnreadable: { code: 'text' },
  // F6a — Bescheide und Zuwendungsbestätigungen. Die Bescheidarten heißen hier nie mit ihrem Namen aus dem Steuerrecht (Verbotsliste der Oberfläche).
  noticeVoided: {},
  noticeSuperseded: {},
  noticeNotValidAt: { date: 'date' },
  noNoticeValidAt: { date: 'date' },
  noticeAfterExemption: { date: 'date' },
  confirmationLineNotFinal: {},
  confirmationLineReversed: {},
  confirmationIncomeNotCertifiable: { category: 'text' },
  confirmationContactIncomplete: {},
  confirmationOrganizationIncomplete: {},
  confirmationLineAlreadyConfirmed: { number: 'text' },
  confirmationAmountNotPositive: {},
  confirmationPossibleReturnWithoutOrigin: {},
  confirmationReturnDraftPending: {},
  // N2: Eine Auszahlung auf einer bestätigungsfähigen Kategorie ist per Definition eine Rückgabe.
  notReturnOnCertifiableCategory: {},
  confirmationEntryUndocumented: {},
  confirmationInKindDetailsMissing: {},
  confirmationInKindMixed: {},
  confirmationTypeInactive: {},
  confirmationExpenseWaiversDisabled: {},
  confirmationBeforeExemptionStart: { entryDate: 'date', exemptFrom: 'date' },
  confirmationAlreadyVoided: {},
  confirmationAlreadySent: {},
  confirmationWasSent: { sentAt: 'date' },
  confirmationSignedMissing: {},
  confirmationNoRecall: {},
  recallTrailAlreadyRecorded: {},
  confirmationChangedMeanwhile: {},
  // BMF 7.11.2013 Nr. 2: Einzel- und Sachzuwendungsbestätigung auf einer Seite (Kurskorrektur 2026-09-27).
  confirmationTooLong: { pages: 'text' },
  confirmationSignedAlready: {},
  signerOverlaps: {},
  facsimileTooLarge: {},
  facsimileNotImage: {},
  entryLockedByConfirmation: { number: 'text' },
  contactLockedByConfirmation: { number: 'text' },
  // Befund 49: je Sperre ein Code statt eines Satzstücks als Parameter.
  entryLockedByPartnerPayment: { payment: 'text' },
  entryLockedByPendingPartnerPayment: { payment: 'text' },
  contactLockedByPartnerPayment: { payment: 'text' },
  contactLockedByPendingPartnerPayment: { payment: 'text' },
  inKindLineOnly: {},
  // F6b — Serienlauf, Sammel-PDFs, Versandvermerk für alle.
  runNothingToIssue: {},
  runAlreadyFinished: {},
  runBlockedNoNotice: {},
  runBlockedOrganizationIncomplete: {},
  runItemNotPending: {},
  bundleToolsMissing: {},
  bundleEmpty: {},
  dispatchNothingMachine: {},
  // F8a — Auslagen: einreichen, freigeben, Verzicht (Spec 8.2).
  expenseNeedsContactLink: { names: 'text' },
  expenseNotDraft: {},
  expenseNotSubmitted: {},
  expenseNothingToSubmit: {},
  expensePositionNeedsReceipt: { position: 'text' },
  expenseTripNeedsKm: {},
  expenseIbanOrWaiver: {},
  expenseOwnClaim: { names: 'text' },
  expenseSameContact: { names: 'text' },
  expenseCategoryRequired: { position: 'text' },
  expenseWaiversDisabled: {},
  waiverAgreedAfterPosition: {},
  waiverLateNeedsReason: {},
  waiverFundsInsufficient: { date: 'date', free: 'cents', amount: 'cents' },
  waiverDeclarationMissing: {},
  waiverSignedMissing: {},
  waiverNotConfirmed: {},
  waiverBasisMissing: {},
  expenseFileNotPdf: { file: 'text' },
  expenseFileTooLarge: { file: 'text', limit: 'text' },
  expenseNotOwner: {},
  waiverSignedAlready: {},
  expenseWaiverCategoryMissing: {},
  expenseNotRejected: {},
  batchNothingReviewed: {},
  // F7 — Partner, Zahlungen an Partner, Nachweise (Spec 8.1, 9.7, 10.1).
  partnerBasisNotForAgent: {},
  partnerBasisNeedsOrganization: {},
  partnerBasisOverrideNeedsReason: {},
  partnerPaymentNotSubmitted: {},
  partnerPaymentNotRejected: {},
  allocationLineAlreadyAssigned: {},
  paidLinesRequired: {},
  paidLineNotEligible: {},
  paidLineNotFinal: {},
  evidenceExplanationMissing: { kind: 'evidenceKind' },
  evidenceKindMissing: { kind: 'evidenceKind' },
  evidenceAmountMissing: { kind: 'evidenceKind' },
  evidenceCoverageIncomplete: {},
  evidenceNotYetPaid: { number: 'text' },
  evidenceAlreadyAcknowledged: {},
  partnerNoticeReasonRequired: {},
  partnerOverdueReasonRequired: {},
  partnerProfileInUse: {},
  partnerPaymentOwnCreator: {},
  partnerNoticeNotApplicable: {},
  // F8b — zurückgelegtes Geld (Rücklagen), Zweck ändern (Umwidmung), Personenübersicht (Spec 8.3, 8.4, 10.1).
  reserveResolutionRequired: {},
  reservePurposeTextRequired: {},
  reserveInsufficient: { date: 'date', name: 'text', available: 'cents', amount: 'cents' },
  reserveDissolved: {},
  reserveMovementOutOfOrder: { date: 'date' },
  reserveInUse: {},
  reserveCarryForwardIncomplete: {},
  reserveCarryForwardOwnStep: {},
  movementDateInFuture: { date: 'date', today: 'date' },
  transferSamePurpose: {},
  transferNoPurposes: {},
  transferDocumentRequired: {},
  transferNotSubmitted: {},
  transferOwn: {},
  transferDateInFuture: { date: 'date', today: 'date' },
  purposeReopenNeedsReason: {},
  resolutionTypeInactive: { names: 'text' },
  resolutionFileNotPdf: { file: 'text' },
  resolutionFileTooLarge: { file: 'text', limit: 'text' },
} as const satisfies Record<string, Record<string, FinanceErrorParamKind>>;

/** `evidenceKind`: der Schlüssel einer Nachweisart (P, Prüfer Block 2) — die Sprachdatei nennt ihn per ICU-`select` in Worten. */
export type FinanceErrorParamKind = 'text' | 'date' | 'cents' | 'evidenceKind';
export type FinanceErrorCode = keyof typeof FINANCE_ERRORS;
type ParamsOf<C extends FinanceErrorCode> = { [K in keyof (typeof FINANCE_ERRORS)[C]]: string | number };

/** Die Codes, mit denen eine Sperre an einer Buchung antwortet (`EntryLock`, Befund 49). */
export type EntryLockCode =
  | 'entryLockedByConfirmation'
  | 'contactLockedByConfirmation'
  | 'entryLockedByPartnerPayment'
  | 'entryLockedByPendingPartnerPayment'
  | 'contactLockedByPartnerPayment'
  | 'contactLockedByPendingPartnerPayment';

/** Der Konflikt einer Sperre — Code und Parameter kommen aus ihr, der Text aus der Sprachdatei. */
export function lockConflict(hit: { code: EntryLockCode; params: Record<string, string> }): Failure {
  return localizedConflict(hit.code, `finance.errors.${hit.code}`, hit.params);
}

/** Der Konflikt `code` mit den Parametern, die sein Text braucht — der Text selbst kommt aus der Sprachdatei. */
export function financeConflict<C extends FinanceErrorCode>(code: C, ...params: keyof (typeof FINANCE_ERRORS)[C] extends never ? [] : [ParamsOf<C>]): Failure {
  return localizedConflict(code, `finance.errors.${code}`, (params[0] ?? {}) as Record<string, string | number>);
}

/**
 * Wie `requireHumanChannel` aus `@kompass/core`, aber die Ablehnung nennt
 * Grund und Abhilfe statt des rohen Einstellungsschlüssels (Befund 13, Spec
 * 10.2) — die einzige Einstellung des Moduls, `finance.mcpHumanOnlyAllowed`,
 * gilt für jeden festschreibenden oder freigebenden Dienst gleich.
 */
export function requireHumanChannelFinance(deps: Deps, ctx: CallContext): Failure | null {
  const denied = requireHumanChannel(deps, ctx, 'finance.mcpHumanOnlyAllowed');
  return denied ? financeConflict('humanOnly') : null;
}
