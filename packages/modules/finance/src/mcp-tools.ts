import { invalid, readSetting, type McpToolDefinition } from '@kompass/core';
import { z } from 'zod';
import {
  activeReserveSchema,
  deleteReserve,
  freeReserveCap,
  freeReserveCapSchema,
  freeReserveCapOverview,
  freeReserveCapOverviewSchema,
  linkResolution,
  linkResolutionSchema,
  listReserves,
  listReservesSchema,
  recordCarryForwardSchema,
  recordReserveCarryForward,
  recordReserveMovement,
  recordReserveMovementSchema,
  reserveIdSchema,
  saveReserve,
  saveReserveSchema,
  setReserveActive,
} from './allocation/reserves';
import {
  approvePurposeTransfer,
  getPurposeTransfer,
  listPurposeTransfers,
  listTransfersSchema,
  purposeMovements,
  purposeMovementsSchema,
  purposeOverview,
  purposeOverviewSchema,
  rejectPurposeTransfer,
  rejectTransferSchema,
  requestPurposeTransfer,
  requestTransferSchema,
  transferIdSchema,
} from './allocation/transfers';
import { personYearOverview, personYearOverviewSchema, relatedPartyPayments, relatedPartyPaymentsSchema } from './allocation/people';
import { setBoardRemuneration, boardRemunerationBaseSchema } from './ledger/setup';
import { approveExpenseClaim, getApproval, listApprovals, rejectExpenseClaim, waiverChecks } from './allocation/approvals';
import { copyExpenseClaim, deleteExpenseDraft, expenseFormStart, getExpenseClaim, listMyExpenseClaims, saveExpenseDraft, submitExpenseClaim, uploadExpenseReceipt } from './allocation/expenses';
import { suggestExpenseCategories } from './allocation/suggest';
import { attachSignedWaiver, createWaiverDeclaration, saveContactWaiverTerms } from './allocation/waiver';
import { decideCandidate, listCandidates } from './import/candidates';
import { discardRun, previewDiscardRun } from './import/discard';
import { getImportRun, importStatement, listImportRuns, setRunClosingBalance } from './import/runs';
import { detectStatementAccount } from './import/detect';
import { getRawTransaction, listRawTransactions } from './import/queries';
import { getAccountStatements } from './import/accounts';
import { listImportProfiles, saveImportProfile, saveImportProfileMcpSchema } from './import/profiles';
import { previewBatchFinalize } from './import/batch';
import { bookFromTransaction, linkTransactionToEntry } from './import/book';
import { createContactFromTransaction, linkContactIban, listContactIbans, unlinkContactIban } from './import/contact-ibans';
import { deleteImportRule, listImportRules, previewImportRule, saveImportRule } from './import/rules';
import { suggestForTransaction } from './import/suggestions';
import { listForeignMoney, markTransactionForeign } from './import/transit';
import { attachVoucherToTransaction, searchVouchersForTransaction } from './import/vouchers';
import { getWorkCounts, listWorkItems } from './import/work';
import { applyInvoiceToDraft, createOpenItemFromInvoice, invoiceProposal, readInvoiceFromDocument } from './import/zugferd/read';
import { closePurpose, deleteMasterData, readMasterData, saveMasterData, setMasterDataActive } from './ledger/master-data';
import { accountCreateSchema, accountUpdateSchema } from './ledger/accounts';
import { categoryFieldsSchema, categoryUpdateSchema } from './ledger/categories';
import { purposeCreateSchema, purposeUpdateSchema } from './ledger/purposes';
import { decideAllocationCorrection, listAllocationCorrections, requestAllocationCorrection } from './ledger/corrections';
import { countCash, emptyDonationBox, listCashCounts, moveCash } from './ledger/cash';
import { createFirstFiscalYear, updateFiscalYear } from './ledger/fiscal-years';
import { removeDatedValue, setDatedValue } from './ledger/dated-values';
import { TAX_CODES } from './ledger/codes';
import { deleteDraft, getEntry, listEntries, saveDraft, setReviewed } from './ledger/entries';
import { bookEntry, finalizeEntry, finalizeReviewed } from './ledger/finalize';
import { getEntryHistory } from './ledger/history';
import { cancelOpenItem, lineTemplateSchema, listOpenItems, listOpenItemSettlements, saveOpenItem } from './ledger/open-items';
import { getBalances, getIncomeStatement } from './ledger/overview';
import { closeFiscalYear, justifyUndocumentedEntry, previewPeriod, reopenFiscalYear } from './ledger/period';
import { markNotReturn } from './ledger/not-return';
import { getProjectFinance, setProjectFinance } from './ledger/project-settings';
import { reverseEntry } from './ledger/reverse';
import { applyTaxDefaults, confirmSetupStep, getPermissionMatrix, getSetupStatus, setExpenseWaiverBasisText, setFinanceLimit, setFinanceSwitch } from './ledger/setup';
import { attachDocument, listVouchersWithoutEntry, revokeVoucher, uploadVoucher } from './ledger/vouchers';
import { NOTICE_KINDS } from './ledger/notice-validity';
import { checkConfirmable } from './donations/check';
import { attachSignedConfirmation, issueConfirmation, listConfirmations, listUncertifiedDonations, recordConfirmationDispatch, recordConfirmationRecall, voidConfirmation } from './donations/confirmations';
import { getInKindDetails, saveInKindDetails } from './donations/in-kind';
import { createNotificationLetterDraft, getMachineProcedure, saveSigner, uploadFacsimile } from './donations/machine';
import { attachNoticeDocument, listNotices, saveNotice, supersedeNotice, voidNotice } from './donations/notices';
import { continueConfirmationRun, dispatchRunConfirmations, getConfirmationRun, listConfirmationRuns, previewConfirmationRun, startConfirmationRun } from './donations/runs';
import { getDonationBook, getDonationReconciliation } from './donations/book';
import { approvePartnerPayment, approvePaymentSchema as approvePartnerPaymentMcpSchema } from './allocation/approvals';
import { acknowledgeEvidence, addEvidenceLink, addEvidenceUpload, ackSchema as acknowledgeEvidenceMcpSchema, idSchema as evidenceIdMcpSchema, linkSchema as addEvidenceLinkMcpSchema, listEvidence, metaSchema as evidenceMetaSchema, removeEvidence, updateEvidence, updateSchema as updateEvidenceMcpSchema } from './allocation/evidence';
import { foreignActivity } from './allocation/foreign';
import {
  copyPartnerPayment,
  deletePartnerPaymentDraft,
  draftBaseSchema as savePartnerPaymentDraftMcpSchema,
  getPartnerPayment,
  idSchema as partnerPaymentIdMcpSchema,
  listEligibleLines,
  listPartnerPayments,
  listSchema as listPartnerPaymentsMcpSchema,
  partnerProofDeadlines,
  rejectSchema as rejectPartnerPaymentMcpSchema,
  rejectPartnerPayment,
  savePartnerPaymentDraft,
  submitPartnerPayment,
  submitSchema as submitPartnerPaymentMcpSchema,
} from './allocation/partner-payments';
import {
  deletePartnerProfile,
  getPartner,
  getBaseSchema as getPartnerMcpSchema,
  idSchema as partnerIdMcpSchema,
  listNoticesSchema as listPartnerNoticesMcpSchema,
  listPartnerNotices,
  listPartners,
  listSchema as listPartnersMcpSchema,
  saveNoticeSchema as savePartnerNoticeMcpSchema,
  savePartnerNotice,
  saveProfileBaseSchema as savePartnerProfileMcpSchema,
  savePartnerProfile,
  setPartnerActive,
  voidNoticeSchema as voidPartnerNoticeMcpSchema,
  voidPartnerNotice,
} from './allocation/partners';

const t = <T>(def: McpToolDefinition<T>): McpToolDefinition => def as McpToolDefinition;

const setPartnerActiveMcpSchema = partnerIdMcpSchema.extend({ isActive: z.boolean() });
const uploadEvidenceMcpSchema = evidenceMetaSchema.extend({ contentBase64: z.string().min(1), fileName: z.string().trim().min(1).max(300) });
const foreignActivityMcpSchema = z.object({ from: z.string().date(), to: z.string().date() });
const proofDeadlinesMcpSchema = z.object({}).strict();

/**
 * Base64 ohne Data-URL-Präfix — wie `media_upload` (`packages/mcp/src/core-tools.ts`).
 * Node's `Buffer.from(…, 'base64')` verwirft fremde Zeichen still; ein Agent
 * bekäme dann ein leeres oder verstümmeltes PDF ohne Fehler.
 */
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;
function decodeBase64(text: string): Uint8Array | null {
  const compact = text.replace(/\s+/g, '');
  if (compact.length === 0 || compact.length % 4 !== 0 || !BASE64.test(compact)) return null;
  return new Uint8Array(Buffer.from(compact, 'base64'));
}

/**
 * M11 (MCP-Prüfer 2026-09-27): Auf oberster Ebene ein Objekt, nie eine Union — ein Client nimmt sonst den ersten
 * Zweig und bietet nur `kind: "account"` an. `includeInactive` gilt für Konten, Kategorien und Zwecke.
 */
const readMasterDataSchema = z.object({
  kind: z.enum(['account', 'category', 'purpose', 'fiscalYear', 'datedValue']),
  includeInactive: z.boolean().optional().describe('account, category and purpose only'),
});

/**
 * Ein Zweig für die Felder einer Art, wie der Client ihn sieht: ohne Vorgabewerte und ohne fremde Felder
 * abzustreifen. Das SDK parst die Argumente mit dem Werkzeugschema, bevor der Dienst sie bekommt — ein
 * Vorgabewert (`isMain: false`) fände sonst in jede Änderung, und eine Union behielte nur die Felder ihres
 * ersten passenden Zweigs. Geprüft wird im Dienst, mit dessen eigenem Schema (`saveMasterDataSchema`).
 */
function mcpBranch(schema: z.ZodType): z.ZodType {
  const shape = (schema as unknown as z.ZodObject).shape as Record<string, z.ZodType>;
  const plain = (field: z.ZodType): z.ZodType => {
    if (field instanceof z.ZodDefault) return plain(field.unwrap() as z.ZodType).optional();
    if (field instanceof z.ZodOptional && field.unwrap() instanceof z.ZodDefault) return plain(field.unwrap() as z.ZodType);
    return field;
  };
  return z.looseObject(Object.fromEntries(Object.entries(shape).map(([key, field]) => [key, plain(field)])));
}

/** M11: `kind` auf oberster Ebene; die Felder je Art eine Ebene tiefer als Union (erlaubt, s. `mcp-schemas.test.ts`). */
const saveMasterDataMcpSchema = z.object({
  kind: z.enum(['account', 'category', 'purpose']),
  data: z
    .union([accountUpdateSchema, accountCreateSchema, categoryUpdateSchema, categoryFieldsSchema, purposeUpdateSchema, purposeCreateSchema].map(mcpBranch) as [z.ZodType, z.ZodType, ...z.ZodType[]])
    .describe('The fields of the kind. With id: update only the named fields (pass expectedVersion). Without id: create.'),
});


const activeSchema = z.object({ kind: z.enum(['account', 'category', 'purpose']), id: z.string(), isActive: z.boolean(), expectedVersion: z.string().optional() });
const deleteSchema = z.object({ kind: z.enum(['account', 'category', 'purpose']), id: z.string() });
const createFirstFiscalYearSchema = z.object({ startsOn: z.string(), endsOn: z.string() });
const updateFiscalYearSchema = z.object({ id: z.string(), designation: z.string().optional(), taxReturnFiledOn: z.string().nullable().optional(), expectedVersion: z.string().optional() });
const purposeCloseSchema = z.object({ id: z.string(), how: z.enum(['fulfilled', 'dissolved', 'reopen']), reason: z.string().trim().max(1000).optional() });
const setDatedValueSchema = z.object({ key: z.string(), validFrom: z.string(), value: z.union([z.number(), z.string()]) });
const removeDatedValueSchema = z.object({ key: z.string(), validFrom: z.string() });

/** Befund 28: fehlte bisher — der Dienst kennt es (`entries.ts`), ein Agent konnte darüber keinen Zahlungsentwurf gegen einen offenen Posten anlegen. */
const settlementSchema = z.object({ openItemId: z.string().describe('The open item this line settles, fully or in part.'), amountCents: z.number().int().positive().describe('How much of this money line settles that open item, in cents.') });
const moneyLineSchema = z.object({
  accountId: z.string(),
  amountCents: z.number().int(),
  rawTransactionId: z.string().nullable().optional(),
  settlements: z.array(settlementSchema).optional().describe('Open items this money line settles, fully or in part.'),
});
const allocationLineSchema = z.object({
  categoryId: z.string(),
  amountCents: z.number().int(),
  taxCode: z.enum(TAX_CODES).optional(),
  rateKind: z.enum(['standard', 'reduced']).optional(),
  projectId: z.string().nullable().optional(),
  purposeId: z.string().nullable().optional(),
  contactId: z.string().nullable().optional(),
  abroad: z.boolean().optional(),
  originLineId: z.string().nullable().optional(),
  addsToAssets: z.boolean().optional(),
});
const saveDraftMcpSchema = z.object({
  id: z.string().optional(),
  expectedVersion: z.string().optional(),
  entryDate: z.string(),
  text: z.string(),
  moneyLines: z.array(moneyLineSchema),
  allocationLines: z.array(allocationLineSchema),
  /** Befund AH and Q: required (boardAllowanceNeedsReason, purposeGoesNegative) when an allowance line goes to a board member without a board-remuneration basis in force on the entry date, or when the lines would take a purpose below zero. */
  reason: z.string().optional(),
});
const entryIdMcpSchema = z.object({ id: z.string() });
const listEntriesMcpSchema = z.object({
  ids: z.array(z.string()).optional(),
  state: z.enum(['draft', 'reviewed', 'final', 'reversed']).optional(),
  categoryId: z.string().optional(),
  text: z.string().optional(),
  withoutVoucher: z.boolean().optional(),
  agentPrepared: z.boolean().optional(),
  orderBy: z.object({ field: z.enum(['entryDate', 'number', 'text', 'amount']), direction: z.enum(['asc', 'desc']) }).optional(),
  status: z.enum(['draft', 'final']).optional(),
  fiscalYearId: z.string().optional(),
  accountId: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  limit: z.number().int().min(1).max(200).optional(),
  offset: z.number().int().min(0).optional(),
});
const setReviewedMcpSchema = z.object({ id: z.string(), reviewed: z.boolean(), expectedVersion: z.string().optional() });
const finalizeEntryMcpSchema = z.object({ id: z.string(), expectedVersion: z.string().optional() });
const finalizeReviewedMcpSchema = z.object({ ids: z.array(z.string()).min(1) });
const reverseEntryMcpSchema = z.object({ id: z.string(), cashWarningReason: z.string().optional(), withCorrectionDraft: z.boolean().optional() });

