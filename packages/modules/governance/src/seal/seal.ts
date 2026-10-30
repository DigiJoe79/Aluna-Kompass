import { createFollowUpInternal, isoNow, newId, notFound, ok, recordAudit, requireHumanChannel, requirePermission, todayIn, validate, type CallContext, type DbOrTx, type Deps, type Failure, type Result } from '@kompass/core';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { circularViewInternal } from '../circulars';
import { catchAborted, GovernanceAborted, governanceConflict } from '../errors';
import { meetingRowInternal, meetingStateOf, meetingView, type MeetingView } from '../meetings';
import { minutesVersionsInternal } from '../minutes/signed';
import { allocateResolutionNumberInternal } from '../numbers';
import { resolutionViewInternal, type ResolutionView } from '../resolutions';
import { governanceCirculars, governanceMeetings, governanceResolutions, type OccasionKind, type ResolutionRow, type TermEndReason } from '../schema';
import { addStatuteResolutionInternal } from '../statutes';
import { endTermInternal, linkTermToResolutionInternal, startTermInternal } from '../terms';
import type { Consequence, ResolutionLike, SealBlocker } from './consequences';
import { applyFinanceReferenceInternal } from './finance';
import { occasion, recordRegisterOccasionInternal } from './occasions';
import { meetingFindingsReasonMissingInternal, meetingResolutionsInOrderInternal, planSealInternal } from './preview';

export const sealMeetingSchema = z.object({ meetingId: z.string().min(1) });
export const sealCircularSchema = z.object({ circularId: z.string().min(1) });

const abort = (failure: Failure): never => {
  throw new GovernanceAborted(failure);
};

const str = (v: string | number | boolean | null | undefined): string | null => (v === null || v === undefined ? null : String(v));

/** Ein Datenfehler, der das Festschreiben ablehnt (Anti-Ziel 1: nie Frist, Quorum oder Mehrheit). */
function blockerFailure(blocker: SealBlocker, fullSeats: number | null): Failure {
  if (blocker === 'officeFull') return governanceConflict('officeFull', { seats: fullSeats ?? 0 });
  if (blocker === 'outcomeMissing') return governanceConflict('outcomeMissing');
  if (blocker === 'reasonMissing') return governanceConflict('reasonMissing');
  if (blocker === 'minutesMissing') return governanceConflict('minutesMissing');
  if (blocker === 'statuteResolutionInvalid') return governanceConflict('statuteResolutionInvalid');
  return governanceConflict('meetingSealed');
}

/**
 * Wirkt die geplanten Folgen in der Transaktion des Aufrufers: zuerst die Nummern (in der Reihenfolge der Planung),
 * dann die Enden vor den Beginnen, dann die übrigen in der Reihenfolge der Vorschau. Ein Wurf (etwa `officeFull` aus
 * `startTermInternal`) rollt alles zurück. In die Finanzen schreibt nur die angenommene Vergütung (G7); Mitglieder bleiben Handarbeit.
 */
