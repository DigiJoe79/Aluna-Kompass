import { invalid, readSetting, type McpToolDefinition } from '@kompass/core';
import { z } from 'zod';
import { decideCandidate, listCandidates } from './import/candidates';
import { getImportRun, importStatement, listImportRuns } from './import/runs';
import { listRawTransactions } from './import/queries';
import { closePurpose, deleteMasterData, readMasterData, saveMasterData, setMasterDataActive } from './ledger/master-data';
import { decideAllocationCorrection, listAllocationCorrections, requestAllocationCorrection } from './ledger/corrections';
import { countCash, emptyDonationBox, listCashCounts, moveCash } from './ledger/cash';
import { createFirstFiscalYear, updateFiscalYear } from './ledger/fiscal-years';
import { removeDatedValue, setDatedValue } from './ledger/dated-values';
import { TAX_CODES } from './ledger/codes';
import { deleteDraft, getEntry, listEntries, saveDraft, setReviewed } from './ledger/entries';
import { bookEntry, finalizeEntry, finalizeReviewed } from './ledger/finalize';
import { getEntryHistory } from './ledger/history';
import { cancelOpenItem, listOpenItems, listOpenItemSettlements, saveOpenItem } from './ledger/open-items';
import { getBalances, getIncomeStatement } from './ledger/overview';
import { closeFiscalYear, justifyUndocumentedEntry, previewPeriod, reopenFiscalYear } from './ledger/period';
import { getProjectFinance, setProjectFinance } from './ledger/project-settings';
import { reverseEntry } from './ledger/reverse';
import { applyTaxDefaults, confirmSetupStep, getPermissionMatrix, getSetupStatus, setFinanceLimit, setFinanceSwitch } from './ledger/setup';
import { attachDocument, revokeVoucher, uploadVoucher } from './ledger/vouchers';

const t = <T>(def: McpToolDefinition<T>): McpToolDefinition => def as McpToolDefinition;

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

const readMasterDataSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('account'), includeInactive: z.boolean().optional() }),
  z.object({ kind: z.literal('category'), includeInactive: z.boolean().optional() }),
  z.object({ kind: z.literal('purpose'), includeInactive: z.boolean().optional() }),
  z.object({ kind: z.literal('fiscalYear') }),
  z.object({ kind: z.literal('datedValue') }),
]);

const saveMasterDataSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('account'), data: z.record(z.string(), z.unknown()) }),
  z.object({ kind: z.literal('category'), data: z.record(z.string(), z.unknown()) }),
  z.object({ kind: z.literal('purpose'), data: z.record(z.string(), z.unknown()) }),
]);

const activeSchema = z.object({ kind: z.enum(['account', 'category', 'purpose']), id: z.string(), isActive: z.boolean(), expectedVersion: z.string().optional() });
const deleteSchema = z.object({ kind: z.enum(['account', 'category', 'purpose']), id: z.string() });
const createFirstFiscalYearSchema = z.object({ startsOn: z.string(), endsOn: z.string() });
const updateFiscalYearSchema = z.object({ id: z.string(), designation: z.string().optional(), taxReturnFiledOn: z.string().nullable().optional(), expectedVersion: z.string().optional() });
const purposeCloseSchema = z.object({ id: z.string(), how: z.enum(['fulfilled', 'dissolved', 'reopen']) });
const setDatedValueSchema = z.object({ key: z.string(), validFrom: z.string(), value: z.union([z.number(), z.string()]) });
const removeDatedValueSchema = z.object({ key: z.string(), validFrom: z.string() });

const moneyLineSchema = z.object({ accountId: z.string(), amountCents: z.number().int(), rawTransactionId: z.string().nullable().optional() });
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
});
const entryIdMcpSchema = z.object({ id: z.string() });
const listEntriesMcpSchema = z.object({
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
  lineTemplate: z.array(z.record(z.string(), z.unknown())).nullable().optional(),
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
});
const decideCorrectionMcpSchema = z.object({ id: z.string(), decision: z.enum(['approve', 'reject']), note: z.string().optional() });
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
const setFinanceLimitMcpSchema = z.object({ key: z.enum(['finance.statementSufficesBelowCents', 'finance.cashDonationAlertCents', 'finance.roundAmountFromCents']), cents: z.number().int().min(0) });

