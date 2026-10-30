import { invalid, isoNow, newId, notFound, ok, recordAudit, requirePermission, validate, type CallContext, type DbOrTx, type Deps, type Result } from '@kompass/core';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { agendaItemsInternal, agendaItemViewInternal, renumberAgendaInternal, type AgendaItemView } from './agenda';
import { AGENDA_KINDS } from './agenda-kinds';
import { meetingRowInternal } from './meetings';
import { votesInputSchema, writeResolutionInternal, type ResolutionView } from './resolutions';
import { governanceAgendaItems, governanceMotions, governanceResolutions, type AgendaItemRow } from './schema';
import { requireWriterInternal } from './session';

const TIME = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const id = z.string().min(1);

export const meetingItemAddSchema = z.object({
  meetingId: id,
  kind: z.enum(AGENDA_KINDS),
  title: z.string().trim().min(1).max(300),
  /** Einfügen nach diesem Punkt; ohne Angabe am Ende. */
  afterItemId: id.optional(),
});
export const lateMotionAdmitSchema = z.object({
  motionId: id,
  votedAt: TIME,
  votes: votesInputSchema.optional(),
  yesComputed: z.boolean().optional(),
  unanimous: z.boolean().optional(),
  /** Als welche Art der TOP entsteht, wenn die Versammlung den Antrag aufnimmt. */
  kind: z.enum(AGENDA_KINDS),
});

/**
 * Ein TOP aus der laufenden Sitzung (Spec § 5.4): „in der Sitzung ergänzt“; muss die Art angekündigt sein, warnt
 * Kompass (`notAnnounced`), sperrt aber nicht.
 */
export async function addMeetingItem(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<AgendaItemView>> {
  const denied = requirePermission(ctx, 'governance.record');
  if (denied) return denied;
  const parsed = validate(deps, meetingItemAddSchema, input);
  if (!parsed.ok) return parsed;
  const { meetingId, kind, title, afterItemId } = parsed.value;
  const meeting = meetingRowInternal(deps.db, meetingId);
  if (!meeting) return notFound('governanceMeeting', meetingId);
  const refused = requireWriterInternal(deps.db, ctx, meeting);
  if (refused) return refused;
  const current = agendaItemsInternal(deps.db, meetingId);
  const after = afterItemId === undefined ? current.length - 1 : current.findIndex((i) => i.id === afterItemId);
  if (afterItemId !== undefined && after === -1) return invalid([{ path: 'afterItemId', message: 'otherMeeting' }]);
  const index = after + 1;
  const now = isoNow(deps.clock);
  return deps.db.transaction((tx: DbOrTx) => {
    const row: AgendaItemRow = { id: newId(), meetingId, position: index + 1, kind, title, invitationText: null, proposal: null, attachmentDocumentIds: [], officeIds: [], fiscalYearId: null, statuteId: null, motionId: null, minutesNote: null, wordingChanges: [], addedDuring: 'meeting', createdAt: now, updatedAt: now };
    tx.insert(governanceAgendaItems).values(row).run();
    const ids = current.map((i) => i.id);
    ids.splice(index, 0, row.id);
    renumberAgendaInternal(tx, ids);
    recordAudit(tx, deps, ctx, { action: 'governance.agenda.save', entityType: 'governanceAgendaItem', entityId: row.id, after: { meetingId, kind, addedDuring: 'meeting' }, params: { kind, position: index + 1 } });
    return ok(agendaItemViewInternal(deps, tx, row.id));
  });
}

/**
 * Ein Antrag nach Frist (Spec § 5.3): Die Versammlung beschließt über die Aufnahme (`agenda`, Mehrheit
 * `lateMotionMajority`, Rückfall einfach). Stellt die Leitung `adopted` fest (`decideResolution`), entsteht der TOP.
 * Nichts wird abgewiesen: Ein abgelehnter Antrag bleibt mit seinem Beschluss sichtbar.
 */
export async function admitLateMotion(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ admission: ResolutionView; item: AgendaItemView | null }>> {
  const denied = requirePermission(ctx, 'governance.record');
  if (denied) return denied;
  const parsed = validate(deps, lateMotionAdmitSchema, input);
  if (!parsed.ok) return parsed;
  const { motionId, kind, ...v } = parsed.value;
  const motion = deps.db.select().from(governanceMotions).where(eq(governanceMotions.id, motionId)).get();
  if (!motion) return notFound('governanceMotion', motionId);
  const meeting = meetingRowInternal(deps.db, motion.meetingId)!;
  const refused = requireWriterInternal(deps.db, ctx, meeting);
  if (refused) return refused;
  const before =
    deps.db
      .select()
      .from(governanceResolutions)
      .where(and(eq(governanceResolutions.meetingId, meeting.id), eq(governanceResolutions.kind, 'agenda')))
      .all()
      .find((r) => (r.details as { motionId?: string } | null)?.motionId === motionId) ?? null;
  return deps.db.transaction((tx: DbOrTx) => {
    const afterItemId = (before?.details as { afterItemId?: string } | null)?.afterItemId;
    const written = writeResolutionInternal(tx, deps, ctx, meeting, null, before, { kind: 'agenda', text: motion.text, ...v, details: { motionId, kind, ...(afterItemId ? { afterItemId } : {}) } });
    if (!written.ok) return written;
    return ok({ admission: written.value, item: motion.agendaItemId ? agendaItemViewInternal(deps, tx, motion.agendaItemId) : null });
  });
}
