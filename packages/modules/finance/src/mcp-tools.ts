import type { McpToolDefinition } from '@kompass/core';
import { z } from 'zod';
import { closePurpose, deleteMasterData, readMasterData, saveMasterData, setMasterDataActive } from './ledger/master-data';
import { createFirstFiscalYear, updateFiscalYear } from './ledger/fiscal-years';
import { removeDatedValue, setDatedValue } from './ledger/dated-values';
import { TAX_CODES } from './ledger/codes';
import { deleteDraft, getEntry, listEntries, saveDraft, setReviewed } from './ledger/entries';
import { bookEntry, finalizeEntry, finalizeReviewed } from './ledger/finalize';
import { reverseEntry } from './ledger/reverse';

const t = <T>(def: McpToolDefinition<T>): McpToolDefinition => def as McpToolDefinition;

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

const moneyLineSchema = z.object({ accountId: z.string(), amountCents: z.number().int() });
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
const listEntriesMcpSchema = z.object({ status: z.enum(['draft', 'final']).optional(), fiscalYearId: z.string().optional(), accountId: z.string().optional(), from: z.string().optional(), to: z.string().optional(), limit: z.number().int().min(1).max(200).optional(), offset: z.number().int().min(0).optional() });
const setReviewedMcpSchema = z.object({ id: z.string(), reviewed: z.boolean(), expectedVersion: z.string().optional() });
const finalizeEntryMcpSchema = z.object({ id: z.string(), expectedVersion: z.string().optional() });
const finalizeReviewedMcpSchema = z.object({ ids: z.array(z.string()).min(1) });
const reverseEntryMcpSchema = z.object({ id: z.string(), cashWarningReason: z.string().optional(), withCorrectionDraft: z.boolean().optional() });

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
  t({ name: 'finance_entries_list', description: 'List booking entries by status, fiscal year, account or date range. Paginated (limit <= 200). Requires finance.read.', inputSchema: listEntriesMcpSchema, handler: (deps, ctx, args) => listEntries(deps, ctx, args), service: listEntries }),
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
];
