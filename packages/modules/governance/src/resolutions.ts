import { invalid, isoNow, newId, notFound, ok, recordAudit, requirePermission, validate, type CallContext, type DbOrTx, type Deps, type Result } from '@kompass/core';
import { and, asc, eq, isNotNull, ne } from 'drizzle-orm';
import { z } from 'zod';
import { presentAtInternal } from './attendance';
import type { AgendaKind } from './agenda-kinds';
import { proposedExclusionsInternal } from './exclusions';
import { admitMotionItemInternal } from './motions';
import { evaluateMajority, votesValid, type MajorityResult, type Votes } from './majority';
import { meetingRowInternal } from './meetings';
import { allVotingOnInternal } from './quorum';
import { DETAILS_HINT, detailWarningsInternal, RESOLUTION_DETAILS, type DetailWarning } from './resolution-details';
import { announceRequired, resolveMajority, resolveRule, type ResolvedRule } from './rules/resolve';
import { LAW_DEFAULT_MAJORITY } from './rules/law';
import { RESOLUTION_KINDS, type Majority, type ResolutionKind, type StatuteRules } from './rules/schema';
import { EXCLUSION_REASONS, governanceAgendaItems, governanceMeetings, governanceResolutions, RESOLUTION_OUTCOMES, type AgendaItemRow, type MeetingRow, type ResolutionExclusion, type ResolutionRow } from './schema';
import { requireWriterInternal } from './session';
import { resolutionRulesInternal } from './statutes';

const TIME = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const id = z.string().min(1);
const count = z.number().int().min(0).max(100000);

/** Steuerlich bedeutsame Beschlüsse je Jahr (Spec § 12 Nr. 6, Steuerprüfung K2). */
export const TAX_RELEVANT_KINDS: readonly ResolutionKind[] = ['statute', 'purpose', 'reserve', 'remuneration', 'expenseRule', 'dissolution'];

/** `reasonMissing`: festgestellt gegen die Zählung ohne Begründung — hält das Festschreiben auf (Plan U1, Entscheidung 1). */
/** `alreadyDischarged`: eine Person dieser Entlastung ist für das Geschäftsjahr schon entlastet (festgeschrieben, W-2). */
export type ResolutionWarning = 'outcomeAgainstCount' | 'reasonMissing' | 'notAnnounced' | 'alreadyDischarged' | DetailWarning;
export interface ResolutionEvaluation {
  required: { value: Majority; source: 'statute' | 'law'; norm?: string; reference?: string };
  /** Stimmberechtigt Anwesende zur Abstimmung, Ausgeschlossene eingeschlossen. */
  presentVoting: number;
  /** Davon vom Stimmrecht ausgeschlossen (nur, wer zur Abstimmung stimmberechtigt anwesend war). */
  excluded: number;
  result: MajorityResult;
}
/** `evaluation` ist `null` ohne Stimmen, ohne Sitzung (Umlauf) und bei Wahlen (je Wahlgang, `elections.ts`). */
export type ResolutionView = ResolutionRow & { evaluation: ResolutionEvaluation | null; warnings: ResolutionWarning[] };

export const votesInputSchema = z.object({
  /** Fehlt bei `yesComputed`: Ja = Stimmberechtigte − Nein − Enthaltung − ungültig (Subtraktionsverfahren). */
  yes: count.optional(),
  no: count,
  abstain: count.default(0),
  invalid: count.default(0),
});
export const exclusionInputSchema = z.object({ contactId: id, reason: z.enum(EXCLUSION_REASONS), note: z.string().trim().max(500).nullable().optional() });
export const resolutionSaveSchema = z.object({
  /** Ohne `id` wird angelegt. */
  id: id.optional(),
  agendaItemId: id,
  /** Vorgabe: die Art des TOP. */
  kind: z.enum(RESOLUTION_KINDS).optional(),
  text: z.string().trim().min(1).max(20000),
  votedAt: TIME,
  votes: votesInputSchema.optional(),
  /** Ja im Subtraktionsverfahren errechnen (Joe 2026-10-28). */
  yesComputed: z.boolean().optional(),
  /** „Einstimmig“ als ein Klick: alle Stimmberechtigten ohne die Ausgeschlossenen stimmen mit Ja. */
  unanimous: z.boolean().optional(),
  /** Ohne Angabe schlägt Kompass die Ausgeschlossenen je Art vor (§ 34 BGB). */
  excluded: z.array(exclusionInputSchema).max(100).optional(),
  details: z.unknown().optional().describe(DETAILS_HINT),
});
export const resolutionDecideSchema = z.object({ id, outcome: z.enum(RESOLUTION_OUTCOMES), outcomeReason: z.string().trim().min(1).max(2000).nullable().optional() });
export const resolutionIdSchema = z.object({ id });
export const resolutionListSchema = z.object({
  organId: id.optional(),
  year: z.number().int().min(1900).max(9999).optional(),
  kinds: z.array(z.enum(RESOLUTION_KINDS)).max(RESOLUTION_KINDS.length).optional(),
  taxRelevant: z.boolean().optional(),
});

