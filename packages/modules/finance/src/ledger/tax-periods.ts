import { expectedVersionField, invalid, isoNow, newId, notFound, ok, requirePermission, staleVersion, todayIn, validate, type CallContext, type DbOrTx, type Deps, type Result } from '@kompass/core';
import { documents, getDocumentRecord, linkDocumentInternal, receiveGeneratedUpload } from '@kompass/module-dms';
import { and, asc, desc, eq, gte, inArray, isNull, lte } from 'drizzle-orm';
import { z } from 'zod';
import { financeAudit } from '../audit';
import { financeConflict } from '../errors';
import { financeFiscalYears, financeNotices, financeReports, financeTaxAmendmentChecks, financeTaxAmendments, financeTaxPeriods, type FinanceFiscalYearRow, type FinanceTaxPeriodRow } from '../schema';
import { statuteSuggestionOf } from '../sources';
import { requireFinanceRead } from './access';
import { dayAfter } from './fiscal-years';
import { nextWorkingDay, type FederalState } from './working-days';

/**
 * Rechenschaft D2 (Spec § D2, Plan Task 1/2): der Erklärungszeitraum der Steuererklärung — ein bis drei aufeinander
 * folgende Geschäftsjahre mit Aufforderung, Frist, Abgabe, Dokumenten und den „Angaben von Ihnen“ der Anlage Gem.
 * Er liegt in `ledger/`, weil § 153 (`corrections.ts`) und das Wiederöffnen (`period.ts`) ihn lesen.
 *
 * Die Angaben sind nach Bedeutung benannt, nicht nach Zeilennummer: Welche Zeile sie füllen, sagt allein
 * `reporting/gem-forms.ts` — eine Abweichung in Mein ELSTER ändert nur jene Tabelle.
 */

const text = z.string().trim().min(1).max(500);
const day = z.iso.date();
const cents = z.number().int().min(0);
const submission = z.enum(['onFile', 'willSubmit']);

export const gemAnswersSchema = z
  .object({
    /** Zeile 2, 3. */
    churchPurposes: z.boolean().optional(),
    charitablePurposes: z.boolean().optional(),
    /** Zeile 5, 6. */
    statuteDate: day.optional(),
    statuteSubmission: submission.optional(),
    /** Zeile 7 — ein Datum oder „kein gesonderter Beschluss“; Zeile 8 nur bei einem Datum. */
    feeResolution: z.union([z.object({ date: day }).strict(), z.literal('none')]).optional(),
    feeResolutionSubmission: submission.optional(),
    /** Tore der Blöcke Wohlfahrtspflege (30–37), Krankenhaus (38), Sport (39–49): „trifft zu?“ — die Werte trägt man in ELSTER ein. */
    welfare: z.boolean().optional(),
    hospital: z.boolean().optional(),
    sport: z.boolean().optional(),
    /** Zeile 54, je Wiederbeschaffungsrücklage (ID der Rücklage). */
    replacementAssets: z.record(z.string().min(1), z.object({ asset: text, expectedCostCents: cents.optional(), regularDepreciationCents: cents.optional() }).strict()).optional(),
    /** Zeile 59, je Beteiligungsrücklage (ID der Rücklage). */
    participations: z.record(z.string().min(1), z.object({ company: text, taxOffice: text, taxNumber: text }).strict()).optional(),
    /** Zeile 74, 75. */
    gratuitousBenefits: z.boolean().optional(),
    gratuitousBenefitList: z.array(z.object({ reason: text, amountCents: z.number().int().positive() }).strict()).max(50).optional(),
    /** Zeile 79 (§ 50a EStG). */
    withholdingTax50a: z.boolean().optional(),
    /** Beilage „EÜR für das Finanzamt“: Mitglieder am Jahresende, je Geschäftsjahr (ID). */
    memberCounts: z.record(z.string().min(1), z.number().int().min(0)).optional(),
  })
  .strict();

export type GemAnswers = z.infer<typeof gemAnswersSchema>;

// ── Erklärungszeitraum ─────────────────────────────────────────────────────

/** Die Plätze für Dokumente am Zeitraum; alle als Art `finance-tax-return` abgelegt, die Rolle sagt der Platz. */
export const TAX_PERIOD_DOCUMENT_SLOTS = ['request', 'filedReturn', 'transmissionProtocol', 'activityReport', 'statute'] as const;
export type TaxPeriodDocumentSlot = (typeof TAX_PERIOD_DOCUMENT_SLOTS)[number];
export const TAX_RETURN_DOCUMENT_TYPE = 'finance-tax-return';

const SLOT_COLUMN = {
  request: 'requestDocumentId',
  filedReturn: 'filedDocumentId',
  transmissionProtocol: 'transmissionDocumentId',
  activityReport: 'activityReportDocumentId',
  statute: 'statuteDocumentId',
} as const satisfies Record<TaxPeriodDocumentSlot, keyof FinanceTaxPeriodRow>;

/** Betreff in der Akte — Papiertext (deutsch, Prinzip 7), nennt keine Person. */
const SLOT_SUBJECT: Record<TaxPeriodDocumentSlot, string> = {
  request: 'Aufforderung zur Steuererklärung',
  filedReturn: 'Abgegebene Steuererklärung',
  transmissionProtocol: 'ELSTER-Übertragungsprotokoll',
  activityReport: 'Tätigkeitsbericht',
  statute: 'Satzung',
};

/**
 * Der Zeitraum aus seiner Zeile, ohne Prüfanlass — was Berichte und Fristen lesen. Die Werte von heute rechnet erst
 * `reporting/tax-amendments.ts` (`TaxPeriodView`), weil die Berichte selbst diesen Zeitraum lesen.
 */