export function applyConsequencesInternal(tx: DbOrTx, deps: Deps, ctx: CallContext, consequences: Consequence[], refs: { meetingId: string | null }): { applied: Consequence[]; numbered: number; started: number } {
  const order = (c: Consequence) => (c.kind === 'numberResolution' ? 0 : c.kind === 'endPredecessor' || c.kind === 'endTerm' ? 1 : 2);
  const sorted = consequences.map((c, i) => ({ c, i })).sort((a, b) => order(a.c) - order(b.c) || a.i - b.i).map(({ c }) => c);
  const termIds = new Map<string, string>();
  let numbered = 0;
  let started = 0;
  for (const c of sorted) {
    const p = c.params;
    switch (c.kind) {
      case 'numberResolution': {
        const row = tx.select().from(governanceResolutions).where(eq(governanceResolutions.id, c.resolutionId!)).get()!;
        const number = allocateResolutionNumberInternal(tx, Number(row.decidedOn.slice(0, 4)));
        // Die Vorschau hat dieselbe Nummer geplant; weicht sie ab, hat jemand dazwischen festgeschrieben.
        if (number !== p.number) throw new Error(`seal: number ${number} instead of ${String(p.number)}`);
        tx.update(governanceResolutions).set({ number, updatedAt: isoNow(deps.clock) }).where(eq(governanceResolutions.id, row.id)).run();
        recordAudit(tx, deps, ctx, { action: 'governance.resolution.number', entityType: 'governanceResolution', entityId: row.id, after: { number }, params: { kind: row.kind, number } });
        numbered += 1;
        break;
      }
      case 'endPredecessor':
      case 'endTerm':
        endTermInternal(tx, deps, ctx, { id: String(p.termId), until: String(p.until), reason: String(p.reason) as TermEndReason });
        break;
      case 'linkTerm':
        linkTermToResolutionInternal(tx, deps, ctx, { termId: String(p.termId), resolutionId: c.resolutionId!, acceptedOn: String(p.acceptedOn) });
        break;
      case 'startTerm': {
        const term = startTermInternal(tx, deps, ctx, { officeId: String(p.officeId), contactId: String(p.contactId), since: String(p.since), origin: 'elected', acceptedOn: String(p.acceptedOn), resolutionId: c.resolutionId! });
        termIds.set(String(p.ref), term.id);
        started += 1;
        break;
      }
      case 'statuteResolved':
        addStatuteResolutionInternal(tx, deps, ctx, { statuteId: String(p.statuteId), on: String(p.on), resolutionId: c.resolutionId!, affectsCharity: p.affectsCharity === true });
        break;
      case 'registerOccasion': {
        const termRef = str(p.termRef);
        recordRegisterOccasionInternal(tx, deps, ctx, occasion(String(p.kind) as OccasionKind, String(p.occurredOn), { meetingId: refs.meetingId, resolutionId: c.resolutionId, termId: termRef ? (termIds.get(termRef) ?? termRef) : null, officeId: str(p.officeId), statuteId: str(p.statuteId) }));
        break;
      }
      case 'followUp':
        createFollowUpInternal(tx, deps, ctx, { entityType: 'governanceResolution', entityId: c.resolutionId!, dueAt: String(p.dueAt), title: String(p.title), assigneeUserId: str(p.assigneeUserId) });
        break;
      case 'financeReference':
        // G7: nur die angenommene Vergütung schreibt (Einrichtungspunkt der Finanzen); alles andere lesen die Module selbst.
        applyFinanceReferenceInternal(tx, deps, ctx, c.resolutionId!);
        break;
      default:
        // memberProposal, none: nichts zu schreiben.
        break;
    }
  }
  return { applied: sorted, numbered, started };
}

/**
 * **humanOnly**, `governance.manage`: schreibt eine Sitzung fest (Spec § 5.1, § 6). Vorbedingungen: `recorded`,
 * unterschriebene Fassung abgelegt, keine Datenfehler. In einer Transaktion: Nummern, Ämter und Rollen,
 * Satzungsstand, Wiedervorlagen, Registeranlässe, `sealedAt`. Danach nur noch Berichtigung.
 */
export async function sealMeeting(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ meeting: MeetingView; applied: Consequence[] }>> {
  const denied = requirePermission(ctx, 'governance.manage');
  if (denied) return denied;
  const human = requireHumanChannel(deps, ctx, 'governance.mcpHumanOnlyAllowed');
  if (human) return human;
  const parsed = validate(deps, sealMeetingSchema, input);
  if (!parsed.ok) return parsed;
  const meeting = meetingRowInternal(deps.db, parsed.value.meetingId);
  if (!meeting) return notFound('governanceMeeting', parsed.value.meetingId);
  const state = meetingStateOf(meeting);
  if (state === 'signed') return governanceConflict('meetingSealed');
  if (state !== 'recorded') return governanceConflict('meetingNotRecorded');
  if (minutesVersionsInternal(deps.db, meeting.id).length === 0) return governanceConflict('minutesMissing');
  // W-10: Beschlüsse eines künftigen Tags wirken nicht vorab — Beginnen geht mit Warnung, Festschreiben erst ab dem Tag.
  if (meeting.heldOn > todayIn(deps)) return governanceConflict('meetingInFuture', { heldOn: meeting.heldOn });
  const res = catchAborted(() =>
    deps.db.transaction((tx: DbOrTx) => {
      const plan = planSealInternal(tx, deps, meetingResolutionsInOrderInternal(tx, meeting.id), { founding: meeting.kind === 'founding' ? { meetingId: meeting.id, heldOn: meeting.heldOn } : null });
      if (meetingFindingsReasonMissingInternal(tx, deps, meeting) && !plan.blockers.includes('reasonMissing')) plan.blockers.push('reasonMissing');
      if (plan.blockers.length > 0) abort(blockerFailure(plan.blockers[0]!, plan.fullSeats));
      const { applied, numbered, started } = applyConsequencesInternal(tx, deps, ctx, plan.consequences, { meetingId: meeting.id });
      tx.update(governanceMeetings).set({ sealedAt: isoNow(deps.clock), sealedByUserId: ctx.userId ?? null, updatedAt: isoNow(deps.clock) }).where(eq(governanceMeetings.id, meeting.id)).run();
      recordAudit(tx, deps, ctx, { action: 'governance.meeting.seal', entityType: 'governanceMeeting', entityId: meeting.id, before: { sealedAt: null }, after: { resolutions: numbered, terms: started }, params: { kind: meeting.kind, heldOn: meeting.heldOn, resolutions: numbered, terms: started } });
      return { meeting: meetingView(tx, meetingRowInternal(tx, meeting.id)!), applied };
    }),
  );
  return 'ok' in res && res.ok === false ? res : ok(res as { meeting: MeetingView; applied: Consequence[] });
}

