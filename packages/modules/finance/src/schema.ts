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