export interface TaxPeriodRecordView {
  id: string;
  firstFiscalYearId: string;
  lastFiscalYearId: string;
  /** Die Jahre des Zeitraums, ältestes zuerst. */
  fiscalYearIds: string[];
  /** „2023–2025“ oder „2025“. */
  label: string;
  requestedOn: string | null;
  withTaxAdvisor: boolean;
  dueOn: string;
  filedOn: string | null;
  filedReportId: string | null;
  /** Die abgegebene Fassung ist inzwischen storniert (Wiederöffnen) — § 153 AO. */
  filedReportVoided: boolean;
  documents: Partial<Record<TaxPeriodDocumentSlot, { documentId: string; documentNumber: string }>>;
  noticeId: string | null;
  answers: GemAnswers;
  /** Eine nicht stornierte festgeschriebene Fassung von `taxReturnGem` gibt es: Die Jahre stehen fest. */
  yearsLocked: boolean;
  state: 'open' | 'filed' | 'assessed';
  version: string;
}

/** B9: eine geänderte Stelle des Abbilds (`reporting/tax-figures.ts`) — eine Zeile der Anlage Gem (Zeile 9 mit Jahr) oder eine Beilage mit Jahr. */
export type TaxFiguresAttachment = 'taxReturnIncomeStatement' | 'assetOverview' | 'reserveStatement';
export type TaxFigureCause = { kind: 'line'; line: string; year?: string } | { kind: 'attachment'; report: TaxFiguresAttachment; year?: string };

/** B9: die Fächer der Ablage an einer Berichtigung — wie an der ersten Abgabe. */
export const TAX_AMENDMENT_DOCUMENT_SLOTS = ['filedReturn', 'transmissionProtocol'] as const;
export type TaxAmendmentDocumentSlot = (typeof TAX_AMENDMENT_DOCUMENT_SLOTS)[number];

/** B9: eine Berichtigung — Tag, Fassung, Ablage und die gegenüber dem vorigen Maßstab geänderten Stellen. */
export interface TaxAmendmentView {
  id: string;
  filedOn: string;
  reportId: string;
  at: string;
  documents: Partial<Record<TaxAmendmentDocumentSlot, { documentId: string; documentNumber: string }>>;
  cause: TaxFigureCause[];
}

/** B9: eine Prüfung — ohne Berichtigung geschlossen (mit Person und Begründung) oder die Anzeige an das Finanzamt. */
export interface TaxAmendmentCheckView {
  id: string;
  kind: 'noAmendment' | 'notified';
  checkedOn: string;
  byUserId: string;
  reason: string | null;
  document: { documentId: string; documentNumber: string } | null;
  at: string;
  cause: TaxFigureCause[];
}

/** Der Zeitraum mit Prüfanlass nach § 153 AO (Spec 0.5.2 § 4.2) — was Seite und Agent lesen. */
export interface TaxPeriodView extends TaxPeriodRecordView {
  /** Prüfanlass offen: Die Werte weichen heute vom Maßstab ab. */
  reviewDue: boolean;
  /** Die geänderten Stellen, nur bei offenem Prüfanlass. */
  reviewCause: TaxFigureCause[];
  /** Der Tag der Anzeige zum laufenden Anlass, sonst `null`. */
  notifiedOn: string | null;
  /** Abgegeben, aber der Maßstab hat kein Abbild (Abgabe vor 0.5.2): Kompass meldet keinen Prüfanlass. */
  filedFiguresMissing: boolean;
  /** Eine Berichtigung ist eintragbar (Werte weichen von der letzten Abgabe ab, oder sie hat kein Abbild). */
  amendmentAllowed: boolean;
  amendments: TaxAmendmentView[];
  checks: TaxAmendmentCheckView[];
}


/** Die Jahre von `first` bis `last` nach Beginn; `null`, wenn eines fehlt. */
function yearsBetween(db: DbOrTx, firstId: string, lastId: string): { first: FinanceFiscalYearRow; last: FinanceFiscalYearRow; years: FinanceFiscalYearRow[] } | null {
  const first = db.select().from(financeFiscalYears).where(eq(financeFiscalYears.id, firstId)).get();
  const last = db.select().from(financeFiscalYears).where(eq(financeFiscalYears.id, lastId)).get();
  if (!first || !last) return null;
  const years = db.select().from(financeFiscalYears).where(and(gte(financeFiscalYears.startsOn, first.startsOn), lte(financeFiscalYears.startsOn, last.startsOn))).orderBy(asc(financeFiscalYears.startsOn)).all();
  return { first, last, years };
}

const labelOf = (first: { designation: string }, last: { designation: string }): string => (first.designation === last.designation ? first.designation : `${first.designation}–${last.designation}`);

/** Ein Fehler an `lastFiscalYearId`, wenn die Jahre keinen Zeitraum bilden: vor dem ersten, mehr als drei, mit Lücke. */
function rangeProblem(range: { first: FinanceFiscalYearRow; last: FinanceFiscalYearRow; years: FinanceFiscalYearRow[] }): Result<never> | null {
  if (range.last.startsOn < range.first.startsOn) return invalid([{ path: 'lastFiscalYearId', message: 'beforeFirst' }]);
  if (range.years.length > 3) return invalid([{ path: 'lastFiscalYearId', message: 'tooManyYears' }]);
  for (let i = 1; i < range.years.length; i++) if (range.years[i]!.startsOn !== dayAfter(range.years[i - 1]!.endsOn)) return invalid([{ path: 'lastFiscalYearId', message: 'notConsecutive' }]);
  return null;
}

/** Die Fassungen von `taxReturnGem` des Zeitraums. `params` ist kanonisches JSON mit genau einem Schlüssel (`reporting/hash.ts`). */
const paramsOfPeriod = (id: string): string => JSON.stringify({ taxPeriodId: id });

function hasFinalVersion(db: DbOrTx, id: string): boolean {
  return !!db.select({ id: financeReports.id }).from(financeReports).where(and(eq(financeReports.reportKey, 'taxReturnGem'), eq(financeReports.params, paramsOfPeriod(id)), isNull(financeReports.voidedAt))).get();
}

function parseAnswers(json: string): GemAnswers {
  const parsed = gemAnswersSchema.safeParse(JSON.parse(json));
  return parsed.success ? parsed.data : {};
}