/**
 * **humanOnly**, `governance.manage`: schreibt einen festgestellten Umlauf fest (Spec § 5.6) — der Beschluss entsteht
 * mit Nummer (bei `adopted`/`rejected`), die Folgen wie in der Sitzung.
 */
export async function sealCircular(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ resolution: ResolutionView; applied: Consequence[] }>> {
  const denied = requirePermission(ctx, 'governance.manage');
  if (denied) return denied;
  const human = requireHumanChannel(deps, ctx, 'governance.mcpHumanOnlyAllowed');
  if (human) return human;
  const parsed = validate(deps, sealCircularSchema, input);
  if (!parsed.ok) return parsed;
  const circular = deps.db.select().from(governanceCirculars).where(eq(governanceCirculars.id, parsed.value.circularId)).get();
  if (!circular) return notFound('governanceCircular', parsed.value.circularId);
  if (circular.sealedAt) return governanceConflict('circularSealed');
  if (!circular.outcome || !circular.decidedOn) return governanceConflict('outcomeMissing');
  const res = catchAborted(() =>
    deps.db.transaction((tx: DbOrTx) => {
      const view = circularViewInternal(tx, circular);
      const count = (a: string) => view.responses.filter((r) => r.answer === a).length;
      const now = isoNow(deps.clock);
      const row: ResolutionRow = {
        id: newId(),
        meetingId: null,
        circularId: circular.id,
        agendaItemId: null,
        organId: circular.organId,
        kind: circular.kind,
        text: circular.text,
        votedAt: null,
        decidedOn: circular.decidedOn!,
        votes: { yes: count('yes'), no: count('no'), abstain: count('abstain'), invalid: 0 },
        yesComputed: false,
        unanimous: false,
        excluded: [],
        outcome: circular.outcome,
        outcomeReason: circular.outcomeReason,
        details: circular.details,
        number: null,
        createdAt: now,
        updatedAt: now,
      };
      tx.insert(governanceResolutions).values(row).run();
      const plan = planSealInternal(tx, deps, [row as ResolutionLike], { founding: null });
      if (plan.blockers.length > 0) abort(blockerFailure(plan.blockers[0]!, plan.fullSeats));
      const { applied } = applyConsequencesInternal(tx, deps, ctx, plan.consequences, { meetingId: null });
      tx.update(governanceCirculars).set({ sealedAt: now, updatedAt: now }).where(eq(governanceCirculars.id, circular.id)).run();
      const sealed = tx.select().from(governanceResolutions).where(eq(governanceResolutions.id, row.id)).get()!;
      recordAudit(tx, deps, ctx, { action: 'governance.circular.seal', entityType: 'governanceCircular', entityId: circular.id, before: { sealedAt: null }, after: { resolutionId: row.id, number: sealed.number }, params: { kind: circular.kind, number: sealed.number ?? '' } });
      return { resolution: resolutionViewInternal(tx, deps, sealed), applied };
    }),
  );
  return 'ok' in res && res.ok === false ? res : ok(res as { resolution: ResolutionView; applied: Consequence[] });
}

/**
 * Nach dem Festschreiben (Annahme einer Abwesenden, Plan G4 Task 6): die Folgen genau dieses Beschlusses sofort wirken —
 * dieselbe Planung, die schon Gewirktes überspringt.
 */
export function applyLateAcceptanceInternal(tx: DbOrTx, deps: Deps, ctx: CallContext, row: ResolutionRow): Consequence[] {
  const plan = planSealInternal(tx, deps, [row], { founding: null });
  if (plan.blockers.includes('officeFull')) abort(blockerFailure('officeFull', plan.fullSeats));
  return applyConsequencesInternal(tx, deps, ctx, plan.consequences, { meetingId: row.meetingId }).applied;
}
