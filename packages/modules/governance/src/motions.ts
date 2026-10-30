import { invalid, isoNow, newId, notFound, ok, recordAudit, requirePermission, validate, type CallContext, type DbOrTx, type Deps, type Result } from '@kompass/core';
import { contacts } from '@kompass/module-contacts';
import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { agendaItemsInternal, renumberAgendaInternal } from './agenda';
import type { AgendaKind } from './agenda-kinds';
import { noticeDeadlineInternal } from './deadlines/notice';
import { meetingRowInternal, refuseUnlessPreparing } from './meetings';
import { governanceAgendaItems, governanceMotions, type MeetingRow, type MotionRow } from './schema';

const DAY = z.iso.date();
const id = z.string().min(1);

/** `late`: eingegangen nach der Antragsfrist des Regelwerks am Sitzungstag — markiert, nie abgewiesen. */
export type MotionView = MotionRow & { late: boolean };

export const motionSaveSchema = z.object({
  /** Ohne `id` wird angelegt. */
  id: id.optional(),
  meetingId: id,
  submittedByContactId: id.nullable().optional(),
  receivedOn: DAY,
  text: z.string().trim().min(1).max(20000),
  documentId: id.nullable().optional(),
  agendaItemId: id.nullable().optional(),
  withdrawnOn: DAY.nullable().optional(),
});

/** Die Anträge einer Sitzung nach Eingang, mit „nach Frist“. */
export function motionViewsInternal(db: DbOrTx, meeting: MeetingRow): MotionView[] {
  const motionsBy = noticeDeadlineInternal(db, meeting.organId, meeting.heldOn).motionsBy;
  return db
    .select()
    .from(governanceMotions)
    .where(eq(governanceMotions.meetingId, meeting.id))
    .orderBy(asc(governanceMotions.receivedOn), asc(governanceMotions.createdAt), asc(governanceMotions.id))
    .all()
    .map((row) => ({ ...row, late: motionsBy !== null && row.receivedOn > motionsBy }));
}

/** Erfasst einen Antrag zur Tagesordnung oder ändert ihn (auch die Rücknahme). */
export async function saveMotion(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<MotionView>> {
  const denied = requirePermission(ctx, 'governance.manage');
  if (denied) return denied;
  const parsed = validate(deps, motionSaveSchema, input);
  if (!parsed.ok) return parsed;
  const { id: motionId, meetingId, ...v } = parsed.value;
  const meeting = meetingRowInternal(deps.db, meetingId);
  if (!meeting) return notFound('governanceMeeting', meetingId);
  const refused = refuseUnlessPreparing(meeting);
  if (refused) return refused;
  if (v.agendaItemId && deps.db.select().from(governanceAgendaItems).where(eq(governanceAgendaItems.id, v.agendaItemId)).get()?.meetingId !== meetingId) return invalid([{ path: 'agendaItemId', message: 'otherMeeting' }]);
  if (v.submittedByContactId && !deps.db.select({ id: contacts.id }).from(contacts).where(eq(contacts.id, v.submittedByContactId)).get()) return notFound('contact', v.submittedByContactId);
  const values = {
    submittedByContactId: v.submittedByContactId ?? null,
    receivedOn: v.receivedOn,
    text: v.text,
    documentId: v.documentId ?? null,
    agendaItemId: v.agendaItemId ?? null,
    withdrawnOn: v.withdrawnOn ?? null,
  };
  const before = motionId ? deps.db.select().from(governanceMotions).where(eq(governanceMotions.id, motionId)).get() : undefined;
  if (motionId && (!before || before.meetingId !== meetingId)) return notFound('governanceMotion', motionId);
  const now = isoNow(deps.clock);
  return deps.db.transaction((tx: DbOrTx) => {
    const rowId = before?.id ?? newId();
    if (before) tx.update(governanceMotions).set({ ...values, updatedAt: now }).where(eq(governanceMotions.id, rowId)).run();
    else tx.insert(governanceMotions).values({ id: rowId, meetingId, ...values, createdAt: now, updatedAt: now }).run();
    const view = motionViewsInternal(tx, meeting).find((m) => m.id === rowId)!;
    // Text und Antragsteller stehen nur am Datensatz.
    recordAudit(tx, deps, ctx, {
      action: 'governance.motion.save',
      entityType: 'governanceMotion',
      entityId: rowId,
      ...(before ? { before: { receivedOn: before.receivedOn, withdrawnOn: before.withdrawnOn, agendaItemId: before.agendaItemId } } : {}),
      after: { receivedOn: view.receivedOn, withdrawnOn: view.withdrawnOn, agendaItemId: view.agendaItemId },
      params: { meetingId, receivedOn: view.receivedOn, late: view.late },
    });
    return ok(view);
  });
}

/**
 * Die Versammlung hat einen späten Antrag aufgenommen (`admitLateMotion`, festgestellt `adopted`): Ein TOP der Art
 * `kind` entsteht am Ende der Tagesordnung — bei einem Antrag aus der Versammlung hinter `afterItemId` (Plan U1,
 * Entscheidung 3) —, „in der Sitzung ergänzt“, und der Antrag zeigt auf ihn. Schon vorhanden → nichts.
 */
export function admitMotionItemInternal(tx: DbOrTx, deps: Deps, ctx: CallContext, motionId: string, kind: AgendaKind, afterItemId?: string): void {
  const motion = tx.select().from(governanceMotions).where(eq(governanceMotions.id, motionId)).get();
  if (!motion || motion.agendaItemId) return;
  const now = isoNow(deps.clock);
  const current = agendaItemsInternal(tx, motion.meetingId);
  const after = afterItemId ? current.findIndex((i) => i.id === afterItemId) : -1;
  const index = after === -1 ? current.length : after + 1;
  const position = index + 1;
  const itemId = newId();
  tx.insert(governanceAgendaItems)
    .values({ id: itemId, meetingId: motion.meetingId, position, kind, title: motion.text.slice(0, 300), invitationText: null, proposal: motion.text, attachmentDocumentIds: [], officeIds: [], fiscalYearId: null, statuteId: null, motionId, addedDuring: 'meeting', createdAt: now, updatedAt: now })
    .run();
  if (index < current.length) {
    const ids = current.map((i) => i.id);
    ids.splice(index, 0, itemId);
    renumberAgendaInternal(tx, ids);
  }
  recordAudit(tx, deps, ctx, { action: 'governance.agenda.save', entityType: 'governanceAgendaItem', entityId: itemId, after: { meetingId: motion.meetingId, kind, motionId }, params: { kind, position } });
  tx.update(governanceMotions).set({ agendaItemId: itemId, updatedAt: now }).where(eq(governanceMotions.id, motionId)).run();
  const meeting = meetingRowInternal(tx, motion.meetingId)!;
  const late = motionViewsInternal(tx, meeting).find((m) => m.id === motionId)!.late;
  recordAudit(tx, deps, ctx, { action: 'governance.motion.save', entityType: 'governanceMotion', entityId: motionId, before: { agendaItemId: null }, after: { agendaItemId: itemId }, params: { meetingId: motion.meetingId, receivedOn: motion.receivedOn, late } });
}