const importStatementMcpSchema = z.object({ accountId: z.string(), fileName: z.string(), contentBase64: z.string().min(1), confirmFormatChange: z.boolean().optional() });
const listImportRunsMcpSchema = z.object({ accountId: z.string().optional(), limit: z.number().int().min(1).max(200).optional(), offset: z.number().int().min(0).optional() });
const getImportRunMcpSchema = z.object({ id: z.string() });
const listCandidatesMcpSchema = z.object({ runId: z.string().optional(), open: z.boolean().optional() });
const decideCandidateMcpSchema = z.object({ id: z.string(), decision: z.enum(['same', 'own']) });
const listRawTransactionsMcpSchema = z.object({ accountId: z.string().optional(), runId: z.string().optional(), state: z.enum(['open', 'booked']).optional(), limit: z.number().int().min(1).max(200).optional(), offset: z.number().int().min(0).optional() });

const previewPeriodMcpSchema = z.object({ id: z.string(), action: z.enum(['close', 'reopen']) });
const closeFiscalYearMcpSchema = z.object({ id: z.string() });
const reopenFiscalYearMcpSchema = z.object({ id: z.string(), note: z.string() });
const justifyUndocumentedEntryMcpSchema = z.object({ entryId: z.string(), note: z.string() });

/** Verteilerdienste (Spec 10.2): ein Werkzeug je Tätigkeit statt zwanzig, mit `kind` als Discriminator. */
export const FINANCE_MCP_TOOLS: readonly McpToolDefinition[] = [
  t({ name: 'finance_master_data', description: 'Read money accounts, categories, purposes, fiscal years or dated values. Requires finance.overview or finance.read; bank details and free-text descriptions only with finance.read.', inputSchema: readMasterDataSchema, handler: (deps, ctx, args) => readMasterData(deps, ctx, args), service: readMasterData }),
  t({ name: 'finance_master_data_save', description: 'Create or update a money account, category or purpose (data.id present updates, absent creates). Requires finance.setup. Audited without names or bank details.', inputSchema: saveMasterDataSchema, handler: (deps, ctx, args) => saveMasterData(deps, ctx, args), service: saveMasterData }),
  t({ name: 'finance_master_data_set_active', description: 'Activate or deactivate a money account, category or purpose. Requires finance.setup.', inputSchema: activeSchema, handler: (deps, ctx, args) => setMasterDataActive(deps, ctx, args), service: setMasterDataActive }),
  t({ name: 'finance_master_data_delete', description: 'Delete a money account, category or purpose. Only unused records; otherwise set inactive. Requires finance.setup.', inputSchema: deleteSchema, handler: (deps, ctx, args) => deleteMasterData(deps, ctx, args), service: deleteMasterData }),
  t({ name: 'finance_fiscal_year_create_first', description: 'Set up the first fiscal year of the association. Requires finance.setup.', inputSchema: createFirstFiscalYearSchema, handler: (deps, ctx, args) => createFirstFiscalYear(deps, ctx, args), service: createFirstFiscalYear }),
  t({ name: 'finance_fiscal_year_update', description: 'Change a fiscal year designation or record the tax return date. The designation is locked once the first entry number exists. Requires finance.setup.', inputSchema: updateFiscalYearSchema, handler: (deps, ctx, args) => updateFiscalYear(deps, ctx, args), service: updateFiscalYear }),
  t({ name: 'finance_purpose_close', description: 'Mark a purpose as fulfilled or dissolved, or reopen it. Requires finance.setup.', inputSchema: purposeCloseSchema, handler: (deps, ctx, args) => closePurpose(deps, ctx, args), service: closePurpose }),
  t({ name: 'finance_dated_value_set', description: 'Set an override for a legal threshold or rate by effective date; it wins over the shipped series from its date on. Requires finance.setup.', inputSchema: setDatedValueSchema, handler: (deps, ctx, args) => setDatedValue(deps, ctx, args), service: setDatedValue }),
  t({ name: 'finance_dated_value_remove', description: 'Remove an override of the association for a dated value; the shipped series applies again. Requires finance.setup.', inputSchema: removeDatedValueSchema, handler: (deps, ctx, args) => removeDatedValue(deps, ctx, args), service: removeDatedValue }),
  t({
    name: 'finance_entry_save_draft',
    description: 'Create or replace a draft entry: money lines (cents, + = inflow to the account) and allocation lines (gross cents, + = income, - = expense). A draft may be unbalanced; remainderCents tells what is left to allocate. Cash accounts cannot hold drafts - use finance_entry_book. Requires finance.entriesWrite.',
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
  t({ name: 'finance_entries_list', description: 'List booking entries, filtered by state (draft, reviewed, final, reversed), category, free text or amount, without voucher, agent-prepared, fiscal year, account or date range; sortable. Paginated (limit <= 200). Returns totals (income, expense, result) over the whole filtered set, not just the page. Requires finance.read.', inputSchema: listEntriesMcpSchema, handler: (deps, ctx, args) => listEntries(deps, ctx, args), service: listEntries }),
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
    description: 'Finalize a draft entry: checks the balance, active accounts and categories, the fiscal year and (for cash accounts) that no day would go negative, then assigns its number. Human only: refused over MCP unless the association has set finance.mcpHumanOnlyAllowed at the screen. Requires finance.entriesFinalize.',
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
    description: 'Create and finalize an entry in one step - the only way to book cash, since a cash draft cannot be parked. Human only: refused over MCP unless the association has set finance.mcpHumanOnlyAllowed at the screen. Requires finance.entriesWrite and finance.entriesFinalize.',
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
    description: 'File a PDF voucher (base64, at most finance.uploadLimitMb) in the name of an entry. The title must not name a person. Allowed at any time, also after the year is closed. Requires finance.entriesWrite.',
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
    description: 'Correct donor, project, purpose or the abroad switch of a finalized line - not amount, date, account or category (reverse the entry for those). Human only: refused over MCP unless the association has set finance.mcpHumanOnlyAllowed at the screen. In a closed year it waits for a second person. Requires finance.entriesFinalize.',
    inputSchema: requestCorrectionMcpSchema,
    handler: (deps, ctx, args) => requestAllocationCorrection(deps, ctx, args),
    service: requestAllocationCorrection,
  }),
  t({
    name: 'finance_correction_decide',
    description: 'Approve or reject a pending allocation correction - never your own request. Human only: refused over MCP unless the association has set finance.mcpHumanOnlyAllowed at the screen. Requires finance.approve.',
    inputSchema: decideCorrectionMcpSchema,
    handler: (deps, ctx, args) => decideAllocationCorrection(deps, ctx, args),
    service: decideAllocationCorrection,
  }),
  t({ name: 'finance_corrections_list', description: 'List allocation corrections by state or entry. Requires finance.read.', inputSchema: listCorrectionsMcpSchema, handler: (deps, ctx, args) => listAllocationCorrections(deps, ctx, args), service: listAllocationCorrections }),
  t({ name: 'finance_balances', description: 'Money account balances, purpose balances and the asset overview at a date (today by default). Requires finance.overview or finance.read.', inputSchema: getBalancesMcpSchema, handler: (deps, ctx, args) => getBalances(deps, ctx, args), service: getBalances }),
  t({ name: 'finance_income_statement', description: 'Income and expense statement by sphere, for a fiscal year or a date range (never both, never neither). Marked preliminary while the fiscal year is open. Requires finance.overview or finance.read.', inputSchema: getIncomeStatementMcpSchema, handler: (deps, ctx, args) => getIncomeStatement(deps, ctx, args), service: getIncomeStatement }),
  t({ name: 'finance_project_get', description: 'Read a project’s finance fields (target, default purpose, abroad, donation status published) and its summed result. Requires finance.overview or finance.read; carries no names.', inputSchema: getProjectFinanceMcpSchema, handler: (deps, ctx, args) => getProjectFinance(deps, ctx, args), service: getProjectFinance }),
  t({ name: 'finance_project_set', description: 'Set a project’s finance fields. Requires finance.setup.', inputSchema: setProjectFinanceMcpSchema, handler: (deps, ctx, args) => setProjectFinance(deps, ctx, args), service: setProjectFinance }),
  t({ name: 'finance_period_preview', description: 'What stands in the way of closing a fiscal year, or what reopening it would undo (action: close or reopen). Requires finance.read.', inputSchema: previewPeriodMcpSchema, handler: (deps, ctx, args) => previewPeriod(deps, ctx, args), service: previewPeriod }),
  t({
    name: 'finance_period_close',
    description: 'Close a fiscal year: no draft dated in it, every finalized entry documented or justified, the previous year closed, the year ended. Human only: refused over MCP unless the association has set finance.mcpHumanOnlyAllowed at the screen. Requires finance.periodClose.',
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
  t({ name: 'finance_setup_status', description: 'Read the computed setup checklist (fiscal year, account with opening balance, roles, categories reviewed, tax defaults applied) and whether it is complete. Requires finance.setup or finance.read.', inputSchema: z.object({}), handler: (deps, ctx) => getSetupStatus(deps, ctx), service: getSetupStatus }),
  t({ name: 'finance_setup_confirm', description: 'Confirm the categories-reviewed or the tax-defaults setup step by hand. Requires finance.setup.', inputSchema: confirmSetupStepMcpSchema, handler: (deps, ctx, args) => confirmSetupStep(deps, ctx, args), service: confirmSetupStep }),
  t({ name: 'finance_setup_tax_defaults', description: 'Apply the shipped defaults for the tax switches (entrepreneur status, membership fee certificates, expense waivers) and confirm the tax setup step in one step. Requires finance.setup.', inputSchema: z.object({}), handler: (deps, ctx) => applyTaxDefaults(deps, ctx), service: applyTaxDefaults }),
  t({ name: 'finance_permission_matrix', description: 'Read the "who may do what" matrix: the ten finance activities mapped to their permission, and per role its granted activities, visible finance navigation entries and active holders (names, no e-mail). Requires finance.setup.', inputSchema: z.object({}), handler: (deps, ctx) => getPermissionMatrix(deps, ctx), service: getPermissionMatrix }),
  t({ name: 'finance_setup_switch', description: 'Set one of the four setup switches: the three tax defaults, or whether an agent may finalize over MCP. The last one stays bound to the screen - refused over MCP. Requires finance.setup.', inputSchema: setFinanceSwitchMcpSchema, handler: (deps, ctx, args) => setFinanceSwitch(deps, ctx, args), service: setFinanceSwitch }),
  t({ name: 'finance_setup_limit', description: 'Set one of the three setup limits, as whole cents: below which a bank statement suffices as proof, from which a cash donation is flagged, and from which an amount is round-number-suspicious. Requires finance.setup.', inputSchema: setFinanceLimitMcpSchema, handler: (deps, ctx, args) => setFinanceLimit(deps, ctx, args), service: setFinanceLimit }),
  t({
    name: 'finance_import_statement',
    description: 'Import a CAMT.053 bank statement (base64, at most finance.uploadLimitMb) for a bank or payment-service account: one run per Stmt in the file, all or nothing. Sets the account import format to camt053 on first use; a change from csv needs confirmFormatChange. Refuses a mismatched IBAN, an already-imported file, or a cash account. An unreadable file is recorded as a failed run and answered with statementUnreadable. Not human only - an agent may import, never finalize. Requires finance.entriesWrite.',
    inputSchema: importStatementMcpSchema,
    handler: (deps, ctx, { contentBase64, ...rest }) => {
      const bytes = decodeBase64(contentBase64);
      if (!bytes) return Promise.resolve(invalid([{ path: 'contentBase64', message: 'invalidBase64' }]));
      return importStatement(deps, ctx, { ...rest, bytes });
    },
    service: importStatement,
  }),
  t({ name: 'finance_import_runs_list', description: 'List import runs (statement uploads), optionally filtered by account, newest first. Counterparty, iban and purpose never appear here - only counts and balances. Requires finance.read.', inputSchema: listImportRunsMcpSchema, handler: (deps, ctx, args) => listImportRuns(deps, ctx, args), service: listImportRuns }),
  t({ name: 'finance_import_run_get', description: 'Read one import run with its raw transactions (counterparty, iban, purpose included). Requires finance.read.', inputSchema: getImportRunMcpSchema, handler: (deps, ctx, args) => getImportRun(deps, ctx, args), service: getImportRun }),
  t({ name: 'finance_import_candidates_list', description: 'List import candidates - statement lines whose duplicate match is only probable, shown next to the existing raw transaction they might match. Requires finance.read.', inputSchema: listCandidatesMcpSchema, handler: (deps, ctx, args) => listCandidates(deps, ctx, args), service: listCandidates }),
  t({ name: 'finance_import_candidate_decide', description: 'Decide an import candidate: "same" leaves it as is, "own" turns it into a new raw transaction. Decidable only once. Requires finance.entriesWrite.', inputSchema: decideCandidateMcpSchema, handler: (deps, ctx, args) => decideCandidate(deps, ctx, args), service: decideCandidate }),
  t({ name: 'finance_raw_transactions_list', description: 'List raw transactions (bank statement lines already accepted), with counterparty, iban and purpose, filterable by account, run or state (open/booked). Requires finance.read.', inputSchema: listRawTransactionsMcpSchema, handler: (deps, ctx, args) => listRawTransactions(deps, ctx, args), service: listRawTransactions }),
];
