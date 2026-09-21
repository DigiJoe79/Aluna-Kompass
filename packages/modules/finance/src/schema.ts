// Drizzle liest genau diese Datei für das Modul `finance` (`drizzle.config.ts`
// im Kern: `../modules/*/src/schema.ts`). Tabellen kommen mit den Tasks, die
// sie brauchen.
import { sql } from 'drizzle-orm';
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

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

export const financePurposes = sqliteTable(
  'finance_purposes',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    /** Kein Fremdschlüssel: Projekte gehören einem anderen Modul. Den Halter dazu meldet Finanzen ab F2c. */
    projectId: text('project_id'),
    referenceNote: text('reference_note'),
    targetCents: integer('target_cents'),
    abroad: integer('abroad', { mode: 'boolean' }).notNull().default(false),
    carryForwardCents: integer('carry_forward_cents'),
    carryForwardDate: text('carry_forward_date'),
    fulfilledAt: text('fulfilled_at'),
    fulfilledByUserId: text('fulfilled_by_user_id'),
    dissolvedAt: text('dissolved_at'),
    dissolvedByUserId: text('dissolved_by_user_id'),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [index('finance_purposes_project_idx').on(t.projectId)],
);
export type FinancePurposeRow = typeof financePurposes.$inferSelect;

export const financeFiscalYears = sqliteTable(
  'finance_fiscal_years',
  {
    id: text('id').primaryKey(),
    startsOn: text('starts_on').notNull(),
    endsOn: text('ends_on').notNull(),
    /** Steht in jeder Buchungsnummer — ab der ersten vergebenen Nummer unveränderlich. */
    designation: text('designation').notNull(),
    taxReturnFiledOn: text('tax_return_filed_on'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [uniqueIndex('finance_fiscal_years_designation_idx').on(t.designation), uniqueIndex('finance_fiscal_years_start_idx').on(t.startsOn)],
);
export type FinanceFiscalYearRow = typeof financeFiscalYears.$inferSelect;

/** Abschließen und Wiederöffnen sind Ereignisse, kein Feld: Der Status ist das jüngste. Nie gelöscht. Dienste ab F2c. */
export const financePeriodEvents = sqliteTable(
  'finance_period_events',
  {
    id: text('id').primaryKey(),
    fiscalYearId: text('fiscal_year_id').notNull().references(() => financeFiscalYears.id),
    kind: text('kind', { enum: ['closed', 'reopened'] }).notNull(),
    at: text('at').notNull(),
    byUserId: text('by_user_id').notNull(),
    reason: text('reason'),
  },
  (t) => [index('finance_period_events_year_idx').on(t.fiscalYearId, t.at)],
);
export type FinancePeriodEventRow = typeof financePeriodEvents.$inferSelect;

/** Der Zähler ist Zustand: Eine Nummer kommt nie wieder. Muster `document_counters` der Akte. */
export const financeEntryCounters = sqliteTable('finance_entry_counters', {
  fiscalYearId: text('fiscal_year_id').primaryKey().references(() => financeFiscalYears.id),
  last: integer('last').notNull(),
});

/** Nur die Überschreibungen des Vereins. Die ausgelieferte Reihe ist Code (`dated-series.ts`) und wächst mit Updates. */
export const financeDatedValues = sqliteTable(
  'finance_dated_values',
  {
    key: text('key').notNull(),
    validFrom: text('valid_from').notNull(),
    /** JSON: eine Zahl, oder bei `taxation` eine Zeichenkette. */
    value: text('value').notNull(),
    updatedAt: text('updated_at').notNull(),
    updatedByUserId: text('updated_by_user_id'),
  },
  (t) => [primaryKey({ columns: [t.key, t.validFrom] })],
);
export type FinanceDatedValueRow = typeof financeDatedValues.$inferSelect;

/** Der Kopf einer Buchung. `final` ist unveränderlich — das sichern Trigger, nicht der Dienst (Spec 5.2). */
export const financeEntries = sqliteTable(
  'finance_entries',
  {
    id: text('id').primaryKey(),
    /** `<Jahresbezeichnung>-NNNN`, vergeben beim Festschreiben. */
    number: text('number'),
    entryDate: text('entry_date').notNull(),
    text: text('text').notNull(),
    status: text('status', { enum: ['draft', 'final'] }).notNull().default('draft'),
    fiscalYearId: text('fiscal_year_id').references(() => financeFiscalYears.id),
    reviewedAt: text('reviewed_at'),
    reviewedByUserId: text('reviewed_by_user_id'),
    finalizedAt: text('finalized_at'),
    finalizedByUserId: text('finalized_by_user_id'),
    finalizedChannel: text('finalized_channel'),
    reversesEntryId: text('reverses_entry_id'),
    reversedByEntryId: text('reversed_by_entry_id'),
    correctionOfEntryId: text('correction_of_entry_id'),
    /** Pflichtbegründung, wenn ein Storno ein Barkonto zeitweise ins Minus bringt; steht im Prüfpaket. */
    cashWarningReason: text('cash_warning_reason'),
    createdByUserId: text('created_by_user_id').notNull(),
    createdChannel: text('created_channel').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [
    uniqueIndex('finance_entries_number_idx').on(t.number),
    index('finance_entries_date_idx').on(t.entryDate),
    index('finance_entries_status_idx').on(t.status),
  ],
);
export type FinanceEntryRow = typeof financeEntries.$inferSelect;

/** Betrag in Cent, + = Zufluss aufs Konto. Storno-Zeilen tragen nie einen Rohumsatz. */
export const financeMoneyLines = sqliteTable(
  'finance_money_lines',
  {
    id: text('id').primaryKey(),
    entryId: text('entry_id').notNull().references(() => financeEntries.id),
    position: integer('position').notNull(),
    accountId: text('account_id').notNull().references(() => financeAccounts.id),
    amountCents: integer('amount_cents').notNull(),
    /** Ab F4. Auch ein Entwurf belegt den Rohumsatz („vorgeschlagen“); das Storno gibt ihn frei. Kein Fremdschlüssel: `import` kennt `ledger`, nicht umgekehrt. */
    rawTransactionId: text('raw_transaction_id'),
    rawReleasedAt: text('raw_released_at'),
  },
  (t) => [
    index('finance_money_lines_entry_idx').on(t.entryId),
    index('finance_money_lines_account_idx').on(t.accountId),
    uniqueIndex('finance_money_lines_raw_idx').on(t.rawTransactionId).where(sql`${t.rawReleasedAt} is null and ${t.rawTransactionId} is not null`),
  ],
);
export type FinanceMoneyLineRow = typeof financeMoneyLines.$inferSelect;

/** Betrag brutto in Cent, + = Einnahme, − = Ausgabe. */
export const financeAllocationLines = sqliteTable(
  'finance_allocation_lines',
  {
    id: text('id').primaryKey(),
    entryId: text('entry_id').notNull().references(() => financeEntries.id),
    position: integer('position').notNull(),
    categoryId: text('category_id').notNull().references(() => financeCategories.id),
    amountCents: integer('amount_cents').notNull(),
    taxCode: text('tax_code').notNull().default('none'),
    /** Nur bei `rc13b` und `icAcquisition` von Bedeutung: voller (Vorgabe) oder ermäßigter Satz. */
    rateKind: text('rate_kind', { enum: ['standard', 'reduced'] }).notNull().default('standard'),
    /** Kein Fremdschlüssel: Projekte gehören einem anderen Modul. */
    projectId: text('project_id'),
    purposeId: text('purpose_id').references(() => financePurposes.id),
    /** Kein Fremdschlüssel: Kontakte gehören einem anderen Modul; das Protokoll nennt nie diese ID. */
    contactId: text('contact_id'),
    abroad: integer('abroad', { mode: 'boolean' }).notNull().default(false),
    /** Rücklastschrift und Rückzahlung zeigen auf die Zeile, die sie zurücknehmen. */
    originLineId: text('origin_line_id'),
    /** „Zuführung zum Vermögen“ (§ 62 Abs. 3 AO) — bei Erbschaften vorbelegt. */
    addsToAssets: integer('adds_to_assets', { mode: 'boolean' }).notNull().default(false),
  },
  (t) => [
    index('finance_allocation_lines_entry_idx').on(t.entryId),
    index('finance_allocation_lines_category_idx').on(t.categoryId),
    index('finance_allocation_lines_contact_idx').on(t.contactId),
    index('finance_allocation_lines_purpose_idx').on(t.purposeId),
    index('finance_allocation_lines_project_idx').on(t.projectId),
  ],
);
export type FinanceAllocationLineRow = typeof financeAllocationLines.$inferSelect;

/**
 * Beleg an der Buchung — n:m, nur festgeschriebene Dokumente der Akte. Die Datei
 * liegt dort; hier steht der Bezug, und derselbe Bezug steht in `document_links`
 * (über ihn liefert die Akte aus). Widerrufen heißt kennzeichnen: Eine
 * widerrufene Verknüpfung bleibt Halter und Verweis.
 */
export const financeEntryDocuments = sqliteTable(
  'finance_entry_documents',
  {
    id: text('id').primaryKey(),
    entryId: text('entry_id').notNull().references(() => financeEntries.id),
    /**
     * Kein Fremdschlüssel: Dokumente gehören der Akte. Wird `null`, wenn das
     * Dokument nach seiner Frist gelöscht wird (F2c, `recordDeleted`) — dann
     * bleibt der Grabstein aus Nummer und Prüfsumme.
     */
    documentId: text('document_id'),
    /**
     * Schon beim Verknüpfen kopiert, nicht erst beim Löschen: Die Akte meldet ein
     * gelöschtes Dokument erst, nachdem seine Zeile weg ist — dann wäre nichts
     * mehr zu lesen. Eine Nummer und eine Prüfsumme sind keine Personendaten.
     */
    documentNumber: text('document_number').notNull(),
    documentChecksum: text('document_checksum'),
    documentDeletedAt: text('document_deleted_at'),
    addedAt: text('added_at').notNull(),
    addedByUserId: text('added_by_user_id').notNull(),
    revokedAt: text('revoked_at'),
    revokedByUserId: text('revoked_by_user_id'),
    /** Frei getippt — steht hier, nie im Protokoll. */
    revokeNote: text('revoke_note'),
    replacedByLinkId: text('replaced_by_link_id'),
  },
  (t) => [uniqueIndex('finance_entry_documents_pair_idx').on(t.entryId, t.documentId), index('finance_entry_documents_document_idx').on(t.documentId)],
);
export type FinanceEntryDocumentRow = typeof financeEntryDocuments.$inferSelect;