const uploadVoucherMcpSchema = z.object({ entryId: z.string(), contentBase64: z.string().min(1), typeKey: z.string(), title: z.string().optional(), documentDate: z.string() });
const attachDocumentMcpSchema = z.object({ entryId: z.string(), documentId: z.string() });
const revokeVoucherMcpSchema = z.object({ linkId: z.string(), note: z.string(), replacementDocumentId: z.string().optional() });

const saveOpenItemMcpSchema = z.object({
  id: z.string().optional(),
  expectedVersion: z.string().optional(),
  kind: z.enum(['receivable', 'payable']).optional(),
  itemDate: z.string().optional(),
  contactId: z.string().nullable().optional(),
  amountCents: z.number().int().optional(),
  dueOn: z.string().nullable().optional(),
  documentId: z.string().nullable().optional(),
  originType: z.string().nullable().optional(),
  originId: z.string().nullable().optional(),
  paymentReference: z.string().nullable().optional(),
  lineTemplate: lineTemplateSchema,
});
const cancelOpenItemMcpSchema = z.object({ id: z.string(), note: z.string() });
const listOpenItemsMcpSchema = z.object({ kind: z.enum(['receivable', 'payable']).optional(), state: z.enum(['open', 'settled', 'overpaid', 'cancelled', 'all']).optional(), limit: z.number().int().min(1).max(200).optional(), offset: z.number().int().min(0).optional() });
const listOpenItemSettlementsMcpSchema = z.object({ openItemId: z.string() });

const requestCorrectionMcpSchema = z.object({
  lineId: z.string(),
  changes: z.object({ contactId: z.string().nullable().optional(), projectId: z.string().nullable().optional(), purposeId: z.string().nullable().optional(), abroad: z.boolean().optional() }),
  note: z.string(),
  proofDocumentId: z.string().optional(),
  acknowledgeSection153: z.boolean().optional(),
  purposeReason: z.string().optional(),
});
const decideCorrectionMcpSchema = z.object({ id: z.string(), decision: z.enum(['approve', 'reject']), note: z.string().optional(), purposeReason: z.string().optional() });
const listCorrectionsMcpSchema = z.object({ state: z.enum(['pending', 'applied', 'rejected']).optional(), entryId: z.string().optional(), limit: z.number().int().min(1).max(200).optional(), offset: z.number().int().min(0).optional() });

const getBalancesMcpSchema = z.object({ date: z.string().optional() });
const getIncomeStatementMcpSchema = z.object({ fiscalYearId: z.string().optional(), from: z.string().optional(), to: z.string().optional() });
const getProjectFinanceMcpSchema = z.object({ projectId: z.string() });
const setProjectFinanceMcpSchema = z.object({ projectId: z.string(), targetCents: z.number().int().nullable().optional(), defaultPurposeId: z.string().nullable().optional(), abroad: z.boolean().optional(), publishDonationStatus: z.boolean().optional() });

const countCashMcpSchema = z.object({
  accountId: z.string(),
  countedOn: z.string(),
  countedCents: z.number().int(),
  counterOneContactId: z.string(),
  counterTwoContactId: z.string(),
  note: z.string().optional(),
  denominations: z.record(z.string(), z.number().int()).optional(),
});
const emptyDonationBoxMcpSchema = z.object({
  accountId: z.string(),
  date: z.string(),
  amountCents: z.number().int(),
  counterOneContactId: z.string(),
  counterTwoContactId: z.string(),
  categoryId: z.string().optional(),
  boxLabel: z.string(),
});
const moveCashMcpSchema = z.object({ fromAccountId: z.string(), toAccountId: z.string(), date: z.string(), amountCents: z.number().int(), text: z.string().optional() });
const listCashCountsMcpSchema = z.object({ accountId: z.string().optional(), limit: z.number().int().min(1).max(200).optional(), offset: z.number().int().min(0).optional() });

const confirmSetupStepMcpSchema = z.object({ step: z.enum(['categories', 'tax']) });
const setFinanceSwitchMcpSchema = z.object({ key: z.enum(['finance.isEntrepreneurOrHasVatId', 'finance.membershipFeesCertifiable', 'finance.expenseWaiversEnabled', 'finance.mcpHumanOnlyAllowed']), value: z.boolean() });
const setExpenseWaiverBasisMcpSchema = z.object({ text: z.string().max(500), agreedOn: z.string().nullable().optional() });
const setFinanceLimitMcpSchema = z.object({ key: z.enum(['finance.statementSufficesBelowCents', 'finance.cashDonationAlertCents', 'finance.roundAmountFromCents']), cents: z.number().int().min(0) });

const detectStatementAccountMcpSchema = z.object({ fileName: z.string(), contentBase64: z.string().min(1) });
const importStatementMcpSchema = z.object({ accountId: z.string(), fileName: z.string(), contentBase64: z.string().min(1), confirmFormatChange: z.boolean().optional(), closingBalanceCents: z.number().int().optional() });
// F4b/A3: das Schema des Dienstes selbst — `format` ist ein CsvFormat-Objekt, Feldfehler kommen von dort.
const listImportProfilesMcpSchema = z.object({});
const listImportRunsMcpSchema = z.object({ accountId: z.string().optional(), limit: z.number().int().min(1).max(200).optional(), offset: z.number().int().min(0).optional() });
const getImportRunMcpSchema = z.object({ id: z.string() });
const setRunClosingBalanceMcpSchema = z.object({ runId: z.string(), closingBalanceCents: z.number().int() });
const listCandidatesMcpSchema = z.object({ runId: z.string().optional(), open: z.boolean().optional() });
const decideCandidateMcpSchema = z.object({ id: z.string(), decision: z.enum(['same', 'own']) });
const listRawTransactionsMcpSchema = z.object({ accountId: z.string().optional(), runId: z.string().optional(), state: z.enum(['open', 'booked']).optional(), limit: z.number().int().min(1).max(200).optional(), offset: z.number().int().min(0).optional() });
const discardIdMcpSchema = z.object({ id: z.string() });
const discardRunMcpSchema = z.object({ id: z.string(), note: z.string().min(1) });
const getAccountStatementsMcpSchema = z.object({ date: z.string().optional() });

const previewPeriodMcpSchema = z.object({ id: z.string(), action: z.enum(['close', 'reopen']) });
const closeFiscalYearMcpSchema = z.object({ id: z.string() });
const reopenFiscalYearMcpSchema = z.object({ id: z.string(), note: z.string() });
const justifyUndocumentedEntryMcpSchema = z.object({ entryId: z.string(), note: z.string() });
const markNotReturnMcpSchema = z.object({ entryId: z.string(), notReturn: z.boolean(), note: z.string().optional() });

// F5 — Arbeitsliste, Regeln, Kontakt über IBAN, fremdes Geld, Beleg von beiden Seiten.
const ruleConditionsMcp = {
  accountId: z.string().nullable().optional(),
  direction: z.enum(['in', 'out']).nullable().optional(),
  counterpartyIban: z.string().nullable().optional(),
  textContains: z.string().nullable().optional(),
  amountMinCents: z.number().int().min(0).nullable().optional(),
  amountMaxCents: z.number().int().min(0).nullable().optional(),
};
const saveImportRuleMcpSchema = z.object({
  id: z.string().optional(),
  name: z.string(),
  sortOrder: z.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
  ...ruleConditionsMcp,
  categoryId: z.string(),
  projectId: z.string().nullable().optional(),
  purposeId: z.string().nullable().optional(),
  contactId: z.string().nullable().optional(),
  taxCode: z.enum(TAX_CODES).nullable().optional(),
  entryText: z.string().nullable().optional(),
});
const listImportRulesMcpSchema = z.object({ includeInactive: z.boolean().optional() });
const idMcpSchema = z.object({ id: z.string() });
const previewImportRuleMcpSchema = z.object({ ...ruleConditionsMcp, categoryId: z.string() });
const linkContactIbanMcpSchema = z.object({ contactId: z.string(), iban: z.string() });
const listContactIbansMcpSchema = z.object({ contactId: z.string() });
const createContactFromTransactionMcpSchema = z.object({
  rawTransactionId: z.string(),
  kind: z.enum(['person', 'organization']),
  firstName: z.string().nullable().optional(),
  lastName: z.string().nullable().optional(),
  name: z.string().nullable().optional(),
});
const listWorkItemsMcpSchema = z.object({ tab: z.enum(['open', 'unsure', 'agent', 'reviewed', 'due']), accountId: z.string().optional(), limit: z.number().int().min(1).max(200).optional(), offset: z.number().int().min(0).optional() });
const rawTransactionIdMcpSchema = z.object({ rawTransactionId: z.string() });
const settlementMcpSchema = z.object({ openItemId: z.string(), amountCents: z.number().int() });
const extraMoneyLineMcpSchema = z.object({ accountId: z.string(), amountCents: z.number().int(), rawTransactionId: z.string().nullable().optional(), settlements: z.array(settlementMcpSchema).optional() });
const bookFromTransactionMcpSchema = z.object({
  rawTransactionId: z.string(),
  entryDate: z.string().optional(),
  text: z.string(),
  allocationLines: z.array(allocationLineSchema),
  extraMoneyLines: z.array(extraMoneyLineMcpSchema).optional(),
  settlements: z.array(settlementMcpSchema).optional(),
  reviewed: z.boolean(),
  expectedDraftId: z.string().optional(),
});
const linkTransactionMcpSchema = z.object({ rawTransactionId: z.string(), entryId: z.string() });
const markForeignMcpSchema = z.object({ rawTransactionId: z.string(), holder: z.string(), returnsLineId: z.string().optional(), reviewed: z.boolean(), expectedDraftId: z.string().optional() });
const batchPreviewMcpSchema = z.object({ ids: z.array(z.string()).min(1).optional() });
const voucherSearchMcpSchema = z.object({ rawTransactionId: z.string(), limit: z.number().int().min(1).max(50).optional() });
const voucherToTransactionMcpSchema = z.object({ rawTransactionId: z.string(), contentBase64: z.string().min(1), typeKey: z.string().optional(), title: z.string().optional(), documentDate: z.string().optional(), entryTextIfNew: z.string().optional() });
const vouchersWithoutEntryMcpSchema = z.object({ limit: z.number().int().min(1).max(200).optional(), offset: z.number().int().min(0).optional() });
const invoiceDocumentMcpSchema = z.object({ documentId: z.string() });
const openItemFromInvoiceMcpSchema = z.object({ documentId: z.string(), contactId: z.string().nullable().optional(), dueOn: z.string().nullable().optional(), reason: z.string().optional().describe('Required when finance_invoice_proposal says probablyPaid: why a second payment is right. Kept at the open payment, never in the audit log.') });
const invoiceApplyMcpSchema = z.object({ entryId: z.string(), documentId: z.string() });

// F6a — Spenden: Bescheide, maschinelles Verfahren, Bestätigungen, Sachspenden.
const saveNoticeMcpSchema = z.object({
  id: z.string().optional(),
  kind: z.enum(NOTICE_KINDS),
  taxOffice: z.string(),
  taxNumber: z.string(),
  noticeDate: z.string(),
  exemptFrom: z.string(),
  assessmentPeriod: z.string().nullable().optional(),
  purposesText: z.string(),
  purposesTextAccusative: z.string().nullable().optional(),
  documentId: z.string().nullable().optional(),
});
const supersedeNoticeMcpSchema = z.object({ id: z.string(), supersededOn: z.string(), documentId: z.string().nullable().optional() });
const voidNoticeMcpSchema = z.object({ id: z.string(), note: z.string() });
const listNoticesMcpSchema = z.object({ includeInactive: z.boolean().optional() });
const noticeDocumentMcpSchema = z.object({ id: z.string(), contentBase64: z.string().min(1) });
const saveSignerMcpSchema = z.object({ id: z.string().optional(), validFrom: z.string(), validTo: z.string().nullable().optional(), signerName: z.string(), notifiedOn: z.string().nullable().optional() });
const facsimileUploadMcpSchema = z.object({ signerId: z.string(), contentBase64: z.string().min(1), mimeType: z.string().optional() });
const signerIdMcpSchema = z.object({ signerId: z.string() });
const confirmationKindMcp = z.enum(['money', 'inKind', 'collective']);
const confirmationCheckMcpSchema = z.object({ lineIds: z.array(z.string()).min(1), issuedOn: z.string().optional(), kind: confirmationKindMcp.optional() });
const confirmationIssueMcpSchema = z.object({ lineIds: z.array(z.string()).min(1), issuedOn: z.string().optional(), kind: confirmationKindMcp.optional(), periodFrom: z.string().optional(), periodTo: z.string().optional() });
const confirmationVoidMcpSchema = z.object({ id: z.string(), note: z.string(), alreadySent: z.boolean(), originalReturnedOn: z.string().optional(), taxOfficeInformedOn: z.string().optional() });
const confirmationDispatchMcpSchema = z.object({ id: z.string(), sentAt: z.string(), sentVia: z.enum(['post', 'email', 'handed']) });
const confirmationRecallMcpSchema = z.object({ id: z.string(), originalReturnedOn: z.string().optional(), taxOfficeInformedOn: z.string().optional() });
const confirmationSignedMcpSchema = z.object({ id: z.string(), contentBase64: z.string().min(1), fileName: z.string().optional() });
const confirmationsListMcpSchema = z.object({ tab: z.enum(['issued', 'toCorrect', 'needsSignature']), contactId: z.string().optional(), year: z.number().int().optional(), limit: z.number().int().min(1).max(200).optional(), offset: z.number().int().min(0).optional() });
const uncertifiedMcpSchema = z.object({ minCents: z.number().int().min(0).optional(), year: z.number().int().optional(), limit: z.number().int().min(1).max(200).optional(), offset: z.number().int().min(0).optional() });
// F6b — Serienlauf und Spendenbuch.
const runArgsMcp = { year: z.number().int(), minCents: z.number().int().min(0).optional(), excludedContactIds: z.array(z.string()).optional(), followUpOfRunId: z.string().optional() };
const runPreviewMcpSchema = z.object(runArgsMcp);
const runStartMcpSchema = z.object(runArgsMcp);
const runContinueMcpSchema = z.object({ runId: z.string(), max: z.number().int().min(1).max(50).optional() });
const runGetMcpSchema = z.object({ id: z.string() });
const runsListMcpSchema = z.object({ limit: z.number().int().min(1).max(100).optional(), offset: z.number().int().min(0).optional() });
const runDispatchMcpSchema = z.object({ runId: z.string(), sentAt: z.string(), sentVia: z.enum(['post', 'email', 'handed']) });
const donationBookMcpSchema = z.object({ year: z.number().int(), limit: z.number().int().min(1).max(500).optional(), offset: z.number().int().min(0).optional() });
const donationReconciliationMcpSchema = z.object({ year: z.number().int() });
const inKindSaveMcpSchema = z.object({
  lineId: z.string(),
  item: z.string(),
  condition: z.string(),
  valuation: z.string(),
  origin: z.enum(['private', 'business']),
  withdrawalValueCents: z.number().int().min(0).nullable().optional(),
  vatCents: z.number().int().min(0).nullable().optional(),
  proofDocumentId: z.string().nullable().optional(),
});
const lineIdMcpSchema = z.object({ lineId: z.string() });