const isResolutionKind = (kind: string): kind is ResolutionKind => (RESOLUTION_KINDS as readonly string[]).includes(kind);
const rowOf = (db: DbOrTx, resolutionId: string) => db.select().from(governanceResolutions).where(eq(governanceResolutions.id, resolutionId)).get() ?? null;

/** Wie viele der Ausgeschlossenen zur Uhrzeit stimmberechtigt anwesend sind — Abwesende werden nicht doppelt abgezogen. */
function excludedPresent(db: DbOrTx, meetingId: string, votedAt: string, excluded: readonly ResolutionExclusion[]) {
  const present = presentAtInternal(db, meetingId, votedAt);
  return { present, excluded: excluded.filter((e) => present.votingContactIds.includes(e.contactId)).length };
}

/** Die Mehrheit für den Beschluss; die Aufnahme eines späten Antrags nach `lateMotionMajority` (Rückfall einfache Mehrheit). */
function majorityFor(rules: StatuteRules, row: Pick<ResolutionRow, 'organId' | 'kind' | 'details'>): ResolvedRule<Majority> {
  if (row.kind === 'agenda' && (row.details as { motionId?: string } | null)?.motionId) {
    const late = resolveRule(rules, row.organId, 'lateMotionMajority');
    return late.value ? { ...late, value: late.value } : { value: LAW_DEFAULT_MAJORITY.value, source: 'law', norm: LAW_DEFAULT_MAJORITY.norm };
  }
  return resolveMajority(rules, row.organId, row.kind);
}

/** Rechnet die Mehrheit für einen Beschluss in einer Sitzung vor. */
export function evaluationOfInternal(db: DbOrTx, deps: Deps, row: Pick<ResolutionRow, 'meetingId' | 'organId' | 'kind' | 'votes' | 'votedAt' | 'decidedOn' | 'excluded' | 'details'>, rules: StatuteRules): ResolutionEvaluation | null {
  if (!row.votes || !row.votedAt || !row.meetingId || row.kind === 'election') return null;
  const { present, excluded } = excludedPresent(db, row.meetingId, row.votedAt, row.excluded);
  const required = majorityFor(rules, row);
  const tie = resolveRule(rules, row.organId, 'tie').value ?? 'rejected';
  const result = evaluateMajority({ majority: required.value, votes: row.votes, presentVoting: present.voting, allVoting: allVotingOnInternal(db, deps, row.organId, row.decidedOn), excluded, tie });
  return { required, presentVoting: present.voting, excluded, result };
}

/** Steht die Feststellung gegen die Zählung? Auch vertagt trotz erreichter Mehrheit (W-8). Gleichstand mit Entscheid der Leitung (`reached null`) nie. */
export const againstCount = (outcome: ResolutionRow['outcome'], evaluation: ResolutionEvaluation | null): boolean =>
  evaluation !== null && ((outcome === 'adopted' && evaluation.result.reached === false) || ((outcome === 'rejected' || outcome === 'postponed') && evaluation.result.reached === true));

