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
    /**
     * Rechenschaft C (Spec § C, AEAO zu § 64 Nr. 17): „Für die Freigrenze“ — `notPerformance` (Zuschüsse, Darlehen,
     * Versicherungsleistungen) zählt nicht zu § 64 Abs. 3, `taxRefund` (erstattete USt) weder dort noch zu § 55.
     */
    thresholdExclusion: text('threshold_exclusion', { enum: ['none', 'notPerformance', 'taxRefund'] }).notNull().default('none'),
    /**
     * Jahresrechnung (0.4.5, St-L-9): Einnahmen über eine Spendenplattform — `confirmsItself` (die Plattform bestätigt
     * selbst, `bodyGrant`) bzw. `handlesOnly` (wickelt nur ab, `donation`). Öffentlich unter Geldspenden mit Unterzeile.
     */
    donationPlatform: text('donation_platform', { enum: ['confirmsItself', 'handlesOnly'] }),
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
    /** F8b Annahme 7: Begründung für das jüngste Wiederöffnen — Pflicht, nie im Protokoll. Ältere Begründungen stehen nur als Zeitpunkt im Protokoll. */
    reopenNote: text('reopen_note'),
    reopenedAt: text('reopened_at'),
    reopenedByUserId: text('reopened_by_user_id'),
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
    /** Wer prüfte — Mensch oder Agent (Befund 18, E10); leer, solange nicht geprüft oder nach Zurücknahme der Prüfung. */
    reviewedChannel: text('reviewed_channel'),
    finalizedAt: text('finalized_at'),
    finalizedByUserId: text('finalized_by_user_id'),
    finalizedChannel: text('finalized_channel'),
    reversesEntryId: text('reverses_entry_id'),
    reversedByEntryId: text('reversed_by_entry_id'),
    correctionOfEntryId: text('correction_of_entry_id'),
    /** Pflichtbegründung, wenn ein Storno ein Barkonto zeitweise ins Minus bringt; steht im Prüfpaket. */
    cashWarningReason: text('cash_warning_reason'),
    /** Befund AH: Pflichtbegründung, wenn eine Pauschale an ein Vorstandsmitglied ohne gültige Grundlage gebucht wird — am Datensatz, nie im Protokoll. */
    boardAllowanceReason: text('board_allowance_reason'),
    /** Befund Q: Pflichtbegründung, wenn die Buchung den Bestand eines Zwecks negativ macht — am Datensatz, nie im Protokoll. */
    purposeNegativeReason: text('purpose_negative_reason'),
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
    /** Nur bei `rc13bEu`, `rc13bOther` und `icAcquisition` von Bedeutung: voller (Vorgabe) oder ermäßigter Satz. */
    rateKind: text('rate_kind', { enum: ['standard', 'reduced'] }).notNull().default('standard'),
    /**
     * E6a: Leistungsdatum (beim Drittland das Rechnungsdatum), nur an § 13b-/Erwerbszeilen. Es bestimmt mit dem
     * Buchungstag die Entstehung der Steuer (`vatTaxPointOn`). Nach dem Festschreiben änderbar über die Zuordnungskorrektur.
     */
    serviceDate: text('service_date'),
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
    /** Rechenschaft D2: Grund, warum eine Erbschaft oder erhaltene Vermögensausstattung nicht dem Vermögen zugeführt wird (`ADDS_TO_ASSETS_OPT_OUTS`). */
    addsToAssetsOptOut: text('adds_to_assets_opt_out', { enum: ['testatorDirectedCurrentUse', 'donorAllowedCurrentUse'] }),
    /** Rechenschaft D2: erhaltene Vermögensausstattung (§ 58 Nr. 3 AO) — nur bei Zuwendungen anderer Organisationen mit Kontakt (Anlage Gem Zeile 69/70). */
    assetEndowment: integer('asset_endowment', { mode: 'boolean' }).notNull().default(false),
    /**
     * Plan L3: der Posten eines Einzugs, den diese Zeile bucht (Beitrag oder Rate) — so ist eine Rate „gebucht“, ein
     * Einzug gebucht, und eine Rückgabe nimmt genau diese Zeile zurück. Kein Fremdschlüssel wie bei `projectId`.
     */
    directDebitItemId: text('direct_debit_item_id'),
  },
  (t) => [
    index('finance_allocation_lines_entry_idx').on(t.entryId),
    index('finance_allocation_lines_direct_debit_item_idx').on(t.directDebitItemId),
    index('finance_allocation_lines_category_idx').on(t.categoryId),
    index('finance_allocation_lines_contact_idx').on(t.contactId),
    index('finance_allocation_lines_purpose_idx').on(t.purposeId),
    index('finance_allocation_lines_project_idx').on(t.projectId),
  ],
);
export type FinanceAllocationLineRow = typeof financeAllocationLines.$inferSelect;

/**
 * AC: „ist keine Rückgabe“ — eine festgeschriebene Auszahlung an eine Person,
 * die auch gespendet hat (Erstattung, Honorar), sperrt deren Bestätigung nicht
 * länger als möglicher Rückläufer. Die Begründung ist Freitext und steht
 * deshalb hier, nie im Protokoll. Aufheben kennzeichnet (`revokedAt`), statt
 * zu löschen; erneutes Setzen überschreibt die Zeile.
 */
export const financeNotReturnMarks = sqliteTable('finance_not_return_marks', {
  entryId: text('entry_id').primaryKey().references(() => financeEntries.id),
  note: text('note').notNull(),
  byUserId: text('by_user_id').notNull(),
  at: text('at').notNull(),
  revokedAt: text('revoked_at'),
  revokedByUserId: text('revoked_by_user_id'),
});
export type FinanceNotReturnMarkRow = typeof financeNotReturnMarks.$inferSelect;

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
    /** Befund Y: Pflichtbegründung, wenn der Posten zu einer wahrscheinlich schon bezahlten Rechnung angelegt wurde. Freitext, nie im Protokoll. */
    probablyPaidReason: text('probably_paid_reason'),
    createdByUserId: text('created_by_user_id').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [
    // Befund 3 (0.2.1): höchstens ein aktiver Posten je Dokument — die Vorabprüfung allein trägt nicht.
    uniqueIndex('finance_open_items_document_active_idx').on(t.documentId).where(sql`${t.documentId} is not null and ${t.cancelledAt} is null`),
    index('finance_open_items_kind_idx').on(t.kind), index('finance_open_items_origin_idx').on(t.originType, t.originId), index('finance_open_items_contact_idx').on(t.contactId),
  ],
);
export type FinanceOpenItemRow = typeof financeOpenItems.$inferSelect;

/**
 * Eine Geldzeile erledigt einen Posten ganz oder teilweise — Sammelüberweisung, Teil- und Überzahlung. Betrag immer > 0.
 * Ein **Rück-Ausgleich** (`reversesSettlementId` gesetzt, Spec Mitglieder und Lastschrift § 6.2) nimmt an der
 * Geldzeile einer Rückgabe einen festgeschriebenen Ausgleich ganz oder teilweise zurück: Die Richtung steht im
 * Verweis, nicht im Vorzeichen, und sein Betrag zählt vom Ausgeglichenen ab — der offene Rest wird berechnet, nie
 * gespeichert (`settledCentsFor`).
 */