// F8a — Auslagen (allocation): einreichen, freigeben, Verzicht.
const expensePositionMcpSchema = z.object({
  id: z.string().min(1).optional(),
  kind: z.enum(['receipt', 'trip']),
  positionDate: z.string().date().nullable().optional(),
  amountCents: z.number().int().min(0).max(100_000_000).optional(),
  purpose: z.string().trim().max(500).optional(),
  projectId: z.string().min(1).nullable().optional(),
  tripFrom: z.string().trim().max(200).nullable().optional(),
  tripTo: z.string().trim().max(200).nullable().optional(),
  tripReason: z.string().trim().max(200).nullable().optional(),
  tripKm: z.number().int().min(0).max(100_000).nullable().optional(),
});
const saveExpenseDraftMcpSchema = z.object({
  id: z.string().min(1).optional(),
  expectedVersion: z.string().min(1).optional(),
  iban: z.string().trim().max(50).nullable().optional(),
  waiver: z.boolean(),
  recurring: z.boolean().optional(),
  positions: z.array(expensePositionMcpSchema).max(100),
});
const uploadExpenseReceiptMcpSchema = z.object({ claimId: z.string().min(1), positionId: z.string().min(1), contentBase64: z.string().min(1), fileName: z.string().trim().min(1).max(300) });
const submitExpenseClaimMcpSchema = z.object({ id: z.string().min(1), expectedVersion: z.string().min(1).optional() });
const expenseIdMcpSchema = z.object({ id: z.string().min(1) });
const listMyExpenseClaimsMcpSchema = z.object({ state: z.enum(['open', 'done']).optional(), limit: z.number().int().min(1).max(200).optional(), offset: z.number().int().min(0).optional() });
const expenseFormStartMcpSchema = z.object({}).strict();
const listApprovalsMcpSchema = z.object({ limit: z.number().int().min(1).max(200).optional(), offset: z.number().int().min(0).optional() });
const approvalClaimIdMcpSchema = z.object({ claimId: z.string().min(1) });
const waiverChecksMcpSchema = z.object({ claimId: z.string().min(1), declaredOn: z.string().date().optional(), claimAgreedConfirmed: z.boolean().optional() });
const approveExpenseClaimMcpSchema = z.object({
  claimId: z.string().min(1),
  expectedVersion: z.string().min(1).optional(),
  positions: z.array(z.object({ positionId: z.string().min(1), categoryId: z.string().min(1), purposeId: z.string().min(1).nullable().optional() })).max(100),
  waiver: z.object({ claimAgreedConfirmed: z.boolean(), declaredOn: z.string().date(), lateReason: z.string().trim().max(1000).optional() }).optional(),
  purposeReason: z.string().trim().max(1000).optional(),
});
const rejectExpenseClaimMcpSchema = z.object({ claimId: z.string().min(1), note: z.string().trim().min(1).max(1000) });
const createWaiverDeclarationMcpSchema = z.object({ claimId: z.string().min(1), declaredOn: z.string().date() });
const attachSignedWaiverMcpSchema = z.object({ claimId: z.string().min(1), contentBase64: z.string().min(1) });
const saveContactWaiverTermsMcpSchema = z.object({ contactId: z.string().min(1), basisText: z.string().trim().min(1).max(500), agreedOn: z.string().date() });

/** Base64 prüfen und gegen `finance.uploadLimitMb` halten — wie `finance_voucher_upload`. */
function voucherBytes(deps: Parameters<McpToolDefinition['handler']>[0], contentBase64: string): Uint8Array | ReturnType<typeof invalid> {
  const bytes = decodeBase64(contentBase64);
  if (!bytes) return invalid([{ path: 'contentBase64', message: 'invalidBase64' }]);
  const limitBytes = readSetting<number>(deps, 'finance.uploadLimitMb') * 1024 * 1024;
  if (bytes.byteLength > limitBytes) return invalid([{ path: 'contentBase64', message: 'fileTooLarge' }]);
  return bytes;
}