/** W-2: Ist eine Person dieser Entlastung für das Jahr schon in einer anderen, festgeschriebenen Sitzung entlastet? */
function alreadyDischargedInternal(db: DbOrTx, row: ResolutionRow): boolean {
  const mine = row.details as { fiscalYearId?: string; contactIds?: string[] } | null;
  if (row.kind !== 'discharge' || !mine?.fiscalYearId || !mine.contactIds?.length) return false;
  const others = db
    .select({ details: governanceResolutions.details })
    .from(governanceResolutions)
    .innerJoin(governanceMeetings, eq(governanceMeetings.id, governanceResolutions.meetingId))
    .where(and(eq(governanceResolutions.kind, 'discharge'), eq(governanceResolutions.outcome, 'adopted'), ne(governanceResolutions.id, row.id), isNotNull(governanceMeetings.sealedAt), row.meetingId ? ne(governanceMeetings.id, row.meetingId) : undefined))
    .all();
  return others.some((o) => {
    const d = o.details as { fiscalYearId?: string; contactIds?: string[] } | null;
    return d?.fiscalYearId === mine.fiscalYearId && (d?.contactIds ?? []).some((c) => mine.contactIds!.includes(c));
  });
}

export function resolutionViewInternal(db: DbOrTx, deps: Deps, row: ResolutionRow): ResolutionView {
  const { rules } = resolutionRulesInternal(db, row);
  const evaluation = evaluationOfInternal(db, deps, row, rules);
  const warnings: ResolutionWarning[] = [];
  if (againstCount(row.outcome, evaluation)) {
    warnings.push('outcomeAgainstCount');
    if (!row.outcomeReason) warnings.push('reasonMissing');
  }
  const item = row.agendaItemId ? db.select().from(governanceAgendaItems).where(eq(governanceAgendaItems.id, row.agendaItemId)).get() : undefined;
  if (item?.addedDuring === 'meeting' && announceRequired(rules, row.organId, row.kind)) warnings.push('notAnnounced');
  warnings.push(...detailWarningsInternal(db, row, rules));
  if (alreadyDischargedInternal(db, row)) warnings.push('alreadyDischarged');
  return { ...row, evaluation, warnings };
}

/** Prüft die Angaben der Art; Pfade beginnen mit `details`. */
export function parseDetailsInternal(deps: Deps, kind: ResolutionKind, details: unknown): Result<unknown> {
  const schema = RESOLUTION_DETAILS[kind];
  if (!schema) return invalid([{ path: 'details', message: 'noDetails' }]);
  const parsed = validate(deps, schema, details);
  if (parsed.ok) return parsed;
  return parsed.error.type === 'validation' ? invalid(parsed.error.issues.map((i) => ({ ...i, path: i.path ? `details.${i.path}` : 'details' }))) : parsed;
}

/** Was eine Art aus dem TOP übernimmt, wenn keine Angaben kommen. */
function detailsFromItem(kind: ResolutionKind, item: AgendaItemRow): unknown {
  if ((kind === 'statute' || kind === 'purpose') && item.statuteId) return { statuteId: item.statuteId };
  if (kind === 'accounts' && item.fiscalYearId) return { fiscalYearId: item.fiscalYearId };
  return null;
}

export interface ResolutionInput {
  kind: ResolutionKind;
  text: string;
  votedAt: string;
  votes?: { yes?: number; no: number; abstain: number; invalid: number };
  yesComputed?: boolean;
  unanimous?: boolean;
  excluded?: { contactId: string; reason: ResolutionExclusion['reason']; note?: string | null }[];
  /** Schon geprüft (`parseDetailsInternal`); `undefined` = übernehmen bzw. aus dem TOP. */
  details?: unknown;
}

/** Freitext der Angaben (Auftrag, Regel, Zweck, Fundstellen) bleibt am Datensatz; IDs, Tage, Beträge, Arten ins Protokoll (G-27). */
const FREE_TEXT_DETAILS = new Set(['task', 'rule', 'purpose', 'statuteReference', 'statuteGround']);
function auditDetails(details: unknown): Record<string, unknown> | null {
  if (!details || typeof details !== 'object') return null;
  return Object.fromEntries(Object.entries(details as Record<string, unknown>).filter(([k]) => !FREE_TEXT_DETAILS.has(k)));
}

/**
 * Legt einen Beschluss einer laufenden Sitzung an oder ändert ihn (ohne Rechte- und Schreibprüfung — die macht der
 * Aufrufer). Stimmen außerhalb der Zahl der Stimmberechtigten sind ein Datenfehler; eine Feststellung bleibt stehen —
 * steht sie danach gegen die Zählung und fehlt der Grund, trägt der Beschluss `reasonMissing` (Plan U1, Entscheidung 1).
 */
