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
