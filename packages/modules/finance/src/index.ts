export { financeModule, FINANCE_PERMISSIONS } from './manifest';
export {
  financeAccounts,
  financeAllocationLines,
  financeCashCounts,
  financeCategories,
  financeConfirmationLines,
  financeConfirmations,
  financeDatedValues,
  financeEntries,
  financeEntryCounters,
  financeAllocationCorrections,
  financeEntryDocuments,
  financeEntryJustifications,
  financeFiscalYears,
  financeContactBankAccounts,
  financeImportCandidates,
  financeImportRules,
  financeImportRuns,
  financeInKindDetails,
  financeMoneyLines,
  financeNotices,
  financeOpenItems,
  financeOpenItemSettlements,
  financePeriodEvents,
  financeProjectSettings,
  financePurposes,
  financeRawTransactions,
  financeSigners,
  type FinanceAccountRow,
  type FinanceAllocationCorrectionRow,
  type FinanceAllocationLineRow,
  type FinanceCashCountRow,
  type FinanceCategoryRow,
  type FinanceConfirmationLineRow,
  type FinanceConfirmationRow,
  type FinanceDatedValueRow,
  type FinanceEntryDocumentRow,
  type FinanceEntryJustificationRow,
  type FinanceEntryRow,
  type FinanceFiscalYearRow,
  type FinanceContactBankAccountRow,
  type FinanceImportCandidateRow,
  type FinanceImportRuleRow,
  type FinanceImportRunRow,
  type FinanceInKindDetailsRow,
  type FinanceMoneyLineRow,
  type FinanceNoticeRow,
  type FinanceOpenItemRow,
  type FinanceOpenItemSettlementRow,
  type FinancePeriodEventRow,
  type FinanceProjectSettingsRow,
  type FinancePurposeRow,
  type FinanceRawTransactionRow,
  type FinanceSignerRow,
} from './schema';

export { requireFinanceRead } from './ledger/access';
export { isValidIban, normalizeIban } from './ledger/iban';
export { ALLOWANCE_KINDS, CERTIFIABLE_INCOME_KINDS, COST_FUNCTIONS, DIRECTIONS, INCOME_KINDS, INPUT_TAX, SPHERES, TAX_CODES } from './ledger/codes';
export {
  accountActiveSchema,
  accountCreateSchema,
  accountDeleteSchema,
  accountInUseInternal,
  accountListSchema,
  accountUpdateSchema,
  createAccount,
  deleteAccount,
  listAccounts,
  setAccountActive,
  setImportFormatInternal,
  updateAccount,
  type AccountView,
} from './ledger/accounts';
export {
  categoryFieldsSchema,
  categoryInUseInternal,
  createCategory,
  createCategoryInternal,
  deleteCategory,
  listCategories,
  setCategoryActive,
  updateCategory,
  type CategoryView,
} from './ledger/categories';
export { START_PLAN } from './ledger/start-plan';
export {
  createPurpose,
  deletePurpose,
  dissolvePurpose,
  fulfillPurpose,
  listPurposes,
  purposeInUseInternal,
  reopenPurpose,
  setPurposeActive,
  updatePurpose,
  type PurposeView,
} from './ledger/purposes';
export {
  allocateEntryNumber,
  createFirstFiscalYear,
  ensureFiscalYearFor,
  fiscalYearForInternal,
  fiscalYearStatusInternal,
  listFiscalYears,
  updateFiscalYear,
  type FiscalYearStatus,
  type FiscalYearView,
} from './ledger/fiscal-years';
export { DATED_SERIES, type DatedValueKey } from './ledger/dated-series';
export { listDatedValues, removeDatedValue, setDatedValue, valueAt, type DatedValueListEntry } from './ledger/dated-values';
export { closePurpose, deleteMasterData, readMasterData, saveMasterData, setMasterDataActive } from './ledger/master-data';
export { firstNegativeCashDay, formatEuro } from './ledger/cash-check';
export { countCash, emptyDonationBox, lastCountInternal, listCashCounts, moveCash, readCashCountProtocol, type CashCountKind, type CashCountView, type CountCashResult, type EmptyDonationBoxResult } from './ledger/cash';
export { cashCountTemplate, type CashCountTemplateInput } from './ledger/cash-count-template';
export {
  applyTaxDefaults,
  confirmSetupStep,
  getPermissionMatrix,
  getSetupStatus,
  setFinanceLimit,
  setFinanceSwitch,
  type PermissionMatrixActivity,
  type PermissionMatrixRole,
  type SetupStep,
  type SetupStepKey,
} from './ledger/setup';
export { taxContextAt, taxOf, type Taxation, type TaxCode, type TaxInput, type TaxResult } from './ledger/tax';
export { abortFinalize, bookEntry, checkFinalizableInternal, finalizeEntry, finalizeInternal, finalizeReviewed, FinalizeAborted, type FinalizeOptions } from './ledger/finalize';
export { reverseEntry, reverseInternal } from './ledger/reverse';
export {
  deleteDraft,
  documentationOf,
  entryLinesSchema,
  entryViewInternal,
  getEntry,
  listEntries,
  resolveEntryLines,
  saveDraft,
  setReviewed,
  writeLinesInternal,
  type AllocationLineView,
  type AllocationLineWrite,
  type EntryDocumentationState,
  type EntryLinesInput,
  type EntryView,
  type MoneyLineView,
  type MoneyLineWrite,
  type VoucherListEntry,
} from './ledger/entries';