export function writeResolutionInternal(tx: DbOrTx, deps: Deps, ctx: CallContext, meeting: MeetingRow, item: AgendaItemRow | null, before: ResolutionRow | null, v: ResolutionInput): Result<ResolutionView> {
  const details = v.details !== undefined ? v.details : (before?.details ?? (item ? detailsFromItem(v.kind, item) : null));
  const excluded: ResolutionExclusion[] = v.excluded
    ? v.excluded.map((e) => ({ contactId: e.contactId, reason: e.reason, note: e.note ?? null }))
    : (before?.excluded ?? proposedExclusionsInternal(tx, { kind: v.kind, details, decidedOn: meeting.heldOn, organId: meeting.organId, meetingId: meeting.id, votedAt: v.votedAt }).map((e) => ({ ...e, note: null })));
  const { present, excluded: away } = excludedPresent(tx, meeting.id, v.votedAt, excluded);
  const voters = present.voting - away;
  let votes: Votes | null = before?.votes ?? null;
  let yesComputed = before?.yesComputed ?? false;
  const unanimous = v.unanimous ?? (v.votes ? false : (before?.unanimous ?? false));
  if (v.unanimous) {
    votes = { yes: voters, no: 0, abstain: 0, invalid: 0 };
    yesComputed = false;
  } else if (v.votes) {
    const { no, abstain, invalid: spoilt } = v.votes;
    yesComputed = v.yesComputed === true;
    if (yesComputed) votes = { yes: voters - no - abstain - spoilt, no, abstain, invalid: spoilt };
    else if (v.votes.yes === undefined) return invalid([{ path: 'votes.yes', message: 'required' }]);
    else votes = { yes: v.votes.yes, no, abstain, invalid: spoilt };
  }
  if (votes && (votes.yes < 0 || !votesValid(votes, present.voting, away))) return invalid([{ path: 'votes', message: 'votesExceedVoters' }]);
  const now = isoNow(deps.clock);
  const row: ResolutionRow = {
    id: before?.id ?? newId(),
    meetingId: meeting.id,
    circularId: null,
    agendaItemId: item?.id ?? before?.agendaItemId ?? null,
    organId: meeting.organId,
    kind: v.kind,
    text: v.text,
    votedAt: v.votedAt,
    decidedOn: meeting.heldOn,
    votes,
    yesComputed,
    unanimous,
    excluded,
    outcome: before?.outcome ?? null,
    outcomeReason: before?.outcomeReason ?? null,
    details,
    number: before?.number ?? null,
    createdAt: before?.createdAt ?? now,
    updatedAt: now,
  };
  if (before) tx.update(governanceResolutions).set(row).where(eq(governanceResolutions.id, row.id)).run();
  else tx.insert(governanceResolutions).values(row).run();
  recordAudit(tx, deps, ctx, {
    action: 'governance.resolution.save',
    entityType: 'governanceResolution',
    entityId: row.id,
    ...(before ? { before: { kind: before.kind, votes: before.votes, excluded: before.excluded.length, details: auditDetails(before.details) } } : {}),
    after: { kind: row.kind, votes: row.votes, excluded: row.excluded.length, details: auditDetails(row.details) },
    params: { kind: row.kind, agendaItemId: row.agendaItemId },
  });
  return ok(resolutionViewInternal(tx, deps, row));
}

