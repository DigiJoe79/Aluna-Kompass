import { notFound, ok, readLocales, requirePermission, todayIn, validate, type CallContext, type DbOrTx, type Deps, type Result } from '@kompass/core';
import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { agendaItemsInternal } from '../agenda';
import { electionViewInternal } from '../elections';
import { findingsViewInternal } from '../findings';
import { meetingRowInternal } from '../meetings';
import { admissionItemId, admissionMotionId } from '../minutes/compose';
import { attendanceListMissingInternal, minutesVersionsInternal } from '../minutes/signed';
import { statuteResolutionWarningsInternal } from '../resolution-details';
import { resolutionRowInternal, resolutionViewInternal } from '../resolutions';
import { governanceCirculars, governanceResolutions, type CircularRow, type MeetingRow, type ResolutionRow } from '../schema';
import { effectiveOutcome, foundingConsequencesInternal, numberPredictor, resolutionConsequencesInternal, TermSimulation, type Consequence, type ResolutionLike, type SealBlocker } from './consequences';

/** `attendanceListMissing`: das Protokoll nennt die Anwesenheitsliste als Anlage, ausgestellt ist keine (W-9). Hinweis, keine Sperre. */
export type SealWarning = 'attendanceListMissing';
export type SealPreview = { consequences: Consequence[]; blockers: SealBlocker[]; warnings: SealWarning[] };
export type SealTarget = { meetingId: string } | { circularId: string };

/**
 * Ein Objekt mit genau einem der beiden Bezüge — auf oberster Ebene keine Union (ein MCP-Client nähme sonst nur den
 * ersten Zweig, Befund M11 der Finanzen).
 */
export const sealPreviewBaseSchema = z.object({ meetingId: z.string().min(1).optional(), circularId: z.string().min(1).optional() });
/** N5: „genau einer der Bezüge“ prüft der Dienst; das Werkzeug zeigt `sealPreviewBaseSchema`. */
export const sealPreviewSchema = sealPreviewBaseSchema.refine((v) => (v.meetingId === undefined) !== (v.circularId === undefined), { message: 'meetingOrCircular', path: ['meetingId'] });

function reasonMissingInternal(db: DbOrTx, deps: Deps, resolutionId: string): boolean {
  const row = resolutionRowInternal(db, resolutionId);
  return !!row && row.kind !== 'election' && resolutionViewInternal(db, deps, row).warnings.includes('reasonMissing');
}

/** Feststellung zu Beginn gegen den Vorschlag ohne Begründung (G-11) — hält das Festschreiben auf wie ein Beschluss. */
export function meetingFindingsReasonMissingInternal(db: DbOrTx, deps: Deps, meeting: MeetingRow): boolean {
  return findingsViewInternal(db, deps, meeting).warnings.includes('reasonMissing');
}

/** Die Beschlüsse einer Sitzung in der Reihenfolge der Tagesordnung, innerhalb eines TOP nach Abstimmung. */
export function meetingResolutionsInOrderInternal(db: DbOrTx, meetingId: string): ResolutionRow[] {
  const position = new Map(agendaItemsInternal(db, meetingId).map((i) => [i.id, i.position]));
  // G-6: Die Aufnahme eines späten Antrags zählt dort, wo sie im Protokoll steht — hinter ihrem TOP, sonst zu Beginn.
  const placeOf = (r: ResolutionRow) => (admissionMotionId(r) !== null ? (admissionItemId(r) ? (position.get(admissionItemId(r)!) ?? 9999) + 0.5 : 0) : (position.get(r.agendaItemId ?? '') ?? 9999));
  return db
    .select()
    .from(governanceResolutions)
    .where(eq(governanceResolutions.meetingId, meetingId))
    .orderBy(asc(governanceResolutions.votedAt), asc(governanceResolutions.createdAt), asc(governanceResolutions.id))
    .all()
    .map((r, index) => ({ r, index }))
    .sort((a, b) => placeOf(a.r) - placeOf(b.r) || a.index - b.index)
    .map(({ r }) => r);
}

/** Ein Umlauf als Beschluss vor dem Festschreiben (noch ohne ID). */
export const circularAsResolution = (row: CircularRow, id: string | null = null): ResolutionLike => ({
  id,
  kind: row.kind,
  details: row.details,
  organId: row.organId,
  decidedOn: row.decidedOn ?? row.requestedOn,
  outcome: row.outcome,
  meetingId: null,
  votedAt: null,
  agendaItemId: null,
});

/**
 * Plant die Folgen (Spec § 6): zuerst die Nummern für `adopted`/`rejected` in der Reihenfolge der TOPs, dann je
 * Beschluss seine Folgen, bei der Gründung die Gründer und der Anlass `initial`. Rein lesend; das Festschreiben ruft
 * es in seiner Transaktion und wirkt genau diese Liste.
 */