/** Verteilerdienste (Spec 10.2): ein Werkzeug je Tätigkeit statt zwanzig, mit `kind` als Discriminator. */
export const FINANCE_MCP_TOOLS: readonly McpToolDefinition[] = [
  t({ name: 'finance_master_data', description: 'Read money accounts, categories, purposes, fiscal years or dated values. Requires finance.overview or finance.read; bank details and free-text descriptions only with finance.read.', inputSchema: readMasterDataSchema, handler: (deps, ctx, args) => readMasterData(deps, ctx, args), service: readMasterData }),
  t({ name: 'finance_master_data_save', description: 'Create or update a money account, category or purpose (data.id present updates, absent creates). Requires finance.setup. Audited without names or bank details.', inputSchema: saveMasterDataMcpSchema, handler: (deps, ctx, args) => saveMasterData(deps, ctx, args), service: saveMasterData }),
  t({ name: 'finance_master_data_set_active', description: 'Activate or deactivate a money account, category or purpose. Requires finance.setup.', inputSchema: activeSchema, handler: (deps, ctx, args) => setMasterDataActive(deps, ctx, args), service: setMasterDataActive }),
  t({ name: 'finance_master_data_delete', description: 'Delete a money account, category or purpose. Only unused records; otherwise set inactive. Requires finance.setup.', inputSchema: deleteSchema, handler: (deps, ctx, args) => deleteMasterData(deps, ctx, args), service: deleteMasterData }),
  t({ name: 'finance_fiscal_year_create_first', description: 'Set up the first fiscal year of the association. Requires finance.setup.', inputSchema: createFirstFiscalYearSchema, handler: (deps, ctx, args) => createFirstFiscalYear(deps, ctx, args), service: createFirstFiscalYear }),
  t({ name: 'finance_fiscal_year_update', description: 'Change a fiscal year designation or record the tax return date. The designation is locked once the first entry number exists. Requires finance.setup.', inputSchema: updateFiscalYearSchema, handler: (deps, ctx, args) => updateFiscalYear(deps, ctx, args), service: updateFiscalYear }),
  t({ name: 'finance_purpose_close', description: 'Mark a purpose as fulfilled or dissolved, or reopen it - reopening requires a reason, kept on the record, never in the audit log. Requires finance.setup.', inputSchema: purposeCloseSchema, handler: (deps, ctx, args) => closePurpose(deps, ctx, args), service: closePurpose }),
  t({ name: 'finance_dated_value_set', description: 'Set an override for a legal threshold or rate by effective date; it wins over the shipped series from its date on. Requires finance.setup.', inputSchema: setDatedValueSchema, handler: (deps, ctx, args) => setDatedValue(deps, ctx, args), service: setDatedValue }),
  t({ name: 'finance_dated_value_remove', description: 'Remove an override of the association for a dated value; the shipped series applies again. Requires finance.setup.', inputSchema: removeDatedValueSchema, handler: (deps, ctx, args) => removeDatedValue(deps, ctx, args), service: removeDatedValue }),
  t({
    name: 'finance_entry_save_draft',
    description: 'Create or replace a draft entry: money lines (cents, + = inflow to the account, settlements to pay down one or more open items in full or in part) and allocation lines (gross cents, + = income, - = expense). A draft may be unbalanced; remainderCents tells what is left to allocate. A date after today is allowed but saved with warnings: ["futureDate"] - finalizing it is refused until that day. Cash accounts cannot hold drafts - use finance_entry_book. An allowance line to a board member without a board-remuneration basis in force on the entry date needs a reason (boardAllowanceNeedsReason); it is kept at the entry. Requires finance.entriesWrite.',
    inputSchema: saveDraftMcpSchema,
    handler: (deps, ctx, args) => saveDraft(deps, ctx, args),
    service: saveDraft,
  }),
  t({ name: 'finance_entry_get', description: 'Read one booking entry with its lines and computed tax. Requires finance.read.', inputSchema: entryIdMcpSchema, handler: (deps, ctx, args) => getEntry(deps, ctx, args), service: getEntry }),
  t({
    name: 'finance_entry_history',
    description: 'The trail of one booking entry (created, reviewed, finalized, allocation changes, reversal, vouchers added or revoked), in order, from the entry itself - never from the audit log. Requires finance.read.',
    inputSchema: entryIdMcpSchema,
    handler: (deps, ctx, args) => getEntryHistory(deps, ctx, args),
    service: getEntryHistory,
  }),
  t({ name: 'finance_entries_list', description: 'List booking entries, filtered by ids, state (draft, reviewed, final, reversed), category, free text or amount, without voucher, agent-prepared, fiscal year, account or date range; sortable. Paginated (limit <= 200). Returns totals (income, expense, result) over the whole filtered set, not just the page. Filtered by accountId, each entry also carries accountAmountCents (the signed money line of that account, not the entry sum) and runningBalanceCents (null for a draft); unfiltered, an entry with no allocation lines (a transfer between own accounts) carries movedCents and transfer: true instead of a misleading zero sum. Requires finance.read.', inputSchema: listEntriesMcpSchema, handler: (deps, ctx, args) => listEntries(deps, ctx, args), service: listEntries }),
  t({ name: 'finance_entry_delete_draft', description: 'Delete a draft entry; a finalized entry is reversed instead. Requires finance.entriesWrite.', inputSchema: entryIdMcpSchema, handler: (deps, ctx, args) => deleteDraft(deps, ctx, args), service: deleteDraft }),
  t({
    name: 'finance_entry_review',
    description: 'Mark a draft as reviewed by a person. Human only: refused over MCP unless the association has set finance.mcpHumanOnlyAllowed at the screen. Requires finance.entriesWrite.',
    inputSchema: setReviewedMcpSchema,
    handler: (deps, ctx, args) => setReviewed(deps, ctx, args),
    service: setReviewed,
  }),
  t({
    name: 'finance_entry_finalize',
    description: 'Finalize a draft entry: checks the balance, active accounts and categories, the fiscal year, that its date is not after today (entryDateInFuture) and (for cash accounts) that no day would go negative, then assigns its number. Lines that would take a purpose below zero need a reason saved at the draft (reason in finance_entry_save_draft; purposeGoesNegative otherwise). Human only: refused over MCP unless the association has set finance.mcpHumanOnlyAllowed at the screen. Requires finance.entriesFinalize.',
    inputSchema: finalizeEntryMcpSchema,
    handler: (deps, ctx, args) => finalizeEntry(deps, ctx, args),
    service: finalizeEntry,
  }),
  t({
    name: 'finance_entries_finalize_reviewed',
    description: 'Finalize reviewed drafts, all or none; returns the new entries and the sums booked per account. Human only: refused over MCP unless the association has set finance.mcpHumanOnlyAllowed at the screen. Requires finance.entriesFinalize.',
    inputSchema: finalizeReviewedMcpSchema,
    handler: (deps, ctx, args) => finalizeReviewed(deps, ctx, args),
    service: finalizeReviewed,
  }),
  t({
    name: 'finance_entry_book',
    description: 'Create and finalize an entry in one step - the only way to book cash, since a cash draft cannot be parked. Lines that would take a purpose below zero need a reason (purposeGoesNegative); it is kept at the entry. When an allowance line takes a person above the yearly cap, the result carries notices: ["allowanceExceeded"] and allowanceExceeded (person, allowance, year, amount above) - a warning, not a refusal. Human only: refused over MCP unless the association has set finance.mcpHumanOnlyAllowed at the screen. Requires finance.entriesWrite and finance.entriesFinalize.',
    inputSchema: saveDraftMcpSchema,
    handler: (deps, ctx, args) => bookEntry(deps, ctx, args),
    service: bookEntry,
  }),
  t({
    name: 'finance_entry_reverse',
    description: 'Reverse a finalized entry by a counter entry with negated lines; optionally leave a correction draft with the original lines. Human only: refused over MCP unless the association has set finance.mcpHumanOnlyAllowed at the screen. Requires finance.entriesFinalize.',
    inputSchema: reverseEntryMcpSchema,
    handler: (deps, ctx, args) => reverseEntry(deps, ctx, args),
    service: reverseEntry,
  }),
  t({
    name: 'finance_voucher_upload',
    description: 'File a PDF voucher (base64, at most finance.uploadLimitMb) in the name of an entry. The title must not name a person. Allowed at any time, also after the year is closed. duplicateOf names readable documents that already hold the same file - filed anyway, check before booking twice. Requires finance.entriesWrite.',
    inputSchema: uploadVoucherMcpSchema,
    handler: (deps, ctx, { contentBase64, ...rest }) => {
      const bytes = decodeBase64(contentBase64);
      if (!bytes) return Promise.resolve(invalid([{ path: 'contentBase64', message: 'invalidBase64' }]));
      const limitBytes = readSetting<number>(deps, 'finance.uploadLimitMb') * 1024 * 1024;
      if (bytes.byteLength > limitBytes) return Promise.resolve(invalid([{ path: 'contentBase64', message: 'fileTooLarge' }]));
      return uploadVoucher(deps, ctx, { ...rest, bytes });
    },
    service: uploadVoucher,
  }),
  t({ name: 'finance_voucher_attach', description: 'Link a filed document you may read to an entry. Requires finance.entriesWrite.', inputSchema: attachDocumentMcpSchema, handler: (deps, ctx, args) => attachDocument(deps, ctx, args), service: attachDocument }),
  t({
    name: 'finance_voucher_revoke',
    description: 'Revoke a voucher link; the file module’s link stays, the auditor still sees what was revoked. In a closed year only with a replacement document. Human only: refused over MCP unless the association has set finance.mcpHumanOnlyAllowed at the screen. Requires finance.entriesFinalize.',
    inputSchema: revokeVoucherMcpSchema,
    handler: (deps, ctx, args) => revokeVoucher(deps, ctx, args),
    service: revokeVoucher,
  }),
  t({ name: 'finance_open_item_save', description: 'Create or update a receivable or payable (id present updates, absent creates). Outside the journal - the income and expense statement never sees it. Requires finance.entriesWrite.', inputSchema: saveOpenItemMcpSchema, handler: (deps, ctx, args) => saveOpenItem(deps, ctx, args), service: saveOpenItem }),
  t({ name: 'finance_open_item_cancel', description: 'Close a mistaken open item without payment, with a note - a final step. Only possible while nothing finalized is settled against it, and never for an item with an origin (it is settled through its own process). Human only: refused over MCP unless the association has set finance.mcpHumanOnlyAllowed at the screen. Requires finance.entriesFinalize.', inputSchema: cancelOpenItemMcpSchema, handler: (deps, ctx, args) => cancelOpenItem(deps, ctx, args), service: cancelOpenItem }),
  t({ name: 'finance_open_items_list', description: 'List receivables and payables by kind or state, with their open amount. Requires finance.read.', inputSchema: listOpenItemsMcpSchema, handler: (deps, ctx, args) => listOpenItems(deps, ctx, args), service: listOpenItems }),
  t({ name: 'finance_open_item_settlements', description: 'List the finalized, unreversed entries that settle an open item, with their entry number - for "settled by". Requires finance.read.', inputSchema: listOpenItemSettlementsMcpSchema, handler: (deps, ctx, args) => listOpenItemSettlements(deps, ctx, args), service: listOpenItemSettlements }),
  t({
    name: 'finance_correction_request',
    description: 'Correct donor, project, purpose or the abroad switch of a finalized line - not amount, date, account or category (reverse the entry for those). Human only: refused over MCP unless the association has set finance.mcpHumanOnlyAllowed at the screen. In a closed year it waits for a second person. When the change would push a purpose below zero (an expense onto it, or an income line away from it) the call is refused with purposeGoesNegative until purposeReason is given; the reason is kept on the correction, never in the audit log. Requires finance.entriesFinalize.',
    inputSchema: requestCorrectionMcpSchema,
    handler: (deps, ctx, args) => requestAllocationCorrection(deps, ctx, args),
    service: requestAllocationCorrection,
  }),
  t({
    name: 'finance_correction_decide',
    description: 'Approve or reject a pending allocation correction - never your own request. On approval the purpose balance is checked again: a reason given with the request still holds, otherwise pass purposeReason (conflict purposeGoesNegative). Human only: refused over MCP unless the association has set finance.mcpHumanOnlyAllowed at the screen. Requires finance.approve.',
    inputSchema: decideCorrectionMcpSchema,
    handler: (deps, ctx, args) => decideAllocationCorrection(deps, ctx, args),
    service: decideAllocationCorrection,
  }),
  t({ name: 'finance_corrections_list', description: 'List allocation corrections by state or entry. Requires finance.read.', inputSchema: listCorrectionsMcpSchema, handler: (deps, ctx, args) => listAllocationCorrections(deps, ctx, args), service: listAllocationCorrections }),
  t({ name: 'finance_balances', description: 'Money account balances, purpose balances and the asset overview at a date (today by default). Requires finance.overview or finance.read.', inputSchema: getBalancesMcpSchema, handler: (deps, ctx, args) => getBalances(deps, ctx, args), service: getBalances }),
  t({ name: 'finance_income_statement', description: 'Income and expense statement by sphere, for a fiscal year or a date range (never both, never neither). Marked preliminary while the fiscal year is open. Requires finance.overview or finance.read.', inputSchema: getIncomeStatementMcpSchema, handler: (deps, ctx, args) => getIncomeStatement(deps, ctx, args), service: getIncomeStatement }),
  t({ name: 'finance_project_get', description: 'Read a project’s finance fields (target, default purpose, abroad, donation status published) and its summed result. Requires finance.overview or finance.read; carries no names.', inputSchema: getProjectFinanceMcpSchema, handler: (deps, ctx, args) => getProjectFinance(deps, ctx, args), service: getProjectFinance }),
  t({ name: 'finance_project_set', description: 'Set a project’s finance fields. Requires finance.setup.', inputSchema: setProjectFinanceMcpSchema, handler: (deps, ctx, args) => setProjectFinance(deps, ctx, args), service: setProjectFinance }),
  t({ name: 'finance_period_preview', description: 'What stands in the way of closing a fiscal year (drafts, undocumented entries, statement lines without a finalized entry, bank accounts without a statement in the year), or what reopening it would undo (action: close or reopen). Requires finance.read.', inputSchema: previewPeriodMcpSchema, handler: (deps, ctx, args) => previewPeriod(deps, ctx, args), service: previewPeriod }),
  t({
    name: 'finance_period_close',
    description: 'Close a fiscal year: no draft dated in it, every finalized entry documented or justified, every statement line booked, a statement for every bank account, the previous year closed, the year ended. Human only: refused over MCP unless the association has set finance.mcpHumanOnlyAllowed at the screen. Requires finance.periodClose.',
    inputSchema: closeFiscalYearMcpSchema,
    handler: (deps, ctx, args) => closeFiscalYear(deps, ctx, args),
    service: closeFiscalYear,
  }),
  t({
    name: 'finance_period_reopen',
    description: 'Reopen the latest closed fiscal year, with a note. Try an allocation correction, or a correction in the current year, first. Human only: refused over MCP unless the association has set finance.mcpHumanOnlyAllowed at the screen. Requires finance.periodClose.',
    inputSchema: reopenFiscalYearMcpSchema,
    handler: (deps, ctx, args) => reopenFiscalYear(deps, ctx, args),
    service: reopenFiscalYear,
  }),
  t({ name: 'finance_entry_justify', description: 'State why a finalized entry has no voucher; needed to close the year. Requires finance.periodClose.', inputSchema: justifyUndocumentedEntryMcpSchema, handler: (deps, ctx, args) => justifyUndocumentedEntry(deps, ctx, args), service: justifyUndocumentedEntry }),
  t({
    name: 'finance_entry_mark_not_return',
    description:
      'Mark a finalized outgoing payment to a contact as not a return of a donation (e.g. an expense refund or a fee paid to a donor), with a note (notReturn: true), or lift the mark (notReturn: false). Unmarked payments to a donor after a donation and not higher than it, booked without originLineId, block that donation\'s confirmation as a possible return (possibleReturnWithoutOrigin). A payment on a certifiable category (donations, fees, in-kind, expense waivers) is a return by definition: the mark is refused (notReturnOnCertifiableCategory) - link it to the donation with originLineId instead. Requires finance.entriesFinalize.',
    inputSchema: markNotReturnMcpSchema,
    handler: (deps, ctx, args) => markNotReturn(deps, ctx, args),
    service: markNotReturn,
  }),
  t({
    name: 'finance_cash_count',
    description: 'Count a cash box or donation box: stores the count, issues the protocol as a filed document and books the difference (cash-surplus or cash-shortage, note required for a shortage). Counters are two different person contacts. Human only: refused over MCP unless the association has set finance.mcpHumanOnlyAllowed at the screen. Requires finance.entriesFinalize.',
    inputSchema: countCashMcpSchema,
    handler: (deps, ctx, args) => countCash(deps, ctx, args),
    service: countCash,
  }),
  t({
    name: 'finance_donation_box_empty',
    description: 'Book an emptied donation box as income without a contact into a cash account, and issue its protocol like a cash count. Human only: refused over MCP unless the association has set finance.mcpHumanOnlyAllowed at the screen. Requires finance.entriesFinalize.',
    inputSchema: emptyDonationBoxMcpSchema,
    handler: (deps, ctx, args) => emptyDonationBox(deps, ctx, args),
    service: emptyDonationBox,
  }),
  t({
    name: 'finance_cash_move',
    description: 'Move cash between a bank account and a cash box as a transfer entry, finalized at once. Exactly one of the two accounts must be a cash account. Human only: refused over MCP unless the association has set finance.mcpHumanOnlyAllowed at the screen. Requires finance.entriesWrite and finance.entriesFinalize.',
    inputSchema: moveCashMcpSchema,
    handler: (deps, ctx, args) => moveCash(deps, ctx, args),
    service: moveCash,
  }),
  t({ name: 'finance_cash_counts_list', description: 'List stored cash counts, newest first, optionally filtered by account. Requires finance.read.', inputSchema: listCashCountsMcpSchema, handler: (deps, ctx, args) => listCashCounts(deps, ctx, args), service: listCashCounts }),
  t({ name: 'finance_setup_status', description: 'Read the computed setup checklist (fiscal year, account with opening balance, roles, categories reviewed, tax defaults applied; optional steps such as documentBases, shown only when the installation has own document bases, with detail.missing listing the bases finance uses that the installation lacks; boardMembers, open while no contact holds an active board-member role — board members are recognised only by that contact role, never by user roles) and whether it is complete. Requires finance.setup or finance.read.', inputSchema: z.object({}), handler: (deps, ctx) => getSetupStatus(deps, ctx), service: getSetupStatus }),
  t({ name: 'finance_setup_confirm', description: 'Confirm the categories-reviewed or the tax-defaults setup step by hand. Requires finance.setup.', inputSchema: confirmSetupStepMcpSchema, handler: (deps, ctx, args) => confirmSetupStep(deps, ctx, args), service: confirmSetupStep }),
  t({ name: 'finance_setup_tax_defaults', description: 'Apply the shipped defaults for the tax switches (entrepreneur status, membership fee certificates, expense waivers) and confirm the tax setup step in one step. Requires finance.setup.', inputSchema: z.object({}), handler: (deps, ctx) => applyTaxDefaults(deps, ctx), service: applyTaxDefaults }),
  t({ name: 'finance_permission_matrix', description: 'Read the "who may do what" matrix: the ten finance activities mapped to their permission, and per role its granted activities, visible finance navigation entries and active holders (names, no e-mail). Requires finance.setup.', inputSchema: z.object({}), handler: (deps, ctx) => getPermissionMatrix(deps, ctx), service: getPermissionMatrix }),
  t({ name: 'finance_setup_switch', description: 'Set one of the four setup switches: the three tax defaults, or whether an agent may finalize over MCP. The last one stays bound to the screen - refused over MCP. Requires finance.setup.', inputSchema: setFinanceSwitchMcpSchema, handler: (deps, ctx, args) => setFinanceSwitch(deps, ctx, args), service: setFinanceSwitch }),
  t({ name: 'finance_setup_waiver_basis', description: 'Set the association\'s legal basis for expense waivers (finance.expenseWaiverBasisText, at most 500 characters, empty clears it) and the day it applies from (agreedOn, YYYY-MM-DD, required with a text - the check "claim agreed in advance" compares it with the earliest position), e.g. "Vereinbarung vom ... / Satzung Par. ..." - it must be a contract or the statutes, a board resolution without a statutory authorisation does not suffice. Copied onto a waiver claim at submission unless the contact has its own terms (finance_contact_waiver_terms_save). Requires finance.setup.', inputSchema: setExpenseWaiverBasisMcpSchema, handler: (deps, ctx, args) => setExpenseWaiverBasisText(deps, ctx, args), service: setExpenseWaiverBasisText }),
  t({ name: 'finance_setup_limit', description: 'Set one of the three setup limits, as whole cents: below which a bank statement suffices as proof, from which a cash donation is flagged, and from which an amount is round-number-suspicious. Requires finance.setup.', inputSchema: setFinanceLimitMcpSchema, handler: (deps, ctx, args) => setFinanceLimit(deps, ctx, args), service: setFinanceLimit }),
  t({
    name: 'finance_import_statement',
    description: 'Import a bank statement (base64, at most finance.uploadLimitMb) for a bank or payment-service account, all or nothing. CAMT.053 (a file starting with "<"): one run per Stmt, sets the account format to camt053 on first use, a change from csv needs confirmFormatChange, refuses a mismatched IBAN. CSV (anything else): read with the one CSV format of the account (set it up first with finance_import_profile_save, else statementNeedsCsvFormat); a file with another header is refused as statementCsvFormatMismatch without a run; closingBalanceCents answers "balance at the bank" for a CSV without a balance column. Refuses an already-imported file or a cash account. An unreadable file is recorded as a failed run and answered with statementUnreadable naming the line. Not human only - an agent may import, never finalize. Requires finance.entriesWrite.',
    inputSchema: importStatementMcpSchema,
    handler: (deps, ctx, { contentBase64, ...rest }) => {
      const bytes = decodeBase64(contentBase64);
      if (!bytes) return Promise.resolve(invalid([{ path: 'contentBase64', message: 'invalidBase64' }]));
      return importStatement(deps, ctx, { ...rest, bytes });
    },
    service: importStatement,
  }),
  t({
    name: 'finance_statement_detect_account',
    description: 'Detect which account a bank statement file belongs to (base64, at most finance.uploadLimitMb), before finance_import_statement. Only active bank and payment-service accounts count. CAMT.053 (a file starting with "<"): by the IBAN of every Stmt; a file with statements for two different IBANs is refused as statementMultipleAccounts naming both - export one file per account. CSV: by the header signature against the one active CSV format of each account. Returns kind one (accountId - import it), many (accounts with name, format label and imported through - ask which), none (the foreign iban for CAMT, the header signature for CSV - set up the account or its CSV format first) or unreadable (the read error code). Creates no run and writes no audit entry. Requires finance.entriesWrite.',
    inputSchema: detectStatementAccountMcpSchema,
    handler: (deps, ctx, { contentBase64, ...rest }) => {
      const bytes = decodeBase64(contentBase64);
      if (!bytes) return Promise.resolve(invalid([{ path: 'contentBase64', message: 'invalidBase64' }]));
      return detectStatementAccount(deps, ctx, { ...rest, bytes });
    },
    service: detectStatementAccount,
  }),
  t({ name: 'finance_import_profile_save', description: 'Save a new CSV import format for a bank or payment-service account and make it the only active format of that account. Formats are immutable; saving again creates a new one. Switching from camt053, or to a format with a different header, needs confirmFormatChange (more doubtful duplicates afterwards). The format names header columns for date, amount (or debit/credit), counterparty, purpose, and optionally value date, iban, reference, fee, balance, currency and pending status. Requires finance.setup.', inputSchema: saveImportProfileMcpSchema, handler: (deps, ctx, args) => saveImportProfile(deps, ctx, args), service: saveImportProfile }),
  t({ name: 'finance_import_profiles_list', description: 'List the saved CSV import formats with the accounts each is active for and the number of runs read with it. Requires finance.setup or finance.read.', inputSchema: listImportProfilesMcpSchema, handler: (deps, ctx) => listImportProfiles(deps, ctx, {}), service: listImportProfiles }),
  t({ name: 'finance_import_runs_list', description: 'List import runs (statement uploads), optionally filtered by account, newest first. Counterparty, iban and purpose never appear here - only counts and balances. Requires finance.read.', inputSchema: listImportRunsMcpSchema, handler: (deps, ctx, args) => listImportRuns(deps, ctx, args), service: listImportRuns }),
  t({ name: 'finance_import_run_get', description: 'Read one import run with its raw transactions (counterparty, iban, purpose included). Requires finance.read.', inputSchema: getImportRunMcpSchema, handler: (deps, ctx, args) => getImportRun(deps, ctx, args), service: getImportRun }),
  t({ name: 'finance_import_run_set_balance', description: 'Amend the closing balance of a finished, not discarded CSV run that has none yet - "balance at the bank on <date>", once. Derives the opening balance the same way a statement with a balance column does (closing minus the sum of the run\'s raw transactions). Refused as runHasBalance if the run already carries a balance (a mistake is undone by discarding the run and reimporting it correctly, not by amending again), or as runNotAmendable if the run is not finished or was discarded. Not human only - an agent may amend, never finalize. Requires finance.entriesWrite.', inputSchema: setRunClosingBalanceMcpSchema, handler: (deps, ctx, args) => setRunClosingBalance(deps, ctx, args), service: setRunClosingBalance }),
  t({ name: 'finance_import_candidates_list', description: 'List import candidates - statement lines whose duplicate match is only probable, shown next to the existing raw transaction they might match. Requires finance.read.', inputSchema: listCandidatesMcpSchema, handler: (deps, ctx, args) => listCandidates(deps, ctx, args), service: listCandidates }),
  t({ name: 'finance_import_candidate_decide', description: 'Decide an import candidate: "same" leaves it as is, "own" turns it into a new raw transaction. Decidable only once. Requires finance.entriesWrite.', inputSchema: decideCandidateMcpSchema, handler: (deps, ctx, args) => decideCandidate(deps, ctx, args), service: decideCandidate }),
  t({ name: 'finance_raw_transactions_list', description: 'List raw transactions (bank statement lines already accepted), with counterparty, iban and purpose, filterable by account, run or state (open/booked). Requires finance.read.', inputSchema: listRawTransactionsMcpSchema, handler: (deps, ctx, args) => listRawTransactions(deps, ctx, args), service: listRawTransactions }),
  t({ name: 'finance_raw_transaction_get', description: 'Read one raw transaction (bank statement line) by id, with counterparty, iban, purpose and state (open/booked, with the bound entry). Requires finance.read.', inputSchema: z.object({ id: z.string() }), handler: (deps, ctx, args) => getRawTransaction(deps, ctx, args), service: getRawTransaction }),
  t({ name: 'finance_import_run_discard_preview', description: 'Preview what discarding an uploaded statement run would do: counts of raw transactions, drafts (including reviewed ones) and vouchers that stay filed, plus any finalized entries that block it. A failed or already discarded run previews as all zeros with canDiscard false. Requires finance.read.', inputSchema: discardIdMcpSchema, handler: (deps, ctx, args) => previewDiscardRun(deps, ctx, args), service: previewDiscardRun }),
  t({ name: 'finance_import_run_discard', description: 'Discard an uploaded statement run: deletes its raw transactions, its file (unless a sibling run of the same upload still holds it), its open candidates and its drafts (documents stay filed, only the link is released). The run itself stays as a permanent record. Blocked by finalized, unreversed entries bound to it - take them back first. A note is required. Not human only - an agent may discard, never finalize. Requires finance.entriesWrite.', inputSchema: discardRunMcpSchema, handler: (deps, ctx, args) => discardRun(deps, ctx, args), service: discardRun }),
  t({ name: 'finance_account_statements', description: 'Per bank and payment-service account (today by default, or a given date): imported through, days since the last statement, and the reconciliation of the finalized book balance against the closing balance of the statement covering the date. Requires finance.overview or finance.read.', inputSchema: getAccountStatementsMcpSchema, handler: (deps, ctx, args) => getAccountStatements(deps, ctx, args), service: getAccountStatements }),
  t({ name: 'finance_work_list', description: 'The work list of bank statement lines, by tab: open (sure suggestion), unsure (unsure or no suggestion), agent (unreviewed drafts prepared over MCP that bind a statement line), reviewed (reviewed drafts), due (overdue open items of both kinds). Statement lines come with a short suggestion (kind, confidence, reasons, problems, hints). Paginated (limit <= 200). Requires finance.read.', inputSchema: listWorkItemsMcpSchema, handler: (deps, ctx, args) => listWorkItems(deps, ctx, args), service: listWorkItems }),
  t({ name: 'finance_work_counts', description: 'Counts of the five work list tabs, and how many doubtful duplicates wait under uploaded statements. Requires finance.read.', inputSchema: z.object({}), handler: (deps, ctx) => getWorkCounts(deps, ctx), service: getWorkCounts }),
  t({ name: 'finance_suggestion_get', description: 'The suggestion for one open bank statement line, with its origin: (0) matches an existing entry (link it), (1) transfer between own accounts or against the cash box, (2) returned payment, (3) open item by payment reference (sure) or by amount and contact (unsure), (4) the first matching rule, (5) contact known from the iban (unsure). draft is ready for finance_transaction_book. A line bound meanwhile answers suggestionStale. Requires finance.read.', inputSchema: rawTransactionIdMcpSchema, handler: (deps, ctx, args) => suggestForTransaction(deps, ctx, args), service: suggestForTransaction }),
  t({
    name: 'finance_transaction_book',
    description: 'Book a bank statement line: builds the money line from it (account, amount, binding), adds extraMoneyLines (the paired line of a transfer, the cash line) and saves a draft; reviewed:true also marks it reviewed. reviewed:true is human only: refused over MCP unless the association has set finance.mcpHumanOnlyAllowed at the screen - an agent books with reviewed:false and a person reviews. A cash line cannot be parked: with reviewed:true it is finalized at once (needs finance.entriesFinalize), with reviewed:false it is refused. Learns the iban of the line for every allocation with a contact. expectedDraftId replaces the draft the work list showed; a line bound elsewhere answers suggestionStale. Requires finance.entriesWrite.',
    inputSchema: bookFromTransactionMcpSchema,
    handler: (deps, ctx, args) => bookFromTransaction(deps, ctx, args),
    service: bookFromTransaction,
  }),
  t({ name: 'finance_transaction_link_entry', description: 'Link a bank statement line to an existing entry - also a finalized one - that has exactly one money line on the same account with the same amount and no statement line yet (entryLineNotBindable otherwise). Requires finance.entriesWrite.', inputSchema: linkTransactionMcpSchema, handler: (deps, ctx, args) => linkTransactionToEntry(deps, ctx, args), service: linkTransactionToEntry }),
  t({
    name: 'finance_transaction_mark_foreign',
    description: 'Mark a bank statement line as money that does not belong to the association: a draft on the category not-ours, with holder (for whom the money is, required) in the entry text - never in the audit log. returnsLineId links a payment back to the earlier receipt. reviewed:true is human only: refused over MCP unless the association has set finance.mcpHumanOnlyAllowed at the screen. Requires finance.entriesWrite.',
    inputSchema: markForeignMcpSchema,
    handler: (deps, ctx, args) => markTransactionForeign(deps, ctx, args),
    service: markTransactionForeign,
  }),
  t({ name: 'finance_foreign_money_list', description: 'Money that does not belong to the association and is not passed on yet: receipts on a transit category whose payments pointing back to them (returnsLineId) do not cover the amount yet, with amountCents, passedOnCents and openCents. Passing on more than is open is refused. Requires finance.read.', inputSchema: z.object({}), handler: (deps, ctx) => listForeignMoney(deps, ctx), service: listForeignMoney }),
  t({ name: 'finance_import_rule_save', description: 'Create or update a rule for bank statement lines (id present updates): conditions (account, direction, iban, text part, amount range - at least one) and result (category, project, purpose, contact, tax code, entry text). Rules apply in their order, the first match wins, and only to future lines. Audited without name, text condition, iban or contact. Requires finance.entriesWrite.', inputSchema: saveImportRuleMcpSchema, handler: (deps, ctx, args) => saveImportRule(deps, ctx, args), service: saveImportRule }),
  t({ name: 'finance_import_rules_list', description: 'List the rules in their order, with category name, whether the category is inactive, and how many earlier lines each hits and how many of those were booked differently. Requires finance.read.', inputSchema: listImportRulesMcpSchema, handler: (deps, ctx, args) => listImportRules(deps, ctx, args), service: listImportRules }),
  t({ name: 'finance_import_rule_delete', description: 'Delete a rule; it is working material and only ever applied forward. Requires finance.entriesWrite.', inputSchema: idMcpSchema, handler: (deps, ctx, args) => deleteImportRule(deps, ctx, args), service: deleteImportRule }),
  t({ name: 'finance_import_rule_preview', description: 'Preview a rule before saving: how many earlier bank statement lines it hits, and which entries booked them to another category. Changes nothing. Requires finance.read.', inputSchema: previewImportRuleMcpSchema, handler: (deps, ctx, args) => previewImportRule(deps, ctx, args), service: previewImportRule }),
  t({ name: 'finance_contact_iban_link', description: 'Link an iban to a contact by hand, so its bank statement lines suggest this contact. Idempotent; refused when another contact holds the iban (contactIbanTaken). Requires finance.entriesWrite.', inputSchema: linkContactIbanMcpSchema, handler: (deps, ctx, args) => linkContactIban(deps, ctx, args), service: linkContactIban }),
  t({ name: 'finance_contact_iban_unlink', description: 'Remove a link between an iban and a contact. Requires finance.entriesWrite.', inputSchema: idMcpSchema, handler: (deps, ctx, args) => unlinkContactIban(deps, ctx, args), service: unlinkContactIban }),
  t({ name: 'finance_contact_ibans_list', description: 'List the ibans linked to a contact. Requires finance.read.', inputSchema: listContactIbansMcpSchema, handler: (deps, ctx, args) => listContactIbans(deps, ctx, args), service: listContactIbans }),
  t({ name: 'finance_contact_create_from_transaction', description: 'Create a contact (person or organization) from the counterparty of a bank statement line - missing name parts are taken from it - and link the iban of the line. Requires finance.entriesWrite and contacts.manage.', inputSchema: createContactFromTransactionMcpSchema, handler: (deps, ctx, args) => createContactFromTransaction(deps, ctx, args), service: createContactFromTransaction }),
  t({ name: 'finance_batch_finalize_preview', description: 'Preview finalizing reviewed drafts (all of them, or ids): per account the sum, the finalized book balance before and after, whether that balance after would be negative (bank or payment service only, never a cash box - no block, just a hint), and the closing balance of the latest statement with a match flag, only when that statement does not end before the earliest draft on the account (a cash box has none); the numbers to be assigned; and every draft that cannot be finalized, with its reason code. Changes nothing - finalizing stays finance_entries_finalize_reviewed. Requires finance.read.', inputSchema: batchPreviewMcpSchema, handler: (deps, ctx, args) => previewBatchFinalize(deps, ctx, args), service: previewBatchFinalize }),
  t({ name: 'finance_voucher_search', description: 'Search the file for vouchers matching a bank statement line - by its amount as written on invoices and by the counterparty name. Only voucher types (finance.voucherTypes), filed and not voided; documents without an entry first; only what the caller may read in the file. Requires finance.read.', inputSchema: voucherSearchMcpSchema, handler: (deps, ctx, args) => searchVouchersForTransaction(deps, ctx, args), service: searchVouchersForTransaction }),
  t({
    name: 'finance_voucher_upload_to_transaction',
    description: 'File a PDF voucher (base64, at most finance.uploadLimitMb) for a bank statement line: attached to the draft or entry already bound to it, otherwise to a new unreviewed draft built from the suggestion. The title names the entry and its category, never a person. voucher.duplicateOf names readable documents that already hold the same file. Requires finance.entriesWrite.',
    inputSchema: voucherToTransactionMcpSchema,
    handler: (deps, ctx, { contentBase64, ...rest }) => {
      const bytes = voucherBytes(deps, contentBase64);
      if (!(bytes instanceof Uint8Array)) return Promise.resolve(bytes);
      return attachVoucherToTransaction(deps, ctx, { ...rest, bytes });
    },
    service: attachVoucherToTransaction,
  }),
  t({ name: 'finance_invoice_read', description: 'Read the ZUGFeRD/Factur-X invoice embedded in a filed PDF you may read: seller, number, dates, totals, tax rates, due date and payee iban, plus the tax code at the issue date, the cent difference between the invoice tax and the computed one (never stored) and the contact known for the iban. null when the PDF carries no invoice attachment. Read on demand, nothing is stored or audited. Requires finance.read.', inputSchema: invoiceDocumentMcpSchema, handler: (deps, ctx, args) => readInvoiceFromDocument(deps, ctx, args), service: readInvoiceFromDocument }),
  t({ name: 'finance_invoice_proposal', description: 'What to do with the invoice of a filed PDF: noInvoice, unsupported (foreign currency, tools missing, unreadable xml), alreadyVoucher (with the entry, and openItem when an open payment of the same invoice is still unsettled - cancel it with finance_open_item_cancel), probablyPaid (a booked, not reversed entry already paid it: same amount in the date window and the invoice number in the purpose or entry text, or the same payee iban or contact on an entry without voucher - attach the PDF with finance_voucher_attach instead of creating an open payment), paid (one open bank statement line matches amount, date window and iban or invoice number), possiblyPaid (amount only - the candidates to choose from) or unpaid (with an existing open payment, if any). Changes nothing. Requires finance.read.', inputSchema: invoiceDocumentMcpSchema, handler: (deps, ctx, args) => invoiceProposal(deps, ctx, args), service: invoiceProposal }),
  t({ name: 'finance_open_item_from_invoice', description: 'Create the open payment for an unpaid invoice of a filed PDF: issue date, amount due, due date, the document, the invoice number as payment reference and a line template with tax code and contact - never a category. One per document (openItemExistsForDocument) and one per invoice number and contact (openItemExistsForInvoice - the same invoice filed twice); EUR only. When the invoice is probablyPaid, reason is required (invoiceProbablyPaidNeedsReason). contactId and dueOn override the invoice. Audited without seller, number, iban or reason. Requires finance.entriesWrite.', inputSchema: openItemFromInvoiceMcpSchema, handler: (deps, ctx, args) => createOpenItemFromInvoice(deps, ctx, args), service: createOpenItemFromInvoice }),
  t({ name: 'finance_invoice_apply_to_draft', description: 'Apply an invoice of a filed PDF to a draft entry: text from seller and invoice number, the contact of the payee iban on lines without a contact, the tax code on lines still carrying their category default, and the document attached as voucher unless it already is. Drafts only (invoiceNotDraft); EUR only. Requires finance.entriesWrite.', inputSchema: invoiceApplyMcpSchema, handler: (deps, ctx, args) => applyInvoiceToDraft(deps, ctx, args), service: applyInvoiceToDraft }),
  t({ name: 'finance_vouchers_without_entry', description: 'List filed documents of the voucher types (finance.voucherTypes) that no entry links yet, newest first - only what the caller may read in the file. Paginated (limit <= 200). Requires finance.read.', inputSchema: vouchersWithoutEntryMcpSchema, handler: (deps, ctx, args) => listVouchersWithoutEntry(deps, ctx, args), service: listVouchersWithoutEntry }),
  // F6a — Spenden.
  t({ name: 'finance_notice_save', description: 'Record or change a notice of the tax office (kind section60a, exemptionNotice or corporateTaxNoticeAttachment) with tax office, tax number, date, exemptFrom (required: the start of the tax exemption the notice grants, ISO date - donations before it get no confirmation, BMF 07.11.2013 no. 14), assessment period (required except for section60a), the favoured purposes as worded, in the genitive case without the leading noun for sponsorship (e.g. "des Tierschutzes (...)"), purposesTextAccusative in the accusative case (required only for section60a, e.g. "den Tierschutz (...)" - the sentence "Wir foerdern nach unserer Satzung ..." needs this form, the genitive would be grammatically wrong there) and optionally a filed document. Validity is computed day-exact, never stored. Only while neither superseded nor voided; a section60a notice is refused once a final notice exists up to its date. Writes tax office, tax number and notice type back to the association settings. Audited without tax office, tax number or purposes. Requires finance.donationsIssue.', inputSchema: saveNoticeMcpSchema, handler: (deps, ctx, args) => saveNotice(deps, ctx, args), service: saveNotice }),
  t({ name: 'finance_notice_supersede', description: 'Mark a notice as revoked or replaced on a date, optionally with the filed document; one time only, the notice stops counting from that day. Confirmations issued on it become "to correct" (computed). Requires finance.donationsIssue.', inputSchema: supersedeNoticeMcpSchema, handler: (deps, ctx, args) => supersedeNotice(deps, ctx, args), service: supersedeNotice }),
  t({ name: 'finance_notice_void', description: 'Mark a notice as recorded in error; one time only, it never counted. The note stays on the record, never in the audit log. Requires finance.donationsIssue.', inputSchema: voidNoticeMcpSchema, handler: (deps, ctx, args) => voidNotice(deps, ctx, args), service: voidNotice }),
  t({ name: 'finance_notices_list', description: 'List the notices of the tax office, newest first, with computed valid-until date and state (valid, expired, superseded, voided, future) - only valid and future ones unless includeInactive. Requires finance.read.', inputSchema: listNoticesMcpSchema, handler: (deps, ctx, args) => listNotices(deps, ctx, args), service: listNotices }),
  t({
    name: 'finance_notice_attach_document',
    description: 'File the notice itself (base64 PDF, at most finance.uploadLimitMb) as incoming document of the default incoming type, linked to the notice and set on it - no file right needed. Only while the notice is neither superseded nor voided. Requires finance.donationsIssue.',
    inputSchema: noticeDocumentMcpSchema,
    handler: (deps, ctx, { contentBase64, ...rest }) => {
      const bytes = voucherBytes(deps, contentBase64);
      if (!(bytes instanceof Uint8Array)) return Promise.resolve(bytes);
      return attachNoticeDocument(deps, ctx, { ...rest, bytes });
    },
    service: attachNoticeDocument,
  }),
  t({ name: 'finance_signer_save', description: 'Create or change a signer of machine-made confirmations: valid from/to (periods never overlap - signerOverlaps; set the end to hand over), name and the date the tax office was notified. The name is never audited. Requires finance.donationsIssue.', inputSchema: saveSignerMcpSchema, handler: (deps, ctx, args) => saveSigner(deps, ctx, args), service: saveSigner }),
  t({
    name: 'finance_facsimile_upload',
    description: 'Upload the facsimile signature of a signer (base64, PNG or JPEG by its first bytes, at most 1 MB). Stored in the finance module storage, never in the media library and never in the audit log; the bytes are never returned by any tool. Replaces an earlier facsimile. Requires finance.donationsIssue.',
    inputSchema: facsimileUploadMcpSchema,
    handler: (deps, ctx, { contentBase64, ...rest }) => {
      const bytes = decodeBase64(contentBase64);
      if (!bytes) return Promise.resolve(invalid([{ path: 'contentBase64', message: 'invalidBase64' }]));
      return uploadFacsimile(deps, ctx, { ...rest, bytes });
    },
    service: uploadFacsimile,
  }),
  t({ name: 'finance_machine_procedure_get', description: 'Read the signers of machine-made confirmations and today\'s status: complete only with a current signer, a facsimile and a notification date; otherwise confirmations get a signature field. No facsimile bytes. Requires finance.read.', inputSchema: z.object({}), handler: (deps, ctx) => getMachineProcedure(deps, ctx), service: getMachineProcedure }),
  t({ name: 'finance_notification_letter_draft', description: 'Create the letter notifying the tax office of machine-made confirmations as a draft in the file (type letter), addressed to the tax office of the latest notice. Requires finance.donationsIssue and dms.create.', inputSchema: signerIdMcpSchema, handler: (deps, ctx, args) => createNotificationLetterDraft(deps, ctx, args), service: createNotificationLetterDraft }),
  t({ name: 'finance_confirmation_check', description: 'The checklist before issuing a donation confirmation for one or more allocation lines of one contact: finalized, certifiable, contact complete, association address, not yet confirmed, notice valid on the issue date, issued on or after the last donation (issuedOn defaults to today), notice complete (a section60a notice needs the accusative wording of the purposes), amount after returns, no possible return without origin, no return draft pending (a draft with originLineId on the line blocks until finalized or deleted), documented, in-kind details, document type active, signer (never blocks - falls back to a signature field), expense waivers enabled. Each check says done, blocked and where to fix it; warnings never block. Changes nothing. Requires finance.read.', inputSchema: confirmationCheckMcpSchema, handler: (deps, ctx, args) => checkConfirmable(deps, ctx, args), service: checkConfirmable }),
  t({ name: 'finance_confirmation_issue', description: 'Issue a donation confirmation after the official template (money, inKind or collective) as a filed document ZWB; refused with the first blocking check. Machine-made with facsimile only with a complete machine procedure, never for in-kind or expense waivers (R 10b.1 Abs. 4 S. 3 EStR). A donation before the start of the tax exemption (exemptFrom of the notices) is refused, no reason heals it. Human only: refused over MCP unless the association has set finance.mcpHumanOnlyAllowed at the screen. Requires finance.donationsIssue.', inputSchema: confirmationIssueMcpSchema, handler: (deps, ctx, args) => issueConfirmation(deps, ctx, args), service: issueConfirmation }),
  t({ name: 'finance_confirmation_void', description: 'Take back a donation confirmation with the retrieval trail (note, already sent, original returned on, tax office informed on); alreadySent false is refused once a dispatch is recorded (confirmationWasSent), missing dates can be added later with finance_confirmation_recall_record; its lines become confirmable again, our copy stays in the file. Human only: refused over MCP unless the association has set finance.mcpHumanOnlyAllowed at the screen. Requires finance.donationsIssue.', inputSchema: confirmationVoidMcpSchema, handler: (deps, ctx, args) => voidConfirmation(deps, ctx, args), service: voidConfirmation }),
  t({ name: 'finance_confirmation_recall_record', description: 'Record the retrieval trail of a voided confirmation that had been sent: original returned on and/or tax office informed on (YYYY-MM-DD, not in the future). Each date once, never overwritten; until both are recorded the confirmation stays under "to correct" (recallTrailMissing). Requires finance.donationsIssue.', inputSchema: confirmationRecallMcpSchema, handler: (deps, ctx, args) => recordConfirmationRecall(deps, ctx, args), service: recordConfirmationRecall }),
  t({ name: 'finance_confirmation_dispatch', description: 'Record that a confirmation was sent (date, post, email or handed); one time only, never in the future, and - for a confirmation with a signature field - only after its signed version is attached (finance_confirmation_attach_signed; confirmationSignedMissing). Kompass does not send anything itself. Requires finance.donationsIssue.', inputSchema: confirmationDispatchMcpSchema, handler: (deps, ctx, args) => recordConfirmationDispatch(deps, ctx, args), service: recordConfirmationDispatch }),
  t({
    name: 'finance_confirmation_attach_signed',
    description: 'File the signed version of a confirmation (base64 PDF, at most finance.uploadLimitMb) as incoming document ZWU linked to it; one time only. Requires finance.donationsIssue.',
    inputSchema: confirmationSignedMcpSchema,
    handler: (deps, ctx, { contentBase64, ...rest }) => {
      const bytes = voucherBytes(deps, contentBase64);
      if (!(bytes instanceof Uint8Array)) return Promise.resolve(bytes);
      return attachSignedConfirmation(deps, ctx, { ...rest, bytes });
    },
    service: attachSignedConfirmation,
  }),
  t({ name: 'finance_confirmations_list', description: 'List donation confirmations by tab: issued (valid and taken back, newest first), toCorrect (computed reasons: notice superseded or voided, line reversed or returned, contact changed) or needsSignature (neither machine-made nor signed version filed); with counts per tab. Paginated (limit <= 200). Requires finance.read.', inputSchema: confirmationsListMcpSchema, handler: (deps, ctx, args) => listConfirmations(deps, ctx, args), service: listConfirmations }),
  t({ name: 'finance_donations_uncertified', description: 'Finalized certifiable allocation lines with a contact and without a valid confirmation, grouped by contact with the sum after returns and whether the address is complete; minCents filters the sum per contact. A line carries a warning (possibleReturnWithoutOrigin) when a booked return of the same amount and contact exists but is not linked back to it via originLineId; it still counts as certifiable. A line a return draft points to (originLineId, not yet finalized) carries the warning returnDraftPending and cannot be issued until that draft is finalized or deleted. A line dated after today (association time zone) carries inFuture: true and cannot be issued yet. Paginated (limit <= 200). Requires finance.read.', inputSchema: uncertifiedMcpSchema, handler: (deps, ctx, args) => listUncertifiedDonations(deps, ctx, args), service: listUncertifiedDonations }),
  t({ name: 'finance_in_kind_details_save', description: 'Record or change what an in-kind donation line is: item, condition, how the value was determined, origin (private or business - business needs withdrawal value and vat) and a filed valuation document, which is attached as voucher to the entry. Only in-kind lines, only while no valid confirmation holds the line. Audited without the free texts. Requires finance.entriesWrite.', inputSchema: inKindSaveMcpSchema, handler: (deps, ctx, args) => saveInKindDetails(deps, ctx, args), service: saveInKindDetails }),
  t({ name: 'finance_in_kind_details_get', description: 'Read the in-kind details of an allocation line, or null. Requires finance.read.', inputSchema: lineIdMcpSchema, handler: (deps, ctx, args) => getInKindDetails(deps, ctx, args), service: getInKindDetails }),
  // F6b — Serienlauf und Spendenbuch.
  t({ name: 'finance_confirmation_run_preview', description: 'Preview the yearly run of donation confirmations: per contact one collective confirmation for money and fees, a separate one for expense waivers (always with a signature field) and one confirmation per in-kind line - a contact with exactly one line in a bucket gets an individual confirmation instead (issueKind money), a collective one only from two lines; grouped ready, needsSignature, addressMissing and blocked, with the number range and what blocks the whole run (no notice, association address). Anonymous lines, lines in a valid confirmation, excluded contacts and contacts below minCents (default finance.batchMinimumCents) stay out; lines dated after today stay out and are counted per item in excludedInFuture, lines a return draft points to in excludedReturnDraft (like excludedPossibleReturn); excluded lists every contact with left-out lines - also those left out completely - with reasons (possibleReturn, returnDraft, inFuture), excludedLineCount of lineCount, excludedCents and the blocking entries with links; followUpOfRunId only names the earlier run. Changes nothing. Each item has kind (the bucket: collective = money and fees, collectiveWaiver = expense waivers, inKind = one in-kind line) and issueKind (the form actually issued: money = individual, collective, inKind). Requires finance.read.', inputSchema: runPreviewMcpSchema, handler: (deps, ctx, args) => previewConfirmationRun(deps, ctx, args), service: previewConfirmationRun }),
  t({ name: 'finance_confirmation_run_start', description: 'Start a run: snapshots the items of the preview as of today (the issue date of all its confirmations); ready and needsSignature items become pending, the others are skipped with their error code - donations before the start of the tax exemption among them. Issues nothing yet - call finance_confirmation_run_continue. Human only: refused over MCP unless the association has set finance.mcpHumanOnlyAllowed at the screen. Requires finance.donationsIssue.', inputSchema: runStartMcpSchema, handler: (deps, ctx, args) => startConfirmationRun(deps, ctx, args), service: startConfirmationRun }),
  t({ name: 'finance_confirmation_run_continue', description: 'Continue a run: issues at most max pending items (1-50, default 10) in name order through the same service as finance_confirmation_issue, under the caller; a failure stays as error code on its item and the run goes on. Finished when nothing is pending. Call again until pending is 0. Human only: refused over MCP unless the association has set finance.mcpHumanOnlyAllowed at the screen. Requires finance.donationsIssue.', inputSchema: runContinueMcpSchema, handler: (deps, ctx, args) => continueConfirmationRun(deps, ctx, args), service: continueConfirmationRun }),
  t({ name: 'finance_confirmation_run_get', description: 'Read a run with its items (state pending, issued, failed or skipped, confirmation number, error code) and computed counts: total, pending, issued, failed, skipped, machine-made, with signature field and still missing the signed version. The combined PDFs are only on the run page. Requires finance.read.', inputSchema: runGetMcpSchema, handler: (deps, ctx, args) => getConfirmationRun(deps, ctx, args), service: getConfirmationRun }),
  t({ name: 'finance_confirmation_runs_list', description: 'List earlier runs, newest first, with their counts and without items. Paginated (limit <= 100). Requires finance.read.', inputSchema: runsListMcpSchema, handler: (deps, ctx, args) => listConfirmationRuns(deps, ctx, args), service: listConfirmationRuns }),
  t({ name: 'finance_confirmation_run_dispatch', description: 'Record dispatch for all machine-made, valid confirmations of a run without a dispatch note, in one transaction (date, post, email or handed); confirmations with a signature field get their note after the signed version. Kompass sends nothing itself. Requires finance.donationsIssue.', inputSchema: runDispatchMcpSchema, handler: (deps, ctx, args) => dispatchRunConfirmations(deps, ctx, args), service: dispatchRunConfirmations }),
  t({ name: 'finance_donation_book', description: 'The donation book of a year: finalized lines of the certifiable kinds (donation, membershipFee only while fees are certifiable, inKindDonation, expenseWaiver) with contact or null for anonymous, returns as negative rows, purpose and the valid confirmation holding the line; sums per kind over the whole year. Paginated (limit <= 500). Requires finance.read.', inputSchema: donationBookMcpSchema, handler: (deps, ctx, args) => getDonationBook(deps, ctx, args), service: getDonationBook }),
  t({ name: 'finance_donation_reconciliation', description: 'Reconcile the donations of a year against valid confirmations: the difference split by reason (belowMinimum, addressMissing, inKindUndescribed, expenseWaiverUnconfirmed, anonymous, other) with count, cents and a link each; confirmations above what is left after returns show as toCorrect. Also carries the limit of the simplified receipt (simplifiedReceiptLimit) valid today. Changes nothing. Requires finance.read.', inputSchema: donationReconciliationMcpSchema, handler: (deps, ctx, args) => getDonationReconciliation(deps, ctx, args), service: getDonationReconciliation }),
  // F8a — Auslagen: einreichen, freigeben, Verzicht.
  t({
    name: 'finance_expense_draft_save',
    description: 'Save an expense claim draft (create when id is absent), replacing all its positions at once - receipt or trip, the trip amount computed from km and the mileage rate at the position date. Nothing is required yet, incomplete positions are kept. Setting a new projectId on a position requires projects.view. Idempotent over id; expectedVersion refuses a stale autosave (staleVersion) and the result carries the current version. For the caller\'s own contact only. Requires finance.expensesSubmit - the one finance permission that needs no finance.read.',
    inputSchema: saveExpenseDraftMcpSchema,
    handler: (deps, ctx, args) => saveExpenseDraft(deps, ctx, args),
    service: saveExpenseDraft,
  }),
  t({
    name: 'finance_expense_receipt_upload',
    description: 'File a PDF receipt (base64, at most the file register limit DOCUMENT_MAX_BYTES, 10 MB) for one draft position, in the name of the claim - no file permission needed. Refuses a file that is not a PDF or too large, naming it; a second upload replaces the receipt at the position, the earlier document stays filed. Draft only, owner only. Requires finance.expensesSubmit.',
    inputSchema: uploadExpenseReceiptMcpSchema,
    handler: (deps, ctx, { contentBase64, ...rest }) => {
      const bytes = voucherBytes(deps, contentBase64);
      if (!(bytes instanceof Uint8Array)) return Promise.resolve(bytes);
      return uploadExpenseReceipt(deps, ctx, { ...rest, bytes });
    },
    service: uploadExpenseReceipt,
  }),
  t({
    name: 'finance_expense_submit',
    description: 'Submit an expense claim draft: needs at least one position, a filed PDF on every receipt position, kilometers and a reason on every trip position, and an iban or a waiver. Assigns the number KE-<year>-NNN (year of submission) and locks the claim except its approval fields. An iban linked to another contact is a warning (ibanBelongsToOtherContact), not a refusal. Owner only. Requires finance.expensesSubmit.',
    inputSchema: submitExpenseClaimMcpSchema,
    handler: (deps, ctx, args) => submitExpenseClaim(deps, ctx, args),
    service: submitExpenseClaim,
  }),
  t({ name: 'finance_expense_draft_delete', description: 'Delete an own expense claim draft, only while it is a draft. Filed receipts stay in the file, only the link to the claim is removed. Owner only. Requires finance.expensesSubmit.', inputSchema: expenseIdMcpSchema, handler: (deps, ctx, args) => deleteExpenseDraft(deps, ctx, args), service: deleteExpenseDraft }),
  t({ name: 'finance_expense_copy', description: 'Copy a rejected expense claim as a new draft with a reference to the original: the same receipts (relinked, not duplicated), category and purpose cleared, a waiver dropped if expense waivers have since been switched off. Owner only. Requires finance.expensesSubmit.', inputSchema: expenseIdMcpSchema, handler: (deps, ctx, args) => copyExpenseClaim(deps, ctx, args), service: copyExpenseClaim }),
  t({ name: 'finance_expense_form_start', description: 'What a new expense claim starts with, without creating anything: the caller\'s own contact name, the iban to prefill (latest own claim, else a known bank account of the contact), whether expense waivers are offered, the steps of the mileage rate (validFrom, centsPerKm), and the active projects (id and name only; empty without projects.view). Refused without a link between the caller\'s user account and a contact, naming who can set it. Requires finance.expensesSubmit.', inputSchema: expenseFormStartMcpSchema, handler: (deps, ctx) => expenseFormStart(deps, ctx, {}), service: expenseFormStart }),
  t({ name: 'finance_expenses_mine', description: 'List the caller\'s own expense claims: state open (draft, submitted, approved and not yet paid) or done (paid or rejected), newest first. Requires finance.expensesSubmit.', inputSchema: listMyExpenseClaimsMcpSchema, handler: (deps, ctx, args) => listMyExpenseClaims(deps, ctx, args), service: listMyExpenseClaims }),
  t({ name: 'finance_expense_get', description: 'Read one expense claim: the owning contact without finance.read, anyone else only with it. warnings lists hints that never block, e.g. ibanBelongsToOtherContact (the iban is linked to another contact, not named). Requires finance.expensesSubmit or finance.read.', inputSchema: expenseIdMcpSchema, handler: (deps, ctx, args) => getExpenseClaim(deps, ctx, args), service: getExpenseClaim }),
  t({ name: 'finance_approvals_list', description: 'The approval queue: submitted expense claims, oldest first, never the caller\'s own - neither submitted by the caller nor on the caller\'s own contact. Requires finance.approve.', inputSchema: listApprovalsMcpSchema, handler: (deps, ctx, args) => listApprovals(deps, ctx, args), service: listApprovals }),
  t({ name: 'finance_approval_get', description: 'Read one expense claim for approval, with iban and receipts only if the caller also holds finance.read. Refused for the caller\'s own claim, naming who can decide it instead. Requires finance.approve.', inputSchema: approvalClaimIdMcpSchema, handler: (deps, ctx, args) => getApproval(deps, ctx, args), service: getApproval }),
  t({ name: 'finance_expense_suggest_categories', description: 'Suggest an expense category per position of a claim, from the first matching import rule or the category of the most recent similar finalized line - never a must, nothing is stored. Requires finance.approve.', inputSchema: approvalClaimIdMcpSchema, handler: (deps, ctx, args) => suggestExpenseCategories(deps, ctx, args), service: suggestExpenseCategories }),
  t({
    name: 'finance_expense_approve',
    description: 'Approve an expense claim: assigns an expense category per position (purpose optional) and either creates the payable open item (payment reference the claim number, due in 14 days) or, for a waiver, books the expense donation without a money line once the waiver checks pass (claim agreed in advance, waiver timely, the association could have paid, the declaration is filed and its signed version attached). Refused for the caller\'s own claim. The state leaves submitted exactly once - a second concurrent approval is refused. If a position paid from a purpose (purposeId) would take that purpose below zero, the approval is refused with purposeGoesNegative until purposeReason is given; the reason is kept on the claim (and on the booking of an expense donation), never in the audit log. Human only: refused over MCP unless the association has set finance.mcpHumanOnlyAllowed at the screen. Requires finance.approve.',
    inputSchema: approveExpenseClaimMcpSchema,
    handler: (deps, ctx, args) => approveExpenseClaim(deps, ctx, args),
    service: approveExpenseClaim,
  }),
  t({ name: 'finance_expense_reject', description: 'Reject a submitted expense claim with a note kept on the record, never in the audit log; the owner may then resubmit it as a copy. Refused for the caller\'s own claim. Requires finance.approve.', inputSchema: rejectExpenseClaimMcpSchema, handler: (deps, ctx, args) => rejectExpenseClaim(deps, ctx, args), service: rejectExpenseClaim }),
  t({ name: 'finance_waiver_checks', description: 'The checks before approving an expense donation (waiver): claim agreed in advance, timely by the statutory deadline, the association\'s free funds at the declaration day against the claimed amount, whether the declaration is filed, and whether its signed version is attached (finance_waiver_signed_attach). Changes nothing. Requires finance.approve.', inputSchema: waiverChecksMcpSchema, handler: (deps, ctx, args) => waiverChecks(deps, ctx, args), service: waiverChecks }),
  t({ name: 'finance_waiver_declaration_create', description: 'Issue the waiver declaration as a filed document with a signature field, for a submitted claim, before approval. Requires finance.approve, or finance.expensesSubmit for the claim\'s own owner.', inputSchema: createWaiverDeclarationMcpSchema, handler: (deps, ctx, args) => createWaiverDeclaration(deps, ctx, args), service: createWaiverDeclaration }),
  t({
    name: 'finance_waiver_signed_attach',
    description: 'File the signed waiver declaration (base64 PDF, at most the file register limit DOCUMENT_MAX_BYTES, 10 MB) as an incoming document, linked to the claim; one time only. Requires finance.approve, or finance.expensesSubmit for the claim\'s own owner.',
    inputSchema: attachSignedWaiverMcpSchema,
    handler: (deps, ctx, { contentBase64, ...rest }) => {
      const bytes = voucherBytes(deps, contentBase64);
      if (!(bytes instanceof Uint8Array)) return Promise.resolve(bytes);
      return attachSignedWaiver(deps, ctx, { ...rest, bytes });
    },
    service: attachSignedWaiver,
  }),
  t({ name: 'finance_contact_waiver_terms_save', description: 'Record or change a contact\'s own basis for expense waivers (overrides the association\'s default), copied onto a claim when it is submitted. Requires finance.setup.', inputSchema: saveContactWaiverTermsMcpSchema, handler: (deps, ctx, args) => saveContactWaiverTerms(deps, ctx, args), service: saveContactWaiverTerms }),

  // F7 — Angaben zum Partner und Empfängerbescheide (Task 2).
  t({ name: 'finance_partner_save', description: 'Create or change the profile of a partner (one per contact): status, usual basis (derived from the status, except for a partner abroad, where it is a required choice), usual proof term in months (usualProofMonths, default 3), register document, framework agreement. Requires finance.entriesWrite.', inputSchema: savePartnerProfileMcpSchema, handler: (deps, ctx, args) => savePartnerProfile(deps, ctx, args), service: savePartnerProfile }),
  t({ name: 'finance_partner_set_active', description: 'Activate or deactivate a partner - changes nothing about its payments or notices. Requires finance.entriesWrite.', inputSchema: setPartnerActiveMcpSchema, handler: (deps, ctx, args) => setPartnerActive(deps, ctx, args), service: setPartnerActive }),
  t({ name: 'finance_partner_delete', description: 'Delete a partner profile, only without any payment or notice on it. Requires finance.entriesWrite.', inputSchema: partnerIdMcpSchema, handler: (deps, ctx, args) => deletePartnerProfile(deps, ctx, args), service: deletePartnerProfile }),
  t({ name: 'finance_partner_get', description: 'Read one partner, by its own id or by the contact id. Requires finance.read.', inputSchema: getPartnerMcpSchema, handler: (deps, ctx, args) => getPartner(deps, ctx, args), service: getPartner }),
  t({ name: 'finance_partners_list', description: 'List partners by contact name with the legal form of their contact, open and overdue proofs and the last payment day; active ones only unless includeInactive is set. Requires finance.read.', inputSchema: listPartnersMcpSchema, handler: (deps, ctx, args) => listPartners(deps, ctx, args), service: listPartners }),
  t({ name: 'finance_partner_notice_save', description: 'Record or change a notice of a partner: a German notice (section60a, exemptionNotice, corporateTaxNoticeAttachment) for a partner led as a tax-exempt body, or recognitionAbroad (with validUntil, required) for a partner abroad - the latter never carries the notice check at the payment day. Kind, notice date, received date (defaults to the linked document\'s date, else today), the filed document. Requires finance.entriesWrite.', inputSchema: savePartnerNoticeMcpSchema, handler: (deps, ctx, args) => savePartnerNotice(deps, ctx, args), service: savePartnerNotice }),
  t({ name: 'finance_partner_notice_void', description: 'Mark a partner\'s notice as recorded by mistake - it never carried. The note stays on the record, never in the audit log. Requires finance.entriesWrite.', inputSchema: voidPartnerNoticeMcpSchema, handler: (deps, ctx, args) => voidPartnerNotice(deps, ctx, args), service: voidPartnerNotice }),
  t({ name: 'finance_partner_notices_list', description: 'List a partner\'s notices, newest first, with their validity state. Requires finance.read.', inputSchema: listPartnerNoticesMcpSchema, handler: (deps, ctx, args) => listPartnerNotices(deps, ctx, args), service: listPartnerNotices }),

  // F7 — Zahlung an Partner: Entwurf, Einreichen, Ablehnen, Kopie, Freigabe (Task 3, 4).
  t({
    name: 'finance_partner_payment_draft_save',
    description: 'Running autosave of a payment-to-partner draft: replaces its positions (money or goods, the latter reading amount and category from a finalized purchase line) and, for a retroactive approval, the chosen already-booked lines as a whole (a line to the partner may still be an unfinalized entry, e.g. just booked from finance_transaction_book - submitting waits until it is finalized; editing that entry keeps the line). proofMonths sets the proof term of this payment in months (omitted or null: the usual term of the partner). Setting a new projectId on a position requires projects.view; a project already on the draft stays. An overridden basis may be saved without its reason - submitting asks for it. The result carries reasonsNeeded (notice, overdue) ahead of submitting. Requires finance.entriesWrite.',
    inputSchema: savePartnerPaymentDraftMcpSchema,
    handler: (deps, ctx, args) => savePartnerPaymentDraft(deps, ctx, args),
    service: savePartnerPaymentDraft,
  }),
  t({
    name: 'finance_partner_payment_submit',
    description: 'Submit a payment-to-partner draft: money positions that would take a purpose below zero need purposeReason (purposeGoesNegative, announced ahead in reasonsNeeded.purpose; kept at the payment). Further, needs at least one position (or, retroactively, at least one chosen line), a purpose, a category on every money position, a reason for a basis that differs from the usual one of the partner, and - depending on basis and partner status - an own agreement document or a reason for a notice or overdue proof of another payment. Retroactively, money positions are generated from the chosen lines, dated on the oldest one. The proof term in months is fixed from here on; where the basis requires an agreement (funding abroad) or a project order (agent mandate), the agreement document of the draft is filed as that evidence. Requires finance.entriesWrite.',
    inputSchema: submitPartnerPaymentMcpSchema,
    handler: (deps, ctx, args) => submitPartnerPayment(deps, ctx, args),
    service: submitPartnerPayment,
  }),
  t({ name: 'finance_partner_payment_reject', description: 'Reject a submitted payment to a partner with a note kept on the record, never in the audit log; state leaves submitted permanently - a copy starts a fresh draft. Requires finance.approve.', inputSchema: rejectPartnerPaymentMcpSchema, handler: (deps, ctx, args) => rejectPartnerPayment(deps, ctx, args), service: rejectPartnerPayment }),
  t({ name: 'finance_partner_payment_copy', description: 'Copy a rejected payment to a partner as a new draft with a reference to the original: positions copied (money positions dropped for a retroactive payment - they are generated again on submit), its chosen lines moved over if still unclaimed, its evidence relinked. Requires finance.entriesWrite.', inputSchema: partnerPaymentIdMcpSchema, handler: (deps, ctx, args) => copyPartnerPayment(deps, ctx, args), service: copyPartnerPayment }),
  t({ name: 'finance_partner_payment_draft_delete', description: 'Delete an own payment-to-partner draft, only while it is a draft. Requires finance.entriesWrite.', inputSchema: partnerPaymentIdMcpSchema, handler: (deps, ctx, args) => deletePartnerPaymentDraft(deps, ctx, args), service: deletePartnerPaymentDraft }),
  t({ name: 'finance_partner_payment_get', description: 'Read one payment to a partner: positions, chosen lines, total, required evidence kinds, the active guided-steps key (draft, submitted, approved, paid, acknowledged), the payment day and the proof deadline counted from it, and readyToAcknowledge (true when the caller could acknowledge the evidence now: finance.approve, not their own payment, paid, all required evidence complete - the same condition as finance_partner_proof_deadlines). Requires finance.read.', inputSchema: partnerPaymentIdMcpSchema, handler: (deps, ctx, args) => getPartnerPayment(deps, ctx, args), service: getPartnerPayment }),
  t({ name: 'finance_partner_payments_list', description: 'List payments to partners, newest first, optionally filtered by partner; each with readyToAcknowledge (the caller could acknowledge its evidence now, as in finance_partner_payment_get). Requires finance.read.', inputSchema: listPartnerPaymentsMcpSchema, handler: (deps, ctx, args) => listPartnerPayments(deps, ctx, args), service: listPartnerPayments }),
  t({
    name: 'finance_partner_payment_approve',
    description: 'Approve a payment to a partner: without a retroactive approval, creates the payable open item (payment reference the assigned number PZ-<year>-NNN, line template from the positions, with abroad for a partner abroad or a contact abroad); with one, no item is created - the payment day already comes from the chosen lines. Assigns the number and the proof deadline. Refused for the caller\'s own submission (never the same person who created it). The state leaves submitted exactly once - a second concurrent approval is refused. If the money positions would now take a purpose below zero (the balance may have changed since submission) and no reason was given at submission, it is refused with purposeGoesNegative until purposeReason is given (announced in reasonsNeeded.purpose of finance_partner_payment_get); the reason is kept on the payment. Human only: refused over MCP unless the association has set finance.mcpHumanOnlyAllowed at the screen. Requires finance.approve.',
    inputSchema: approvePartnerPaymentMcpSchema,
    handler: (deps, ctx, args) => approvePartnerPayment(deps, ctx, args),
    service: approvePartnerPayment,
  }),
  t({
    name: 'finance_partner_eligible_lines',
    description: 'Candidate booked lines for a payment to a partner\'s positions: kind paidLine for a retroactive approval (finalized, paid to the partner, still unclaimed), kind goodsLine for a goods position (finalized expense lines, amount and category read from there, reusable). Newest first, at most 50. Requires finance.read.',
    inputSchema: z.object({ partnerId: z.string().min(1), kind: z.enum(['paidLine', 'goodsLine']) }),
    handler: (deps, ctx, args) => listEligibleLines(deps, ctx, args),
    service: listEligibleLines,
  }),
  t({ name: 'finance_partner_proof_deadlines', description: 'Approved and paid payments to partners whose evidence is not yet acknowledged, with their proof deadline (counted from the payment day) and whether the grace period (finance.proofGraceDays) after it has passed; readyToAcknowledge tells whether the caller could acknowledge the evidence now (all required kinds complete, never an own payment, needs finance.approve). Requires finance.read.', inputSchema: proofDeadlinesMcpSchema, handler: (deps, ctx) => partnerProofDeadlines(deps, ctx, {}), service: partnerProofDeadlines }),

  // F7 — Nachweise einer Zahlung an Partner (Task 3).
  t({
    name: 'finance_partner_evidence_upload',
    description: 'Upload a piece of evidence for a payment to a partner as a filed PDF (base64, at most the file register limit), in the name of the payment - subject names the kind and the date, never the partner. Only for a submitted or approved payment. Requires finance.entriesWrite.',
    inputSchema: uploadEvidenceMcpSchema,
    handler: (deps, ctx, { contentBase64, fileName, ...rest }) => {
      const bytes = voucherBytes(deps, contentBase64);
      if (!(bytes instanceof Uint8Array)) return Promise.resolve(bytes);
      return addEvidenceUpload(deps, ctx, { ...rest, bytes, fileName });
    },
    service: addEvidenceUpload,
  }),
  t({ name: 'finance_partner_evidence_list', description: 'List the evidence filed for a payment to a partner, each with its kind, the document id and the document number in the file register. Requires finance.read.', inputSchema: acknowledgeEvidenceMcpSchema, handler: (deps, ctx, args) => listEvidence(deps, ctx, args), service: listEvidence }),
  t({ name: 'finance_partner_evidence_link', description: 'Link an already filed, finalized document of the file register as evidence for a payment to a partner - the same document may serve more than one payment. Requires finance.entriesWrite.', inputSchema: addEvidenceLinkMcpSchema, handler: (deps, ctx, args) => addEvidenceLink(deps, ctx, args), service: addEvidenceLink }),
  t({ name: 'finance_partner_evidence_update', description: 'Change a piece of evidence\'s foreign-language flag, its German explanation or its covered amount - not the document itself, and not once the payment\'s evidence is acknowledged. Requires finance.entriesWrite.', inputSchema: updateEvidenceMcpSchema, handler: (deps, ctx, args) => updateEvidence(deps, ctx, args), service: updateEvidence }),
  t({ name: 'finance_partner_evidence_remove', description: 'Remove a piece of evidence, only before the payment\'s evidence is acknowledged. Requires finance.entriesWrite.', inputSchema: evidenceIdMcpSchema, handler: (deps, ctx, args) => removeEvidence(deps, ctx, args), service: removeEvidence }),
  t({
    name: 'finance_partner_evidence_acknowledge',
    description: 'Acknowledge the evidence of an approved payment to a partner: every required kind present with a real document, every foreign-language one explained, the covered amount complete where required, and the payment itself already paid. Refused for the caller\'s own submission. Human only: refused over MCP unless the association has set finance.mcpHumanOnlyAllowed at the screen. Requires finance.approve.',
    inputSchema: acknowledgeEvidenceMcpSchema,
    handler: (deps, ctx, args) => acknowledgeEvidence(deps, ctx, args),
    service: acknowledgeEvidence,
  }),

  // F7 — Auslandsabfrage (Task 5, Annahme 14).
  t({
    name: 'finance_foreign_activity',
    description: 'Foreign activity over a date range, in three separate groups: payments to partners by basis, other lines flagged abroad, other lines to a contact abroad - a line already counted in the first group never appears again in the others. Requires finance.read.',
    inputSchema: foreignActivityMcpSchema,
    handler: (deps, ctx, args) => foreignActivity(deps, ctx, args),
    service: foreignActivity,
  }),

  // F8b — zurückgelegtes Geld (Task 2/5, Annahme 1, 2, 4).
  t({ name: 'finance_reserve_save', description: 'Create or change reserved funds - creating requires an already filed, finalized document of the file register as the resolution (never uploaded here; use the screen or link an existing one). A carry-forward is recorded with its resolution via finance_reserve_carry_forward; here it may only pass through unchanged or be cleared (reserveCarryForwardOwnStep otherwise). Requires finance.setup.', inputSchema: saveReserveSchema.omit({ resolutionUpload: true }), handler: (deps, ctx, args) => saveReserve(deps, ctx, args), service: saveReserve }),
  t({ name: 'finance_reserves_list', description: 'List reserved funds with their computed balance. Requires finance.overview.', inputSchema: listReservesSchema, handler: (deps, ctx, args) => listReserves(deps, ctx, args), service: listReserves }),
  t({ name: 'finance_reserve_set_active', description: 'Activate or deactivate reserved funds. Requires finance.setup.', inputSchema: activeReserveSchema, handler: (deps, ctx, args) => setReserveActive(deps, ctx, args), service: setReserveActive }),
  t({ name: 'finance_reserve_delete', description: 'Delete reserved funds - only without a movement and without a carry-forward; deactivate otherwise. Requires finance.setup.', inputSchema: reserveIdSchema, handler: (deps, ctx, args) => deleteReserve(deps, ctx, args), service: deleteReserve }),
  t({
    name: 'finance_reserve_movement_record',
    description: 'Record a movement of reserved funds (allocate, withdraw, dissolve) with its resolution document - an already filed, finalized document of the file register (never uploaded here; use the screen or link an existing one). An allocation to a free reserve counts against the cap of forFiscalYearId. Without it, the only fiscal year in question on the movement date is taken; while the year before is not yet closed, two years are in question and the call is refused (reserveYearAmbiguous, naming both) - pass forFiscalYearId then (finance_free_reserve_cap_overview lists the years). Allocating above that cap needs capReason (freeReserveCapExceeded); it is kept at the movement. Dissolve never takes an amount, it is the balance on that day, computed and stored. Never touches a money account, a line or the income statement. Human only: refused over MCP unless the association has set finance.mcpHumanOnlyAllowed at the screen. Requires finance.entriesWrite.',
    inputSchema: recordReserveMovementSchema.omit({ resolutionUpload: true }),
    handler: (deps, ctx, args) => recordReserveMovement(deps, ctx, args),
    service: recordReserveMovement,
  }),
  t({ name: 'finance_reserve_carry_forward', description: 'Record or change the carry-forward of reserved funds from before Kompass - amount (cents, not negative), date and its resolution in one step: documentId of an already filed, finalized document of the file register, or omitted to keep the carry-forward resolution already on file (refused when there is none). finance_reserve_save no longer sets a carry-forward. Requires finance.setup (and dms.view to pick a document).', inputSchema: recordCarryForwardSchema.omit({ upload: true }), handler: (deps, ctx, args) => recordReserveCarryForward(deps, ctx, args), service: recordReserveCarryForward }),
  t({ name: 'finance_reserve_resolution_link', description: 'Link an already filed, finalized document of the file register as the resolution or carry-forward resolution of reserved funds - also after creation. Requires finance.entriesWrite.', inputSchema: linkResolutionSchema, handler: (deps, ctx, args) => linkResolution(deps, ctx, args), service: linkResolution }),
  t({
    name: 'finance_free_reserve_cap',
    description: 'The approximate cap of the free reserve for a fiscal year (§ 62 Abs. 1 Nr. 3 AO): the dated share of the surplus of asset management plus the dated share of the other timely funds, and how much of it is already used for that year; exceeded and overCents flag an allocation above the cap. Which years matter today: finance_free_reserve_cap_overview. Display and warning only, never a lock. Requires finance.overview.',
    inputSchema: freeReserveCapSchema,
    handler: (deps, ctx, args) => freeReserveCap(deps, ctx, args),
    service: freeReserveCap,
  }),
  t({
    name: 'finance_free_reserve_cap_overview',
    description: 'The cap of the free reserve (§ 62 Abs. 1 Nr. 3 AO) for the fiscal years that matter today, older first: the year before, while it is not closed (provisional: true - its figures can still change; an allocation decided at its year-end close counts for it), and the current year (capCents 0 until it has income). defaultFiscalYearId is the year the screen proposes for an allocation (the open year before, else the current year); while two years are listed, finance_reserve_movement_record needs forFiscalYearId for an allocation to a free reserve. Display and warning only, never a lock. Requires finance.overview.',
    inputSchema: freeReserveCapOverviewSchema,
    handler: (deps, ctx) => freeReserveCapOverview(deps, ctx, {}),
    service: freeReserveCapOverview,
  }),

  // F8b — Zweck ändern / Umwidmung (Task 3/5, Annahme 5, 6, 7, 8).
  t({
    name: 'finance_purpose_transfer_request',
    description: 'Change the purpose of funds (a transfer): from a purpose or free funds to a purpose or free funds, with a resolution document (an already filed, finalized document of the file register - never uploaded here; use the screen or link an existing one) and a reason - never both sides free funds, never the same purpose twice, never into a fulfilled or dissolved purpose. Enters directly as submitted, numbered UM-YYYY-NNN. Requires finance.entriesWrite.',
    inputSchema: requestTransferSchema.omit({ documentUpload: true }),
    handler: (deps, ctx, args) => requestPurposeTransfer(deps, ctx, args),
    service: requestPurposeTransfer,
  }),
  t({ name: 'finance_purpose_transfer_get', description: 'A purpose transfer with the balance before and after on each side, and whether the source would go negative (a data field, not an error). Requires finance.read.', inputSchema: transferIdSchema, handler: (deps, ctx, args) => getPurposeTransfer(deps, ctx, args), service: getPurposeTransfer }),
  t({ name: 'finance_purpose_transfers_list', description: 'List purpose transfers, newest first, optionally filtered by purpose. Requires finance.read.', inputSchema: listTransfersSchema, handler: (deps, ctx, args) => listPurposeTransfers(deps, ctx, args), service: listPurposeTransfers }),
  t({
    name: 'finance_purpose_transfer_approve',
    description: 'Approve a submitted purpose transfer - never the caller\'s own, and never twice. Re-checks the target purpose and the date. Human only: refused over MCP unless the association has set finance.mcpHumanOnlyAllowed at the screen. Requires finance.approve.',
    inputSchema: transferIdSchema,
    handler: (deps, ctx, args) => approvePurposeTransfer(deps, ctx, args),
    service: approvePurposeTransfer,
  }),
  t({ name: 'finance_purpose_transfer_reject', description: 'Reject a submitted purpose transfer with a note - the note stays on the record, never in the audit log. Requires finance.approve.', inputSchema: rejectTransferSchema, handler: (deps, ctx, args) => rejectPurposeTransfer(deps, ctx, args), service: rejectPurposeTransfer }),
  t({ name: 'finance_purpose_movements', description: 'A purpose\'s movements - carry-forward, finalized allocation lines (with entry number, entry text and counterparty name) and approved transfers (with their reason) - with a running balance. Requires finance.read.', inputSchema: purposeMovementsSchema, handler: (deps, ctx, args) => purposeMovements(deps, ctx, args), service: purposeMovements }),
  t({
    name: 'finance_purpose_overview',
    description: 'Purposes with their computed balance and state. With finance.read the full row (description, project, abroad, transfer sums); with only finance.overview a reduced row without name-adjacent detail: id, name, target, balance, state, negative, fulfilledWithRest - carry-forward, inflow, outflow and transfer sums are then omitted, not zero. Requires finance.overview.',
    inputSchema: purposeOverviewSchema,
    handler: (deps, ctx, args) => purposeOverview(deps, ctx, args),
    service: purposeOverview,
  }),

  // F8b — Personenübersicht (Task 4/5, Annahme 9, 10).
  t({
    name: 'finance_people_overview',
    description: 'Allowances and reimbursements per person for a calendar year (§ 3 Nr. 26/26a EStG), from finalized lines only, plus a count of allowance lines without a linked person. reimbursementCents counts only money paid to the person (reimbursementClaimCount: the number of expense claims behind it); a waived expense (expense waiver) is reported apart as waivedCents. Per person and allowance, allowanceVolunteerExceeded/allowanceTrainerExceeded and the amount above the cap (allowanceVolunteerOverCents/allowanceTrainerOverCents; the excess is not tax-exempt, whether the association must withhold payroll tax or social insurance depends on the kind of activity). Requires finance.read.',
    inputSchema: personYearOverviewSchema,
    handler: (deps, ctx, args) => personYearOverview(deps, ctx, args),
    service: personYearOverview,
  }),
  t({
    name: 'finance_related_party_payments',
    description: 'Payments to board members and related parties for a fiscal year: date, number, amount, category, the contact\'s role, who approved it, and its origin (originKind expenseClaim | waiver | partnerPayment | other, with originNumber). Flags an allowance to a board member as without-basis while the board-remuneration setup point is not confirmed. Returns { rows, boardMembersMissing }: boardMembersMissing is true when no contact holds the board-member role in the fiscal year — then the list stays empty for lack of maintained roles, not for lack of payments. Requires finance.read.',
    inputSchema: relatedPartyPaymentsSchema,
    handler: (deps, ctx, args) => relatedPartyPayments(deps, ctx, args),
    service: relatedPartyPayments,
  }),
  t({
    name: 'finance_setup_board_remuneration',
    description: 'Confirm the "board remuneration" setup point: whether allowances to board members are allowed, the by-laws basis, the day it applies from (validFrom, YYYY-MM-DD, required when allowed - a payment before it keeps the mark "without basis"), and an optional general-meeting resolution from the file register. Requires finance.setup.',
    inputSchema: boardRemunerationBaseSchema,
    handler: (deps, ctx, args) => setBoardRemuneration(deps, ctx, args),
    service: setBoardRemuneration,
  }),
];
