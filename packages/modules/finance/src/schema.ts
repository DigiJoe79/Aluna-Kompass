// Drizzle liest genau diese Datei für das Modul `finance` (`drizzle.config.ts`
// im Kern: `../modules/*/src/schema.ts`). Tabellen kommen mit den Tasks, die
// sie brauchen.
import { sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

/** Beträge sind ganzzahlige Cent. Spendendosen sind keine Konten, sondern ein Zugang zur Barkasse. */
export const financeAccounts = sqliteTable(
  'finance_accounts',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    kind: text('kind', { enum: ['bank', 'cash', 'paymentService'] }).notNull(),
    iban: text('iban'),
    bic: text('bic'),
    bankName: text('bank_name'),
    openingBalanceCents: integer('opening_balance_cents'),
    openingDate: text('opening_date'),
    importFormat: text('import_format', { enum: ['camt053', 'csv'] }),
    isMain: integer('is_main', { mode: 'boolean' }).notNull().default(false),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [uniqueIndex('finance_accounts_main_idx').on(t.isMain).where(sql`${t.isMain} = 1`), index('finance_accounts_active_idx').on(t.isActive)],
);
export type FinanceAccountRow = typeof financeAccounts.$inferSelect;

export const financeCategories = sqliteTable(
  'finance_categories',
  {
    id: text('id').primaryKey(),
    key: text('key').notNull(),
    name: text('name').notNull(),
    explanation: text('explanation').notNull().default(''),
    direction: text('direction', { enum: ['income', 'expense', 'transit'] }).notNull(),
    sphere: text('sphere', { enum: ['ideal', 'assetManagement', 'purposeOperation', 'business'] }),
    incomeKind: text('income_kind'),
    costFunction: text('cost_function', { enum: ['program', 'administration', 'fundraising'] }),
    allowanceKind: text('allowance_kind', { enum: ['none', 'volunteer', 'trainer'] }).notNull().default('none'),
    statementSuffices: integer('statement_suffices', { mode: 'boolean' }).notNull().default(false),
    defaultTaxCode: text('default_tax_code').notNull().default('none'),
    inputTaxDeductible: text('input_tax_deductible', { enum: ['no', 'yes', 'partial'] }).notNull().default('no'),
    countsTowardTurnover: integer('counts_toward_turnover', { mode: 'boolean' }).notNull().default(false),
    isAssetSale: integer('is_asset_sale', { mode: 'boolean' }).notNull().default(false),
    externalAccountNumber: text('external_account_number'),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [uniqueIndex('finance_categories_key_idx').on(t.key)],
);
export type FinanceCategoryRow = typeof financeCategories.$inferSelect;
