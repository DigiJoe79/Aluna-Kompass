// Drizzle liest genau diese Datei für das Modul `finance` (`drizzle.config.ts`
// im Kern: `../modules/*/src/schema.ts`). Tabellen kommen mit den Tasks, die
// sie brauchen.
import { sql } from 'drizzle-orm';
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex, type AnySQLiteColumn } from 'drizzle-orm/sqlite-core';

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
    /**
     * Das eine aktive CSV-Format des Kontos (F4b). Ohne Fremdschlüssel wie
     * `raw_transaction_id`: Ein Fremdschlüssel ließe drizzle-kit die Tabelle
     * neu anlegen. Die Invariante „csv ⇔ Format gesetzt“ sichern Trigger.
     */
    importProfileId: text('import_profile_id'),
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

/** Forderung oder Verbindlichkeit — außerhalb des Journals; die EÜR sieht sie nie. */
export const financeOpenItems = sqliteTable(
  'finance_open_items',
  {
    id: text('id').primaryKey(),
    kind: text('kind', { enum: ['receivable', 'payable'] }).notNull(),
    itemDate: text('item_date').notNull(),
    contactId: text('contact_id'),
    amountCents: integer('amount_cents').notNull(),
    dueOn: text('due_on'),
    documentId: text('document_id'),
    originType: text('origin_type'),
    originId: text('origin_id'),
    paymentReference: text('payment_reference'),
    /** JSON: Zuordnungszeilen, die eine Zahlung dieses Postens vorbelegen. */
    lineTemplate: text('line_template'),
    cancelledAt: text('cancelled_at'),
    cancelledByUserId: text('cancelled_by_user_id'),
    cancelNote: text('cancel_note'),
    createdByUserId: text('created_by_user_id').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [index('finance_open_items_kind_idx').on(t.kind), index('finance_open_items_origin_idx').on(t.originType, t.originId), index('finance_open_items_contact_idx').on(t.contactId)],
);
export type FinanceOpenItemRow = typeof financeOpenItems.$inferSelect;

/** Eine Geldzeile erledigt einen Posten ganz oder teilweise — Sammelüberweisung, Teil- und Überzahlung. Betrag immer > 0. */
export const financeOpenItemSettlements = sqliteTable(
  'finance_open_item_settlements',
  {
    id: text('id').primaryKey(),
    moneyLineId: text('money_line_id').notNull().references(() => financeMoneyLines.id),
    openItemId: text('open_item_id').notNull().references(() => financeOpenItems.id),
    amountCents: integer('amount_cents').notNull(),
  },
  (t) => [uniqueIndex('finance_open_item_settlements_pair_idx').on(t.moneyLineId, t.openItemId), index('finance_open_item_settlements_item_idx').on(t.openItemId)],
);
export type FinanceOpenItemSettlementRow = typeof financeOpenItemSettlements.$inferSelect;

/** E18: Vorher und Nachher einer Zuordnung — der Fachdatensatz, in dem stehen darf, was nie ins Protokoll kommt. Nie gelöscht. */
export const financeAllocationCorrections = sqliteTable(
  'finance_allocation_corrections',
  {
    id: text('id').primaryKey(),
    lineId: text('line_id').notNull().references(() => financeAllocationLines.id),
    entryId: text('entry_id').notNull().references(() => financeEntries.id),
    state: text('state', { enum: ['pending', 'applied', 'rejected'] }).notNull(),
    before: text('before').notNull(),
    after: text('after').notNull(),
    note: text('note').notNull(),
    proofDocumentId: text('proof_document_id'),
    section153: integer('section_153', { mode: 'boolean' }).notNull().default(false),
    requestedByUserId: text('requested_by_user_id').notNull(),
    requestedAt: text('requested_at').notNull(),
    approvedByUserId: text('approved_by_user_id'),
    approvedAt: text('approved_at'),
    rejectedByUserId: text('rejected_by_user_id'),
    rejectedAt: text('rejected_at'),
    rejectNote: text('reject_note'),
  },
  (t) => [index('finance_allocation_corrections_line_idx').on(t.lineId), index('finance_allocation_corrections_entry_idx').on(t.entryId), index('finance_allocation_corrections_state_idx').on(t.state)],
);
export type FinanceAllocationCorrectionRow = typeof financeAllocationCorrections.$inferSelect;

/** Warum eine festgeschriebene Buchung ohne Beleg bleibt — eine Aussage des Schatzmeisters zum Jahresabschluss. Frei getippt, deshalb hier und nie im Protokoll. */
export const financeEntryJustifications = sqliteTable('finance_entry_justifications', {
  entryId: text('entry_id').primaryKey().references(() => financeEntries.id),
  note: text('note').notNull(),
  byUserId: text('by_user_id').notNull(),
  at: text('at').notNull(),
});
export type FinanceEntryJustificationRow = typeof financeEntryJustifications.$inferSelect;

/**
 * Eine Kassenzählung ist eine gespeicherte Tatsache (Spec 5.5) — nie
 * geändert, nie gelöscht; Trigger sichern das auf Datenbankebene (Ausnahme:
 * `document_id` darf beim Grabstein des Dokuments auf `null` fallen). Die
 * Zählenden sind Kontakte, kein Fremdschlüssel (Muster `contacts_user_links`
 * — Kontakte gehören einem anderen Modul); ihr Anzeigename zum Zeitpunkt der
 * Zählung steht zusätzlich hier, damit das Protokoll auch nach einer
 * Anonymisierung des Kontakts lesbar bleibt.
 */
export const financeCashCounts = sqliteTable(
  'finance_cash_counts',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull().references(() => financeAccounts.id),
    countedOn: text('counted_on').notNull(),
    countedCents: integer('counted_cents').notNull(),
    bookCents: integer('book_cents').notNull(),
    /** = countedCents − bookCents. */
    differenceCents: integer('difference_cents').notNull(),
    counterOneContactId: text('counter_one_contact_id').notNull(),
    counterTwoContactId: text('counter_two_contact_id').notNull(),
    counterOneName: text('counter_one_name').notNull(),
    counterTwoName: text('counter_two_name').notNull(),
    /** Pflicht bei differenceCents < 0 — nie im Änderungsprotokoll. */
    note: text('note'),
    /** JSON: Stückzahlen je Nennwert, oder `null` ohne Zählhilfe. */
    denominations: text('denominations'),
    documentId: text('document_id'),
    documentNumber: text('document_number').notNull(),
    /** `null`, wenn differenceCents = 0 — dann entsteht keine Buchung. */
    entryId: text('entry_id').references(() => financeEntries.id),
    createdByUserId: text('created_by_user_id').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [index('finance_cash_counts_account_idx').on(t.accountId, t.countedOn)],
);
export type FinanceCashCountRow = typeof financeCashCounts.$inferSelect;

/**
 * Ein CSV-Format (F4b; Spec 6.2 „Profil“) — unveränderlich: Eine Änderung ist
 * ein neues Format, das Konto zeigt dann auf das neue, alte Läufe behalten
 * ihres. Trigger `finance_import_profiles_no_update` und
 * `…_no_delete_used` (von Hand angefügt).
 */
export const financeImportProfiles = sqliteTable('finance_import_profiles', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  /** `CsvFormat` als JSON, beim Schreiben mit `csvFormatSchema` geprüft. */
  format: text('format').notNull(),
  headerSignature: text('header_signature').notNull(),
  builtinKey: text('builtin_key'),
  createdAt: text('created_at').notNull(),
  createdByUserId: text('created_by_user_id').notNull(),
  createdChannel: text('created_channel').notNull(),
});
export type FinanceImportProfileRow = typeof financeImportProfiles.$inferSelect;