export const financeOpenItemSettlements = sqliteTable(
  'finance_open_item_settlements',
  {
    id: text('id').primaryKey(),
    moneyLineId: text('money_line_id').notNull().references(() => financeMoneyLines.id),
    openItemId: text('open_item_id').notNull().references(() => financeOpenItems.id),
    amountCents: integer('amount_cents').notNull(),
    reversesSettlementId: text('reverses_settlement_id'),
  },
  (t) => [
    uniqueIndex('finance_open_item_settlements_pair_idx').on(t.moneyLineId, t.openItemId),
    index('finance_open_item_settlements_item_idx').on(t.openItemId),
    index('finance_open_item_settlements_reverses_idx').on(t.reversesSettlementId),
  ],
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
    /** Befund 7: warum ein Zweck durch diese Korrektur ins Minus geht — frei getippt, deshalb hier und nie im Protokoll. */
    purposeNegativeReason: text('purpose_negative_reason'),
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
    /** Prozesstest-Befund 5: JSON-Array bekannter Warncodes (bisher nur `futureDates`) — nie ein Ablehnungsgrund. */
    warnings: text('warnings'),
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
    /** Plan L3: `MndtId` einer Lastschrift oder ihrer Rückgabe — damit eine Rückgabe ihr Mandat sicher findet. Nur aus CAMT. */
    mandateReference: text('mandate_reference'),
    /** Plan L3: die Gläubiger-ID (`CdtrSchmeId`) einer Lastschrift. Nur aus CAMT. */
    creditorId: text('creditor_id'),
    /** AC: Bezug auf eine frühere Transaktion desselben Dienstes (PayPal „Zugehöriger Transaktionscode“) — bei einer Rückzahlung die Spende. Nur aus CSV. */
    relatedReference: text('related_reference'),
    /** AB: E-Mail der Gegenseite (PayPal „Absender E-Mail-Adresse“), klein geschrieben — personenbezogen wie Name und IBAN. Nur aus CSV. */
    counterpartyEmail: text('counterparty_email'),
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

/** Woher Kompass eine Zuordnung Kontakt ↔ IBAN kennt (Plan U4 Task 3): aus einem Umsatz gelernt, von Hand, aus einem Mandat. */
export const CONTACT_IBAN_SOURCES = ['learned', 'manual', 'mandate'] as const;
export type ContactIbanSourceKind = (typeof CONTACT_IBAN_SOURCES)[number];

/**
 * Kontakt ↔ IBAN (F5): gelernt aus Handlungen, nie rückwirkend. Arbeitsmaterial,
 * löschbar. Kein Fremdschlüssel: Kontakte gehören einem anderen Modul.
 * `source` und `learnedFromEntryDate` (Plan U4 Task 3): die Herkunft für die Liste am Kontakt; Zuordnungen von davor
 * haben keine (`null`). Von Hand: Person und Tag stehen in `createdByUserId`/`createdAt`.
 */
export const financeContactBankAccounts = sqliteTable(
  'finance_contact_bank_accounts',
  {
    id: text('id').primaryKey(),
    contactId: text('contact_id').notNull(),
    iban: text('iban').notNull(),
    createdAt: text('created_at').notNull(),
    createdByUserId: text('created_by_user_id').notNull(),
    source: text('source', { enum: CONTACT_IBAN_SOURCES }),
    /** Bei `learned`: der Tag des Umsatzes bzw. der Buchung, aus der Kompass die Zuordnung kennt. */
    learnedFromEntryDate: text('learned_from_entry_date'),
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
    /** Q Rest: Begründung der Freigabe, wenn „bezahlt aus“ einen Zweck ins Minus bringt — nie im Protokoll, danach unveränderlich. */
    purposeNegativeReason: text('purpose_negative_reason'),
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

// ── F7: Partner — Angaben, Zahlungen an Partner, Nachweise ─────────────────

/** Übliche Nachweisfrist eines Partners in Monaten, wenn nichts anderes gesagt ist — Spalte, Eingabe und Fristrechnung (Teil C Task 2d). */
export const DEFAULT_PROOF_MONTHS = 3;

/** Angaben zum Partner (Spec 8.1, Annahme 1) — eine Zeile je Kontakt. `note` ist Freitext, nie im Protokoll. */
export const financePartnerProfiles = sqliteTable(
  'finance_partner_profiles',
  {
    id: text('id').primaryKey(),
    contactId: text('contact_id').notNull(),
    status: text('status', { enum: ['taxExemptBody', 'foreignBody', 'publicBody', 'agent'] }).notNull(),
    usualBasis: text('usual_basis', { enum: ['transfer58', 'agent57'] }),
    /** Übliche Nachweisfrist in Monaten (Entscheidung 2, Design-Nachtrag Phase 4) — Vorgabe jeder Zahlung, dort übersteuerbar. */
    usualProofMonths: integer('usual_proof_months').notNull().default(DEFAULT_PROOF_MONTHS),
    registerDocumentId: text('register_document_id'),
    agreementDocumentId: text('agreement_document_id'),
    note: text('note'),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    createdAt: text('created_at').notNull(),
    createdByUserId: text('created_by_user_id').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [uniqueIndex('finance_partner_profiles_contact_idx').on(t.contactId)],
);
export type FinancePartnerProfileRow = typeof financePartnerProfiles.$inferSelect;

/** Empfängerbescheide des Partners (§ 58a AO, Annahme 2) — Reihe wie `finance_notices`, eigene Tabelle; bei `taxExemptBody` die deutschen Bescheide, bei `foreignBody` die Anerkennung im Sitzland (ohne Prüfwirkung). */
export const financePartnerNotices = sqliteTable(
  'finance_partner_notices',
  {
    id: text('id').primaryKey(),
    partnerId: text('partner_id').notNull().references(() => financePartnerProfiles.id),
    kind: text('kind', { enum: ['section60a', 'exemptionNotice', 'corporateTaxNoticeAttachment', 'recognitionAbroad'] }).notNull(),
    noticeDate: text('notice_date').notNull(),
    /** Nur `recognitionAbroad` (Entscheidung 3): „gültig bis“ steht auf der Anerkennung; die deutschen Bescheide rechnen es aus dem Datum. */
    validUntil: text('valid_until'),
    receivedOn: text('received_on').notNull(),
    documentId: text('document_id'),
    supersededOn: text('superseded_on'),
    voidedAt: text('voided_at'),
    voidedByUserId: text('voided_by_user_id'),
    voidNote: text('void_note'),
    createdAt: text('created_at').notNull(),
    createdByUserId: text('created_by_user_id').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [index('finance_partner_notices_partner_idx').on(t.partnerId, t.noticeDate)],
);
export type FinancePartnerNoticeRow = typeof financePartnerNotices.$inferSelect;

/**
 * Zahlung an Partner (Spec 8.1, Annahme 3) — Entwurf, Einreichen, Freigabe,
 * Ablehnen, Anerkennen der Nachweise. `purposeText`, `basisOverrideReason`,
 * `noticeReason`, `overdueReason`, `rejectNote` sind Freitext, nie im
 * Protokoll. Die Nummer entsteht erst beim Freigeben.
 */
export const financePartnerPayments = sqliteTable(
  'finance_partner_payments',
  {
    id: text('id').primaryKey(),
    number: text('number'),
    partnerId: text('partner_id').notNull().references(() => financePartnerProfiles.id),
    basis: text('basis', { enum: ['transfer58', 'agent57'] }).notNull(),
    basisOverridden: integer('basis_overridden', { mode: 'boolean' }).notNull().default(false),
    basisOverrideReason: text('basis_override_reason'),
    purposeText: text('purpose_text').notNull().default(''),
    agreementDocumentId: text('agreement_document_id'),
    proofDueOn: text('proof_due_on'),
    /** Nachweisfrist dieser Zahlung in Monaten; `null` im Entwurf heißt „übliche Frist des Partners“. Ab dem Einreichen fest. */
    proofMonths: integer('proof_months'),
    state: text('state', { enum: ['draft', 'submitted', 'approved', 'rejected'] }).notNull().default('draft'),
    retroactive: integer('retroactive', { mode: 'boolean' }).notNull().default(false),
    submittedAt: text('submitted_at'),
    approvedByUserId: text('approved_by_user_id'),
    approvedAt: text('approved_at'),
    approvedChannel: text('approved_channel'),
    openItemId: text('open_item_id').references(() => financeOpenItems.id),
    acknowledgedByUserId: text('acknowledged_by_user_id'),
    acknowledgedAt: text('acknowledged_at'),
    acknowledgedChannel: text('acknowledged_channel'),
    noticeReason: text('notice_reason'),
    overdueReason: text('overdue_reason'),
    /** Befund Q: Pflichtbegründung beim Einreichen, wenn die Zahlung den Bestand eines Zwecks negativ machte. */
    purposeNegativeReason: text('purpose_negative_reason'),
    rejectedByUserId: text('rejected_by_user_id'),
    rejectedAt: text('rejected_at'),
    rejectNote: text('reject_note'),
    copiedFromPaymentId: text('copied_from_payment_id').references((): AnySQLiteColumn => financePartnerPayments.id),
    /** Rechenschaft D2: Mittel zur Vermögensausstattung (§ 58 Nr. 3 AO) — nur `transfer58` an steuerbegünstigte oder öffentliche Körperschaften; ab dem Einreichen fest. */
    assetEndowment: integer('asset_endowment', { mode: 'boolean' }).notNull().default(false),
    /** G7: Beschluss eines anderen Moduls (Gremien, `governanceResolution`), der die Zahlung trägt; ohne Fremdschlüssel. */
    resolutionId: text('resolution_id'),
    createdByUserId: text('created_by_user_id').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [
    uniqueIndex('finance_partner_payments_number_idx').on(t.number),
    index('finance_partner_payments_partner_idx').on(t.partnerId),
    index('finance_partner_payments_state_idx').on(t.state, t.submittedAt),
  ],
);
export type FinancePartnerPaymentRow = typeof financePartnerPayments.$inferSelect;

/** Positionen der Zahlung: Geld oder Sachen (Annahme 4). Bei Sachen zeigt `goodsLineId` auf die festgeschriebene Ausgabe-Zuordnungszeile des Einkaufs. */
export const financePartnerPaymentPositions = sqliteTable(
  'finance_partner_payment_positions',
  {
    id: text('id').primaryKey(),
    paymentId: text('payment_id').notNull().references(() => financePartnerPayments.id),
    sortOrder: integer('sort_order').notNull(),
    kind: text('kind', { enum: ['money', 'goods'] }).notNull(),
    amountCents: integer('amount_cents'),
    categoryId: text('category_id').references(() => financeCategories.id),
    purposeId: text('purpose_id').references(() => financePurposes.id),
    projectId: text('project_id'),
    goodsLineId: text('goods_line_id').references(() => financeAllocationLines.id),
    note: text('note'),
  },
  (t) => [index('finance_partner_payment_positions_payment_idx').on(t.paymentId, t.sortOrder)],
);
export type FinancePartnerPaymentPositionRow = typeof financePartnerPaymentPositions.$inferSelect;

/** Bei nachträglicher Freigabe: die bezahlten, festgeschriebenen Zeilen des Partners, im Entwurf gewählt (Annahme 4). `paidLineId` UNIQUE gegen Doppelzuordnung. */
export const financePartnerPaidLines = sqliteTable(
  'finance_partner_paid_lines',
  {
    id: text('id').primaryKey(),
    paymentId: text('payment_id').notNull().references(() => financePartnerPayments.id),
    paidLineId: text('paid_line_id').notNull().references(() => financeAllocationLines.id),
    createdAt: text('created_at').notNull(),
  },
  (t) => [uniqueIndex('finance_partner_paid_lines_paid_line_idx').on(t.paidLineId), index('finance_partner_paid_lines_payment_idx').on(t.paymentId)],
);
export type FinancePartnerPaidLineRow = typeof financePartnerPaidLines.$inferSelect;

/**
 * Nachweise am Vorgang (Annahme 9) — `explanationDe` Pflicht bei `foreignLanguage`, nie im Protokoll; `documentId` nullable für den Grabstein.
 * `assignment` und `photo` sind Altarten (vor Spec 14.4): nie mehr angelegt, gelesen über `normalizeEvidenceKind`.
 */
export const financePartnerEvidence = sqliteTable(
  'finance_partner_evidence',
  {
    id: text('id').primaryKey(),
    paymentId: text('payment_id').notNull().references(() => financePartnerPayments.id),
    kind: text('kind', { enum: ['assignment', 'agreement', 'paymentProof', 'recipientReceipt', 'invoice', 'report', 'photo', 'settlement'] }).notNull(),
    documentId: text('document_id'),
    foreignLanguage: integer('foreign_language', { mode: 'boolean' }).notNull().default(false),
    explanationDe: text('explanation_de'),
    coveredCents: integer('covered_cents'),
    addedByUserId: text('added_by_user_id').notNull(),
    addedAt: text('added_at').notNull(),
  },
  (t) => [index('finance_partner_evidence_payment_idx').on(t.paymentId)],
);
export type FinancePartnerEvidenceRow = typeof financePartnerEvidence.$inferSelect;

/** Der Zähler der Vorgangsnummern je Jahr der Freigabe (Muster `finance_expense_counters`). */
export const financePartnerPaymentCounters = sqliteTable('finance_partner_payment_counters', {
  year: integer('year').primaryKey(),
  last: integer('last').notNull(),
});

// ── F8b: Zwecke, zurückgelegtes Geld (Rücklagen), Zweck ändern (Umwidmung) ──

/**
 * Zurückgelegtes Geld (F8b Annahme 1, § 62 Abs. 1 Nr. 1–4 AO) — ein
 * Stammsatz. Löschbar nur ohne Vorgänge und ohne Vortrag (sonst
 * stilllegen). `resolutionDocumentId` ist beim Anlegen Pflicht (Dienst), die
 * Spalte bleibt nullable für den Grabstein nach Ablauf der Dokumentfrist;
 * dasselbe gilt für `carryForwardDocumentId`. Vortrag-Felder stehen immer
 * alle drei oder keins.
 */
export const financeReserves = sqliteTable(
  'finance_reserves',
  {
    id: text('id').primaryKey(),
    // Dieselbe Liste wie `RESERVE_KINDS` (`allocation/reserve-rules.ts`; der neutrale Boden importiert keinen Bereich, ein Test vergleicht beide).
    kind: text('kind', { enum: ['projectFunds', 'replacement', 'free', 'participation', 'business', 'assetManagement'] }).notNull(),
    name: text('name').notNull(),
    /** Pflicht bei `projectFunds`/`replacement` (Dienst) — der Verwendungszweck im Wortlaut, nie im Protokoll; bei `business`/`assetManagement` die Begründung (wofür im Betrieb, M1). */
    purposeText: text('purpose_text'),
    purposeId: text('purpose_id').references(() => financePurposes.id),
    resolutionDocumentId: text('resolution_document_id'),
    /** G7: der Beschluss in Gremien (`governanceResolution`), neben oder statt des Dokuments; geprüft über `resolveRecordLabel`. */
    resolutionId: text('resolution_id'),
    carryForwardCents: integer('carry_forward_cents'),
    carryForwardDate: text('carry_forward_date'),
    carryForwardDocumentId: text('carry_forward_document_id'),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    createdByUserId: text('created_by_user_id').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [index('finance_reserves_purpose_idx').on(t.purposeId), index('finance_reserves_active_idx').on(t.isActive)],
);
export type FinanceReserveRow = typeof financeReserves.$inferSelect;

/**
 * Ein Vorgang an zurückgelegtem Geld (F8b Annahme 2) — unveränderlich, nie
 * gelöscht. `forFiscalYearId` nur bei `allocate` in einer freien Rücklage:
 * das Geschäftsjahr, für das zugeführt wird (§ 62 Abs. 2 AO, der Beschluss
 * kommt oft erst im Folgejahr); bei `projectFunds`/`replacement`/`participation`
 * nur für eine nachträgliche Bildung aus Mitteln eines früheren Jahres (bis Ende
 * des zweiten Folgejahres, M1) — sonst null. `resolutionDocumentId` ist beim Anlegen
 * Pflicht (Dienst), die Spalte bleibt nullable für den Grabstein. Bewegt nie
 * ein Bankkonto oder eine Kasse und erscheint nie in der EÜR.
 */
export const financeReserveMovements = sqliteTable(
  'finance_reserve_movements',
  {
    id: text('id').primaryKey(),
    reserveId: text('reserve_id').notNull().references(() => financeReserves.id),
    kind: text('kind', { enum: ['allocate', 'withdraw', 'dissolve'] }).notNull(),
    movementDate: text('movement_date').notNull(),
    amountCents: integer('amount_cents').notNull(),
    forFiscalYearId: text('for_fiscal_year_id').references(() => financeFiscalYears.id),
    resolutionDocumentId: text('resolution_document_id'),
    /** Frei getippt — steht hier, nie im Protokoll. */
    note: text('note'),
    /** Befund S: Pflichtbegründung, wenn eine Zuführung zur freien Rücklage den Höchstbetrag des Jahres überschreitet. */
    capReason: text('cap_reason'),
    createdByUserId: text('created_by_user_id').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [index('finance_reserve_movements_reserve_idx').on(t.reserveId, t.movementDate), index('finance_reserve_movements_year_idx').on(t.forFiscalYearId)],
);
export type FinanceReserveMovementRow = typeof financeReserveMovements.$inferSelect;

/**
 * Anfangsvortrag der Mittelverwendung je Entstehungsjahr (M1, Spec 0.4.5 Teil M, Prüfung L-4): was aus den zwei Jahren
 * vor dem ersten Kompass-Jahr noch zeitnah zu verwenden war, mit der Einnahmensumme jenes Jahres (Kompass prüft die
 * damalige Grenze). Nie gelöscht (Trigger); geändert nur, solange das erste Geschäftsjahr offen ist. `documentId` ist im
 * Dienst Pflicht, die Spalte bleibt nullable für den Grabstein nach Ablauf der Dokumentfrist.
 */
export const financeFundsUseOpenings = sqliteTable(
  'finance_funds_use_openings',
  {
    id: text('id').primaryKey(),
    /** 1 = Jahr vor dem ersten Kompass-Jahr, 2 = das davor. */
    offset: integer('offset').notNull(),
    designation: text('designation').notNull(),
    endsOn: text('ends_on').notNull(),
    revenueCents: integer('revenue_cents').notNull(),
    amountCents: integer('amount_cents').notNull(),
    documentId: text('document_id'),
    createdByUserId: text('created_by_user_id').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [uniqueIndex('finance_funds_use_openings_offset_idx').on(t.offset)],
);
export type FinanceFundsUseOpeningRow = typeof financeFundsUseOpenings.$inferSelect;

/**
 * Zweck ändern (Umwidmung, F8b Annahme 5) — ohne Entwurf: entsteht direkt als
 * `submitted` mit Nummer. `fromPurposeId`/`toPurposeId` `null` = freie
 * Mittel (nicht beide `null`). `documentId` ist beim Anlegen Pflicht
 * (Dienst), die Spalte bleibt nullable für den Grabstein. `reason` ist
 * Freitext, nie im Protokoll. Bewegt nie ein Bankkonto oder eine Kasse und
 * erscheint nie in der EÜR.
 */
export const financePurposeTransfers = sqliteTable(
  'finance_purpose_transfers',
  {
    id: text('id').primaryKey(),
    number: text('number').notNull(),
    fromPurposeId: text('from_purpose_id').references(() => financePurposes.id),
    toPurposeId: text('to_purpose_id').references(() => financePurposes.id),
    amountCents: integer('amount_cents').notNull(),
    transferDate: text('transfer_date').notNull(),
    /** Frei getippt — steht hier, nie im Protokoll. */
    reason: text('reason').notNull(),
    documentId: text('document_id'),
    state: text('state', { enum: ['submitted', 'approved', 'rejected'] }).notNull().default('submitted'),
    createdByUserId: text('created_by_user_id').notNull(),
    createdAt: text('created_at').notNull(),
    approvedByUserId: text('approved_by_user_id'),
    approvedAt: text('approved_at'),
    approvedChannel: text('approved_channel'),
    rejectedByUserId: text('rejected_by_user_id'),
    rejectedAt: text('rejected_at'),
    /** Frei getippt — steht hier, nie im Protokoll. */
    rejectNote: text('reject_note'),
  },
  (t) => [
    uniqueIndex('finance_purpose_transfers_number_idx').on(t.number),
    index('finance_purpose_transfers_from_idx').on(t.fromPurposeId),
    index('finance_purpose_transfers_to_idx').on(t.toPurposeId),
    index('finance_purpose_transfers_state_idx').on(t.state, t.createdAt),
  ],
);
export type FinancePurposeTransferRow = typeof financePurposeTransfers.$inferSelect;

/** Der Zähler der Umwidmungsnummern je Jahr des Anlegens (Muster `finance_partner_payment_counters`). */
export const financePurposeTransferCounters = sqliteTable('finance_purpose_transfer_counters', {
  year: integer('year').primaryKey(),
  last: integer('last').notNull(),
});
export type FinancePurposeTransferCounterRow = typeof financePurposeTransferCounters.$inferSelect;

// ── Lastschrift (Plan L1, Spec Mitglieder und Lastschrift § 7.2, § 7.3) ─────────────────────────────────────────────

export const MANDATE_SEQUENCES = ['recurring', 'oneOff'] as const;
export const MANDATE_END_REASONS = ['debtor', 'creditor', 'superseded', 'returned'] as const;
export type MandateEndReason = (typeof MANDATE_END_REASONS)[number];
export const MANDATE_CHANGE_FIELDS = ['iban', 'debtorName', 'bic'] as const;
export type MandateChangeField = (typeof MANDATE_CHANGE_FIELDS)[number];

/** Der Änderungshinweis für den nächsten Einzug (`AmdmntInd`, `OrgnlDbtrAcct` bzw. `OrgnlMndtId`); L2 liest und quittiert ihn. */
export interface PendingAmendment {
  originalIban?: string;
  originalReference?: string;
  since: string;
}

/**
 * Ein SEPA-Mandat (Spec § 7.2). Gehört dem Kontakt, der zahlt (`contactId`, ohne Fremdschlüssel: Kontakte gehören einem
 * anderen Modul) — nicht zwingend dem Mitglied. Der Zustand (vorbereitet, aktiv, beendet, verfallen) wird berechnet
 * (`direct-debit/mandates.ts`), nie gespeichert. Die Referenz kommt aus dem Zähler und wird nie wiederverwendet.
 */
export const financeSepaMandates = sqliteTable(
  'finance_sepa_mandates',
  {
    id: text('id').primaryKey(),
    contactId: text('contact_id').notNull(),
    reference: text('reference').notNull(),
    /** Kontoinhaber, kann vom Kontakt abweichen (höchstens 70 Zeichen). */
    debtorName: text('debtor_name').notNull(),
    iban: text('iban').notNull(),
    bic: text('bic'),
    sequence: text('sequence', { enum: MANDATE_SEQUENCES }).notNull().default('recurring'),
    preparedOn: text('prepared_on').notNull(),
    signedOn: text('signed_on'),
    /** Das unterschriebene Mandat in der Akte. */
    signedDocumentId: text('signed_document_id'),
    endedOn: text('ended_on'),
    endReason: text('end_reason', { enum: MANDATE_END_REASONS }),
    /** Setzt L2 mit jedem gebuchten Einzug; Maßstab für den Verfall nach 36 Monaten. */
    lastCollectedOn: text('last_collected_on'),
    pendingAmendment: text('pending_amendment', { mode: 'json' }).$type<PendingAmendment>(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [uniqueIndex('finance_sepa_mandates_reference_idx').on(t.reference), index('finance_sepa_mandates_contact_idx').on(t.contactId)],
);
export type FinanceSepaMandateRow = typeof financeSepaMandates.$inferSelect;

/** Verlauf von IBAN, Kontoinhaber und BIC eines unterschriebenen Mandats (Spec § 7.2). */
export const financeSepaMandateChanges = sqliteTable(
  'finance_sepa_mandate_changes',
  {
    id: text('id').primaryKey(),
    mandateId: text('mandate_id')
      .notNull()
      .references(() => financeSepaMandates.id),
    field: text('field', { enum: MANDATE_CHANGE_FIELDS }).notNull(),
    before: text('before'),
    after: text('after'),
    validFrom: text('valid_from').notNull(),
    createdAt: text('created_at').notNull(),
    createdByUserId: text('created_by_user_id').notNull(),
  },
  (t) => [index('finance_sepa_mandate_changes_mandate_idx').on(t.mandateId, t.validFrom)],
);
export type FinanceSepaMandateChangeRow = typeof financeSepaMandateChanges.$inferSelect;

/** Der Zähler der Mandatsreferenzen, eine Zeile `id = 'mandate'` — eigene Tabelle, damit keine Nummer wiederkommt. */
export const financeSepaCounter = sqliteTable('finance_sepa_counter', {
  id: text('id').primaryKey(),
  last: integer('last').notNull(),
});

export const PLEDGE_INTERVALS = ['monthly', 'quarterly', 'halfYearly', 'yearly'] as const;
export type PledgeInterval = (typeof PLEDGE_INTERVALS)[number];
export const PLEDGE_PAYMENT_METHODS = ['directDebit', 'transfer', 'standingOrder'] as const;
export type PledgePaymentMethod = (typeof PLEDGE_PAYMENT_METHODS)[number];

/**
 * Eine Dauerspenden-Zusage (Spec § 7.3). Erzeugt nie einen offenen Posten: Eine Spende ist keine Forderung. Die Raten
 * werden berechnet (`direct-debit/rates.ts`); gespeichert ist nur, was entschieden wurde (`finance_pledge_rate_marks`).
 */
export const financePledges = sqliteTable(
  'finance_pledges',
  {
    id: text('id').primaryKey(),
    contactId: text('contact_id').notNull(),
    amountCents: integer('amount_cents').notNull(),
    interval: text('interval', { enum: PLEDGE_INTERVALS }).notNull(),
    firstDueOn: text('first_due_on').notNull(),
    lastDueOn: text('last_due_on'),
    paymentMethod: text('payment_method', { enum: PLEDGE_PAYMENT_METHODS }).notNull(),
    mandateId: text('mandate_id').references(() => financeSepaMandates.id),
    purposeId: text('purpose_id').references(() => financePurposes.id),
    projectId: text('project_id'),
    pausedFrom: text('paused_from'),
    pausedUntil: text('paused_until'),
    endedOn: text('ended_on'),
    /** Frei getippt — steht hier, nie im Protokoll. */
    note: text('note'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [index('finance_pledges_contact_idx').on(t.contactId), index('finance_pledges_mandate_idx').on(t.mandateId)],
);
export type FinancePledgeRow = typeof financePledges.$inferSelect;

/** `notAnnounced` (Plan N1, M14): die Rate lag beim Anlegen der Zusage schon innerhalb der Frist der Vorabankündigung. */
export const PLEDGE_RATE_MARK_REASONS = ['paused', 'waivedAfterReturn', 'notAnnounced'] as const;

/** Eine ausgelassene Rate — die einzige gespeicherte Ratenangabe, weil sie eine Entscheidung ist. */
export const financePledgeRateMarks = sqliteTable(
  'finance_pledge_rate_marks',
  {
    id: text('id').primaryKey(),
    pledgeId: text('pledge_id')
      .notNull()
      .references(() => financePledges.id),
    dueOn: text('due_on').notNull(),
    mark: text('mark', { enum: ['skipped'] }).notNull(),
    reason: text('reason', { enum: PLEDGE_RATE_MARK_REASONS }).notNull(),
  },
  (t) => [uniqueIndex('finance_pledge_rate_marks_rate_idx').on(t.pledgeId, t.dueOn)],
);
export type FinancePledgeRateMarkRow = typeof financePledgeRateMarks.$inferSelect;

// ── Einzug (Plan L2, Spec Mitglieder und Lastschrift § 7.4, § 7.5) ──────────────────────────────────────────────────

/** `booked` und `expired` (Plan N1, M41: nie eingereicht, Einreichfenster vorbei) werden berechnet, nie gespeichert. */
export const DIRECT_DEBIT_RUN_STATUSES = ['draft', 'fileCreated', 'submitted', 'booked', 'expired', 'cancelled'] as const;
export type DirectDebitRunStatus = (typeof DIRECT_DEBIT_RUN_STATUSES)[number];
export const DIRECT_DEBIT_SOURCES = ['openItem', 'pledge'] as const;
export type DirectDebitSource = (typeof DIRECT_DEBIT_SOURCES)[number];

/**
 * Ein Einzug zu einem Fälligkeitstag (Spec § 7.4). Der Zustand ist gespeichert, weil er die Schritte eines Vorgangs
 * festhält (Datei erzeugt, eingereicht, storniert), keine abgeleitete Größe; Summen werden berechnet. „Gebucht“ ist
 * berechnet (L3 Nacharbeit, `runStatusInternal`): gespeichert endet der Zustand bei `submitted`. Die Sequenz
 * (`RCUR`/`OOFF`) steht am Mandat — ein Einzug kann beide tragen, die Datei hat dann je eine Gruppe.
 */
export const financeDirectDebitRuns = sqliteTable(
  'finance_direct_debit_runs',
  {
    id: text('id').primaryKey(),
    collectionDate: text('collection_date').notNull(),
    accountId: text('account_id')
      .notNull()
      .references(() => financeAccounts.id),
    status: text('status', { enum: DIRECT_DEBIT_RUN_STATUSES }).notNull(),
    /** `MsgId` der Datei: eindeutig, höchstens 35 Zeichen aus dem SEPA-Zeichensatz. */
    messageId: text('message_id').notNull(),
    fileName: text('file_name'),
    fileCreatedAt: text('file_created_at'),
    fileCreatedByUserId: text('file_created_by_user_id'),
    /** M15: je Mandat der Stand (Prüfsumme von IBAN, BIC, Name, Änderungshinweis), mit dem die Datei entstand. */
    fileMandates: text('file_mandates', { mode: 'json' }).$type<Record<string, string>>(),
    submittedOn: text('submitted_on'),
    submittedByUserId: text('submitted_by_user_id'),
    cancelledAt: text('cancelled_at'),
    cancelledByUserId: text('cancelled_by_user_id'),
    /** Der Begleitzettel in der Akte (Art `sepa-run-summary`). */
    summaryDocumentId: text('summary_document_id'),
    createdByUserId: text('created_by_user_id').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [uniqueIndex('finance_direct_debit_runs_message_idx').on(t.messageId), index('finance_direct_debit_runs_date_idx').on(t.collectionDate)],
);
export type FinanceDirectDebitRunRow = typeof financeDirectDebitRuns.$inferSelect;

/**
 * Ein Posten eines Einzugs: ein offener Posten (Beitrag) oder eine Rate einer Zusage (`installmentOn`). Herausgenommen
 * wird er über `removedAt`, nie gelöscht. Dass ein Posten in höchstens einem nicht stornierten Einzug steckt, prüft der
 * Dienst — SQLite kennt keinen Index über den Zustand des Laufs.
 */
export const financeDirectDebitItems = sqliteTable(
  'finance_direct_debit_items',
  {
    id: text('id').primaryKey(),
    runId: text('run_id')
      .notNull()
      .references(() => financeDirectDebitRuns.id),
    mandateId: text('mandate_id')
      .notNull()
      .references(() => financeSepaMandates.id),
    source: text('source', { enum: DIRECT_DEBIT_SOURCES }).notNull(),
    /** Der offene Posten bzw. die Zusage. */
    sourceId: text('source_id').notNull(),
    /** Nur bei einer Zusage: der Tag der Rate. */
    installmentOn: text('installment_on'),
    amountCents: integer('amount_cents').notNull(),
    endToEndId: text('end_to_end_id').notNull(),
    /** Verwendungszweck (höchstens 140 Zeichen). */
    remittance: text('remittance').notNull(),
    /** Der Änderungshinweis des Mandats, übernommen beim Anlegen (erste Zeile je Mandat). */
    amendment: text('amendment', { mode: 'json' }).$type<PendingAmendment>(),
    removedAt: text('removed_at'),
    removedByUserId: text('removed_by_user_id'),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    uniqueIndex('finance_direct_debit_items_e2e_idx').on(t.endToEndId),
    index('finance_direct_debit_items_run_idx').on(t.runId),
    index('finance_direct_debit_items_source_idx').on(t.source, t.sourceId),
    index('finance_direct_debit_items_mandate_idx').on(t.mandateId),
  ],
);
export type FinanceDirectDebitItemRow = typeof financeDirectDebitItems.$inferSelect;

export const DIRECT_DEBIT_RETURN_STATUSES = ['open', 'resolved'] as const;
export type DirectDebitReturnStatus = (typeof DIRECT_DEBIT_RETURN_STATUSES)[number];
/** `alreadyPaid` (U4, Plan N3): der Beitrag war inzwischen anders bezahlt — nichts mehr zu tun. */
export const DIRECT_DEBIT_RETURN_RESOLUTIONS = ['recollect', 'requestTransfer', 'waive', 'alreadyPaid'] as const;
export type DirectDebitReturnResolution = (typeof DIRECT_DEBIT_RETURN_RESOLUTIONS)[number];

/**
 * Eine Rücklastschrift als Fall (Plan L3, Spec § 7.7): Sie entsteht, wenn die Buchung der Rückgabe festgeschrieben
 * wird, und ist offen, bis „Rückgabe klären“ den Weg entscheidet. Gespeichert, weil „geklärt“ eine Entscheidung ist —
 * Rückgabe-Code und Gebühr stehen hier, nie im Änderungsprotokoll als Satz.
 */
export const financeDirectDebitReturns = sqliteTable(
  'finance_direct_debit_returns',
  {
    id: text('id').primaryKey(),
    itemId: text('item_id')
      .notNull()
      .references(() => financeDirectDebitItems.id),
    rawTransactionId: text('raw_transaction_id').notNull(),
    /** Die festgeschriebene Buchung der Rückgabe. */
    entryId: text('entry_id').notNull(),
    returnCode: text('return_code'),
    /** Das Rückgabeentgelt der Bank, als eigene Zeile gebucht; wird nicht weiterberechnet. */
    feeCents: integer('fee_cents').notNull().default(0),
    status: text('status', { enum: DIRECT_DEBIT_RETURN_STATUSES }).notNull(),
    resolution: text('resolution', { enum: DIRECT_DEBIT_RETURN_RESOLUTIONS }),
    mandateEnded: integer('mandate_ended', { mode: 'boolean' }).notNull().default(false),
    resolvedAt: text('resolved_at'),
    resolvedByUserId: text('resolved_by_user_id'),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    uniqueIndex('finance_direct_debit_returns_raw_item_idx').on(t.rawTransactionId, t.itemId),
    index('finance_direct_debit_returns_item_idx').on(t.itemId),
    index('finance_direct_debit_returns_status_idx').on(t.status),
  ],
);
export type FinanceDirectDebitReturnRow = typeof financeDirectDebitReturns.$inferSelect;

/** Ein angekündigter Einzug: Tag und Betrag. */
export interface PrenotificationPlanEntry {
  dueOn: string;
  amountCents: number;
  /** R11: wofür (Verwendungszweck); fehlt bei Ankündigungen ohne Bezug, etwa älteren. */
  remittance?: string;
}

/**
 * Eine Vorabankündigung (Spec § 7.5): welches Dokument welche Einzüge eines Mandats ankündigt. Der abgedeckte Zeitraum
 * folgt aus dem Plan, der Tag der Ankündigung aus dem Dokument (Datum des festgeschriebenen Briefs) — beides wird nicht
 * gespeichert. Die Zeile entsteht auch schon zum Entwurf (`savePledge`); sie deckt erst, wenn der Brief festgeschrieben ist.
 */
export const financeSepaPrenotifications = sqliteTable(
  'finance_sepa_prenotifications',
  {
    id: text('id').primaryKey(),
    mandateId: text('mandate_id')
      .notNull()
      .references(() => financeSepaMandates.id),
    documentId: text('document_id').notNull(),
    plan: text('plan', { mode: 'json' }).$type<PrenotificationPlanEntry[]>().notNull(),
    createdByUserId: text('created_by_user_id').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [index('finance_sepa_prenotifications_mandate_idx').on(t.mandateId)],
);
export type FinanceSepaPrenotificationRow = typeof financeSepaPrenotifications.$inferSelect;

// ── Rechenschaft A1: festgeschriebene Berichte (Spec Rechenschaft 0.4.0 § A) ──

/**
 * Eine festgeschriebene Fassung eines Berichts. Kein Summenwert (Prinzip 5): nur der Bericht, seine Parameter
 * (kanonisches JSON), der Daten-Hash und das Dokument der Akte. Stornieren setzt `voided_at` — beim Wiederöffnen
 * eines Jahres oder wenn eine neue Fassung mit anderem Datenstand sie ersetzt (`replaced_by_report_id`); das
 * Dokument bleibt lesbar.
 */
export const financeReports = sqliteTable(
  'finance_reports',
  {
    id: text('id').primaryKey(),
    reportKey: text('report_key').notNull(),
    /** `ReportParams` als kanonisches JSON (`canonicalJson`) — gleiche Parameter, gleicher Text. */
    params: text('params').notNull(),
    /** Das jüngste betroffene Geschäftsjahr. */
    fiscalYearId: text('fiscal_year_id').notNull().references(() => financeFiscalYears.id),
    dataHash: text('data_hash').notNull(),
    documentId: text('document_id').notNull(),
    documentNumber: text('document_number').notNull(),
    /** Grundlage der Freigabe des Jahres beim Festschreiben, `null` ohne (Gruppe Finanzamt). */
    releaseBasis: text('release_basis', { enum: ['auditReport', 'noAuditProvided', 'oralReport', 'singleAuditor', 'notAudited', 'other'] }),
    finalizedAt: text('finalized_at').notNull(),
    finalizedByUserId: text('finalized_by_user_id').notNull(),
    voidedAt: text('voided_at'),
    /** Begründung des Stornos — nie im Änderungsprotokoll. */
    voidReason: text('void_reason'),
    replacedByReportId: text('replaced_by_report_id').references((): AnySQLiteColumn => financeReports.id),
    /**
     * Jahresrechnung (0.4.5, Planreview J1): eine beim Festschreiben verlangte Bestätigung als JSON
     * (`{ code, reason, note }`, z. B. Vergütung an den Vorstand ohne Grundlage) — unveränderlich, nie im PDF; der
     * Freitext nie im Protokoll.
     */
    finalizeConfirmation: text('finalize_confirmation'),
  },
  (t) => [index('finance_reports_year_idx').on(t.fiscalYearId), index('finance_reports_key_params_idx').on(t.reportKey, t.params)],
);
export type FinanceReportRow = typeof financeReports.$inferSelect;

/**
 * Die Freigabe der Berichte eines Jahres zum Festschreiben (Spec § A „Festschreiben erst nach der Kassenprüfung“):
 * der abgelegte Prüfbericht (D1) oder eine bestätigte Begründung. Je Jahr eine Zeile; Wiederöffnen widerruft sie
 * (`revoked_at`), eine neue Freigabe setzt die Zeile neu. Die Geschichte steht im Änderungsprotokoll.
 */
export const financeReportReleases = sqliteTable('finance_report_releases', {
  fiscalYearId: text('fiscal_year_id').primaryKey().references(() => financeFiscalYears.id),
  basis: text('basis', { enum: ['auditReport', 'noAuditProvided', 'oralReport', 'singleAuditor', 'notAudited', 'other'] }).notNull(),
  /** Freitext zur Begründung (Pflicht bei `other`) — nie im Änderungsprotokoll. */
  note: text('note'),
  documentId: text('document_id'),
  at: text('at').notNull(),
  byUserId: text('by_user_id').notNull(),
  revokedAt: text('revoked_at'),
  revokedByUserId: text('revoked_by_user_id'),
});
export type FinanceReportReleaseRow = typeof financeReportReleases.$inferSelect;

/**
 * Rechenschaft A2 (Spec 0.4.0 § Kernberichte, Designer Runde 2 11d–11h): sonstige Vermögensgegenstände und
 * Verpflichtungen von Hand — Sachwerte, Inventar, Darlehen, Kautionen —, bis es ein Anlagenverzeichnis gibt.
 * Gültig von `recorded_from` bis einschließlich `recorded_until` („der letzte Tag, an dem er dem Verein gehörte“).
 * „Neuer Wert ab …“ beendet den Eintrag am Vortag und legt einen Nachfolger an (`replaced_by_id`); der Vorgänger
 * eines Eintrags wird darüber rückwärts gelesen. Bezeichnung, Grundlage und Grund sind frei getippt — sie stehen hier,
 * nie im Änderungsprotokoll. Nie gelöscht.
 */
export const financeOtherAssets = sqliteTable(
  'finance_other_assets',
  {
    id: text('id').primaryKey(),
    kind: text('kind', { enum: ['asset', 'liability'] }).notNull(),
    label: text('label').notNull(),
    valueCents: integer('value_cents').notNull(),
    basis: text('basis').notNull(),
    recordedFrom: text('recorded_from').notNull(),
    recordedUntil: text('recorded_until'),
    endReason: text('end_reason'),
    replacedById: text('replaced_by_id'),
    documentId: text('document_id'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [index('finance_other_assets_from_idx').on(t.recordedFrom), index('finance_other_assets_replaced_by_idx').on(t.replacedById)],
);
export type FinanceOtherAssetRow = typeof financeOtherAssets.$inferSelect;

/**
 * Rechenschaft D1 (Spec 0.4.0 § D1 „Prüfer je Jahr“): wer das Geschäftsjahr prüft — ein Kontakt je Zeile, „in Kompass“
 * (verknüpfter Nutzer mit Prüferrolle) oder „auf Papier“. Wahl, Protokoll und Vertraulichkeit sind Einträge, keine
 * Organverwaltung. `access_ended_*`: wann jemand den Zugang beendet hat (die Rolle entzogen, Designer 12h). Ausgetragen
 * wird nur, solange keine Arbeit daran hängt; dann verschwindet die Zeile (Protokoll `finance.audit.auditor.remove`).
 */
export const financeAuditAuditors = sqliteTable(
  'finance_audit_auditors',
  {
    id: text('id').primaryKey(),
    fiscalYearId: text('fiscal_year_id').notNull().references(() => financeFiscalYears.id),
    /** Kein Fremdschlüssel: Kontakte gehören einem anderen Modul; das Protokoll nennt nie diese ID. */
    contactId: text('contact_id').notNull(),
    mode: text('mode', { enum: ['kompass', 'paper'] }).notNull(),
    confidential: integer('confidential', { mode: 'boolean' }).notNull().default(false),
    confidentialityDocumentId: text('confidentiality_document_id'),
    electedOn: text('elected_on'),
    minutesDocumentId: text('minutes_document_id'),
    accessEndedAt: text('access_ended_at'),
    accessEndedByUserId: text('access_ended_by_user_id'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [uniqueIndex('finance_audit_auditors_year_contact_idx').on(t.fiscalYearId, t.contactId)],
);
export type FinanceAuditAuditorRow = typeof financeAuditAuditors.$inferSelect;

/**
 * Rechenschaft D1 „Prüfstand“: was beim Abschluss geprüft wird — Zeitpunkt, je Bericht der Gruppen MV und Prüfung
 * Parameter und voller Daten-Hash (`report_refs`, JSON), und je festgeschriebener Buchung des Jahres ein Fingerabdruck
 * (`finance_audit_baseline_entries`). Keine Summen. `initial` beim ersten Abschluss, `followUp` nach einem Wiederöffnen,
 * wenn ein Bericht auf dem letzten Stand schon abgelegt war. Unveränderlich, nie gelöscht (Trigger).
 */
export const financeAuditBaselines = sqliteTable(
  'finance_audit_baselines',
  {
    id: text('id').primaryKey(),
    fiscalYearId: text('fiscal_year_id').notNull().references(() => financeFiscalYears.id),
    kind: text('kind', { enum: ['initial', 'followUp'] }).notNull(),
    reportRefs: text('report_refs').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [index('finance_audit_baselines_year_idx').on(t.fiscalYearId, t.createdAt)],
);
export type FinanceAuditBaselineRow = typeof financeAuditBaselines.$inferSelect;

export const financeAuditBaselineEntries = sqliteTable(
  'finance_audit_baseline_entries',
  {
    baselineId: text('baseline_id').notNull().references(() => financeAuditBaselines.id),
    entryId: text('entry_id').notNull().references(() => financeEntries.id),
    fingerprint: text('fingerprint').notNull(),
  },
  (t) => [primaryKey({ columns: [t.baselineId, t.entryId] })],
);

/**
 * Rechenschaft D1 „Stichproben“ (Designer N4): je Prüfer und Buchung ein Haken mit dem Fingerabdruck beim Abhaken —
 * weicht er heute ab, steht die Stichprobe auf „erneut prüfen“. Abhaken nimmt sie weg (protokolliert).
 */
export const financeAuditSamples = sqliteTable(
  'finance_audit_samples',
  {
    id: text('id').primaryKey(),
    fiscalYearId: text('fiscal_year_id').notNull().references(() => financeFiscalYears.id),
    auditorId: text('auditor_id').notNull().references(() => financeAuditAuditors.id),
    entryId: text('entry_id').notNull().references(() => financeEntries.id),
    fingerprint: text('fingerprint').notNull(),
    at: text('at').notNull(),
  },
  (t) => [uniqueIndex('finance_audit_samples_auditor_entry_idx').on(t.auditorId, t.entryId), index('finance_audit_samples_year_idx').on(t.fiscalYearId)],
);
export type FinanceAuditSampleRow = typeof financeAuditSamples.$inferSelect;

/** „Abschnitt durchgesehen“ je Prüfer und Abschnitt (Designer Runde 1 4b). */
export const financeAuditSectionReviews = sqliteTable(
  'finance_audit_section_reviews',
  {
    fiscalYearId: text('fiscal_year_id').notNull().references(() => financeFiscalYears.id),
    auditorId: text('auditor_id').notNull().references(() => financeAuditAuditors.id),
    section: text('section', { enum: ['journal', 'reconciliation', 'vouchers', 'imports', 'anomalies', 'purposesReserves', 'donations', 'partnerPayments', 'resolutions'] }).notNull(),
    at: text('at').notNull(),
    /**
     * Plan D1e Task 0: SHA-256 über die Zeilen des Abschnitts zur Zeit der Durchsicht (kanonisch, Buchungen mit ihrem
     * Fingerabdruck). `null` bei Durchsichten von vor dieser Spalte — für sie gilt die Regel aus D1d.
     */
    rowsHash: text('rows_hash'),
  },
  (t) => [uniqueIndex('finance_audit_section_reviews_idx').on(t.fiscalYearId, t.auditorId, t.section)],
);

/**
 * Rechenschaft D1 „Vermerk“: Frage oder Feststellung eines Prüfers an einer Buchung, einem Beleg, einem Bericht
 * (`target_id` = Katalogschlüssel) oder am Jahr. Für einen Papier-Prüfer trägt ein Kompass-Prüfer ein
 * (`author_auditor_id` ≠ Prüfer des Nutzers). Text frei — hier, nie im Protokoll. Nie gelöscht (Trigger).
 */
export const financeAuditRemarks = sqliteTable(
  'finance_audit_remarks',
  {
    id: text('id').primaryKey(),
    fiscalYearId: text('fiscal_year_id').notNull().references(() => financeFiscalYears.id),
    kind: text('kind', { enum: ['question', 'finding'] }).notNull(),
    targetType: text('target_type', { enum: ['entry', 'document', 'report', 'year', 'resolution'] }).notNull(),
    targetId: text('target_id').notNull(),
    text: text('text').notNull(),
    authorAuditorId: text('author_auditor_id').notNull().references(() => financeAuditAuditors.id),
    enteredByUserId: text('entered_by_user_id').notNull(),
    state: text('state', { enum: ['open', 'answered', 'resolved'] }).notNull().default('open'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [index('finance_audit_remarks_year_idx').on(t.fiscalYearId, t.state), index('finance_audit_remarks_target_idx').on(t.targetType, t.targetId)],
);
export type FinanceAuditRemarkRow = typeof financeAuditRemarks.$inferSelect;

/** Antworten (Schatzmeisterin) und Nachfragen (Prüfer) zu einem Vermerk, in ihrer Folge. Unveränderlich. */
export const financeAuditRemarkPosts = sqliteTable(
  'finance_audit_remark_posts',
  {
    id: text('id').primaryKey(),
    remarkId: text('remark_id').notNull().references(() => financeAuditRemarks.id),
    kind: text('kind', { enum: ['answer', 'followUp'] }).notNull(),
    byUserId: text('by_user_id').notNull(),
    text: text('text').notNull(),
    at: text('at').notNull(),
  },
  (t) => [index('finance_audit_remark_posts_remark_idx').on(t.remarkId, t.at)],
);

/**
 * Rechenschaft D1 „Prüfbericht“ (Designer Runde 3 12d–12g): der Bericht der Prüfer (`report`) oder ein Nachtrag nach
 * dem Wiederöffnen (`followUp`), am Prüfstand. `origin: blank` ist der Vordruck für Papier-Prüfer. Karten speichern
 * einzeln mit eigenem Stand (`…_updated_at`). Freitexte (Ort, „nicht geprüft“, Grund) stehen hier, nie im Protokoll.
 */
export const financeAuditReports = sqliteTable(
  'finance_audit_reports',
  {
    id: text('id').primaryKey(),
    fiscalYearId: text('fiscal_year_id').notNull().references(() => financeFiscalYears.id),
    kind: text('kind', { enum: ['report', 'followUp'] }).notNull(),
    origin: text('origin', { enum: ['kompass', 'blank'] }).notNull(),
    baselineId: text('baseline_id').notNull().references(() => financeAuditBaselines.id),
    state: text('state', { enum: ['draft', 'readyToSign', 'filed'] }).notNull().default('draft'),
    /** JSON-Liste ISO-Tage. */
    examDates: text('exam_dates').notNull().default('[]'),
    examPlace: text('exam_place'),
    examNotTested: text('exam_not_tested'),
    /** Die gewählte Kassenzählung „im Beisein von“ (Designer 12f: „im Gegenstand kann man zwischen ihnen wechseln“). */
    examCashCountId: text('exam_cash_count_id'),
    examUpdatedAt: text('exam_updated_at'),
    examUpdatedByUserId: text('exam_updated_by_user_id'),
    signatureMode: text('signature_mode', { enum: ['both', 'one', 'separate'] }).notNull().default('both'),
    nonSignerAuditorId: text('non_signer_auditor_id'),
    nonSignerReason: text('non_signer_reason'),
    signaturesUpdatedAt: text('signatures_updated_at'),
    signaturesUpdatedByUserId: text('signatures_updated_by_user_id'),
    readyAt: text('ready_at'),
    readyByUserId: text('ready_by_user_id'),
    filedAt: text('filed_at'),
    lastPrintedAt: text('last_printed_at'),
    /** Gegenstand ab „zum Unterschreiben freigeben“ (JSON, Spec § D1 „Prüfstand“): steht fest, bis die Freigabe zurückgeht. */
    subjectSnapshot: text('subject_snapshot'),
    createdAt: text('created_at').notNull(),
  },
  (t) => [index('finance_audit_reports_year_idx').on(t.fiscalYearId, t.createdAt)],
);
export type FinanceAuditReportRow = typeof financeAuditReports.$inferSelect;

/** Ergebnis und Empfehlung: gemeinsam (`auditor_id` leer) oder je Prüfer bei getrennten Berichten. */
export const financeAuditReportResults = sqliteTable(
  'finance_audit_report_results',
  {
    id: text('id').primaryKey(),
    reportId: text('report_id').notNull().references(() => financeAuditReports.id),
    auditorId: text('auditor_id').references(() => financeAuditAuditors.id),
    result: text('result', { enum: ['clean', 'withFindings'] }),
    recommendation: text('recommendation', { enum: ['discharge', 'noDischarge', 'none'] }).notNull().default('none'),
    updatedAt: text('updated_at').notNull(),
    updatedByUserId: text('updated_by_user_id').notNull(),
  },
  // Eindeutig je Bericht und Prüfer, „gemeinsam“ (leer) eingeschlossen: Ausdrucks-Index in der Migration `…_locks`.
  (t) => [index('finance_audit_report_results_report_idx').on(t.reportId)],
);
export type FinanceAuditReportResultRow = typeof financeAuditReportResults.$inferSelect;

/** „Abweichende Feststellungen · <Name>“ — je Prüfer nur das eigene Feld. */
export const financeAuditReportDeviations = sqliteTable(
  'finance_audit_report_deviations',
  {
    reportId: text('report_id').notNull().references(() => financeAuditReports.id),
    auditorId: text('auditor_id').notNull().references(() => financeAuditAuditors.id),
    text: text('text').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.reportId, t.auditorId] })],
);

/** Der abgelegte Scan (Task 7): einer je Bericht, bei getrennten Berichten einer je Prüfer. */
export const financeAuditReportScans = sqliteTable(
  'finance_audit_report_scans',
  {
    id: text('id').primaryKey(),
    reportId: text('report_id').notNull().references(() => financeAuditReports.id),
    auditorId: text('auditor_id').references(() => financeAuditAuditors.id),
    documentId: text('document_id').notNull(),
    filedAt: text('filed_at').notNull(),
    filedByUserId: text('filed_by_user_id').notNull(),
  },
  // Eindeutig je Bericht und Prüfer (leer bei einem Bericht): Ausdrucks-Index in der Migration `…_locks`.
  (t) => [index('finance_audit_report_scans_report_idx').on(t.reportId)],
);

/**
 * Rechenschaft D1 „im Beisein von“ (Designer 12f): welche Prüfer des gerade geprüften Jahres bei einer Kassenzählung
 * dabei waren, mit dem Namen von damals (wie die Zählenden). Unveränderlich, nie gelöscht (Trigger).
 */
export const financeCashCountWitnesses = sqliteTable(
  'finance_cash_count_witnesses',
  {
    countId: text('count_id').notNull().references(() => financeCashCounts.id),
    auditorId: text('auditor_id').notNull().references(() => financeAuditAuditors.id),
    /** Name des Kontakts bei der Zählung — Papier, nie im Protokoll. */
    name: text('name').notNull(),
  },
  (t) => [primaryKey({ columns: [t.countId, t.auditorId] }), index('finance_cash_count_witnesses_auditor_idx').on(t.auditorId)],
);

/**
 * Rechenschaft C Schritt 1 (Spec § C): der Kontoauszug der Bank als PDF in der Akte, je Konto mit dem Zeitraum, den
 * er abdeckt. Nur anhängen (Trigger): Ein falscher Auszug wird in der Akte storniert und zählt dann nicht mehr.
 */
export const financeAccountStatementDocuments = sqliteTable(
  'finance_account_statement_documents',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull().references(() => financeAccounts.id),
    documentId: text('document_id').notNull(),
    periodFrom: text('period_from'),
    periodTo: text('period_to').notNull(),
    createdAt: text('created_at').notNull(),
    createdByUserId: text('created_by_user_id').notNull(),
  },
  (t) => [index('finance_account_statement_documents_account_idx').on(t.accountId, t.periodTo)],
);

/**
 * Rechenschaft C Schritt 1: je Jahr und Konto eine Bestätigung — Saldo bestätigt oder „nicht abstimmbar“ (Zahlungsdienst),
 * fehlender Auszug begründet (Bankkonto); Schritt 2: Bestand rückgerechnet (Kasse, E2). Nur anhängen (Trigger); es gilt
 * die jüngste.
 */
export const financeAccountYearConfirmations = sqliteTable(
  'finance_account_year_confirmations',
  {
    id: text('id').primaryKey(),
    fiscalYearId: text('fiscal_year_id').notNull().references(() => financeFiscalYears.id),
    accountId: text('account_id').notNull().references(() => financeAccounts.id),
    kind: text('kind', { enum: ['balanceConfirmed', 'notReconcilable', 'missingJustified', 'cashRecomputed'] }).notNull(),
    note: text('note'),
    at: text('at').notNull(),
    byUserId: text('by_user_id').notNull(),
  },
  (t) => [index('finance_account_year_confirmations_year_idx').on(t.fiscalYearId, t.accountId)],
);

/**
 * Rechenschaft C (Finanz-Spec § 9.6): die Bestätigung eines Schritts im Jahresabschluss — Nutzer, Zeit, Begründung als
 * Tatsache. Nur anhängen (Trigger); es gilt die jüngste je Jahr und Schritt.
 */
export const financeClosingConfirmations = sqliteTable(
  'finance_closing_confirmations',
  {
    id: text('id').primaryKey(),
    fiscalYearId: text('fiscal_year_id').notNull().references(() => financeFiscalYears.id),
    step: text('step').notNull(),
    note: text('note'),
    at: text('at').notNull(),
    byUserId: text('by_user_id').notNull(),
  },
  (t) => [index('finance_closing_confirmations_year_idx').on(t.fiscalYearId, t.step)],
);

/**
 * Rechenschaft C Schritt 11 (Spec § C): das Ergebnis der Mitgliederversammlung zu einem Geschäftsjahr — ein Datensatz
 * je Jahr; ein Nachtrag aus einer späteren MV ändert ihn, die Geschichte steht im Protokoll.
 */
export const financeAssemblyResults = sqliteTable('finance_assembly_results', {
  fiscalYearId: text('fiscal_year_id').primaryKey().references(() => financeFiscalYears.id),
  assemblyOn: text('assembly_on').notNull(),
  minutesDocumentId: text('minutes_document_id'),
  accountsApproved: text('accounts_approved', { enum: ['yes', 'no', 'notVoted'] }),
  dischargeMode: text('discharge_mode', { enum: ['individual', 'collective'] }).notNull(),
  collectiveOutcome: text('collective_outcome', { enum: ['granted', 'refused', 'postponed'] }),
  updatedAt: text('updated_at').notNull(),
  updatedByUserId: text('updated_by_user_id').notNull(),
});

/** Die Entlastung je Person bei Einzelentlastung; `decided_on` ist der Tag der MV, die das Ergebnis dieser Person zuletzt änderte. */
export const financeAssemblyDischarges = sqliteTable(
  'finance_assembly_discharges',
  {
    fiscalYearId: text('fiscal_year_id').notNull().references(() => financeFiscalYears.id),
    contactId: text('contact_id').notNull(),
    outcome: text('outcome', { enum: ['granted', 'refused', 'postponed'] }),
    decidedOn: text('decided_on'),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.fiscalYearId, t.contactId] })],
);

/**
 * Rechenschaft C / D1 (Spec § D1 „Wiederöffnen nach der Prüfung“, nach der MV): Die Nachprüfung wird geschlossen,
 * indem die Korrektur in Prüfpaket und Kassenbericht des Folgejahres geht und der nächsten MV berichtet wird. Gilt
 * nur dem Prüfstand, auf dem sie steht. Nur anhängen (Trigger).
 */
export const financeAuditCarryOvers = sqliteTable(
  'finance_audit_carry_overs',
  {
    id: text('id').primaryKey(),
    fiscalYearId: text('fiscal_year_id').notNull().references(() => financeFiscalYears.id),
    baselineId: text('baseline_id').notNull().references(() => financeAuditBaselines.id),
    targetFiscalYearId: text('target_fiscal_year_id').notNull().references(() => financeFiscalYears.id),
    note: text('note').notNull(),
    at: text('at').notNull(),
    byUserId: text('by_user_id').notNull(),
  },
  (t) => [index('finance_audit_carry_overs_year_idx').on(t.fiscalYearId), index('finance_audit_carry_overs_target_idx').on(t.targetFiscalYearId)],
);

export type FinanceAuditCarryOverRow = typeof financeAuditCarryOvers.$inferSelect;

/** Je übernommener Buchung eine Zeile: neu (nicht im Prüfstand), zurückgenommen oder geändert. */
export const financeAuditCarryOverEntries = sqliteTable(
  'finance_audit_carry_over_entries',
  {
    carryOverId: text('carry_over_id').notNull().references(() => financeAuditCarryOvers.id),
    entryId: text('entry_id').notNull().references(() => financeEntries.id),
    entryNumber: text('entry_number').notNull(),
    change: text('change', { enum: ['new', 'reversed', 'changed'] }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.carryOverId, t.entryId] })],
);

/**
 * Rechenschaft C (Amtsübergabe): Kontakte, in deren Beisein gezählt wurde (die neue Schatzmeisterin), mit dem Namen
 * von damals — neben den Prüfer-Zeugen. Unveränderlich, nie gelöscht (Trigger).
 */
export const financeCashCountContactWitnesses = sqliteTable(
  'finance_cash_count_contact_witnesses',
  {
    countId: text('count_id').notNull().references(() => financeCashCounts.id),
    contactId: text('contact_id').notNull(),
    name: text('name').notNull(),
  },
  (t) => [primaryKey({ columns: [t.countId, t.contactId] })],
);

/**
 * Rechenschaft C (Spec § C, Finanz-Spec § 9.6): die Amtsübergabe des Schatzmeisters — Zwischenbericht (Parameter und
 * Hash, keine Ablage), Kassenzählung am Übergabetag, Übergabepunkte, das unterschriebene Protokoll. Nie gelöscht
 * (Trigger); abgebrochen ist ein Zustand.
 */
export const financeHandovers = sqliteTable(
  'finance_handovers',
  {
    id: text('id').primaryKey(),
    fiscalYearId: text('fiscal_year_id').notNull().references(() => financeFiscalYears.id),
    fromContactId: text('from_contact_id').notNull(),
    toContactId: text('to_contact_id').notNull(),
    handoverOn: text('handover_on').notNull(),
    state: text('state', { enum: ['open', 'done', 'cancelled'] }).notNull(),
    interimParams: text('interim_params'),
    interimHash: text('interim_hash'),
    interimAt: text('interim_at'),
    /** Altdaten (C1): eine Zählung je Übergabe. Seit E2 ungenutzt — die Sicht leitet je Kasse aus `financeCashCounts` ab (14c). */
    cashCountId: text('cash_count_id'),
    protocolDocumentId: text('protocol_document_id'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [index('finance_handovers_year_idx').on(t.fiscalYearId)],
);
export type FinanceHandoverRow = typeof financeHandovers.$inferSelect;

/** Die Punkte der Übergabe (Finanz-Spec § 9.6): Standardpunkte beim Beginnen, eigene dazu. */
export const financeHandoverItems = sqliteTable(
  'finance_handover_items',
  {
    id: text('id').primaryKey(),
    handoverId: text('handover_id').notNull().references(() => financeHandovers.id),
    key: text('key', { enum: ['cash', 'records', 'bankAccess', 'paymentServices', 'kompass', 'custom'] }).notNull(),
    label: text('label'),
    note: text('note'),
    checked: integer('checked', { mode: 'boolean' }).notNull().default(false),
    position: integer('position').notNull(),
  },
  (t) => [index('finance_handover_items_handover_idx').on(t.handoverId)],
);


/**
 * E6a: die Abgabe einer Umsatzsteuer-Voranmeldung (`period` `'YYYY-Qn'` oder `'YYYY-MM'`) oder Jahreserklärung
 * (`'YYYY'`). Eine zweite Abgabe desselben Zeitraums ist die berichtigte Anmeldung (`amendment`). `linesDigest` ist der
 * Fingerabdruck der Zeilen des Zeitraums bei der Abgabe (`vatPeriodDigestInternal`); weicht der heutige ab, ist eine
 * Berichtigung fällig. Übertragene Abgaben ohne Fingerabdruck melden nie eine. Kein Löschen, kein Ändern.
 */
export const financeVatFilings = sqliteTable(
  'finance_vat_filings',
  {
    id: text('id').primaryKey(),
    period: text('period').notNull(),
    filedOn: text('filed_on').notNull(),
    amendment: integer('amendment', { mode: 'boolean' }).notNull().default(false),
    linesDigest: text('lines_digest'),
    /** Die Teile, aus denen `linesDigest` entstand (JSON-Liste, `vatPeriodPartsInternal`) — Ursache einer Berichtigung. */
    linesSnapshot: text('lines_snapshot'),
    /** E6b: Abbild der Kennzahlen bei der Abgabe (JSON, Cent je Quelle `VatFigureSource`) — die Spalte „abgegeben“ der Berichtigung. */
    figures: text('figures'),
    /** E6b: die festgeschriebene Fassung des Berichts mit dem Datenstand der Abgabe, sonst `null`. */
    reportId: text('report_id'),
    /** E6b: Ablage an der Abgabe — abgegebene Fassung (nur mit `report_id`) und ELSTER-Übertragungsprotokoll. */
    filedReturnDocumentId: text('filed_return_document_id'),
    transmissionProtocolDocumentId: text('transmission_protocol_document_id'),
    at: text('at').notNull(),
    byUserId: text('by_user_id').notNull(),
  },
  (t) => [index('finance_vat_filings_period_idx').on(t.period)],
);
export type FinanceVatFilingRow = typeof financeVatFilings.$inferSelect;

/**
 * Rechenschaft B2: ein erzeugter Datenexport für eine Außenprüfung (§ 147 Abs. 6 AO). Metadaten, nie Inhalte: Das ZIP
 * liegt in den Dateien des Moduls und wird nach 30 Tagen gelöscht (`reporting/export/sweep.ts`); die Zeile bleibt mit
 * `file_deleted_at`, damit das Protokoll auf etwas zeigt. „Bis“ wird berechnet (`dataExportExpiresAt`), nie gespeichert.
 */
export const financeDataExports = sqliteTable(
  'finance_data_exports',
  {
    id: text('id').primaryKey(),
    /** JSON-Liste der Geschäftsjahr-IDs. */
    fiscalYearIds: text('fiscal_year_ids').notNull(),
    /** „2024, 2025“ — Bezeichnungen beim Erzeugen. */
    designations: text('designations').notNull(),
    /** Offene Jahre beim Erzeugen („2026“) oder leer. */
    provisional: text('provisional').notNull().default(''),
    fileName: text('file_name').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    /** SHA-256 des ZIP. */
    checksum: text('checksum').notNull(),
    createdAt: text('created_at').notNull(),
    createdByUserId: text('created_by_user_id'),
    channel: text('channel', { enum: ['ui', 'mcp'] }).notNull(),
    fileDeletedAt: text('file_deleted_at'),
  },
  (t) => [index('finance_data_exports_created_idx').on(t.createdAt)],
);
export type FinanceDataExportRow = typeof financeDataExports.$inferSelect;

/**
 * Rechenschaft D2 (Spec § D2): der Erklärungszeitraum der Steuererklärung — ein bis drei aufeinander folgende
 * Geschäftsjahre (`first`…`last`), mit Aufforderung, Frist, Abgabe, der abgegebenen festgeschriebenen Fassung des
 * Berichts `taxReturnGem`, den Dokumenten je Platz und dem Bescheid. `answers_json` hält die „Angaben von Ihnen“
 * der Anlage Gem (`gemAnswersSchema`) — Freitext, nie im Protokoll. Ersetzt „Steuererklärung abgegeben am“ am
 * Geschäftsjahr. Nie gelöscht (Trigger `finance_tax_periods_no_delete`).
 */
export const financeTaxPeriods = sqliteTable(
  'finance_tax_periods',
  {
    id: text('id').primaryKey(),
    firstFiscalYearId: text('first_fiscal_year_id').notNull().references(() => financeFiscalYears.id),
    lastFiscalYearId: text('last_fiscal_year_id').notNull().references(() => financeFiscalYears.id),
    requestedOn: text('requested_on'),
    withTaxAdvisor: integer('with_tax_advisor', { mode: 'boolean' }).notNull().default(false),
    dueOn: text('due_on').notNull(),
    filedOn: text('filed_on'),
    filedReportId: text('filed_report_id').references(() => financeReports.id),
    /** Dokumente der Akte je Platz — kein Fremdschlüssel, die Akte gehört einem anderen Modul. */
    requestDocumentId: text('request_document_id'),
    filedDocumentId: text('filed_document_id'),
    transmissionDocumentId: text('transmission_document_id'),
    activityReportDocumentId: text('activity_report_document_id'),
    /** Die Satzung, wenn sie gesondert übermittelt wird (Zeile 6, Befund 18b). */
    statuteDocumentId: text('statute_document_id'),
    noticeId: text('notice_id').references(() => financeNotices.id),
    answersJson: text('answers_json').notNull().default('{}'),
    createdAt: text('created_at').notNull(),
    createdByUserId: text('created_by_user_id').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [index('finance_tax_periods_first_idx').on(t.firstFiscalYearId), index('finance_tax_periods_last_idx').on(t.lastFiscalYearId)],
);
export type FinanceTaxPeriodRow = typeof financeTaxPeriods.$inferSelect;

/**
 * Rechenschaft D2 (Spec § D2): Finanzamt, Steuernummer und begünstigter Zweck einer Körperschaft, an die Kompass eine
 * Vermögensausstattung gibt oder von der es eine erhält (Anlage Gem Zeilen 65 und 70) — eine Zeile je Kontakt für
 * Empfänger und Geber; das Partnerprofil zeigt und pflegt die seines Kontakts. Eine eigene ID statt der Kontakt-ID als
 * Schlüssel, weil die ID ins Änderungsprotokoll geht und dort nie eine Kontakt-ID stehen darf (wie
 * `finance_contact_waiver_terms`). Arbeitsmaterial: Der Bericht trägt beim Festschreiben seine eigene Abschrift; geht
 * mit dem Kontakt.
 */
export const financeContactTaxDetails = sqliteTable(
  'finance_contact_tax_details',
  {
    id: text('id').primaryKey(),
    contactId: text('contact_id').notNull(),
    taxOffice: text('tax_office'),
    taxNumber: text('tax_number'),
    beneficiaryPurpose: text('beneficiary_purpose'),
    /** E6a: „Rechnungen mit Umkehr der Steuerschuld (§ 13b)“ — Vorgabe `rc13bEu`/`rc13bOther` für jede Ausgabe an den Kontakt. */
    reverseCharge: text('reverse_charge', { enum: ['eu', 'other'] }),
    /** E6b: gemerktes „Nein, weil …“ der Prüffrage § 13b — Grund, Freitext nur bei `other`, Tag und Person. Schließt `reverse_charge` aus. */
    reverseChargeDeclineReason: text('reverse_charge_decline_reason', { enum: ['paymentServices', 'domesticProvider', 'exception13b6', 'other'] }),
    reverseChargeDeclineText: text('reverse_charge_decline_text'),
    reverseChargeDeclineOn: text('reverse_charge_decline_on'),
    reverseChargeDeclineByUserId: text('reverse_charge_decline_by_user_id'),
    /** Jahresrechnung (0.4.5, Ve-F-3): juristische Person ja/nein, `null` = unbekannt (wirkt wie nein). Nur bei Organisationen. */
    legalEntity: text('legal_entity', { enum: ['yes', 'no'] }),
    updatedAt: text('updated_at').notNull(),
    updatedByUserId: text('updated_by_user_id').notNull(),
  },
  (t) => [uniqueIndex('finance_contact_tax_details_contact_idx').on(t.contactId)],
);
export type FinanceContactTaxDetailsRow = typeof financeContactTaxDetails.$inferSelect;

/**
 * Jahresrechnung (0.4.5, Ve-L-6, Art. 7 Abs. 1 DSGVO): Einwilligung zur Namensnennung als **Verlauf** — „erteilt am …
 * für die Jahresrechnungen ab {Jahr}“ und „widerrufen am …“. Nur anhängen (Trigger); geht mit dem Kontakt, wenn dieser
 * nach seiner Frist gelöscht wird. Die eigene ID geht ins Protokoll, nie die Kontakt-ID.
 */
export const financeNameConsents = sqliteTable(
  'finance_name_consents',
  {
    id: text('id').primaryKey(),
    contactId: text('contact_id').notNull(),
    kind: text('kind', { enum: ['granted', 'revoked'] }).notNull(),
    on: text('on').notNull(),
    /** Nur bei `granted`: ab welchem Geschäftsjahr die Einwilligung gilt. */
    fromYear: integer('from_year'),
    documentId: text('document_id'),
    createdAt: text('created_at').notNull(),
    createdByUserId: text('created_by_user_id').notNull(),
  },
  (t) => [index('finance_name_consents_contact_idx').on(t.contactId, t.on)],
);
export type FinanceNameConsentRow = typeof financeNameConsents.$inferSelect;

/**
 * Jahresrechnung (0.4.5): Erläuterungstext des Vereins je Geschäftsjahr (Markdown, höchstens 4.000 Zeichen). Änderbar
 * bis zum Festschreiben, Teil des Daten-Hashs; Arbeitsmaterial davor.
 */
export const financeAnnualAccountsNotes = sqliteTable('finance_annual_accounts_notes', {
  fiscalYearId: text('fiscal_year_id').primaryKey().references(() => financeFiscalYears.id),
  text: text('text').notNull(),
  updatedAt: text('updated_at').notNull(),
  updatedByUserId: text('updated_by_user_id').notNull(),
});
export type FinanceAnnualAccountsNoteRow = typeof financeAnnualAccountsNotes.$inferSelect;

/**
 * Jahresrechnung (0.4.5, J2): die Abzeichnung einer festgeschriebenen Fassung durch ein vertretungsberechtigtes
 * Vorstandsmitglied — über sein Konto oder als Scan. Je Fassung höchstens eine; nur anhängen (Trigger). Name und Amt
 * zum Tag festgehalten; das Protokoll nennt nie die Person, nur Weg und Nummern. `documentId` ist die erzeugte,
 * abgezeichnete Fassung (nie der Scan, der eine Unterschrift als Bild trägt), `namedContactIds` die Zuwender, die F8
 * dieser Fassung mit Namen nennt (JSON-Liste).
 */
export const financeReportSignatures = sqliteTable('finance_report_signatures', {
  id: text('id').primaryKey(),
  reportId: text('report_id')
    .notNull()
    .unique()
    .references(() => financeReports.id),
  contactId: text('contact_id').notNull(),
  signerName: text('signer_name').notNull(),
  signerOffice: text('signer_office'),
  via: text('via', { enum: ['account', 'scan'] }).notNull(),
  /** Nur beim Weg `account`: das Konto, das abgezeichnet hat. */
  signerUserId: text('signer_user_id'),
  signedOn: text('signed_on').notNull(),
  documentId: text('document_id').notNull(),
  documentNumber: text('document_number').notNull(),
  scanDocumentId: text('scan_document_id'),
  namedContactIds: text('named_contact_ids').notNull(),
  createdAt: text('created_at').notNull(),
  createdByUserId: text('created_by_user_id').notNull(),
});
export type FinanceReportSignatureRow = typeof financeReportSignatures.$inferSelect;

/**
 * Jahresrechnung (0.4.5, J2): die Veröffentlichung einer abgezeichneten Fassung über die Sicht `annualAccounts`. Je
 * Fassung höchstens eine laufende (partieller Unique-Index); Zurücknehmen setzt `withdrawn_*` einmal, eine Webfassung
 * nach Widerruf einer Einwilligung setzt `web_*` neu. Sonst unveränderlich, nie gelöscht (Trigger). `earlyNote` ist
 * Freitext und steht nie im Protokoll.
 */
export const financeAnnualAccountsPublications = sqliteTable(
  'finance_annual_accounts_publications',
  {
    id: text('id').primaryKey(),
    reportId: text('report_id')
      .notNull()
      .references(() => financeReports.id),
    fiscalYearId: text('fiscal_year_id')
      .notNull()
      .references(() => financeFiscalYears.id),
    publishedAt: text('published_at').notNull(),
    publishedByUserId: text('published_by_user_id').notNull(),
    /** Vor dem MV-Ergebnis: warum (ITZ-Frist, Bitte eines Förderers, Sonstiges mit `earlyNote`). */
    earlyReason: text('early_reason', { enum: ['itzDeadline', 'funderRequest', 'other'] }),
    earlyNote: text('early_note'),
    /** Es gab für das Jahr schon eine Veröffentlichung: berichtigte Fassung (Ve-L-3). */
    corrected: integer('corrected', { mode: 'boolean' }).notNull().default(false),
    /** `finalizedAt` der zuletzt veröffentlichten früheren Fassung des Jahres. */
    replacesFinalizedAt: text('replaces_finalized_at'),
    webDocumentId: text('web_document_id'),
    webDocumentNumber: text('web_document_number'),
    webVersionOn: text('web_version_on'),
    withdrawnAt: text('withdrawn_at'),
    withdrawnByUserId: text('withdrawn_by_user_id'),
    withdrawnCause: text('withdrawn_cause', { enum: ['manual', 'voided', 'renderFailed'] }),
    /** Seit wann sie beim Zurücknehmen auf der Webseite stand; leer: nur bereitgestellt, nie ausgeliefert (Bildabnahme 0.4.5 F-2). */
    withdrawnLiveSince: text('withdrawn_live_since'),
  },
  (t) => [index('finance_annual_accounts_publications_year_idx').on(t.fiscalYearId), uniqueIndex('finance_annual_accounts_publications_live_idx').on(t.reportId).where(sql`${t.withdrawnAt} is null`)],
);
export type FinanceAnnualAccountsPublicationRow = typeof financeAnnualAccountsPublications.$inferSelect;