function viewOf(db: DbOrTx, row: FinanceTaxPeriodRow): TaxPeriodRecordView {
  const range = yearsBetween(db, row.firstFiscalYearId, row.lastFiscalYearId)!;
  const docIds = TAX_PERIOD_DOCUMENT_SLOTS.map((slot) => [slot, row[SLOT_COLUMN[slot]]] as const).filter((e): e is readonly [TaxPeriodDocumentSlot, string] => e[1] !== null);
  const numbers = new Map(docIds.length > 0 ? db.select({ id: documents.id, number: documents.number }).from(documents).where(inArray(documents.id, docIds.map(([, id]) => id))).all().map((d) => [d.id, d.number ?? ''] as const) : []);
  const filedReport = row.filedReportId ? db.select({ voidedAt: financeReports.voidedAt }).from(financeReports).where(eq(financeReports.id, row.filedReportId)).get() : undefined;
  const noticeHolds = noticeHoldsInternal(db, row.noticeId);
  return {
    id: row.id,
    firstFiscalYearId: row.firstFiscalYearId,
    lastFiscalYearId: row.lastFiscalYearId,
    fiscalYearIds: range.years.map((y) => y.id),
    label: labelOf(range.first, range.last),
    requestedOn: row.requestedOn,
    withTaxAdvisor: row.withTaxAdvisor,
    dueOn: row.dueOn,
    filedOn: row.filedOn,
    filedReportId: row.filedReportId,
    filedReportVoided: Boolean(filedReport?.voidedAt),
    documents: Object.fromEntries(docIds.map(([slot, id]) => [slot, { documentId: id, documentNumber: numbers.get(id) ?? '' }])),
    noticeId: row.noticeId,
    answers: parseAnswers(row.answersJson),
    yearsLocked: hasFinalVersion(db, row.id),
    state: noticeHolds ? 'assessed' : row.filedOn ? 'filed' : 'open',
    version: row.updatedAt,
  };
}

/** Ein verknüpfter Bescheid, der nicht storniert ist: Er trägt die Veranlagung. Ein stornierter trug nie (Befund 17 a). */
function noticeHoldsInternal(db: DbOrTx, noticeId: string | null): boolean {
  if (!noticeId) return false;
  const notice = db.select({ voidedAt: financeNotices.voidedAt }).from(financeNotices).where(eq(financeNotices.id, noticeId)).get();
  return !!notice && notice.voidedAt === null;
}

/** Ohne Rechteprüfung: die Zeile des Zeitraums, oder `null`. */
export function taxPeriodRowInternal(db: DbOrTx, id: string): FinanceTaxPeriodRow | null {
  return loadRow(db, id);
}

function loadRow(db: DbOrTx, id: string): FinanceTaxPeriodRow | null {
  return db.select().from(financeTaxPeriods).where(eq(financeTaxPeriods.id, id)).get() ?? null;
}

/** Ohne Rechteprüfung: der Zeitraum, oder `null`. */
export function taxPeriodInternal(db: DbOrTx, id: string): TaxPeriodRecordView | null {
  const row = loadRow(db, id);
  return row ? viewOf(db, row) : null;
}

/** Ohne Rechteprüfung: alle Zeiträume, neuester zuerst (nach dem Beginn des letzten Jahres). */
export function taxPeriodsInternal(db: DbOrTx): TaxPeriodRecordView[] {
  const starts = new Map(db.select({ id: financeFiscalYears.id, startsOn: financeFiscalYears.startsOn }).from(financeFiscalYears).all().map((y) => [y.id, y.startsOn] as const));
  return db
    .select()
    .from(financeTaxPeriods)
    .all()
    .sort((a, b) => (starts.get(b.lastFiscalYearId) ?? '').localeCompare(starts.get(a.lastFiscalYearId) ?? ''))
    .map((row) => viewOf(db, row));
}

/** Ohne Rechteprüfung: der Zeitraum, zu dem das Geschäftsjahr gehört, oder `null`. */
export function taxPeriodOfYearInternal(db: DbOrTx, fiscalYearId: string): TaxPeriodRecordView | null {
  const year = db.select().from(financeFiscalYears).where(eq(financeFiscalYears.id, fiscalYearId)).get();
  if (!year) return null;
  return taxPeriodsInternal(db).find((p) => p.fiscalYearIds.includes(year.id)) ?? null;
}

/** Ohne Rechteprüfung: der Tag der Abgabe des Zeitraums mit diesem Jahr, oder `null` (Schritt 12, Wiederöffnen, § 153 AO). */
export function taxReturnFiledForYearInternal(db: DbOrTx, fiscalYearId: string): string | null {
  return taxPeriodOfYearInternal(db, fiscalYearId)?.filedOn ?? null;
}

/** Ein Jahr eines anderen Zeitraums in `years` → Konflikt mit Bezeichnung und Zeitraum („2025 gehört schon zu 2023–2025“). */
function overlapProblem(db: DbOrTx, years: readonly FinanceFiscalYearRow[], exceptId: string | null): Result<never> | null {
  for (const period of taxPeriodsInternal(db)) {
    if (period.id === exceptId) continue;
    const shared = years.find((y) => period.fiscalYearIds.includes(y.id));
    if (shared) return financeConflict('taxPeriodOverlap', { designation: shared.designation, period: period.label });
  }
  return null;
}

/**
 * Art. 97 § 36 Abs. 3 EGAO (gesetze-im-internet.de, abgerufen 2026-10-25) — Corona-Verlängerungen für die
 * Besteuerungszeiträume 2020–2024: Nr. 1 ersetzt den letzten Februartag (mit Beratung, § 149 Abs. 3 AO), Nr. 3 die
 * „sieben Monate“ (ohne Beratung, § 149 Abs. 2 S. 1 AO) durch zehn (2020, 2021), neun (2022) bzw. acht (2023) Monate;
 * 2024 ohne Beratung gilt wieder der 31.07. Auch diese Tage schiebt § 108 Abs. 3 AO auf den nächsten Werktag.
 */
const EGAO_DEADLINES: Record<number, { withAdvisor?: string; withoutAdvisor?: string }> = {
  2020: { withAdvisor: '2022-08-31', withoutAdvisor: '2021-10-31' },
  2021: { withAdvisor: '2023-08-31', withoutAdvisor: '2022-10-31' },
  2022: { withAdvisor: '2024-07-31', withoutAdvisor: '2023-09-30' },
  2023: { withAdvisor: '2025-05-31', withoutAdvisor: '2024-08-31' },
  2024: { withAdvisor: '2026-04-30' },
};