/**
 * Ein CAMT.053-Lauf ist eine geschriebene Tatsache (Spec 6.1) — ganz oder
 * gar nicht importiert, nie halb. Zähler und Abschlussfelder sind änderbar,
 * bis `finishedAt`/`failedAt` gesetzt ist; danach nur `discardedAt`/
 * `discardedByUserId`/`discardNote` (je einmal) und `fileKey` → `NULL` (je
 * einmal, beim Verwerfen). Trigger sichern das auf Datenbankebene (von Hand
 * angefügt, `0018_finance_import.sql`).
 */
export const financeImportRuns = sqliteTable(
  'finance_import_runs',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull().references(() => financeAccounts.id),
    format: text('format', { enum: ['camt053', 'csv'] }).notNull(),
    /** F4b: mit welchem CSV-Format gelesen — Verlauf, auch wenn das Konto später wechselt. */
    profileId: text('profile_id'),
    /** Name des Formats beim Lesen (Schnappschuss). */
    profileName: text('profile_name'),
    fileName: text('file_name').notNull(),
    fileSha256: text('file_sha256').notNull(),
    /** Modulspeicher-Schlüssel der Originaldatei — `NULL` nach dem Verwerfen. */
    fileKey: text('file_key'),
    periodFrom: text('period_from'),
    periodTo: text('period_to'),
    openingCents: integer('opening_cents'),
    closingCents: integer('closing_cents'),
    countNew: integer('count_new'),
    countKnown: integer('count_known'),
    countHeld: integer('count_held'),
    countPendingSkipped: integer('count_pending_skipped'),
    gapFrom: text('gap_from'),
    gapTo: text('gap_to'),
    startedAt: text('started_at').notNull(),
    finishedAt: text('finished_at'),
    failedAt: text('failed_at'),
    failureCode: text('failure_code'),
    failureLine: integer('failure_line'),
    discardedAt: text('discarded_at'),
    discardedByUserId: text('discarded_by_user_id'),
    /** Frei getippt — steht hier, nie im Änderungsprotokoll. */
    discardNote: text('discard_note'),
    createdByUserId: text('created_by_user_id').notNull(),
    createdChannel: text('created_channel').notNull(),
  },
  (t) => [index('finance_import_runs_account_idx').on(t.accountId)],
);
export type FinanceImportRunRow = typeof financeImportRuns.$inferSelect;

