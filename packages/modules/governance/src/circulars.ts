import { invalid, isoNow, newId, notFound, ok, recordAudit, requirePermission, validate, type CallContext, type DbOrTx, type Deps, type Result } from '@kompass/core';
import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { governanceConflict } from './errors';
import { organMembersOnInternal } from './invitation/board';
import { invitationRecipientsInternal } from './invitation/runs';
import { evaluateMajority } from './majority';
import { proposedExclusionsInternal } from './exclusions';
import { DETAILS_HINT, detailWarningsInternal, type DetailWarning } from './resolution-details';
import { parseDetailsInternal } from './resolutions';
import { LAW_FALLBACK } from './rules/law';
import { resolveRule } from './rules/resolve';
import { RESOLUTION_KINDS, type Majority } from './rules/schema';
import { CIRCULAR_ANSWERS, CIRCULAR_CHANNELS, governanceCircularResponses, governanceCirculars, governanceOrgans, governanceResolutions, RESOLUTION_OUTCOMES, type CircularResponseRow, type CircularRow } from './schema';
import { statuteRulesOnInternal } from './statutes';

const DAY = z.iso.date();
const id = z.string().min(1);

/** `answerAfterDeadline`: eine Antwort trägt einen Tag nach der Frist (G-18) — sie zählt, die Leitung entscheidet. */
/** `excludedAnswered`: jemand, der nach § 34 BGB vom Stimmrecht ausgeschlossen wäre (etwa Inhaber eines vergüteten Amts), hat geantwortet (L-1). */
export type CircularWarning = 'circularNotAllowed' | 'outcomeAgainstCount' | 'answerAfterDeadline' | 'excludedAnswered' | DetailWarning;
export interface CircularEvaluation {
  consent: 'all' | Majority;
  reached: boolean;
  /** Organmitglieder ohne Antwort. */
  missing: number;
  /** Nötige Zustimmungen: bei `all` jede Antwortzeile, sonst nach der Mehrheit (Plan U2). */
  needed: number;
  yes: number;
  no: number;
  abstain: number;
  /** Zahl der Antwortzeilen. */
  total: number;
  /** Tag der Ja-Antwort, mit der `needed` erreicht wurde. */
  reachedOn: string | null;
  /** Mit allen offenen Antworten als Ja noch erreichbar. */
  possible: boolean;
}
export type CircularView = CircularRow & { responses: CircularResponseRow[]; evaluation: CircularEvaluation; warnings: CircularWarning[] };

export const circularCreateSchema = z.object({
  organId: id,
  kind: z.enum(RESOLUTION_KINDS),
  text: z.string().trim().min(1).max(20000),
  details: z.unknown().optional().describe(DETAILS_HINT),
  requestedOn: DAY,
  deadline: DAY,
  channel: z.enum(CIRCULAR_CHANNELS),
});
export const circularResponseSchema = z.object({
  /** Die Antwort-Zeile (je Organmitglied angelegt). */
  id,
  answer: z.enum(CIRCULAR_ANSWERS),
  answeredOn: DAY.nullable().optional(),
  /** Nachweis in der Akte (Mail, Bildschirmfoto) … */
  documentId: id.nullable().optional(),
  /** … oder ein Vermerk statt eines Dokuments (Messenger). */
  note: z.string().trim().max(1000).nullable().optional(),
});
export const circularDecideSchema = z.object({ id, outcome: z.enum(RESOLUTION_OUTCOMES), outcomeReason: z.string().trim().min(1).max(2000).nullable().optional(), decidedOn: DAY, decidedByContactId: id });
export const circularIdSchema = z.object({ id });
export const circularListSchema = z.object({ organId: id.optional(), year: z.number().int().min(1900).max(9999).optional() });