/**
 * Rein: die Erklärungsfrist eines Kalenderjahres (Veranlagungszeitraum) — ohne Beratung der 31.07. des Folgejahres
 * (§ 149 Abs. 2 S. 1 AO), mit Beratung der letzte Februartag des zweiten Folgejahres (§ 149 Abs. 3 AO), für 2020–2024
 * nach Art. 97 § 36 Abs. 3 EGAO; immer am nächsten Werktag (§ 108 Abs. 3 AO), mit `state` auch nach Landesfeiertagen.
 */
export function declarationDueOn(calendarYear: number, withTaxAdvisor: boolean, state?: FederalState | null): string {
  const table = EGAO_DEADLINES[calendarYear]?.[withTaxAdvisor ? 'withAdvisor' : 'withoutAdvisor'];
  if (table) return nextWorkingDay(table, state);
  if (!withTaxAdvisor) return nextWorkingDay(`${calendarYear + 1}-07-31`, state);
  const target = calendarYear + 2;
  const leap = (target % 4 === 0 && target % 100 !== 0) || target % 400 === 0;
  return nextWorkingDay(`${target}-02-${leap ? '29' : '28'}`, state);
}

/** Rein: der Vorschlag für die Frist eines Erklärungszeitraums — `declarationDueOn` des Kalenderjahres seines Endes. */
export function suggestedDueOn(lastEndsOn: string, withTaxAdvisor: boolean, state?: FederalState | null): string {
  return declarationDueOn(Number(lastEndsOn.slice(0, 4)), withTaxAdvisor, state);
}

/**
 * `finance.read`: Vorschlag für den nächsten Zeitraum — Von ist das Jahr nach dem letzten Zeitraum, ohne Zeitraum das
 * jüngste beendete Jahr; Bis ist Von + 2, soweit die Jahre schon angelegt sind; dazu beide Fristen zum Ende von Bis.
 * `null`, wenn es kein solches Jahr gibt.
 */
/** G7: das Satzungsdatum, wie die Antwort `statuteDate` es vorbelegt — aus Gremien, mit Dokument und Quelle. */
export type TaxStatuteSuggestion = { date: string; documentId: string | null; source: { label: string; href: string } };

function statuteAt(deps: Deps, on: string): TaxStatuteSuggestion | null {
  const found = statuteSuggestionOf(deps, deps.db, on);
  return found ? { date: found.statuteDate, documentId: found.documentId, source: found.source } : null;
}

export async function taxPeriodDefaults(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ firstFiscalYearId: string; lastFiscalYearId: string; dueOn: string; dueOnWithAdvisor: string; statute: TaxStatuteSuggestion | null } | null>> {
  const denied = requireFinanceRead(ctx, 'read');
  if (denied) return denied;
  const parsed = validate(deps, z.object({}).strict(), input ?? {});
  if (!parsed.ok) return parsed;
  const db = deps.db;
  const latest = taxPeriodsInternal(db)[0];
  let year: FinanceFiscalYearRow | undefined;
  if (latest) {
    const last = db.select().from(financeFiscalYears).where(eq(financeFiscalYears.id, latest.lastFiscalYearId)).get()!;
    year = db.select().from(financeFiscalYears).where(eq(financeFiscalYears.startsOn, dayAfter(last.endsOn))).get();
  } else {
    year = db.select().from(financeFiscalYears).where(lte(financeFiscalYears.endsOn, todayIn(deps))).orderBy(desc(financeFiscalYears.endsOn)).get();
  }
  if (!year) return ok(null);
  // Bis = Von + 2 (Joe 2026-10-25, wie die Finanzämter in der Regel prüfen): drei aufeinander folgende Jahre, soweit es
  // sie schon gibt; die Aufforderung überschreibt den Vorschlag.
  let last = year;
  for (let i = 0; i < 2; i++) {
    const next = db.select().from(financeFiscalYears).where(eq(financeFiscalYears.startsOn, dayAfter(last.endsOn))).get();
    if (!next) break;
    last = next;
  }
  return ok({ firstFiscalYearId: year.id, lastFiscalYearId: last.id, dueOn: suggestedDueOn(last.endsOn, false), dueOnWithAdvisor: suggestedDueOn(last.endsOn, true), statute: statuteAt(deps, last.endsOn) });
}

/**
 * `finance.read` (G7, Spec Gremien § 8.1): Vorschlag für „Satzung in der Fassung vom“ eines Erklärungszeitraums — das
 * jüngste Beschlussdatum des Stands, der am Ende des Zeitraums gilt, samt Wortlaut als Dokument. Nur ein Vorschlag:
 * gespeichert wird mit `saveTaxPeriodAnswers`, verknüpft mit `linkTaxPeriodDocument`. Ohne Gremien `null`.
 */
