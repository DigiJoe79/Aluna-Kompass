import { invalid, isoNow, newId, notFound, ok, recordAudit, requirePermission, validate, type CallContext, type DbOrTx, type Deps, type Result } from '@kompass/core';
import { contacts } from '@kompass/module-contacts';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { agendaItemsInternal } from './agenda';
import { AGENDA_KINDS } from './agenda-kinds';
import { meetingRowInternal } from './meetings';
import { motionViewsInternal, type MotionView } from './motions';
import { writeResolutionInternal } from './resolutions';
import { governanceMotions } from './schema';
import { requireWriterInternal } from './session';

const id = z.string().min(1);

export const floorMotionSchema = z.object({
  meetingId: id,
  submittedByContactId: id.nullable().optional(),
  text: z.string().trim().min(1).max(20000),
  /** Als welche Art der TOP entsteht, wenn die Versammlung den Antrag aufnimmt. */
  kind: z.enum(AGENDA_KINDS),
  /** Der Punkt, hinter dem der TOP entsteht (meist der aktuelle); ohne Angabe am Ende (Plan U1, Entscheidung 3). */
  afterItemId: id.optional(),
});

/**
 * Ein Antrag aus der Versammlung (Spec § 5.4, Plan U1 Task 2): eingegangen am Sitzungstag — mit Antragsfrist also
 * „nach Frist“ — und sofort mit der offenen Abstimmung über die Aufnahme (Dringlichkeit, `kind 'agenda'`), die sich
 * Art und Platz merkt. Danach wie jeder späte Antrag: `admitLateMotion` zählt, `decideResolution` stellt fest, bei
 * `adopted` entsteht der TOP hinter `afterItemId`. Nur die Schreibende der laufenden Sitzung.
 */
export async function recordFloorMotion(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<MotionView>> {
  const denied = requirePermission(ctx, 'governance.record');
  if (denied) return denied;
  const parsed = validate(deps, floorMotionSchema, input);
  if (!parsed.ok) return parsed;
  const v = parsed.value;
  const meeting = meetingRowInternal(deps.db, v.meetingId);
  if (!meeting) return notFound('governanceMeeting', v.meetingId);
  const refused = requireWriterInternal(deps.db, ctx, meeting);
  if (refused) return refused;
  if (v.submittedByContactId && !deps.db.select({ id: contacts.id }).from(contacts).where(eq(contacts.id, v.submittedByContactId)).get()) return notFound('contact', v.submittedByContactId);
  if (v.afterItemId && !agendaItemsInternal(deps.db, meeting.id).some((i) => i.id === v.afterItemId)) return invalid([{ path: 'afterItemId', message: 'otherMeeting' }]);
  const now = isoNow(deps.clock);
  return deps.db.transaction((tx: DbOrTx) => {
    const motionId = newId();
    tx.insert(governanceMotions)
      .values({ id: motionId, meetingId: meeting.id, submittedByContactId: v.submittedByContactId ?? null, receivedOn: meeting.heldOn, text: v.text, documentId: null, agendaItemId: null, withdrawnOn: null, createdAt: now, updatedAt: now })
      .run();
    const view = motionViewsInternal(tx, meeting).find((m) => m.id === motionId)!;
    // Text und Antragsteller stehen nur am Datensatz (wie `saveMotion`).
    recordAudit(tx, deps, ctx, { action: 'governance.motion.save', entityType: 'governanceMotion', entityId: motionId, after: { receivedOn: view.receivedOn, withdrawnOn: null, agendaItemId: null }, params: { meetingId: meeting.id, receivedOn: view.receivedOn, late: view.late } });
    // Die offene Abstimmung über die Aufnahme: ohne Stimmen, Uhrzeit vorläufig der Beginn — `admitLateMotion` setzt sie.
    const written = writeResolutionInternal(tx, deps, ctx, meeting, null, null, { kind: 'agenda', text: v.text, votedAt: meeting.startsAt, details: { motionId, kind: v.kind, ...(v.afterItemId ? { afterItemId: v.afterItemId } : {}) } });
    if (!written.ok) return written;
    return ok(view);
  });
}