const rowOf = (db: DbOrTx, circularId: string) => db.select().from(governanceCirculars).where(eq(governanceCirculars.id, circularId)).get() ?? null;
const responsesOf = (db: DbOrTx, circularId: string) =>
  db.select().from(governanceCircularResponses).where(eq(governanceCircularResponses.circularId, circularId)).orderBy(asc(governanceCircularResponses.createdAt), asc(governanceCircularResponses.id)).all();

/** Die Regel des Organs am Anfragetag; ohne Satzungsregel § 32 Abs. 3 BGB (alle, Textform). */
function circularRule(db: DbOrTx, row: Pick<CircularRow, 'organId' | 'requestedOn'>) {
  return resolveRule(statuteRulesOnInternal(db, row.requestedOn).rules, row.organId, 'circular').value ?? null;
}

/**
 * Kam der Umlauf zustande? (Spec § 5.6) Zustimmung aller: nur, wenn jede Antwort `yes` ist — jede Enthaltung oder
 * fehlende Antwort lässt ihn scheitern (Rechtsprüfung S4). Mit Mehrheit: wie in der Sitzung, Bezugsgröße die
 * Organmitglieder.
 */
export function evaluateCircularInternal(db: DbOrTx, circularId: string): CircularEvaluation {
  const row = rowOf(db, circularId)!;
  const responses = responsesOf(db, circularId);
  const consent = (circularRule(db, row) ?? LAW_FALLBACK.circular.value!).consent;
  const count = (a: CircularResponseRow['answer']) => responses.filter((r) => r.answer === a).length;
  const [yes, no, abstain, missing] = [count('yes'), count('no'), count('abstain'), count('none')];
  const total = responses.length;
  const yesDays = responses.filter((r) => r.answer === 'yes').map((r) => r.answeredOn ?? '').sort();
  const dayOf = (needed: number) => (yesDays.length >= needed && needed > 0 ? yesDays[needed - 1] || null : null);
  const numbers = { yes, no, abstain, total, missing };
  if (consent === 'all') {
    const reached = total > 0 && yes === total;
    return { consent, reached, ...numbers, needed: total, reachedOn: reached ? dayOf(total) : null, possible: total > 0 && no === 0 && abstain === 0 };
  }
  const tie = resolveRule(statuteRulesOnInternal(db, row.requestedOn).rules, row.organId, 'tie').value ?? 'rejected';
  const evaluate = (y: number) => evaluateMajority({ majority: consent, votes: { yes: y, no, abstain, invalid: 0 }, presentVoting: total, allVoting: total, excluded: 0, tie });
  const result = evaluate(yes);
  const reached = result.reached === true;
  return { consent, reached, ...numbers, needed: result.needed, reachedOn: reached ? dayOf(result.needed) : null, possible: reached || evaluate(yes + missing).reached !== false };
}

const against = (outcome: CircularRow['outcome'], reached: boolean) => (outcome === 'adopted' && !reached) || (outcome === 'rejected' && reached);

export function circularViewInternal(db: DbOrTx, row: CircularRow): CircularView {
  const evaluation = evaluateCircularInternal(db, row.id);
  const warnings: CircularWarning[] = [];
  if (circularRule(db, row)?.allowed !== true) warnings.push('circularNotAllowed');
  if (against(row.outcome, evaluation.reached)) warnings.push('outcomeAgainstCount');
  const responses = responsesOf(db, row.id);
  if (responses.some((r) => r.answer !== 'none' && r.answeredOn !== null && r.answeredOn > row.deadline)) warnings.push('answerAfterDeadline');
  // K-5: Dieselben Hinweise aus den Angaben wie bei einem Sitzungsbeschluss (`detailsMissing`, Vergütung ohne Satzungsgrundlage …).
  const day = row.decidedOn ?? row.requestedOn;
  // Nach dem Festschreiben steht der Beschluss des Umlaufs am Stand (L-3).
  const sealedId = row.sealedAt ? (db.select({ id: governanceResolutions.id }).from(governanceResolutions).where(eq(governanceResolutions.circularId, row.id)).get()?.id ?? null) : null;
  warnings.push(...detailWarningsInternal(db, { id: sealedId, kind: row.kind, details: row.details, decidedOn: day, organId: row.organId }, statuteRulesOnInternal(db, day).rules));
  // L-1: Im Umlauf gibt es keinen Abzug — wer betroffen ist und trotzdem geantwortet hat, steht als Hinweis da (§ 34 BGB).
  const excluded = new Set(proposedExclusionsInternal(db, { kind: row.kind, details: row.details, decidedOn: day, organId: row.organId }).map((e) => e.contactId));
  if (responses.some((r) => r.answer !== 'none' && r.contactId !== null && excluded.has(r.contactId))) warnings.push('excludedAnswered');
  return { ...row, responses, evaluation, warnings };
}

