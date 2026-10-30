// Drizzle liest genau diese Datei für das Modul `members` (`drizzle.config.ts` im Kern: `../modules/*/src/schema.ts`).
import { localizedColumn } from '@kompass/core';
import { sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

/** Mitgliedsarten (Spec § 3.1): Stammdaten, der Schlüssel steht nach der Anlage fest. */
export const memberTypes = sqliteTable(
  'member_types',
  {
    id: text('id').primaryKey(),
    key: text('key').notNull(),
    name: localizedColumn('name'),
    hasVotingRight: integer('has_voting_right', { mode: 'boolean' }).notNull().default(false),
    feeExempt: integer('fee_exempt', { mode: 'boolean' }).notNull().default(false),
    active: integer('active', { mode: 'boolean' }).notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [uniqueIndex('member_types_key_idx').on(t.key), index('member_types_sort_idx').on(t.sortOrder)],
);
export type MemberTypeRow = typeof memberTypes.$inferSelect;

export const END_REASONS = ['resignation', 'exclusion', 'struckOff', 'death', 'other'] as const;
export type EndReason = (typeof END_REASONS)[number];

/**
 * Eine Mitgliedschaft (Spec § 3.2). Der Zustand wird aus den Tagen berechnet, nie gespeichert (Prinzip 5). `contactId`
 * ohne Fremdschlüssel: Kontakte gehören einem anderen Modul, das Löschen räumt `recordDeleted` auf.
 */
export const memberMemberships = sqliteTable(
  'member_memberships',
  {
    id: text('id').primaryKey(),
    contactId: text('contact_id').notNull(),
    /** Vergeben bei der Aufnahme, nie wiederverwendet; bis dahin leer. */
    memberNumber: text('member_number'),
    appliedOn: text('applied_on'),
    admittedOn: text('admitted_on'),
    rejectedOn: text('rejected_on'),
    joinedOn: text('joined_on'),
    /** Letzter Tag der Mitgliedschaft. */
    endsOn: text('ends_on'),
    endReason: text('end_reason', { enum: END_REASONS }),
    endNoticeOn: text('end_notice_on'),
    endDocumentId: text('end_document_id'),
    /** Nur für Minderjährige nötig — an der Mitgliedschaft, weil nur sie es braucht. */
    birthDate: text('birth_date'),
    guardianContactId: text('guardian_contact_id'),
    applicationDocumentId: text('application_document_id'),
    notes: text('notes'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [uniqueIndex('member_memberships_number_idx').on(t.memberNumber), index('member_memberships_contact_idx').on(t.contactId)],
);
export type MembershipRow = typeof memberMemberships.$inferSelect;

/** Verlauf der Art einer Mitgliedschaft: ab `validFrom` gilt `typeId`. Eine Periode je Tag. */
export const memberTypePeriods = sqliteTable(
  'member_type_periods',
  {
    id: text('id').primaryKey(),
    membershipId: text('membership_id')
      .notNull()
      .references(() => memberMemberships.id),
    typeId: text('type_id')
      .notNull()
      .references(() => memberTypes.id),
    validFrom: text('valid_from').notNull(),
  },
  (t) => [uniqueIndex('member_type_periods_day_idx').on(t.membershipId, t.validFrom), index('member_type_periods_type_idx').on(t.typeId)],
);
export type MemberTypePeriodRow = typeof memberTypePeriods.$inferSelect;

/**
 * Der Zähler der Mitgliedsnummern, eine Zeile `id = 'member'`. Eine eigene Tabelle statt `max` über die Mitgliedschaften:
 * Eine gelöschte Mitgliedschaft nähme ihre Nummer sonst mit, und sie würde wieder vergeben.
 */
export const memberNumberCounter = sqliteTable('member_number_counter', {
  id: text('id').primaryKey(),
  last: integer('last').notNull(),
});

// ── Beiträge (Spec § 4, Plan M3) ──────────────────────────────────────────────────────────────────────────────────

export const FEE_INTERVALS = ['yearly', 'halfYearly', 'quarterly', 'monthly'] as const;
export type FeeInterval = (typeof FEE_INTERVALS)[number];
/** M30: Höchstbetrag eines Beitrags — dieselbe Grenze wie bei Zusagen (1.000.000,00 €), weit unter der SEPA-Grenze. */
export const FEE_MAX_CENTS = 100_000_000;
export const PAYMENT_METHODS = ['transfer', 'directDebit'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export const FEE_REDUCTIONS = ['none', 'reduced', 'deferred', 'waived'] as const;
export type FeeReduction = (typeof FEE_REDUCTIONS)[number];
export const FEE_CHARGE_STATES = ['pending', 'created', 'skipped', 'replaced'] as const;
export type FeeChargeState = (typeof FEE_CHARGE_STATES)[number];

/** Ein Stand der Beitragsordnung (Spec § 4.1): gilt ab `validFrom` bis zum nächsten. */
export const memberFeeSchedules = sqliteTable(
  'member_fee_schedules',
  {
    id: text('id').primaryKey(),
    validFrom: text('valid_from').notNull(),
    resolvedOn: text('resolved_on'),
    resolutionDocumentId: text('resolution_document_id'),
    /** G7: der Beschluss in Gremien (`governanceResolution`), geprüft über `resolveRecordLabel`. */
    resolutionId: text('resolution_id'),
    note: text('note'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [uniqueIndex('member_fee_schedules_valid_from_idx').on(t.validFrom)],
);
export type FeeScheduleRow = typeof memberFeeSchedules.$inferSelect;

/** Eine Regel eines Stands je Art; für eine beitragsfreie Art gibt es keine. */
export const memberFeeRules = sqliteTable(
  'member_fee_rules',
  {
    id: text('id').primaryKey(),
    scheduleId: text('schedule_id')
      .notNull()
      .references(() => memberFeeSchedules.id),
    typeId: text('type_id')
      .notNull()
      .references(() => memberTypes.id),
    amountCents: integer('amount_cents').notNull(),
    interval: text('interval', { enum: FEE_INTERVALS }).notNull(),
    /** Betrag ist Mindestbetrag; das Mitglied darf mehr wählen. */
    minimum: integer('minimum', { mode: 'boolean' }).notNull().default(false),
    /** JSON-Liste der Rhythmen, die das Mitglied statt `interval` wählen darf (enthält `interval`). */
    allowedIntervals: text('allowed_intervals').notNull(),
    admissionFeeCents: integer('admission_fee_cents'),
  },
  (t) => [uniqueIndex('member_fee_rules_schedule_type_idx').on(t.scheduleId, t.typeId), index('member_fee_rules_type_idx').on(t.typeId)],
);
export type FeeRuleRow = typeof memberFeeRules.$inferSelect;

/** Beitragsvereinbarung je Mitglied ab einem Tag (Spec § 4.2). Leere Werte gelten nach Ordnung. Kein Freitext-Grund. */
export const memberFeeAgreements = sqliteTable(
  'member_fee_agreements',
  {
    id: text('id').primaryKey(),
    membershipId: text('membership_id')
      .notNull()
      .references(() => memberMemberships.id),
    validFrom: text('valid_from').notNull(),
    amountCents: integer('amount_cents'),
    interval: text('interval', { enum: FEE_INTERVALS }),
    paymentMethod: text('payment_method', { enum: PAYMENT_METHODS }).notNull().default('transfer'),
    /** Prüfung des Mandats kommt mit L1. */
    mandateId: text('mandate_id'),
    reduction: text('reduction', { enum: FEE_REDUCTIONS }).notNull().default('none'),
    reductionDocumentId: text('reduction_document_id'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [uniqueIndex('member_fee_agreements_day_idx').on(t.membershipId, t.validFrom)],
);
export type FeeAgreementRow = typeof memberFeeAgreements.$inferSelect;

/** Wer die Beitragsmitteilung bekommt; Lastschrift-Zahler immer (Entscheid F3), deshalb kein `none`. */
export const FEE_RUN_NOTICES = ['all', 'directDebitOnly'] as const;
export type FeeRunNotices = (typeof FEE_RUN_NOTICES)[number];

/** Ein Beitragslauf je Jahr (Spec § 4.3), Vorbild Serienlauf der Zuwendungsbestätigungen. */
export const memberFeeRuns = sqliteTable(
  'member_fee_runs',
  {
    id: text('id').primaryKey(),
    year: integer('year').notNull(),
    status: text('status', { enum: ['running', 'done'] }).notNull(),
    /** Wer eine Beitragsmitteilung bekommt (Plan M4 Task 5); Lastschrift-Zahler immer (Entscheid F3). */
    notices: text('notices', { enum: FEE_RUN_NOTICES }).notNull().default('directDebitOnly'),
    /** Mitteilungen, die der Lauf nicht ausstellen konnte (etwa `addressMissing`), damit er nicht an ihnen hängt. */
    noticeRefused: text('notice_refused', { mode: 'json' }).$type<{ membershipId: string; code: string; letter?: 'prenotification' }[]>().notNull().default([]),
    createdByUserId: text('created_by_user_id'),
    createdAt: text('created_at').notNull(),
    finishedAt: text('finished_at'),
  },
  (t) => [index('member_fee_runs_year_idx').on(t.year)],
);
export type FeeRunRow = typeof memberFeeRuns.$inferSelect;

/**
 * Ein Beitrag eines Zeitraums: Zeitraum, Betrag und Verweis auf den offenen Posten der Finanzen. Bezahlt, offen,
 * erlassen wird aus dem Posten berechnet (Prinzip 5). Ein Zeitraum entsteht nie zweimal — außer neben ersetzten Zeilen.
 */
export const memberFeeCharges = sqliteTable(
  'member_fee_charges',
  {
    id: text('id').primaryKey(),
    membershipId: text('membership_id')
      .notNull()
      .references(() => memberMemberships.id),
    periodStart: text('period_start').notNull(),
    periodEnd: text('period_end').notNull(),
    amountCents: integer('amount_cents').notNull(),
    dueOn: text('due_on').notNull(),
    /** Gestundet bis (Spec § 4.4); die Fälligkeit des Postens steht in den Finanzen. */
    deferredTo: text('deferred_to'),
    openItemId: text('open_item_id'),
    /** Leer: bei der Aufnahme oder einer Neuberechnung angelegt. */
    runId: text('run_id').references(() => memberFeeRuns.id),
    state: text('state', { enum: FEE_CHARGE_STATES }).notNull(),
    skipReason: text('skip_reason'),
    replacedById: text('replaced_by_id'),
    /**
     * Der Zahlweg des Beitrags (Plan N1 E3): beim Anlegen der Vereinbarung an seiner Fälligkeit entnommen; wechselt der
     * Zahlweg, zieht ein offener Beitrag mit — außer ein Brief forderte ihn schon zur Überweisung auf
     * (`memberTransferRequests`) oder er steckt in einem Einzug. Ein Einzug nimmt nur `directDebit`.
     */
    paymentMethod: text('payment_method', { enum: PAYMENT_METHODS }).notNull().default('transfer'),
    /** M4: der Stand der Beitragsordnung, der an der Fälligkeit galt — er ist fest, sobald ein Beitrag nach ihm entstand. */
    scheduleId: text('schedule_id'),
  },
  (t) => [
    uniqueIndex('member_fee_charges_period_idx').on(t.membershipId, t.periodStart).where(sql`${t.state} <> 'replaced'`),
    index('member_fee_charges_run_idx').on(t.runId),
    index('member_fee_charges_open_item_idx').on(t.openItemId),
  ],
);
export type FeeChargeRow = typeof memberFeeCharges.$inferSelect;

// ── Briefe der Läufe (Plan M4) ───────────────────────────────────────────────────────────────────────────────────

/**
 * Welche Briefe ein Lauf ausgestellt hat (`runRef` = `membersFeeRun:<id>` bzw. `membersDunningRun:<id>`), mit
 * Empfänger — die Grundlage des Schritts „Versand“. Ob gesendet oder vermerkt, steht in der Akte (berechnet).
 */
export const memberRunLetters = sqliteTable(
  'member_run_letters',
  {
    id: text('id').primaryKey(),
    runRef: text('run_ref').notNull(),
    membershipId: text('membership_id')
      .notNull()
      .references(() => memberMemberships.id),
    documentId: text('document_id').notNull(),
    contactId: text('contact_id').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [uniqueIndex('member_run_letters_document_idx').on(t.runRef, t.documentId), index('member_run_letters_membership_idx').on(t.membershipId)],
);
export type MemberRunLetterRow = typeof memberRunLetters.$inferSelect;

/**
 * Welcher festgeschriebene Brief zu welchem Beitrag zur Überweisung aufforderte (Plan N1 E3): Aufnahmebestätigung,
 * Beitragsmitteilung, Mahnung, Zahlungsaufforderung. Solange der Brief nicht storniert ist, bleibt der Beitrag bei einem
 * Wechsel auf Lastschrift Überweisung — sonst zöge der Einzug, was das Mitglied schon überwiesen haben kann.
 */
export const memberTransferRequests = sqliteTable(
  'member_transfer_requests',
  {
    id: text('id').primaryKey(),
    chargeId: text('charge_id')
      .notNull()
      .references(() => memberFeeCharges.id),
    documentId: text('document_id').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [index('member_transfer_requests_charge_idx').on(t.chargeId)],
);
export type MemberTransferRequestRow = typeof memberTransferRequests.$inferSelect;

// ── Mahnlauf (Spec § 4.5, Plan M4) ───────────────────────────────────────────────────────────────────────────────

/**
 * Ein Mahnlauf zum Stichtag `asOf`. Die Mitglieder stehen nicht fest: Jeder Schritt rechnet die Vorschau zum Stichtag
 * neu, damit eine Zahlung zwischen Start und Fortsetzen das Mitglied noch herausnimmt. `refused` hält Mitglieder fest,
 * deren Brief der Lauf nicht ausstellen konnte (etwa `addressMissing`), damit er nicht an ihnen hängen bleibt.
 */
export const memberDunningRuns = sqliteTable(
  'member_dunning_runs',
  {
    id: text('id').primaryKey(),
    asOf: text('as_of').notNull(),
    status: text('status', { enum: ['running', 'done'] }).notNull(),
    refused: text('refused', { mode: 'json' }).$type<{ membershipId: string; code: string }[]>().notNull(),
    createdByUserId: text('created_by_user_id'),
    createdAt: text('created_at').notNull(),
    finishedAt: text('finished_at'),
  },
  (t) => [index('member_dunning_runs_status_idx').on(t.status)],
);
export type DunningRunRow = typeof memberDunningRuns.$inferSelect;

/**
 * Ein Mahnvermerk: welche Stufe für welche Posten mit welchem Brief. Ob die Stufe erreicht ist, rechnet `reachedLevel`
 * aus dem Versandvermerk des Dokuments (Prinzip 5) — gespeichert wird nur, was ausgestellt wurde.
 */
export const memberDunningNotices = sqliteTable(
  'member_dunning_notices',
  {
    id: text('id').primaryKey(),
    membershipId: text('membership_id')
      .notNull()
      .references(() => memberMemberships.id),
    levelKey: text('level_key').notNull(),
    documentId: text('document_id').notNull(),
    chargeIds: text('charge_ids', { mode: 'json' }).$type<string[]>().notNull(),
    runId: text('run_id').references(() => memberDunningRuns.id),
    issuedOn: text('issued_on').notNull(),
  },
  (t) => [index('member_dunning_notices_membership_idx').on(t.membershipId), index('member_dunning_notices_run_idx').on(t.runId)],
);
export type DunningNoticeRow = typeof memberDunningNotices.$inferSelect;