/**
 * Ein Kontoumsatz aus einem Auszug — unveränderlich ab dem Einlesen
 * (Trigger `finance_raw_transactions_no_update`). Gegenpartei, IBAN und
 * Verwendungszweck sind personenbezogen und stehen deshalb nie im
 * Änderungsprotokoll (Spec 10.3).
 */
export const financeRawTransactions = sqliteTable(
  'finance_raw_transactions',
  {
    id: text('id').primaryKey(),
    runId: text('run_id').notNull().references(() => financeImportRuns.id),
    accountId: text('account_id').notNull().references(() => financeAccounts.id),
    bookingDate: text('booking_date').notNull(),
    valueDate: text('value_date'),
    amountCents: integer('amount_cents').notNull(),
    counterpartyName: text('counterparty_name'),
    counterpartyIban: text('counterparty_iban'),
    purpose: text('purpose').notNull().default(''),
    bankReference: text('bank_reference'),
    endToEndId: text('end_to_end_id'),
    returnCode: text('return_code'),
    dedupKey: text('dedup_key').notNull(),
    lineIndex: integer('line_index').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    uniqueIndex('finance_raw_transactions_reference_idx')
      .on(t.accountId, t.bankReference)
      .where(sql`${t.bankReference} is not null`),
    index('finance_raw_transactions_dedup_idx').on(t.accountId, t.dedupKey),
    index('finance_raw_transactions_run_idx').on(t.runId),
  ],
);
export type FinanceRawTransactionRow = typeof financeRawTransactions.$inferSelect;

/**
 * Eine Zeile des Auszugs, deren Dublettenschlüssel nur wahrscheinlich trifft
 * — zurückgehalten und entschieden mit „same“/„own“ (Spec 6.1, 6.3). `line`
 * trägt die volle `CamtLine` als JSON und ist damit personenbezogen wie der
 * Rohumsatz selbst.
 */
export const financeImportCandidates = sqliteTable(
  'finance_import_candidates',
  {
    id: text('id').primaryKey(),
    runId: text('run_id').notNull().references(() => financeImportRuns.id),
    accountId: text('account_id').notNull().references(() => financeAccounts.id),
    line: text('line').notNull(),
    matchesRawTransactionId: text('matches_raw_transaction_id').references(() => financeRawTransactions.id),
    dedupKey: text('dedup_key').notNull(),
    decision: text('decision', { enum: ['same', 'own'] }),
    decidedAt: text('decided_at'),
    decidedByUserId: text('decided_by_user_id'),
    /** Nur gesetzt bei `decision = 'own'`. */
    rawTransactionId: text('raw_transaction_id').references(() => financeRawTransactions.id),
  },
  (t) => [index('finance_import_candidates_run_idx').on(t.runId)],
);
export type FinanceImportCandidateRow = typeof financeImportCandidates.$inferSelect;