/** Wer antworten soll: die Amtsinhaber des Organs, bei der Versammlung die stimmberechtigten Mitglieder am Tag. */
function respondentsOn(db: DbOrTx, deps: Deps, organId: string, day: string): string[] {
  const assembly = db.select().from(governanceOrgans).where(eq(governanceOrgans.id, organId)).get()?.kind === 'assembly';
  return assembly ? [...new Set(invitationRecipientsInternal(db, deps, day).filter((m) => m.hasVotingRight).map((m) => m.contactId))] : organMembersOnInternal(db, organId, day);
}

/** Erfasst einen Umlauf (Kompass verschickt nicht): je Organmitglied am Anfragetag eine Antwort „keine“. */
export async function createCircular(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<CircularView>> {
  const denied = requirePermission(ctx, 'governance.manage');
  if (denied) return denied;
  const parsed = validate(deps, circularCreateSchema, input);
  if (!parsed.ok) return parsed;
  const v = parsed.value;
  if (v.deadline < v.requestedOn) return invalid([{ path: 'deadline', message: 'beforeRequest' }]);
  if (!deps.db.select({ id: governanceOrgans.id }).from(governanceOrgans).where(eq(governanceOrgans.id, v.organId)).get()) return notFound('governanceOrgan', v.organId);
  let details: unknown = null;
  if (v.details !== undefined) {
    const checked = parseDetailsInternal(deps, v.kind, v.details);
    if (!checked.ok) return checked;
    details = checked.value;
  }
  const now = isoNow(deps.clock);
  return deps.db.transaction((tx: DbOrTx) => {
    const row: CircularRow = { id: newId(), organId: v.organId, kind: v.kind, text: v.text, details, requestedOn: v.requestedOn, deadline: v.deadline, channel: v.channel, outcome: null, outcomeReason: null, decidedOn: null, decidedByContactId: null, sealedAt: null, createdAt: now, updatedAt: now };
    tx.insert(governanceCirculars).values(row).run();
    for (const contactId of respondentsOn(tx, deps, v.organId, v.requestedOn)) tx.insert(governanceCircularResponses).values({ id: newId(), circularId: row.id, contactId, answer: 'none', answeredOn: null, documentId: null, note: null, createdAt: now, updatedAt: now }).run();
    recordAudit(tx, deps, ctx, { action: 'governance.circular.create', entityType: 'governanceCircular', entityId: row.id, after: { kind: row.kind, requestedOn: row.requestedOn, deadline: row.deadline, channel: row.channel }, params: { kind: row.kind, organId: row.organId } });
    return ok(circularViewInternal(tx, row));
  });
}

/** Hält eine Antwort fest (Zustimmung, Ablehnung, Enthaltung, keine) mit Tag und Nachweis oder Vermerk. */
export async function saveCircularResponse(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<CircularView>> {
  const denied = requirePermission(ctx, 'governance.manage');
  if (denied) return denied;
  const parsed = validate(deps, circularResponseSchema, input);
  if (!parsed.ok) return parsed;
  const v = parsed.value;
  const response = deps.db.select().from(governanceCircularResponses).where(eq(governanceCircularResponses.id, v.id)).get();
  if (!response) return notFound('governanceCircularResponse', v.id);
  const circular = rowOf(deps.db, response.circularId)!;
  if (circular.sealedAt) return governanceConflict('circularSealed');
  if (v.answeredOn && v.answeredOn < circular.requestedOn) return invalid([{ path: 'answeredOn', message: 'beforeRequest' }]);
  const set = { answer: v.answer, answeredOn: v.answeredOn ?? null, documentId: v.documentId ?? null, note: v.note ?? null };
  return deps.db.transaction((tx: DbOrTx) => {
    tx.update(governanceCircularResponses).set({ ...set, updatedAt: isoNow(deps.clock) }).where(eq(governanceCircularResponses.id, response.id)).run();
    // Vermerk und Dokument stehen nur am Datensatz.
    recordAudit(tx, deps, ctx, { action: 'governance.circular.response', entityType: 'governanceCircular', entityId: circular.id, before: { answer: response.answer }, after: { answer: v.answer }, params: { answer: v.answer, contactId: response.contactId } });
    return ok(circularViewInternal(tx, circular));
  });
}

/** Die Vorsitzende stellt fest; gegen die Auswertung nur mit Begründung (Anti-Ziel 1). Festschreiben: G4. */
export async function decideCircular(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<CircularView>> {
  const denied = requirePermission(ctx, 'governance.manage');
  if (denied) return denied;
  const parsed = validate(deps, circularDecideSchema, input);
  if (!parsed.ok) return parsed;
  const { id: circularId, outcome, decidedOn, decidedByContactId } = parsed.value;
  const outcomeReason = parsed.value.outcomeReason ?? null;
  const row = rowOf(deps.db, circularId);
  if (!row) return notFound('governanceCircular', circularId);
  if (row.sealedAt) return governanceConflict('circularSealed');
  if (decidedOn < row.requestedOn) return invalid([{ path: 'decidedOn', message: 'beforeRequest' }]);
  const isAgainst = against(outcome, evaluateCircularInternal(deps.db, row.id).reached);
  if (isAgainst && !outcomeReason) return invalid([{ path: 'outcomeReason', message: 'outcomeReasonRequired' }]);
  return deps.db.transaction((tx: DbOrTx) => {
    tx.update(governanceCirculars).set({ outcome, outcomeReason, decidedOn, decidedByContactId, updatedAt: isoNow(deps.clock) }).where(eq(governanceCirculars.id, row.id)).run();
    recordAudit(tx, deps, ctx, { action: 'governance.circular.decide', entityType: 'governanceCircular', entityId: row.id, before: { outcome: row.outcome }, after: { outcome, decidedOn }, params: { kind: row.kind, outcome, againstCount: isAgainst } });
    return ok(circularViewInternal(tx, rowOf(tx, row.id)!));
  });
}

export async function getCircular(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<CircularView>> {
  const denied = requirePermission(ctx, 'governance.read');
  if (denied) return denied;
  const parsed = validate(deps, circularIdSchema, input);
  if (!parsed.ok) return parsed;
  const row = rowOf(deps.db, parsed.value.id);
  return row ? ok(circularViewInternal(deps.db, row)) : notFound('governanceCircular', parsed.value.id);
}

export async function listCirculars(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<CircularView[]>> {
  const denied = requirePermission(ctx, 'governance.read');
  if (denied) return denied;
  const parsed = validate(deps, circularListSchema, input ?? {});
  if (!parsed.ok) return parsed;
  const { organId, year } = parsed.value;
  const rows = deps.db
    .select()
    .from(governanceCirculars)
    .where(organId ? eq(governanceCirculars.organId, organId) : undefined)
    .orderBy(asc(governanceCirculars.requestedOn), asc(governanceCirculars.createdAt), asc(governanceCirculars.id))
    .all()
    .filter((r) => year === undefined || r.requestedOn.startsWith(`${year}-`));
  return ok(rows.map((r) => circularViewInternal(deps.db, r)));
}
