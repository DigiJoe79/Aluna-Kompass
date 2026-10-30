// Drizzle liest genau diese Datei für das Modul `governance` (`drizzle.config.ts` im Kern: `../modules/*/src/schema.ts`).
import { sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { RESOLUTION_KINDS, type StatuteRules } from './rules/schema';

export const ORGAN_KINDS = ['assembly', 'board', 'other'] as const;
export type OrganKind = (typeof ORGAN_KINDS)[number];

/** Organ (Spec Gremien § 3.1): genau eine Mitgliederversammlung, genau ein Vorstand, beliebig viele andere. */
export const governanceOrgans = sqliteTable(
  'governance_organs',
  {
    id: text('id').primaryKey(),
    kind: text('kind', { enum: ORGAN_KINDS }).notNull(),
    /** Nutzdaten des Vereins; die Vorgabe kommt aus der Sprachtabelle `START_ORGANS`. */
    name: text('name').notNull(),
    active: integer('active', { mode: 'boolean' }).notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [uniqueIndex('governance_organs_kind_idx').on(t.kind).where(sql`${t.kind} in ('assembly', 'board')`)],
);
export type OrganRow = typeof governanceOrgans.$inferSelect;

export const OFFICE_FUNCTIONS = ['chair', 'treasurer', 'board', 'auditor'] as const;
export type OfficeFunction = (typeof OFFICE_FUNCTIONS)[number];

/** Amt (Spec § 3.2). `function` ist der einzige Schlüssel, den Code kennt; der Name bleibt Nutzdaten. */
export const governanceOffices = sqliteTable(
  'governance_offices',
  {
    id: text('id').primaryKey(),
    organId: text('organ_id').notNull(),
    name: text('name').notNull(),
    seats: integer('seats').notNull().default(1),
    /** Vertritt nach § 26 BGB (wird im Register eingetragen). */
    representative: integer('representative', { mode: 'boolean' }).notNull().default(false),
    /** Amtszeit in Monaten; leer = unbefristet (BGB-Rückfall). */
    termMonths: integer('term_months'),
    untilSuccessor: integer('until_successor', { mode: 'boolean' }).notNull().default(false),
    function: text('function', { enum: OFFICE_FUNCTIONS }),
    /** Ämter, die dieselbe Person nicht zugleich haben soll — Warnung, keine Sperre. */
    incompatibleWith: text('incompatible_with', { mode: 'json' }).$type<string[]>().notNull().default([]),
    active: integer('active', { mode: 'boolean' }).notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [index('governance_offices_organ_idx').on(t.organId)],
);
export type OfficeRow = typeof governanceOffices.$inferSelect;

export const TERM_ORIGINS = ['elected', 'substitute', 'appointed', 'courtAppointed', 'backfilled'] as const;
export type TermOrigin = (typeof TERM_ORIGINS)[number];
export const TERM_END_REASONS = ['resigned', 'dismissed', 'died', 'expired', 'successor', 'other'] as const;
export type TermEndReason = (typeof TERM_END_REASONS)[number];

/**
 * Amtsinhaberschaft (Spec § 3.3). Ob sie läuft, wird berechnet. `contactId` ohne Fremdschlüssel: Kontakte gehören
 * einem anderen Modul. `roleRowIds` sind die Zeilen in `contact_roles`, die aus ihr folgen (Spec § 3.4).
 */
export const governanceTerms = sqliteTable(
  'governance_terms',
  {
    id: text('id').primaryKey(),
    officeId: text('office_id').notNull(),
    contactId: text('contact_id').notNull(),
    since: text('since').notNull(),
    until: text('until'),
    origin: text('origin', { enum: TERM_ORIGINS }).notNull(),
    acceptedOn: text('accepted_on'),
    /** Beschluss, aus dem sie folgt (ab G4). */
    resolutionId: text('resolution_id'),
    endReason: text('end_reason', { enum: TERM_END_REASONS }),
    /** Zugang der Niederlegung (§ 26 Abs. 2 S. 2 BGB). */
    endReceivedOn: text('end_received_on'),
    documentId: text('document_id'),
    roleRowIds: text('role_row_ids', { mode: 'json' }).$type<string[]>().notNull().default([]),
    note: text('note'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [index('governance_terms_office_idx').on(t.officeId), index('governance_terms_contact_idx').on(t.contactId)],
);
export type TermRow = typeof governanceTerms.$inferSelect;

export type StatuteResolutionRef = { on: string; resolutionId: string | null };
export type StatuteTaxReview = {
  affectsCharity: boolean | null;
  submittedOn: string | null;
  submissionDocumentId: string | null;
  answer: 'notRelevant' | 'newNotice' | null;
  answerDocumentId: string | null;
};
export const EMPTY_TAX_REVIEW: StatuteTaxReview = { affectsCharity: null, submittedOn: null, submissionDocumentId: null, answer: null, answerDocumentId: null };
export type StatuteFoundingChecks = { signatures: number | null; establishedOn: string | null };

/**
 * Satzungsstand (Spec § 4.1). Der Zustand (Entwurf, beschlossen, gültig, abgelöst) wird berechnet. `rules` ist das
 * Regelwerk (`rules/schema.ts`), ungeprüft als JSON gespeichert — geprüft beim Schreiben.
 */
export const governanceStatutes = sqliteTable('governance_statutes', {
  id: text('id').primaryKey(),
  basedOnId: text('based_on_id'),
  documentId: text('document_id'),
  resolutions: text('resolutions', { mode: 'json' }).$type<StatuteResolutionRef[]>().notNull().default([]),
  registeredOn: text('registered_on'),
  rules: text('rules', { mode: 'json' }).$type<StatuteRules>().notNull().default({ organs: {} }),
  taxReview: text('tax_review', { mode: 'json' }).$type<StatuteTaxReview>().notNull().default(EMPTY_TAX_REVIEW),
  /** Prüfliste nach § 59 Abs. 3 BGB, nur am Gründungsstand. */
  foundingChecks: text('founding_checks', { mode: 'json' }).$type<StatuteFoundingChecks | null>(),
  note: text('note'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});
export type StatuteRow = typeof governanceStatutes.$inferSelect;

/** Feststellungen zu Beginn einer Sitzung (Spec § 5.4); Personen nur als Kontakt-ID. */
export interface MeetingFindings {
  invitationProper: boolean | null;
  invitationNote: string | null;
  quorate: boolean | null;
  quorumNote: string | null;
  chairContactId: string | null;
  minuteTakerContactId: string | null;
  chairBy: 'statute' | 'elected' | 'consent' | null;
  agendaApproved: boolean | null;
}

export const MEETING_KINDS = ['founding', 'ordinary', 'extraordinary', 'repeat', 'board'] as const;
export type MeetingKind = (typeof MEETING_KINDS)[number];
export const MEETING_FORMS = ['inPerson', 'hybrid', 'virtual'] as const;
export type MeetingForm = (typeof MEETING_FORMS)[number];

/**
 * Sitzung eines Organs (Spec Gremien § 5.1, § 5.2). Der Zustand wird aus den Tagesstempeln berechnet (Prinzip 5).
 * `access` (Link, Einwahl) steht nur in der Einladung, nie im Protokoll. Personen nur als Kontakt-ID.
 */
export const governanceMeetings = sqliteTable(
  'governance_meetings',
  {
    id: text('id').primaryKey(),
    organId: text('organ_id').notNull(),
    kind: text('kind', { enum: MEETING_KINDS }).notNull(),
    heldOn: text('held_on').notNull(),
    /** `HH:MM`. */
    startsAt: text('starts_at').notNull(),
    form: text('form', { enum: MEETING_FORMS }).notNull(),
    place: text('place'),
    access: text('access'),
    /** Wie die Rechte elektronisch ausgeübt werden (§ 32 Abs. 2 S. 3 BGB). */
    remoteNote: text('remote_note'),
    plannedChairContactId: text('planned_chair_contact_id'),
    plannedMinuteTakerContactId: text('planned_minute_taker_contact_id'),
    /** Bei `repeat`: die beschlussunfähige Versammlung. */
    repeatOfId: text('repeat_of_id'),
    /** Außerordentliche MV auf Verlangen (§ 37 BGB). */
    assemblyRequestId: text('assembly_request_id'),
    invitedOn: text('invited_on'),
    invitationDocumentId: text('invitation_document_id'),
    /** Weg einer Einladung ohne Dokument (Vorstand: „Messenger“). */
    invitationNote: text('invitation_note'),
    cancelledOn: text('cancelled_on'),
    cancelReason: text('cancel_reason'),
    /** Mitlauf (Spec § 5.4): Zeitstempel und Tag, an dem die Sitzung begonnen wurde. */
    startedAt: text('started_at'),
    startedOn: text('started_on'),
    /** `HH:MM`, Ende der Sitzung; gesetzt heißt `recorded`. */
    endedAt: text('ended_at'),
    /** Genau eine Person schreibt (Spec § 5.4); Übergabe über „Protokollführung übernehmen“. */
    writerUserId: text('writer_user_id'),
    /** Feststellungen zu Beginn (`findings.ts`), geprüft beim Schreiben. */
    findings: text('findings', { mode: 'json' }).$type<Partial<MeetingFindings>>().notNull().default({}),
    /** Festgeschrieben (Spec § 5.1, § 6): gesetzt heißt `signed`; danach nur Berichtigung. */
    sealedAt: text('sealed_at'),
    sealedByUserId: text('sealed_by_user_id'),
    /** Nachgetragen (Spec § 5.7): ohne Einladung und Mitlauf; Anwesenheit nur als Zahl. */
    backfilled: integer('backfilled', { mode: 'boolean' }).notNull().default(false),
    backfillPresent: integer('backfill_present'),
    backfillVoting: integer('backfill_voting'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [index('governance_meetings_organ_idx').on(t.organId, t.heldOn)],
);
export type MeetingRow = typeof governanceMeetings.$inferSelect;

/** Ein geänderter Absatz: leer `before` = neu, leer `after` = gestrichen. */
export type WordingChange = { label: string; before: string; after: string };

export const AGENDA_ADDED_DURING = ['preparation', 'supplement', 'meeting'] as const;
export type AgendaAddedDuring = (typeof AGENDA_ADDED_DURING)[number];

/**
 * Tagesordnungspunkt (Spec § 5.2). `kind` ist eine Beschlussart oder `report`/`discussion`/`other` (`AGENDA_KINDS`,
 * `agenda.ts`). Anlagen sind Dokumente der Akte jeder Art.
 */
export const governanceAgendaItems = sqliteTable(
  'governance_agenda_items',
  {
    id: text('id').primaryKey(),
    meetingId: text('meeting_id').notNull(),
    position: integer('position').notNull(),
    kind: text('kind').notNull(),
    title: text('title').notNull(),
    invitationText: text('invitation_text'),
    /** Beschlussvorlage. */
    proposal: text('proposal'),
    attachmentDocumentIds: text('attachment_document_ids', { mode: 'json' }).$type<string[]>().notNull().default([]),
    /** Nur `election`: die Ämter, die gewählt werden. */
    officeIds: text('office_ids', { mode: 'json' }).$type<string[]>().notNull().default([]),
    /** `discharge`, `accounts`: das Geschäftsjahr. */
    fiscalYearId: text('fiscal_year_id'),
    /** `statute`, `purpose`: der Satzungsentwurf. */
    statuteId: text('statute_id'),
    motionId: text('motion_id'),
    /** Notiz aus dem Mitlauf, Fließtext fürs Protokoll (Spec § 5.4). */
    minutesNote: text('minutes_note'),
    /** `statute`, `purpose`: die geänderten Absätze, Anlage der Einladung in zwei Spalten (Plan U2). Kompass vergleicht nichts. */
    wordingChanges: text('wording_changes', { mode: 'json' }).$type<WordingChange[]>().notNull().default([]),
    addedDuring: text('added_during', { enum: AGENDA_ADDED_DURING }).notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [index('governance_agenda_items_meeting_idx').on(t.meetingId, t.position)],
);
export type AgendaItemRow = typeof governanceAgendaItems.$inferSelect;

/**
 * Antrag zur Tagesordnung (Spec § 5.3). „Nach Frist“ wird berechnet. Nie gelöscht und nie abgewiesen (Anti-Ziel 1);
 * Rücknahme über `withdrawnOn`. Wird der Kontakt gelöscht, verliert der Antrag nur den Bezug.
 */
export const governanceMotions = sqliteTable(
  'governance_motions',
  {
    id: text('id').primaryKey(),
    meetingId: text('meeting_id').notNull(),
    submittedByContactId: text('submitted_by_contact_id'),
    receivedOn: text('received_on').notNull(),
    text: text('text').notNull(),
    documentId: text('document_id'),
    agendaItemId: text('agenda_item_id'),
    withdrawnOn: text('withdrawn_on'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [index('governance_motions_meeting_idx').on(t.meetingId), index('governance_motions_contact_idx').on(t.submittedByContactId)],
);
export type MotionRow = typeof governanceMotions.$inferSelect;

/** Verlangen einer außerordentlichen Versammlung durch eine Minderheit (§ 37 BGB); ob das Quorum erreicht ist, wird berechnet. */
export const governanceAssemblyRequests = sqliteTable('governance_assembly_requests', {
  id: text('id').primaryKey(),
  organId: text('organ_id').notNull(),
  receivedOn: text('received_on').notNull(),
  supporters: integer('supporters').notNull(),
  purpose: text('purpose').notNull(),
  documentId: text('document_id'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});
export type AssemblyRequestRow = typeof governanceAssemblyRequests.$inferSelect;

export const INVITATION_RUN_KINDS = ['invitation', 'supplement', 'cancellation'] as const;
export type InvitationRunKind = (typeof INVITATION_RUN_KINDS)[number];

/**
 * Einladungslauf der Mitgliederversammlung (Spec § 5.3): ein Hauptdokument (`ELD`), dann je Mitglied ein Brief (`ELB`)
 * über Mail oder Post. `refused` hält die Mitgliedschaften fest, für die kein Brief entstand (Grund als Code).
 */
export const governanceInvitationRuns = sqliteTable(
  'governance_invitation_runs',
  {
    id: text('id').primaryKey(),
    meetingId: text('meeting_id').notNull(),
    kind: text('kind', { enum: INVITATION_RUN_KINDS }).notNull(),
    status: text('status', { enum: ['running', 'done'] }).notNull(),
    issuedOn: text('issued_on').notNull(),
    masterDocumentId: text('master_document_id'),
    refused: text('refused', { mode: 'json' }).$type<{ membershipId: string; code: string }[]>().notNull().default([]),
    createdByUserId: text('created_by_user_id'),
    createdAt: text('created_at').notNull(),
    finishedAt: text('finished_at'),
  },
  (t) => [index('governance_invitation_runs_meeting_idx').on(t.meetingId)],
);
export type InvitationRunRow = typeof governanceInvitationRuns.$inferSelect;

/** Ein Brief eines Einladungslaufs: an wen er ging (Mitglied oder gesetzliche Vertretung). */
export const governanceRunLetters = sqliteTable(
  'governance_run_letters',
  {
    id: text('id').primaryKey(),
    runId: text('run_id').notNull(),
    membershipId: text('membership_id').notNull(),
    contactId: text('contact_id').notNull(),
    documentId: text('document_id').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [uniqueIndex('governance_run_letters_run_membership_idx').on(t.runId, t.membershipId)],
);
export type RunLetterRow = typeof governanceRunLetters.$inferSelect;

export const ATTENDANCE_ROLES = ['member', 'officeHolder', 'founder', 'guest'] as const;
export type AttendanceRole = (typeof ATTENDANCE_ROLES)[number];
/** Eine Anwesenheitsspanne, Uhrzeiten `HH:MM`; `to` leer = noch da. */
export type AttendancePeriod = { from: string; to: string | null };

/**
 * Anwesenheit in einer Sitzung (Spec § 5.4, § 9.3). Das Stimmrecht ist der Stand am Sitzungstag, festgehalten, weil es
 * die Löschung des Kontakts überlebt; dann bleibt die Zeile ohne `contactId`. Gäste ohne Namen, nur `guestLabel`.
 */
export const governanceAttendance = sqliteTable(
  'governance_attendance',
  {
    id: text('id').primaryKey(),
    meetingId: text('meeting_id').notNull(),
    contactId: text('contact_id'),
    membershipId: text('membership_id'),
    guest: integer('guest', { mode: 'boolean' }).notNull().default(false),
    guestLabel: text('guest_label'),
    role: text('role', { enum: ATTENDANCE_ROLES }).notNull(),
    votingRight: integer('voting_right', { mode: 'boolean' }).notNull(),
    periods: text('periods', { mode: 'json' }).$type<AttendancePeriod[]>().notNull().default([]),
    /** Vermerk, etwa eine Stimmrechtsübertragung, wo die Satzung sie erlaubt. */
    note: text('note'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [index('governance_attendance_meeting_idx').on(t.meetingId), index('governance_attendance_contact_idx').on(t.contactId)],
);
export type AttendanceRow = typeof governanceAttendance.$inferSelect;

export const EXCLUSION_REASONS = ['discharge', 'legalTransaction', 'litigation', 'remuneration', 'exclusion', 'other'] as const;
/** Grund eines Stimmverbots (§ 34 BGB, Spec § 4.2). */
export type ExclusionReason = (typeof EXCLUSION_REASONS)[number];
export type ResolutionExclusion = { contactId: string; reason: ExclusionReason; note: string | null };
export const RESOLUTION_OUTCOMES = ['adopted', 'rejected', 'postponed', 'withdrawn'] as const;
export type ResolutionOutcome = (typeof RESOLUTION_OUTCOMES)[number];
/** Stimmen eines Beschlusses; ungültig zählt nicht als abgegeben (BGHZ 83, 35). */
export type ResolutionVotes = { yes: number; no: number; abstain: number; invalid: number };

/**
 * Beschluss (Spec § 4.2, § 5.4, § 5.6) — in einer Sitzung an einem TOP oder aus einem Umlauf. Kompass rechnet vor, die
 * Leitung stellt fest (`outcome`); eine Feststellung gegen die Zählung trägt `outcomeReason`. Die Nummer entsteht erst
 * beim Festschreiben (G4). `details` sind die Angaben der strukturierten Arten (`resolution-details.ts`).
 */
export const governanceResolutions = sqliteTable(
  'governance_resolutions',
  {
    id: text('id').primaryKey(),
    meetingId: text('meeting_id'),
    circularId: text('circular_id'),
    agendaItemId: text('agenda_item_id'),
    organId: text('organ_id').notNull(),
    kind: text('kind', { enum: RESOLUTION_KINDS }).notNull(),
    /** Antragstext — nur am Datensatz, nie im Änderungsprotokoll. */
    text: text('text').notNull(),
    /** `HH:MM` der Abstimmung; die Anwesenheit zu dieser Zeit ergibt die Stimmberechtigten. */
    votedAt: text('voted_at'),
    decidedOn: text('decided_on').notNull(),
    votes: text('votes', { mode: 'json' }).$type<ResolutionVotes | null>(),
    /** Ja im Subtraktionsverfahren errechnet (Joe 2026-10-28) — der Protokollsatz nennt das Verfahren. */
    yesComputed: integer('yes_computed', { mode: 'boolean' }).notNull().default(false),
    unanimous: integer('unanimous', { mode: 'boolean' }).notNull().default(false),
    excluded: text('excluded', { mode: 'json' }).$type<ResolutionExclusion[]>().notNull().default([]),
    outcome: text('outcome', { enum: RESOLUTION_OUTCOMES }),
    outcomeReason: text('outcome_reason'),
    details: text('details', { mode: 'json' }).$type<unknown>(),
    number: text('number'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [index('governance_resolutions_meeting_idx').on(t.meetingId), index('governance_resolutions_organ_idx').on(t.organId, t.decidedOn), uniqueIndex('governance_resolutions_number_idx').on(t.number)],
);
export type ResolutionRow = typeof governanceResolutions.$inferSelect;

/** Zähler der Beschlussnummern je Jahr, vereinsweit über alle Organe (`numbers.ts`). */
export const governanceResolutionCounters = sqliteTable('governance_resolution_counters', {
  year: integer('year').primaryKey(),
  next: integer('next').notNull(),
});

export const CIRCULAR_CHANNELS = ['email', 'messenger', 'letter'] as const;
export type CircularChannel = (typeof CIRCULAR_CHANNELS)[number];
export const CIRCULAR_ANSWERS = ['yes', 'no', 'abstain', 'none'] as const;
export type CircularAnswer = (typeof CIRCULAR_ANSWERS)[number];

/**
 * Umlaufbeschluss (Spec § 5.6): Kompass erfasst, verschickt nicht. Ob er zustande kam, wird aus den Antworten
 * berechnet; festgestellt wird von Hand (`outcome`), festgeschrieben mit Nummer in G4 (`sealedAt`).
 */
export const governanceCirculars = sqliteTable(
  'governance_circulars',
  {
    id: text('id').primaryKey(),
    organId: text('organ_id').notNull(),
    kind: text('kind', { enum: RESOLUTION_KINDS }).notNull(),
    /** Antragstext — nur am Datensatz. */
    text: text('text').notNull(),
    details: text('details', { mode: 'json' }).$type<unknown>(),
    requestedOn: text('requested_on').notNull(),
    deadline: text('deadline').notNull(),
    channel: text('channel', { enum: CIRCULAR_CHANNELS }).notNull(),
    outcome: text('outcome', { enum: RESOLUTION_OUTCOMES }),
    outcomeReason: text('outcome_reason'),
    decidedOn: text('decided_on'),
    decidedByContactId: text('decided_by_contact_id'),
    sealedAt: text('sealed_at'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [index('governance_circulars_organ_idx').on(t.organId, t.requestedOn)],
);
export type CircularRow = typeof governanceCirculars.$inferSelect;

/** Antwort eines Organmitglieds; Nachweis als Dokument der Akte oder als Vermerk. Ohne Kontakt nach dessen Löschung. */
export const governanceCircularResponses = sqliteTable(
  'governance_circular_responses',
  {
    id: text('id').primaryKey(),
    circularId: text('circular_id').notNull(),
    contactId: text('contact_id'),
    answer: text('answer', { enum: CIRCULAR_ANSWERS }).notNull(),
    answeredOn: text('answered_on'),
    documentId: text('document_id'),
    note: text('note'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [index('governance_circular_responses_circular_idx').on(t.circularId), index('governance_circular_responses_contact_idx').on(t.contactId)],
);
export type CircularResponseRow = typeof governanceCircularResponses.$inferSelect;

/**
 * Fassungen des unterschriebenen Protokolls (Spec § 5.1, § 5.5): Version 1 ist die abgelegte oder verknüpfte Fassung,
 * jede Berichtigung eine weitere mit Grund (nur am Datensatz). Das Dokument selbst liegt in der Akte.
 */
export const governanceMinutesVersions = sqliteTable(
  'governance_minutes_versions',
  {
    id: text('id').primaryKey(),
    meetingId: text('meeting_id').notNull(),
    version: integer('version').notNull(),
    documentId: text('document_id').notNull(),
    reason: text('reason'),
    filedAt: text('filed_at').notNull(),
    filedByUserId: text('filed_by_user_id'),
  },
  (t) => [uniqueIndex('governance_minutes_versions_meeting_idx').on(t.meetingId, t.version), index('governance_minutes_versions_document_idx').on(t.documentId)],
);
export type MinutesVersionRow = typeof governanceMinutesVersions.$inferSelect;

export const OCCASION_KINDS = ['initial', 'statute', 'boardChange', 'representation', 'dissolution'] as const;
/** Anlass einer Registeranmeldung (Spec § 6, § 7.1; § 67, § 71, §§ 74, 76 BGB); G5 führt daraus den Vorgang. */
export type OccasionKind = (typeof OCCASION_KINDS)[number];

/**
 * Fälliger Anlass zur Registeranmeldung — entsteht beim Festschreiben (Wahl, Abberufung, Satzung, Auflösung,
 * Gründung) und bei Änderungen ohne Beschluss (Rücktritt, Tod, Ersatzbestellung, Vertretungsregel). `filingId` setzt
 * der Registervorgang (G5), der den Anlass aufnimmt. Personen nur über `termId`.
 */
export const governanceRegisterOccasions = sqliteTable(
  'governance_register_occasions',
  {
    id: text('id').primaryKey(),
    kind: text('kind', { enum: OCCASION_KINDS }).notNull(),
    occurredOn: text('occurred_on').notNull(),
    meetingId: text('meeting_id'),
    resolutionId: text('resolution_id'),
    termId: text('term_id'),
    officeId: text('office_id'),
    statuteId: text('statute_id'),
    filingId: text('filing_id'),
    createdAt: text('created_at').notNull(),
  },
  (t) => [index('governance_register_occasions_filing_idx').on(t.filingId), index('governance_register_occasions_day_idx').on(t.occurredOn)],
);
export type OccasionRow = typeof governanceRegisterOccasions.$inferSelect;

/** Zwischenverfügung des Registergerichts an einer Anmeldung (Spec § 7.1); die Wiedervorlage gehört dem Kern. */
export type InterimOrder = { on: string; deadline: string | null; documentId: string | null; resolvedOn: string | null; followUpId: string | null };
/** Prüffragen zum Transparenzregister (Spec § 7.2), Antworten als Wahrheitswert je Schlüssel (`register/transparency.ts`). */
export type FilingTransparency = { answers: Partial<Record<string, boolean>>; checkedOn: string | null; confirmationDocumentId: string | null; extractDocumentIds: string[] };
/** Vermerke zur Auflösung (Spec § 6; § 137 AO, § 50 BGB). */
export type FilingDissolution = { taxOfficeNotifiedOn: string | null; municipalityNotifiedOn: string | null; announcedOn: string | null };

/**
 * Registeranmeldung als Vorgang (Spec § 7.1): bündelt Anlässe aus `governance_register_occasions` (deren `filingId`).
 * Der Zustand (fällig, beim Notar, eingereicht, Zwischenverfügung, eingetragen) wird aus den Tagen berechnet. Kompass
 * reicht nichts ein; der Notar ist ein Kontakt. `documents` sind von Hand gesetzte Unterlagen je Schlüssel der Prüfliste.
 */
export const governanceRegisterFilings = sqliteTable('governance_register_filings', {
  id: text('id').primaryKey(),
  notaryContactId: text('notary_contact_id'),
  notarizedOn: text('notarized_on'),
  submittedOn: text('submitted_on'),
  interimOrders: text('interim_orders', { mode: 'json' }).$type<InterimOrder[]>().notNull().default([]),
  registeredOn: text('registered_on'),
  registerCourt: text('register_court'),
  registerNumber: text('register_number'),
  /** Registerauszug nach der Eintragung. */
  extractDocumentId: text('extract_document_id'),
  documents: text('documents', { mode: 'json' }).$type<Partial<Record<string, string[]>>>().notNull().default({}),
  transparency: text('transparency', { mode: 'json' }).$type<FilingTransparency | null>(),
  dissolution: text('dissolution', { mode: 'json' }).$type<FilingDissolution | null>(),
  note: text('note'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});
export type FilingRow = typeof governanceRegisterFilings.$inferSelect;