export { attachDocument, listVouchersWithoutEntry, readVoucher, revokeVoucher, uploadVoucher, type VoucherLinkResult, type VoucherWithoutEntry } from './ledger/vouchers';
export {
  accountBalancesAt,
  assetOverviewAt,
  incomeStatement,
  projectBalances,
  purposeBalancesAt,
  standing,
  type AccountBalance,
  type AssetOverview,
  type IncomeStatement,
  type IncomeStatementCategory,
  type IncomeStatementSphere,
  type ProjectBalance,
  type PurposeBalance,
  type Sphere,
  type Standing,
} from './ledger/queries';
export { getBalances, getIncomeStatement, type BalancesView } from './ledger/overview';
export {
  closeFiscalYear,
  justifyUndocumentedEntry,
  previewPeriod,
  previewPeriodClose,
  previewPeriodReopen,
  previewReopenInternal,
  reopenFiscalYear,
  reopenInternal,
  type PeriodClosePreview,
  type UndocumentedEntryPreview,
} from './ledger/period';
export { financeRecordDeleted, financeRecordReferences, financeRetentionDue, financeRetentionHolds, yearAnchorInternal } from './ledger/holds';
export { getEntryHistory, type EntryHistoryEvent } from './ledger/history';
export { getProjectFinance, projectFinanceInternal, setProjectFinance, type ProjectFinanceSettings } from './ledger/project-settings';
export { cancelOpenItem, createOpenItem, listOpenItems, listOpenItemSettlements, openCentsInternal, openItemHasAnySettlementInternal, openItemsAtInternal, overdueOpenItemsInternal, saveOpenItem, updateOpenItem, type OpenItemSettlementView, type OpenItemView } from './ledger/open-items';
export { applyCorrectionInternal, approveAllocationCorrection, decideAllocationCorrection, listAllocationCorrections, rejectAllocationCorrection, requestAllocationCorrection, type CorrectionView } from './ledger/corrections';

export { AUDIT_FIELDS, financeAudit, type FinanceEntity } from './audit';
export { installFinance } from './install';
export { FINANCE_MCP_TOOLS } from './mcp-tools';
export { seedFinance } from './seed';

export { parseCamt053, type CamtError, type CamtLine, type CamtStatement } from './import/camt';
export { buildCamt053, buildCamt053Bytes, type CamtFixtureInput, type CamtFixtureLine } from './import/camt-fixture';
export { dedupKey, normalizePurpose } from './import/dedup';
export { getImportRun, importRunRowInternal, importStatement, listImportRuns, setRunClosingBalance, toRunView, type ImportRunView } from './import/runs';
export { decideCandidate, listCandidates, type CandidateView } from './import/candidates';
export { getRawTransaction, listRawTransactions, rawStateInternal, rawTransactionViewInternal, rawTransactionsForRunInternal, type RawTransactionView } from './import/queries';
export { discardRun, previewDiscardRun, type DiscardBlockingEntry, type DiscardPreview } from './import/discard';
export { getAccountStatements, type AccountStatementView } from './import/accounts';
export { activeProfileInternal, listImportProfiles, profileFormatInternal, saveImportProfile, type ImportProfileView } from './import/profiles';