export async function taxPeriodStatute(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<TaxStatuteSuggestion | null>> {
  const denied = requireFinanceRead(ctx, 'read');
  if (denied) return denied;
  const parsed = validate(deps, z.object({ taxPeriodId: z.string().min(1) }), input);
  if (!parsed.ok) return parsed;
  const row = loadRow(deps.db, parsed.value.taxPeriodId);
  if (!row) return notFound('financeTaxPeriod', parsed.value.taxPeriodId);
  const last = deps.db.select().from(financeFiscalYears).where(eq(financeFiscalYears.id, row.lastFiscalYearId)).get()!;
  return ok(statuteAt(deps, last.endsOn));
}

const createSchema = z.object({
  firstFiscalYearId: z.string().min(1),
  lastFiscalYearId: z.string().min(1),
  requestedOn: day.nullable().optional(),
  withTaxAdvisor: z.boolean(),
  dueOn: day,
});

/** `finance.periodClose`: einen Erklärungszeitraum aus ein bis drei aufeinander folgenden Geschäftsjahren anlegen. */
export async function createTaxPeriod(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<TaxPeriodRecordView>> {
  const denied = requirePermission(ctx, 'finance.periodClose');
  if (denied) return denied;
  const parsed = validate(deps, createSchema, input);
  if (!parsed.ok) return parsed;
  const v = parsed.value;
  const range = yearsBetween(deps.db, v.firstFiscalYearId, v.lastFiscalYearId);
  if (!range) return notFound('financeFiscalYear', deps.db.select().from(financeFiscalYears).where(eq(financeFiscalYears.id, v.firstFiscalYearId)).get() ? v.lastFiscalYearId : v.firstFiscalYearId);
  const problem = rangeProblem(range) ?? overlapProblem(deps.db, range.years, null);
  if (problem) return problem;
  return deps.db.transaction((tx: DbOrTx) => {
    const now = isoNow(deps.clock);
    const row: FinanceTaxPeriodRow = {
      id: newId(), firstFiscalYearId: range.first.id, lastFiscalYearId: range.last.id, requestedOn: v.requestedOn ?? null, withTaxAdvisor: v.withTaxAdvisor, dueOn: v.dueOn,
      filedOn: null, filedReportId: null, requestDocumentId: null, filedDocumentId: null, transmissionDocumentId: null, activityReportDocumentId: null, statuteDocumentId: null, noticeId: null,
      answersJson: '{}', filedFigures: null, createdAt: now, createdByUserId: ctx.userId ?? 'system', updatedAt: now,
    };
    tx.insert(financeTaxPeriods).values(row).run();
    financeAudit(tx, deps, ctx, { action: 'finance.taxPeriod.create', entity: 'financeTaxPeriod', id: row.id, after: row, params: { first: range.first.designation, last: range.last.designation, dueOn: v.dueOn } });
    return ok(viewOf(tx, row));
  });
}

const updateSchema = z.object({
  id: z.string().min(1),
  firstFiscalYearId: z.string().min(1).optional(),
  lastFiscalYearId: z.string().min(1).optional(),
  requestedOn: day.nullable().optional(),
  withTaxAdvisor: z.boolean().optional(),
  dueOn: day.optional(),
  /** Abgegeben am — verlangt eine festgeschriebene Fassung von `taxReturnGem`; `null` nimmt die Abgabe zurück. */
  filedOn: day.nullable().optional(),
  expectedVersion: expectedVersionField,
});

/** Die jüngste nicht stornierte festgeschriebene Fassung von `taxReturnGem` des Zeitraums, oder `null`. */
function latestFinalVersion(db: DbOrTx, id: string): string | null {
  return db.select({ id: financeReports.id }).from(financeReports).where(and(eq(financeReports.reportKey, 'taxReturnGem'), eq(financeReports.params, paramsOfPeriod(id)), isNull(financeReports.voidedAt))).orderBy(desc(financeReports.finalizedAt), desc(financeReports.id)).get()?.id ?? null;
}

/** Ohne Rechteprüfung: Hat der Zeitraum eine Berichtigung oder Prüfung (B9)? Dann bleibt die erste Abgabe. */
export function taxPeriodAmendedInternal(db: DbOrTx, id: string): boolean {
  return !!db.select({ id: financeTaxAmendments.id }).from(financeTaxAmendments).where(eq(financeTaxAmendments.taxPeriodId, id)).get() || !!db.select({ id: financeTaxAmendmentChecks.id }).from(financeTaxAmendmentChecks).where(eq(financeTaxAmendmentChecks.taxPeriodId, id)).get();
}

/**
 * Der Dienst `updateTaxPeriod` ohne Prüfanlass — er steht in `reporting/tax-amendments.ts`, weil das Abbild der ersten
 * Abgabe (`figuresOf`) die Berichte rechnet, die ihrerseits den Zeitraum lesen.
 *
 * Jahre, Aufforderung, Beratung, Frist und Abgabe ändern. Die Jahre stehen fest, sobald eine Fassung von `taxReturnGem`
 * festgeschrieben ist (`taxPeriodYearsLocked`); Tage und Frist bleiben änderbar. Die erste Abgabe („Abgegeben am“, nicht
 * in der Zukunft, nicht vor der Aufforderung) verlangt eine festgeschriebene Fassung (`taxReturnNotFinal`), merkt sich
 * die jüngste und hält das Abbild der Werte fest (B9). Danach ändert `filedOn` nur noch den Tag; Fassung und Abbild
 * bleiben. `null` nimmt die Abgabe zurück — nicht mehr hinter einen Bescheid (`taxPeriodNoticeLinked`) und nicht hinter
 * eine Berichtigung oder Prüfung (`taxPeriodAmended`). Die Abgabe ist eine Tatsache, keine persönliche Erklärung — kein
 * `humanOnly` (wie die Abgabe der Umsatzsteuer-Jahreserklärung).
 */
export async function updateTaxPeriodInternal(deps: Deps, ctx: CallContext, input: unknown, figuresOf: (tx: DbOrTx, id: string) => string | null): Promise<Result<TaxPeriodRecordView>> {
  const denied = requirePermission(ctx, 'finance.periodClose');
  if (denied) return denied;
  const parsed = validate(deps, updateSchema, input);
  if (!parsed.ok) return parsed;
  const v = parsed.value;
  const before = loadRow(deps.db, v.id);
  if (!before) return notFound('financeTaxPeriod', v.id);
  const stale = staleVersion(v.expectedVersion, before.updatedAt);
  if (stale) return stale;
  const firstId = v.firstFiscalYearId ?? before.firstFiscalYearId;
  const lastId = v.lastFiscalYearId ?? before.lastFiscalYearId;
  const yearsChange = firstId !== before.firstFiscalYearId || lastId !== before.lastFiscalYearId;
  const range = yearsBetween(deps.db, firstId, lastId);
  if (!range) return notFound('financeFiscalYear', deps.db.select().from(financeFiscalYears).where(eq(financeFiscalYears.id, firstId)).get() ? lastId : firstId);
  if (yearsChange) {
    if (hasFinalVersion(deps.db, before.id)) return financeConflict('taxPeriodYearsLocked', { period: viewOf(deps.db, before).label });
    const problem = rangeProblem(range) ?? overlapProblem(deps.db, range.years, before.id);
    if (problem) return problem;
  }
  const requestedOn = v.requestedOn === undefined ? before.requestedOn : v.requestedOn;
  const filedOn = v.filedOn;
  const filing = filedOn !== undefined;
  let filedReportId = before.filedReportId;
  const firstFiling = filedOn !== undefined && filedOn !== null && before.filedOn === null;
  if (filedOn !== undefined && filedOn !== null) {
    if (filedOn > todayIn(deps)) return invalid([{ path: 'filedOn', message: 'inFuture' }]);
    if (requestedOn && filedOn < requestedOn) return invalid([{ path: 'filedOn', message: 'beforeRequested' }]);
    if (firstFiling) {
      filedReportId = latestFinalVersion(deps.db, before.id);
      if (!filedReportId) return financeConflict('taxReturnNotFinal', { period: labelOf(range.first, range.last) });
    }
  }
  // Ein Bescheid gehört zu einer abgegebenen Erklärung: Solange einer verknüpft ist, bleibt die Abgabe (Befund 16 c).
  // Ein stornierter Bescheid sperrt nicht (Befund 17 a); mit der Abgabe fällt dann auch seine Verknüpfung.
  if (filedOn === null && before.filedOn !== null && noticeHoldsInternal(deps.db, before.noticeId)) return financeConflict('taxPeriodNoticeLinked', { period: labelOf(range.first, range.last) });
  // B9 (N24): Die erste Abgabe bleibt, sobald eine Berichtigung oder Prüfung auf sie folgt.
  if (filedOn === null && before.filedOn !== null && taxPeriodAmendedInternal(deps.db, before.id)) return financeConflict('taxPeriodAmended', { period: labelOf(range.first, range.last) });
  if (filedOn === null) filedReportId = null;
  const noticeId = filedOn === null ? null : before.noticeId;
  return deps.db.transaction((tx: DbOrTx) => {
    const after: FinanceTaxPeriodRow = {
      ...before,
      firstFiscalYearId: firstId,
      lastFiscalYearId: lastId,
      requestedOn,
      filedOn: filedOn === undefined ? before.filedOn : filedOn,
      filedReportId,
      noticeId,
      filedFigures: filedOn === null ? null : firstFiling ? figuresOf(tx, before.id) : before.filedFigures,
      withTaxAdvisor: v.withTaxAdvisor ?? before.withTaxAdvisor,
      dueOn: v.dueOn ?? before.dueOn,
      updatedAt: isoNow(deps.clock),
    };
    tx.update(financeTaxPeriods).set(after).where(eq(financeTaxPeriods.id, before.id)).run();
    const period = labelOf(range.first, range.last);
    if (filing) financeAudit(tx, deps, ctx, { action: 'finance.taxPeriod.filed', entity: 'financeTaxPeriod', id: before.id, before, after, params: { period, filedOn: after.filedOn } });
    else financeAudit(tx, deps, ctx, { action: 'finance.taxPeriod.update', entity: 'financeTaxPeriod', id: before.id, before, after, params: { period } });
    return ok(viewOf(tx, after));
  });
}

const answersSaveSchema = z.object({ id: z.string().min(1), answers: gemAnswersSchema, acknowledgeFiled: z.boolean().optional(), expectedVersion: expectedVersionField });

/**
 * `finance.periodClose`: die „Angaben von Ihnen“ speichern — vollständig, sie ersetzen die bisherigen. „Nein“ in Zeile 74
 * verwirft die Liste der Zuwendungen. Angaben zu einer Rücklage, die der Bericht nicht kennt, bleiben stehen; der
 * Bericht übergeht sie. Das Protokoll nennt nur den Zeitraum, nie den Inhalt. Nach der Abgabe bleiben die Angaben
 * änderbar (B9, F1), aber nur mit der Bestätigung `acknowledgeFiled` (`taxPeriodFiledUnacknowledged`, wie
 * `section153Unacknowledged`): Ändert die Angabe einen Wert, meldet Kompass einen Prüfanlass (§ 153 AO).
 */
export async function saveTaxPeriodAnswers(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<TaxPeriodRecordView>> {
  const denied = requirePermission(ctx, 'finance.periodClose');
  if (denied) return denied;
  const parsed = validate(deps, answersSaveSchema, input);
  if (!parsed.ok) return parsed;
  const v = parsed.value;
  const before = loadRow(deps.db, v.id);
  if (!before) return notFound('financeTaxPeriod', v.id);
  const stale = staleVersion(v.expectedVersion, before.updatedAt);
  if (stale) return stale;
  if (before.filedOn !== null && v.acknowledgeFiled !== true) return financeConflict('taxPeriodFiledUnacknowledged', { period: viewOf(deps.db, before).label });
  const answers: GemAnswers = { ...v.answers };
  if (answers.gratuitousBenefits === false) delete answers.gratuitousBenefitList;
  if (answers.feeResolution === 'none') delete answers.feeResolutionSubmission;
  return deps.db.transaction((tx: DbOrTx) => {
    const after: FinanceTaxPeriodRow = { ...before, answersJson: JSON.stringify(answers), updatedAt: isoNow(deps.clock) };
    tx.update(financeTaxPeriods).set(after).where(eq(financeTaxPeriods.id, before.id)).run();
    financeAudit(tx, deps, ctx, { action: 'finance.taxPeriod.answers', entity: 'financeTaxPeriod', id: before.id, params: { period: viewOf(tx, before).label } });
    return ok(viewOf(tx, after));
  });
}

const DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;
const isPdf = (bytes: Uint8Array): boolean => bytes.length >= 5 && new TextDecoder().decode(bytes.subarray(0, 5)) === '%PDF-';
/** B9: Wohin ein Dokument gehört — an den Zeitraum (erste Abgabe), an eine Berichtigung oder an die Anzeige des laufenden Anlasses. */
export const TAX_DOCUMENT_TARGETS = ['period', 'amendment', 'notice'] as const;
export type TaxDocumentTarget = (typeof TAX_DOCUMENT_TARGETS)[number];
const ALL_SLOTS = [...TAX_PERIOD_DOCUMENT_SLOTS, 'notice'] as const;
type AnySlot = (typeof ALL_SLOTS)[number];
const targetFields = { target: z.enum(TAX_DOCUMENT_TARGETS).optional(), amendmentId: z.string().min(1).optional() };
const fileSchema = z.object({ id: z.string().min(1), slot: z.enum(ALL_SLOTS), bytes: z.custom<Uint8Array>((val) => val instanceof Uint8Array, { message: 'invalidBytes' }), fileName: z.string().trim().max(300).optional(), ...targetFields });
const linkSchema = z.object({ id: z.string().min(1), slot: z.enum(ALL_SLOTS), documentId: z.string().min(1), ...targetFields });

const AMENDMENT_SLOT_COLUMN = { filedReturn: 'filedReturnDocumentId', transmissionProtocol: 'transmissionProtocolDocumentId' } as const;
const AMENDMENT_SUBJECT = { filedReturn: 'Berichtigte Steuererklärung', transmissionProtocol: 'ELSTER-Übertragungsprotokoll der Berichtigung' } as const;
const NOTICE_SUBJECT = 'Anzeige nach § 153 AO zur Steuererklärung';

/**
 * Ohne Rechteprüfung (B9): die Anzeige des laufenden Prüfanlasses — eine Anzeige, die nach dem jüngsten Maßstab
 * (Berichtigung oder Prüfung ohne Berichtigung, sonst die erste Abgabe) eingetragen ist; sonst `null`. Dieselbe Regel
 * liest `reporting/tax-figures.ts`.
 */
export function currentTaxNoticeInternal(db: DbOrTx, taxPeriodId: string) {
  const lastAmendment = db.select({ at: financeTaxAmendments.at }).from(financeTaxAmendments).where(eq(financeTaxAmendments.taxPeriodId, taxPeriodId)).orderBy(desc(financeTaxAmendments.at)).get()?.at ?? '';
  const checks = db.select().from(financeTaxAmendmentChecks).where(eq(financeTaxAmendmentChecks.taxPeriodId, taxPeriodId)).orderBy(asc(financeTaxAmendmentChecks.at), asc(financeTaxAmendmentChecks.id)).all();
  const lastClosed = checks.filter((c) => c.kind === 'noAmendment').at(-1)?.at ?? '';
  const reference = lastAmendment > lastClosed ? lastAmendment : lastClosed;
  return checks.filter((c) => c.kind === 'notified' && c.at > reference).at(-1) ?? null;
}

/** Ziel und Fach passen zusammen; die Berichtigung gehört zum Zeitraum, die Anzeige ist eingetragen. */
type Placement = { target: 'period'; slot: TaxPeriodDocumentSlot } | { target: 'amendment'; slot: keyof typeof AMENDMENT_SLOT_COLUMN; amendmentId: string } | { target: 'notice'; checkId: string };
function placementOf(db: DbOrTx, row: FinanceTaxPeriodRow, v: { slot: AnySlot; target?: TaxDocumentTarget; amendmentId?: string }): Result<Placement> {
  const target = v.target ?? 'period';
  if (target === 'period') return v.slot === 'notice' ? invalid([{ path: 'slot', message: 'wrongTarget' }]) : ok({ target, slot: v.slot });
  if (target === 'notice') {
    if (v.slot !== 'notice') return invalid([{ path: 'slot', message: 'wrongTarget' }]);
    const notice = currentTaxNoticeInternal(db, row.id);
    return notice ? ok({ target, checkId: notice.id }) : financeConflict('taxAmendmentNoNotice', { period: viewOf(db, row).label });
  }
  if (!v.amendmentId) return invalid([{ path: 'amendmentId', message: 'required' }]);
  if (v.slot !== 'filedReturn' && v.slot !== 'transmissionProtocol') return invalid([{ path: 'slot', message: 'wrongTarget' }]);
  const amendment = db.select({ id: financeTaxAmendments.id, taxPeriodId: financeTaxAmendments.taxPeriodId }).from(financeTaxAmendments).where(eq(financeTaxAmendments.id, v.amendmentId)).get();
  if (!amendment || amendment.taxPeriodId !== row.id) return notFound('financeTaxAmendment', v.amendmentId);
  return ok({ target, slot: v.slot, amendmentId: amendment.id });
}

/** In der Transaktion: Platz setzen, Bezüge auf Zeitraum, letztes Geschäftsjahr und Berichtigung bzw. Anzeige, Protokoll. */
function setSlotInternal(tx: DbOrTx, deps: Deps, ctx: CallContext, row: FinanceTaxPeriodRow, placement: Placement, doc: { id: string; number: string }, action: 'finance.taxPeriod.documentFile' | 'finance.taxPeriod.documentLink'): TaxPeriodRecordView {
  let after: FinanceTaxPeriodRow = row;
  if (placement.target === 'period') {
    after = { ...row, [SLOT_COLUMN[placement.slot]]: doc.id, updatedAt: isoNow(deps.clock) };
    tx.update(financeTaxPeriods).set(after).where(eq(financeTaxPeriods.id, row.id)).run();
  } else if (placement.target === 'amendment') {
    tx.update(financeTaxAmendments).set({ [AMENDMENT_SLOT_COLUMN[placement.slot]]: doc.id }).where(eq(financeTaxAmendments.id, placement.amendmentId)).run();
    linkDocumentInternal(tx, deps, { documentId: doc.id, entityType: 'financeTaxAmendment', entityId: placement.amendmentId });
  } else {
    tx.update(financeTaxAmendmentChecks).set({ documentId: doc.id }).where(eq(financeTaxAmendmentChecks.id, placement.checkId)).run();
    linkDocumentInternal(tx, deps, { documentId: doc.id, entityType: 'financeTaxAmendmentCheck', entityId: placement.checkId });
  }
  linkDocumentInternal(tx, deps, { documentId: doc.id, entityType: 'financeTaxPeriod', entityId: row.id });
  linkDocumentInternal(tx, deps, { documentId: doc.id, entityType: 'financeFiscalYear', entityId: row.lastFiscalYearId });
  const view = viewOf(tx, after);
  const slot = placement.target === 'notice' ? 'notice' : placement.slot;
  financeAudit(tx, deps, ctx, { action, entity: 'financeTaxPeriod', id: row.id, ...(placement.target === 'period' ? { before: row, after } : {}), params: { period: view.label, slot, documentNumber: doc.number, target: placement.target } });
  return view;
}

/**
 * `finance.periodClose`: ein PDF (bis 10 MB) als Art `finance-tax-return` am Zeitraum und seinem letzten Jahr ablegen und
 * auf den Platz setzen — mit `target` an eine Berichtigung (`amendmentId`, Fächer `filedReturn`, `transmissionProtocol`)
 * oder als Anzeigeschreiben an die Anzeige des laufenden Anlasses (Fach `notice`, B9).
 */
export async function fileTaxPeriodDocument(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<TaxPeriodRecordView>> {
  const denied = requirePermission(ctx, 'finance.periodClose');
  if (denied) return denied;
  const parsed = validate(deps, fileSchema, input);
  if (!parsed.ok) return parsed;
  const v = parsed.value;
  if (v.bytes.length > DOCUMENT_MAX_BYTES) return invalid([{ path: 'bytes', message: 'tooLarge' }]);
  if (!isPdf(v.bytes)) return invalid([{ path: 'bytes', message: 'notPdf' }]);
  const row = loadRow(deps.db, v.id);
  if (!row) return notFound('financeTaxPeriod', v.id);
  const placement = placementOf(deps.db, row, v);
  if (!placement.ok) return placement;
  const label = viewOf(deps.db, row).label;
  const p = placement.value;
  const subject = p.target === 'period' ? SLOT_SUBJECT[p.slot] : p.target === 'amendment' ? AMENDMENT_SUBJECT[p.slot] : NOTICE_SUBJECT;
  const links = [{ entityType: 'financeTaxPeriod', entityId: row.id }, { entityType: 'financeFiscalYear', entityId: row.lastFiscalYearId }];
  if (p.target === 'amendment') links.push({ entityType: 'financeTaxAmendment', entityId: p.amendmentId });
  if (p.target === 'notice') links.push({ entityType: 'financeTaxAmendmentCheck', entityId: p.checkId });
  const filed = await receiveGeneratedUpload(deps, ctx, {
    bytes: v.bytes,
    typeKey: TAX_RETURN_DOCUMENT_TYPE,
    subject: `${subject} ${label}`,
    documentDate: p.target === 'period' && p.slot === 'request' && row.requestedOn ? row.requestedOn : todayIn(deps),
    links,
    afterReceive: (tx, doc) => setSlotInternal(tx, deps, ctx, loadRow(tx, row.id)!, p, { id: doc.id, number: doc.number ?? '' }, 'finance.taxPeriod.documentFile'),
  });
  if (!filed.ok) return filed;
  return ok(filed.value.after!);
}

/** `finance.periodClose`: ein Dokument aus der Akte (ausgestellt, nicht storniert) auf einen Platz setzen — Ziele wie beim Ablegen. */
export async function linkTaxPeriodDocument(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<TaxPeriodRecordView>> {
  const denied = requirePermission(ctx, 'finance.periodClose');
  if (denied) return denied;
  const parsed = validate(deps, linkSchema, input);
  if (!parsed.ok) return parsed;
  const v = parsed.value;
  const row = loadRow(deps.db, v.id);
  if (!row) return notFound('financeTaxPeriod', v.id);
  const placement = placementOf(deps.db, row, v);
  if (!placement.ok) return placement;
  const doc = await getDocumentRecord(deps, ctx, v.documentId);
  if (!doc.ok) return doc;
  if (doc.value.status === 'voided') return invalid([{ path: 'documentId', message: 'documentVoided' }]);
  if (doc.value.phase !== 'issued') return invalid([{ path: 'documentId', message: 'documentNotFinal' }]);
  return deps.db.transaction((tx: DbOrTx) => ok(setSlotInternal(tx, deps, ctx, loadRow(tx, row.id)!, placement.value, { id: doc.value.id, number: doc.value.number ?? '' }, 'finance.taxPeriod.documentLink')));
}

const noticeLinkSchema = z.object({ id: z.string().min(1), noticeId: z.string().min(1), expectedVersion: expectedVersionField });

/**
 * `finance.periodClose`: den Bescheid zum abgegebenen Zeitraum verknüpfen (`taxPeriodNotFiled` vorher) — ein Eintrag der
 * Bescheide (Freistellungsbescheid oder Anlage zum Körperschaftsteuerbescheid, nicht storniert): Gültigkeit,
 * Ablaufhemmung und Kopie an die Bank laufen dort weiter. Danach ist der Zeitraum „veranlagt“.
 */
export async function linkTaxPeriodNotice(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<TaxPeriodRecordView>> {
  const denied = requirePermission(ctx, 'finance.periodClose');
  if (denied) return denied;
  const parsed = validate(deps, noticeLinkSchema, input);
  if (!parsed.ok) return parsed;
  const v = parsed.value;
  const before = loadRow(deps.db, v.id);
  if (!before) return notFound('financeTaxPeriod', v.id);
  const stale = staleVersion(v.expectedVersion, before.updatedAt);
  if (stale) return stale;
  const label = viewOf(deps.db, before).label;
  if (!before.filedOn) return financeConflict('taxPeriodNotFiled', { period: label });
  const notice = deps.db.select().from(financeNotices).where(eq(financeNotices.id, v.noticeId)).get();
  if (!notice) return notFound('financeNotice', v.noticeId);
  if (notice.kind !== 'exemptionNotice' && notice.kind !== 'corporateTaxNoticeAttachment') return invalid([{ path: 'noticeId', message: 'wrongKind' }]);
  if (notice.voidedAt !== null) return invalid([{ path: 'noticeId', message: 'noticeVoided' }]);
  return deps.db.transaction((tx: DbOrTx) => {
    const after: FinanceTaxPeriodRow = { ...before, noticeId: notice.id, updatedAt: isoNow(deps.clock) };
    tx.update(financeTaxPeriods).set(after).where(eq(financeTaxPeriods.id, before.id)).run();
    financeAudit(tx, deps, ctx, { action: 'finance.taxPeriod.noticeLink', entity: 'financeTaxPeriod', id: before.id, before, after, params: { period: label } });
    return ok(viewOf(tx, after));
  });
}