/** Erfasst Antragstext und Stimmen eines Beschlusses an einem TOP der laufenden Sitzung (Spec § 5.4). */
export async function saveResolution(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<ResolutionView>> {
  const denied = requirePermission(ctx, 'governance.record');
  if (denied) return denied;
  const parsed = validate(deps, resolutionSaveSchema, input);
  if (!parsed.ok) return parsed;
  const v = parsed.value;
  const item = deps.db.select().from(governanceAgendaItems).where(eq(governanceAgendaItems.id, v.agendaItemId)).get();
  if (!item) return notFound('governanceAgendaItem', v.agendaItemId);
  const meeting = meetingRowInternal(deps.db, item.meetingId)!;
  const refused = requireWriterInternal(deps.db, ctx, meeting);
  if (refused) return refused;
  const kind = v.kind ?? item.kind;
  if (!isResolutionKind(kind)) return invalid([{ path: 'kind', message: 'required' }]);
  const before = v.id ? rowOf(deps.db, v.id) : null;
  if (v.id && (!before || before.meetingId !== meeting.id)) return notFound('governanceResolution', v.id);
  let details: unknown;
  if (v.details !== undefined) {
    const checked = parseDetailsInternal(deps, kind, v.details);
    if (!checked.ok) return checked;
    details = checked.value;
  }
  return deps.db.transaction((tx: DbOrTx) => writeResolutionInternal(tx, deps, ctx, meeting, item, before, { ...v, kind, details }));
}

/**
 * Die Leitung stellt fest (Spec § 5.4, Anti-Ziel 1). Gegen die Zählung mit Warnung `outcomeAgainstCount`; fehlt die
 * Begründung, dazu `reasonMissing`, das erst das Festschreiben aufhält (Plan U1, Entscheidung 1: „Weiter“ bleibt frei,
 * und die Feststellung geht beim Neuladen nicht verloren). Bei Gleichstand, den die Leitung entscheidet, frei.
 */
export async function decideResolution(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<ResolutionView>> {
  const denied = requirePermission(ctx, 'governance.record');
  if (denied) return denied;
  const parsed = validate(deps, resolutionDecideSchema, input);
  if (!parsed.ok) return parsed;
  const { id: resolutionId, outcome } = parsed.value;
  const outcomeReason = parsed.value.outcomeReason ?? null;
  const row = rowOf(deps.db, resolutionId);
  if (!row || !row.meetingId) return notFound('governanceResolution', resolutionId);
  const refused = requireWriterInternal(deps.db, ctx, meetingRowInternal(deps.db, row.meetingId)!);
  if (refused) return refused;
  const against = againstCount(outcome, resolutionViewInternal(deps.db, deps, row).evaluation);
  return deps.db.transaction((tx: DbOrTx) => {
    tx.update(governanceResolutions).set({ outcome, outcomeReason, updatedAt: isoNow(deps.clock) }).where(eq(governanceResolutions.id, row.id)).run();
    // Aufnahme eines späten Antrags beschlossen: Der TOP entsteht (Plan G3 Task 7).
    const late = row.kind === 'agenda' ? (row.details as { motionId: string; kind: AgendaKind; afterItemId?: string } | null) : null;
    if (late && outcome === 'adopted') admitMotionItemInternal(tx, deps, ctx, late.motionId, late.kind, late.afterItemId);
    // Die Begründung steht nur am Datensatz.
    recordAudit(tx, deps, ctx, { action: 'governance.resolution.decide', entityType: 'governanceResolution', entityId: row.id, before: { outcome: row.outcome }, after: { outcome }, params: { kind: row.kind, outcome, againstCount: against } });
    return ok(resolutionViewInternal(tx, deps, rowOf(tx, row.id)!));
  });
}

export async function getResolution(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<ResolutionView>> {
  const denied = requirePermission(ctx, 'governance.read');
  if (denied) return denied;
  const parsed = validate(deps, resolutionIdSchema, input);
  if (!parsed.ok) return parsed;
  const row = rowOf(deps.db, parsed.value.id);
  return row ? ok(resolutionViewInternal(deps.db, deps, row)) : notFound('governanceResolution', parsed.value.id);
}

/** Beschlussliste über alle Organe (Spec § 1), nach Tag; `taxRelevant` filtert die steuerlich bedeutsamen Arten. */
export async function listResolutions(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<ResolutionView[]>> {
  const denied = requirePermission(ctx, 'governance.read');
  if (denied) return denied;
  const parsed = validate(deps, resolutionListSchema, input ?? {});
  if (!parsed.ok) return parsed;
  const { organId, year, kinds, taxRelevant } = parsed.value;
  const rows = deps.db
    .select()
    .from(governanceResolutions)
    .where(organId ? eq(governanceResolutions.organId, organId) : undefined)
    .orderBy(asc(governanceResolutions.decidedOn), asc(governanceResolutions.votedAt), asc(governanceResolutions.createdAt), asc(governanceResolutions.id))
    .all()
    .filter((r) => year === undefined || r.decidedOn.startsWith(`${year}-`))
    .filter((r) => !kinds || kinds.length === 0 || kinds.includes(r.kind))
    .filter((r) => taxRelevant === undefined || TAX_RELEVANT_KINDS.includes(r.kind) === taxRelevant);
  return ok(rows.map((r) => resolutionViewInternal(deps.db, deps, r)));
}

export const resolutionRowInternal = rowOf;