// F5 — Arbeitsliste: Regeln, Kontakt über IBAN, Vorschläge, Handeln, fremdes Geld, Sammel-Festschreiben, Beleg von beiden Seiten.
export { deleteImportRule, listImportRules, previewImportRule, saveImportRule, type ImportRuleView } from './import/rules';
export { ruleMatches, normalizeText, type RuleConditions, type RuleTarget } from './import/suggest/rule';
export { contactForIbanInternal, createContactFromTransaction, learnContactIbanInternal, linkContactIban, listContactIbans, unlinkContactIban, type ContactIbanSource, type ContactIbanView } from './import/contact-ibans';
export { openRawTransactionsInternal, suggestForTransaction, type SuggestionDraft, type SuggestionKind, type SuggestionReason, type SuggestionView } from './import/suggestions';
export { getWorkCounts, listWorkItems, type SuggestionSummary, type WorkCounts, type WorkEntry, type WorkItem, type WorkOpenItem, type WorkTab } from './import/work';
export { bookFromTransaction, linkTransactionToEntry } from './import/book';
export { listForeignMoney, markTransactionForeign, type ForeignMoneyItem } from './import/transit';
export { previewBatchFinalize, type BatchAccountPreview, type BatchFinalizePreview } from './import/batch';
export { amountSpellings, attachVoucherToTransaction, searchVouchersForTransaction, type VoucherSearchHit } from './import/vouchers';
export { INVOICE_ATTACHMENT_NAMES, INVOICE_XML_MAX_BYTES, isInvoiceAttachmentName, parseFacturX, type InvoiceTax, type ParseInvoiceResult, type ParsedInvoice } from './import/zugferd/parse';
export { applyInvoiceToDraft, createOpenItemFromInvoice, invoiceProposal, readInvoiceFromDocument, type InvoiceProposal, type InvoiceView } from './import/zugferd/read';

// F6a — Spenden: Bescheide; Gültigkeit rein in `ledger/`, damit F7 sie für Empfängerbescheide nutzt.
export { NOTICE_KINDS, noticeValidAt, noticeValidUntil, type NoticeKind, type NoticeValidityInput } from './ledger/notice-validity';
export { certifiableLineExistsInternal, listNotices, noticeExpiryInternal, noticeValidAtInternal, saveNotice, supersedeNotice, voidNotice, type NoticeView } from './donations/notices';
// Maschinelles Verfahren: `readFacsimile` nur für den Route Handler (bewusst ohne MCP — Ausnahmeliste der App).
export {
  createNotificationLetterDraft,
  FACSIMILE_MAX_BYTES,
  getMachineProcedure,
  machineProcedureStatusAt,
  readFacsimile,
  readFacsimileInternal,
  saveSigner,
  uploadFacsimile,
  type MachineProcedureStatus,
  type SignerView,
} from './donations/machine';
export { type MachineProcedureMissing } from './ledger/machine-status';
// Bestätigung: Prüfliste, Ausstellen, Rücknahme, Versand, unterschriebene Fassung, Listen, Vorschau (nur Route Handler), Sachspende.
export {
  checkConfirmable,
  CONFIRMATION_CHECK_KEYS,
  checkConfirmableInternal,
  checkFailure,
  missingContactFields,
  type CheckConfirmableArgs,
  type ConfirmationCheck,
  type ConfirmationCheckKey,
  type ConfirmationCheckLine,
  type ConfirmationCheckResult,
  type ConfirmationWarning,
} from './donations/check';
export {
  attachSignedConfirmation,
  buildConfirmationInputInternal,
  countNeedsSignatureInternal,
  issueConfirmation,
  listConfirmations,
  listUncertifiedDonations,
  PREVIEW_NUMBER,
  previewConfirmation,
  readConfirmationCopy,
  recordConfirmationDispatch,
  voidConfirmation,
  type ConfirmationInputBuild,
  type ConfirmationInputOptions,
  type ConfirmationKind,
  type ConfirmationLineView,
  type ConfirmationList,
  type ConfirmationView,
  type UncertifiedGroup,
} from './donations/confirmations';
export { getInKindDetails, saveInKindDetails } from './donations/in-kind';
export { countToCorrectInternal, toCorrectConfirmationsInternal, toCorrectReasonsInternal, type ToCorrectReason } from './donations/to-correct';
export { confirmationContactLock, confirmationEntryLock } from './donations/locks';
export { ENTRY_LOCKS, registerEntryLocks, type EntryLock } from './locks';