export function planSealInternal(db: DbOrTx, deps: Deps, resolutions: ResolutionLike[], opts: { founding: { meetingId: string; heldOn: string } | null }): SealPreview & { fullSeats: number | null } {
  const predict = numberPredictor(db);
  const sim = new TermSimulation(db);
  const locale = readLocales(deps)[0] ?? 'de';
  const numbers: Consequence[] = [];
  const rest: Consequence[] = [];
  const blockers: SealBlocker[] = [];
  for (const row of resolutions) {
    const outcome = effectiveOutcome(db, deps, row);
    if (outcome === null && row.kind !== 'election' && !blockers.includes('outcomeMissing')) blockers.push('outcomeMissing');
    // Gegen die Zählung festgestellt, Begründung fehlt (Plan U1, Entscheidung 1) — nur gespeicherte Beschlüsse einer Sitzung.
    if (row.id && row.meetingId && !blockers.includes('reasonMissing') && reasonMissingInternal(db, deps, row.id)) blockers.push('reasonMissing');
    if (outcome === 'adopted' && !blockers.includes('statuteResolutionInvalid') && statuteResolutionWarningsInternal(db, row).length > 0) blockers.push('statuteResolutionInvalid');
    if (outcome !== 'adopted' && outcome !== 'rejected') continue;
    const number = row.number ?? predict(row.decidedOn);
    if (!row.number) numbers.push({ kind: 'numberResolution', resolutionId: row.id, params: { number, kind: row.kind, outcome } });
    const winners = row.kind === 'election' && row.id && row.meetingId ? electionViewInternal(db, deps, row as ResolutionRow).winners : [];
    if (outcome === 'adopted') rest.push(...resolutionConsequencesInternal(db, row, number, sim, opts.founding !== null, locale, winners));
  }
  if (opts.founding) rest.push(...foundingConsequencesInternal(db, opts.founding.meetingId, opts.founding.heldOn));
  if (sim.officeFull) blockers.push('officeFull');
  return { consequences: [...numbers, ...rest], blockers, warnings: [], fullSeats: sim.fullSeats };
}

/** Die Vorschau für eine Sitzung oder einen Umlauf; `null`, wenn es ihn nicht gibt. */
export function sealPreviewInternal(db: DbOrTx, deps: Deps, target: SealTarget): SealPreview | null {
  if ('meetingId' in target) {
    const meeting = meetingRowInternal(db, target.meetingId);
    if (!meeting) return null;
    const plan = planSealInternal(db, deps, meetingResolutionsInOrderInternal(db, meeting.id), { founding: meeting.kind === 'founding' ? { meetingId: meeting.id, heldOn: meeting.heldOn } : null });
    const blockers: SealBlocker[] = [];
    if (meeting.sealedAt) blockers.push('meetingSealed');
    if (!meeting.sealedAt && meeting.heldOn > todayIn(deps)) blockers.push('meetingInFuture');
    if (minutesVersionsInternal(db, meeting.id).length === 0) blockers.push('minutesMissing');
    if (meetingFindingsReasonMissingInternal(db, deps, meeting) && !plan.blockers.includes('reasonMissing')) plan.blockers.push('reasonMissing');
    return { consequences: plan.consequences, blockers: [...blockers, ...plan.blockers], warnings: attendanceListMissingInternal(db, meeting) ? ['attendanceListMissing'] : [] };
  }
  const circular = db.select().from(governanceCirculars).where(eq(governanceCirculars.id, target.circularId)).get();
  if (!circular) return null;
  if (circular.sealedAt) return { consequences: [], blockers: ['meetingSealed'], warnings: [] };
  const plan = planSealInternal(db, deps, [circularAsResolution(circular)], { founding: null });
  return { consequences: plan.consequences, blockers: plan.blockers, warnings: [] };
}

/** „Was beim Festschreiben entsteht“ — für Sitzung (`meetingId`) oder Umlauf (`circularId`); Agenten dürfen sie lesen. */
export async function previewSeal(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<SealPreview>> {
  const denied = requirePermission(ctx, 'governance.read');
  if (denied) return denied;
  const parsed = validate(deps, sealPreviewSchema, input);
  if (!parsed.ok) return parsed;
  const target: SealTarget = parsed.value.meetingId ? { meetingId: parsed.value.meetingId } : { circularId: parsed.value.circularId! };
  const preview = sealPreviewInternal(deps.db, deps, target);
  if (!preview) return 'meetingId' in target ? notFound('governanceMeeting', target.meetingId) : notFound('governanceCircular', target.circularId);
  return ok(preview);
}