/** Finanzfelder eines Projekts — kein Fremdschlüssel: Projekte gehören einem anderen Modul. Ohne Zeile gelten die Vorgaben aus `projectFinanceInternal`. */
export const financeProjectSettings = sqliteTable('finance_project_settings', {
  projectId: text('project_id').primaryKey(),
  targetCents: integer('target_cents'),
  defaultPurposeId: text('default_purpose_id').references(() => financePurposes.id),
  abroad: integer('abroad', { mode: 'boolean' }).notNull().default(false),
  publishDonationStatus: integer('publish_donation_status', { mode: 'boolean' }).notNull().default(false),
  updatedAt: text('updated_at').notNull(),
});
export type FinanceProjectSettingsRow = typeof financeProjectSettings.$inferSelect;

/**
 * Eine Regel für Kontoumsätze (F5, Spec 6.4 Vorschlag 4): Bedingungen →
 * Ergebnis. Arbeitsmaterial — änderbar und löschbar; sie wirkt nur nach vorn.
 * Mindestens eine Bedingung ist gesetzt (Trigger
 * `finance_import_rules_needs_condition_insert`/`…_update`, von Hand
 * angefügt). Kein Fremdschlüssel auf Konto, Kontakt oder Projekt: Ein
 * Fremdschlüssel aufs Konto hielte ein unbenutztes Konto fest, Kontakte und
 * Projekte gehören anderen Modulen. Name und Textbedingung sind Freitext und
 * stehen nie im Änderungsprotokoll.
 */
export const financeImportRules = sqliteTable(
  'finance_import_rules',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    // Bedingungen — alle optional, mindestens eine.
    accountId: text('account_id'),
    direction: text('direction', { enum: ['in', 'out'] }),
    counterpartyIban: text('counterparty_iban'),
    textContains: text('text_contains'),
    amountMinCents: integer('amount_min_cents'),
    amountMaxCents: integer('amount_max_cents'),
    // Ergebnis.
    categoryId: text('category_id').notNull().references(() => financeCategories.id),
    projectId: text('project_id'),
    purposeId: text('purpose_id').references(() => financePurposes.id),
    contactId: text('contact_id'),
    taxCode: text('tax_code'),
    entryText: text('entry_text'),
    createdAt: text('created_at').notNull(),
    createdByUserId: text('created_by_user_id').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [index('finance_import_rules_order_idx').on(t.sortOrder)],
);
export type FinanceImportRuleRow = typeof financeImportRules.$inferSelect;

/**
 * Kontakt ↔ IBAN (F5): gelernt aus Handlungen, nie rückwirkend. Arbeitsmaterial,
 * löschbar. Kein Fremdschlüssel: Kontakte gehören einem anderen Modul.
 */
export const financeContactBankAccounts = sqliteTable(
  'finance_contact_bank_accounts',
  {
    id: text('id').primaryKey(),
    contactId: text('contact_id').notNull(),
    iban: text('iban').notNull(),
    createdAt: text('created_at').notNull(),
    createdByUserId: text('created_by_user_id').notNull(),
  },
  (t) => [uniqueIndex('finance_contact_bank_accounts_pair_idx').on(t.contactId, t.iban), index('finance_contact_bank_accounts_iban_idx').on(t.iban)],
);
export type FinanceContactBankAccountRow = typeof financeContactBankAccounts.$inferSelect;

/**
 * Ein Bescheid des Vereins (F6a, Spec 7.1): § 60a, Freistellungsbescheid
 * oder Anlage zum Körperschaftsteuerbescheid — eine datierte Reihe, nie
 * gelöscht (Trigger `finance_notices_no_delete`). „Aufgehoben oder ersetzt
 * am“ und „irrtümlich erfasst“ werden je einmal gesetzt (Trigger
 * `…_supersede_once`, `…_void_once`); die Gültigkeit rechnet
 * `ledger/notice-validity.ts`, sie steht nie hier. Finanzamt, Steuernummer,
 * Zwecke und Begründung stehen nie im Änderungsprotokoll. Kein Fremdschlüssel
 * auf Dokumente: die gehören der Akte.
 */
export const financeNotices = sqliteTable(
  'finance_notices',
  {
    id: text('id').primaryKey(),
    kind: text('kind', { enum: ['section60a', 'exemptionNotice', 'corporateTaxNoticeAttachment'] }).notNull(),
    taxOffice: text('tax_office').notNull(),
    taxNumber: text('tax_number').notNull(),
    noticeDate: text('notice_date').notNull(),
    /**
     * Steuerbefreiung ab: Beginn des ersten Veranlagungszeitraums, für den der
     * Bescheid die Befreiung ausspricht (BMF 07.11.2013 Nr. 14, § 60 Abs. 2 AO).
     * Für Zuwendungen davor gibt es keine Bestätigung.
     */
    exemptFrom: text('exempt_from').notNull(),
    /** „2023“ oder „2021–2023“ — beim § 60a-Bescheid leer. */
    assessmentPeriod: text('assessment_period'),
    /** Die begünstigten Zwecke im Wortlaut des Bescheids, im Genitiv, ohne „Förderung“. */
    purposesText: text('purposes_text').notNull(),
    /** Dieselben Zwecke im Akkusativ — Pflicht nur beim § 60a-Bescheid (Befundliste 0.2.0, N8). */
    purposesTextAccusative: text('purposes_text_accusative'),
    documentId: text('document_id'),
    supersededOn: text('superseded_on'),
    supersededDocumentId: text('superseded_document_id'),
    voidedAt: text('voided_at'),
    voidedByUserId: text('voided_by_user_id'),
    /** Frei getippt — steht hier, nie im Protokoll. */
    voidNote: text('void_note'),
    createdAt: text('created_at').notNull(),
    createdByUserId: text('created_by_user_id').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [index('finance_notices_date_idx').on(t.noticeDate)],
);
export type FinanceNoticeRow = typeof financeNotices.$inferSelect;

/**
 * Maschinelles Verfahren (F6a, Annahme 8): wer in welchem Zeitraum
 * unterzeichnet, mit Faksimile im Modulspeicher (nie in der Mediathek) und dem
 * Tag der Anzeige beim Finanzamt. Nie gelöscht; ein Amtsende ist `validTo`.
 * Der Name steht nie im Protokoll.
 */
export const financeSigners = sqliteTable(
  'finance_signers',
  {
    id: text('id').primaryKey(),
    validFrom: text('valid_from').notNull(),
    validTo: text('valid_to'),
    signerName: text('signer_name').notNull(),
    /** Schlüssel im Modulspeicher, `signature-<id>.png|jpg`. */
    facsimileKey: text('facsimile_key'),
    facsimileChecksum: text('facsimile_checksum'),
    notifiedOn: text('notified_on'),
    createdAt: text('created_at').notNull(),
    createdByUserId: text('created_by_user_id').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [index('finance_signers_valid_from_idx').on(t.validFrom)],
);
export type FinanceSignerRow = typeof financeSigners.$inferSelect;

/**
 * Eine Zuwendungsbestätigung (F6a, Spec 7.2): unser Exemplar ist das
 * ausgestellte Dokument der Akte (`documentId`, Art `finance-confirmation`).
 * Nach dem Ausstellen unveränderlich (Trigger `finance_confirmations_immutable`);
 * änderbar bleiben nur Versand, unterschriebene Fassung (einmal) und die
 * Rücknahme mit Rückholspur (einmal). Nie gelöscht. Kein Fremdschlüssel auf
 * Kontakt oder Dokument — sie gehören anderen Modulen.
 */
export const financeConfirmations = sqliteTable(
  'finance_confirmations',
  {
    id: text('id').primaryKey(),
    kind: text('kind', { enum: ['money', 'inKind', 'collective'] }).notNull(),
    /** Nie im Protokoll. */
    contactId: text('contact_id').notNull(),
    noticeId: text('notice_id').notNull().references(() => financeNotices.id),
    documentId: text('document_id').notNull(),
    documentNumber: text('document_number').notNull(),
    issuedOn: text('issued_on').notNull(),
    issuedByUserId: text('issued_by_user_id').notNull(),
    issuedChannel: text('issued_channel').notNull(),
    machine: integer('machine', { mode: 'boolean' }).notNull().default(false),
    signerId: text('signer_id').references(() => financeSigners.id),
    facsimileChecksum: text('facsimile_checksum'),
    expenseWaiver: integer('expense_waiver', { mode: 'boolean' }).notNull().default(false),
    totalCents: integer('total_cents').notNull(),
    periodFrom: text('period_from'),
    periodTo: text('period_to'),
    signedDocumentId: text('signed_document_id'),
    sentAt: text('sent_at'),
    sentVia: text('sent_via', { enum: ['post', 'email', 'handed'] }),
    voidedAt: text('voided_at'),
    voidedByUserId: text('voided_by_user_id'),
    /** Frei getippt — nie im Protokoll. */
    voidNote: text('void_note'),
    sentBeforeVoid: integer('sent_before_void', { mode: 'boolean' }),
    originalReturnedOn: text('original_returned_on'),
    taxOfficeInformedOn: text('tax_office_informed_on'),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    index('finance_confirmations_contact_idx').on(t.contactId),
    index('finance_confirmations_notice_idx').on(t.noticeId),
    index('finance_confirmations_document_idx').on(t.documentId),
    index('finance_confirmations_issued_idx').on(t.issuedOn),
  ],
);
export type FinanceConfirmationRow = typeof financeConfirmations.$inferSelect;

/**
 * Welche Zuordnungszeile eine Bestätigung trägt. Eine Zeile steht in höchstens
 * einer gültigen Bestätigung (partieller Unique-Index); die Rücknahme setzt
 * `releasedAt` — die einzige änderbare Spalte, einmal (Spec 5.2). Nie gelöscht.
 */
export const financeConfirmationLines = sqliteTable(
  'finance_confirmation_lines',
  {
    id: text('id').primaryKey(),
    confirmationId: text('confirmation_id').notNull().references(() => financeConfirmations.id),
    lineId: text('line_id').notNull().references(() => financeAllocationLines.id),
    amountCents: integer('amount_cents').notNull(),
    releasedAt: text('released_at'),
  },
  (t) => [
    uniqueIndex('finance_confirmation_lines_line_idx').on(t.lineId).where(sql`${t.releasedAt} is null`),
    index('finance_confirmation_lines_confirmation_idx').on(t.confirmationId),
    index('finance_confirmation_lines_all_line_idx').on(t.lineId),
  ],
);
export type FinanceConfirmationLineRow = typeof financeConfirmationLines.$inferSelect;

/**
 * Was eine Sachspende ist (Prüfstein 5, Annahme 11) — an der
 * `inKindDonation`-Zeile. Gegenstand, Zustand und Wertermittlung sind
 * Freitext und stehen nie im Protokoll; sie fallen mit dem Personenbezug des
 * Jahres. Die Wertunterlage ist ein Dokument der Akte (kein Fremdschlüssel).
 */
export const financeInKindDetails = sqliteTable('finance_in_kind_details', {
  lineId: text('line_id').primaryKey().references(() => financeAllocationLines.id),
  item: text('item').notNull(),
  condition: text('condition').notNull(),
  valuation: text('valuation').notNull(),
  origin: text('origin', { enum: ['private', 'business'] }).notNull(),
  withdrawalValueCents: integer('withdrawal_value_cents'),
  vatCents: integer('vat_cents'),
  proofDocumentId: text('proof_document_id'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});
export type FinanceInKindDetailsRow = typeof financeInKindDetails.$inferSelect;

/**
 * Ein Serienlauf (F6b, Spec 7.4): Parameter und Tatsachen des Starts, dazu
 * drei späte Tatsachen — fertig, Versand vermerkt, Weg —, je einmal von leer
 * auf Wert (Trigger `finance_confirmation_runs_immutable`). Nie gelöscht: Der
 * Lauf ist die Tatsache, wer wann was ausgestellt hat. Die ausgeschlossenen
 * Kontakte stehen hier als JSON-Liste, nie im Protokoll (dort nur ihre Zahl).
 * Der Fortschritt ist berechnet — aus den Posten, nie hier gespeichert.
 */
export const financeConfirmationRuns = sqliteTable('finance_confirmation_runs', {
  id: text('id').primaryKey(),
  year: integer('year').notNull(),
  minCents: integer('min_cents').notNull(),
  /** JSON `string[]` — nie im Protokoll. */
  excludedContactIds: text('excluded_contact_ids').notNull(),
  followUpOfRunId: text('follow_up_of_run_id').references((): AnySQLiteColumn => financeConfirmationRuns.id),
  /** Ausstellungstag aller Bestätigungen des Laufs. */
  startedOn: text('started_on').notNull(),
  startedAt: text('started_at').notNull(),
  startedByUserId: text('started_by_user_id').notNull(),
  startedChannel: text('started_channel').notNull(),
  finishedAt: text('finished_at'),
  dispatchedAt: text('dispatched_at'),
  dispatchedVia: text('dispatched_via', { enum: ['post', 'email', 'handed'] }),
  createdAt: text('created_at').notNull(),
});
export type FinanceConfirmationRunRow = typeof financeConfirmationRuns.$inferSelect;

/**
 * Ein Posten des Serienlaufs: Kontakt × Art (× Sachspendenzeile), beim Start
 * als Schnappschuss angelegt und danach unveränderlich; nur der Ausgang —
 * `state`, `confirmationId`, `errorCode`, `doneAt` — verlässt `pending`
 * einmal (Trigger `…_done_once`). Eindeutig je Lauf, Kontakt, Art und
 * Sachspendenzeile. Weil SQLite zwei NULL im Unique-Index für verschieden
 * hält, trägt ein zweiter, partieller Index die Posten ohne Sachspendenzeile
 * (`coalesce` im Index kann drizzle-kit nicht erzeugen). Kein Fremdschlüssel
 * auf Kontakt oder Bestätigung —
 * `contactId` und `sortKey` stehen nie im Protokoll.
 */
export const financeConfirmationRunItems = sqliteTable(
  'finance_confirmation_run_items',
  {
    id: text('id').primaryKey(),
    runId: text('run_id').notNull().references(() => financeConfirmationRuns.id),
    /** Nie im Protokoll. */
    contactId: text('contact_id').notNull(),
    kind: text('kind', { enum: ['collective', 'collectiveWaiver', 'inKind'] }).notNull(),
    inKindLineId: text('in_kind_line_id'),
    /** JSON `string[]` der Zuordnungszeilen. */
    lineIds: text('line_ids').notNull(),
    totalCents: integer('total_cents').notNull(),
    needsSignature: integer('needs_signature', { mode: 'boolean' }).notNull(),
    state: text('state', { enum: ['pending', 'issued', 'failed', 'skipped'] }).notNull(),
    confirmationId: text('confirmation_id'),
    errorCode: text('error_code'),
    doneAt: text('done_at'),
    /** Kontaktname klein, für die Reihenfolge der Sammel-PDFs — nie im Protokoll. */
    sortKey: text('sort_key').notNull(),
  },
  (t) => [
    uniqueIndex('finance_confirmation_run_items_key_idx').on(t.runId, t.contactId, t.kind, t.inKindLineId),
    uniqueIndex('finance_confirmation_run_items_collective_idx').on(t.runId, t.contactId, t.kind).where(sql`${t.inKindLineId} is null`),
  ],
);
export type FinanceConfirmationRunItemRow = typeof financeConfirmationRunItems.$inferSelect;

/**
 * Ein Antrag auf Erstattung einer Auslage (F8a, Spec 8.2). Der Entwurf ist
 * Arbeitsmaterial — änderbar, löschbar; die Nummer `KE-<Jahr>-NNN` entsteht
 * beim Einreichen. Danach ist der Antrag unveränderlich bis auf die
 * Freigabefelder, und `state` verlässt `submitted` genau einmal (Trigger
 * `finance_expense_claims_submitted_immutable`); gelöscht wird nur ein Entwurf
 * (`…_no_delete_submitted`). „Ausgezahlt“ ist berechnet — aus dem offenen
 * Posten, nie hier gespeichert. Kein Fremdschlüssel auf Kontakt oder Dokument:
 * sie gehören anderen Modulen. IBAN, Anspruchsgrundlage, Begründung und
 * Ablehnungsgrund stehen nie im Änderungsprotokoll.
 */
export const financeExpenseClaims = sqliteTable(
  'finance_expense_claims',
  {
    id: text('id').primaryKey(),
    number: text('number'),
    /** Die antragstellende Person — nie im Protokoll. */
    contactId: text('contact_id').notNull(),
    /** Wer den Antrag angelegt hat (Anleger); die Freigabe prüft Freigebender ≠ Anleger. */
    submittedByUserId: text('submitted_by_user_id').notNull(),
    state: text('state', { enum: ['draft', 'submitted', 'approved', 'rejected'] }).notNull().default('draft'),
    iban: text('iban'),
    waiver: integer('waiver', { mode: 'boolean' }).notNull().default(false),
    recurring: integer('recurring', { mode: 'boolean' }).notNull().default(false),
    waiverBasisText: text('waiver_basis_text'),
    waiverAgreedOn: text('waiver_agreed_on'),
    waiverDeclaredOn: text('waiver_declared_on'),
    waiverDeclarationDocumentId: text('waiver_declaration_document_id'),
    waiverSignedDocumentId: text('waiver_signed_document_id'),
    claimAgreedConfirmed: integer('claim_agreed_confirmed', { mode: 'boolean' }).notNull().default(false),
    waiverLateReason: text('waiver_late_reason'),
    waiverFreeFundsCents: integer('waiver_free_funds_cents'),
    submittedAt: text('submitted_at'),
    approvedAt: text('approved_at'),
    approvedByUserId: text('approved_by_user_id'),
    rejectedAt: text('rejected_at'),
    rejectedByUserId: text('rejected_by_user_id'),
    rejectNote: text('reject_note'),
    openItemId: text('open_item_id').references(() => financeOpenItems.id),
    entryId: text('entry_id').references(() => financeEntries.id),
    copiedFromClaimId: text('copied_from_claim_id').references((): AnySQLiteColumn => financeExpenseClaims.id),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [
    uniqueIndex('finance_expense_claims_number_idx').on(t.number),
    index('finance_expense_claims_contact_idx').on(t.contactId),
    index('finance_expense_claims_state_idx').on(t.state, t.submittedAt),
  ],
);
export type FinanceExpenseClaimRow = typeof financeExpenseClaims.$inferSelect;

/**
 * Eine Position des Antrags: ein Beleg (ein PDF der Akte) oder eine Fahrt
 * nach Kilometersatz. Im Entwurf darf alles fehlen (laufende Sicherung);
 * der Fahrtbetrag wird beim Speichern mit dem Satz von damals berechnet und
 * **gespeichert** — eine Tatsache des Einreichens. Nach dem Einreichen ändern
 * sich nur Kategorie und Zweck, solange der Antrag eingereicht ist; das
 * Dokument wird höchstens geleert, wenn es nach seiner Frist gelöscht wird —
 * die Nummer bleibt als Grabstein (Trigger `finance_expense_positions_*`).
 * „Wofür“, Strecke und Anlass sind Freitext und stehen nie im Protokoll.
 */
export const financeExpensePositions = sqliteTable(
  'finance_expense_positions',
  {
    id: text('id').primaryKey(),
    claimId: text('claim_id').notNull().references(() => financeExpenseClaims.id),
    sortOrder: integer('sort_order').notNull(),
    kind: text('kind', { enum: ['receipt', 'trip'] }).notNull(),
    positionDate: text('position_date'),
    amountCents: integer('amount_cents').notNull().default(0),
    /** „Wofür war das?“ — Freitext, nie im Protokoll. */
    purpose: text('purpose').notNull().default(''),
    projectId: text('project_id'),
    documentId: text('document_id'),
    documentNumber: text('document_number'),
    tripFrom: text('trip_from'),
    tripTo: text('trip_to'),
    tripReason: text('trip_reason'),
    tripKm: integer('trip_km'),
    tripRateCentsPerKm: integer('trip_rate_cents_per_km'),
    categoryId: text('category_id').references(() => financeCategories.id),
    purposeId: text('purpose_id').references(() => financePurposes.id),
  },
  (t) => [index('finance_expense_positions_claim_idx').on(t.claimId, t.sortOrder), index('finance_expense_positions_project_idx').on(t.projectId), index('finance_expense_positions_document_idx').on(t.documentId)],
);
export type FinanceExpensePositionRow = typeof financeExpensePositions.$inferSelect;

/** Der Zähler der Antragsnummern je Jahr des Einreichens — eine Nummer kommt nie wieder (Muster `finance_entry_counters`). */
export const financeExpenseCounters = sqliteTable('finance_expense_counters', {
  year: integer('year').primaryKey(),
  last: integer('last').notNull(),
});

/**
 * Die Anspruchsgrundlage einer Person für Aufwandsspenden (Spec 8.2) — sie
 * überschreibt `finance.expenseWaiverBasisText` und belegt den Antrag vor.
 * Arbeitsmaterial: Der Antrag trägt seine eigene Abschrift. Eine eigene ID
 * statt der Kontakt-ID als Schlüssel, weil die ID ins Änderungsprotokoll
 * geht und dort nie eine Kontakt-ID stehen darf (Spec 10.3); je Kontakt
 * höchstens eine Zeile. Text nie im Protokoll.
 */
export const financeContactWaiverTerms = sqliteTable(
  'finance_contact_waiver_terms',
  {
    id: text('id').primaryKey(),
    contactId: text('contact_id').notNull(),
    basisText: text('basis_text').notNull(),
    agreedOn: text('agreed_on').notNull(),
    updatedAt: text('updated_at').notNull(),
    updatedByUserId: text('updated_by_user_id').notNull(),
  },
  (t) => [uniqueIndex('finance_contact_waiver_terms_contact_idx').on(t.contactId)],
);
export type FinanceContactWaiverTermsRow = typeof financeContactWaiverTerms.$inferSelect;
