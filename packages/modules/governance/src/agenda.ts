import { invalid, isoDayIn, isoNow, newId, notFound, ok, recordAudit, requirePermission, validate, type CallContext, type DbOrTx, type Deps, type Result } from '@kompass/core';
import { documents } from '@kompass/module-dms';
import { financeReports, lastFiledReportInternal } from '@kompass/module-finance';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { AGENDA_KINDS, type AgendaKind } from './agenda-kinds';
import { meetingRowInternal, refuseUnlessPreparing } from './meetings';
import { announceRequired } from './rules/resolve';
import { RESOLUTION_KINDS, type ResolutionKind } from './rules/schema';
import { statuteRulesOnInternal } from './statutes';
import { governanceAgendaItems, governanceMotions, type AgendaItemRow, type MeetingRow } from './schema';

export { AGENDA_KINDS, type AgendaKind } from './agenda-kinds';

/** Hinweise, keine Sperren (Spec § 5.2, Anti-Ziel 1). */
export type AgendaWarning = 'cashReportMissing' | 'auditReportMissing' | 'changedAfterInvitation' | 'notAnnounced';
export type AgendaItemView = AgendaItemRow & { warnings: AgendaWarning[] };

const id = z.string().min(1);
export const agendaItemSaveSchema = z.object({
  /** Ohne `id` wird angehängt. */
  id: id.optional(),
  meetingId: id,
  kind: z.enum(AGENDA_KINDS),
  title: z.string().trim().min(1).max(300),
  invitationText: z.string().trim().max(20000).nullable().optional(),
  proposal: z.string().trim().max(20000).nullable().optional(),
  attachmentDocumentIds: z.array(id).max(50).optional(),
  officeIds: z.array(id).max(50).optional(),
  fiscalYearId: id.nullable().optional(),
  statuteId: id.nullable().optional(),
  motionId: id.nullable().optional(),
  /** Nur `statute`/`purpose`: geänderte Absätze für die Anlage der Einladung (Plan U2). */
  wordingChanges: z.array(z.strictObject({ label: z.string().trim().min(1).max(120), before: z.string().trim().max(5000), after: z.string().trim().max(5000) })).max(50).optional(),
});
/** Arten, an denen geänderte Absätze stehen dürfen. */
export const WORDING_KINDS: readonly string[] = ['statute', 'purpose'];
export const agendaItemIdSchema = z.object({ id });
export const agendaReorderSchema = z.object({ meetingId: id, itemIds: z.array(id).min(1).max(200) });
export const agendaProposeSchema = z.object({ meetingId: id });

const isResolutionKind = (kind: string): kind is ResolutionKind => (RESOLUTION_KINDS as readonly string[]).includes(kind);

/** Bis zur Einladung und danach als Nachtrag; eine nachgetragene Sitzung bis zum Festschreiben (Spec § 5.7). */
const refuseUnlessEditable = (meeting: MeetingRow) => (meeting.backfilled && !meeting.sealedAt ? null : refuseUnlessPreparing(meeting));

/** Ein nicht stornierter Kassenbericht des Geschäftsjahres (Finanzen, `reportKey 'cashReport'`), der jüngste. */
export function cashReportDocumentInternal(db: DbOrTx, fiscalYearId: string): string | null {
  const rows = db.select().from(financeReports).where(and(eq(financeReports.reportKey, 'cashReport'), eq(financeReports.fiscalYearId, fiscalYearId), isNull(financeReports.voidedAt))).all();
  return rows.sort((a, b) => b.finalizedAt.localeCompare(a.finalizedAt))[0]?.documentId ?? null;
}

/** Was `isoDayIn` braucht: die Zeitzone des Vereins aus den Einstellungen. */
type DayDeps = Pick<Deps, 'db' | 'registry'>;

function warningsOf(deps: DayDeps, db: DbOrTx, item: AgendaItemRow, meeting: Pick<MeetingRow, 'invitedOn' | 'heldOn' | 'organId' | 'backfilled'>): AgendaWarning[] {
  const warnings: AgendaWarning[] = [];
  if (item.kind === 'accounts' && (!item.fiscalYearId || !cashReportDocumentInternal(db, item.fiscalYearId))) warnings.push('cashReportMissing');
  if (item.kind === 'discharge' && (!item.fiscalYearId || !lastFiledReportInternal(db, item.fiscalYearId))) warnings.push('auditReportMissing');
  // Beim Nachtrag ist `updatedAt` der Tag des Eintippens, nicht der einer Änderung (0.5.0 Nr. 23).
  if (meeting.invitedOn && item.addedDuring !== 'meeting' && (item.addedDuring === 'supplement' || (!meeting.backfilled && isoDayIn(deps, Date.parse(item.updatedAt)) > meeting.invitedOn))) warnings.push('changedAfterInvitation');
  // In der Sitzung ergänzt, aber die Art muss angekündigt sein (Spec § 5.4, § 32 Abs. 1 S. 2 BGB).
  if (item.addedDuring === 'meeting' && isResolutionKind(item.kind) && announceRequired(statuteRulesOnInternal(db, meeting.heldOn).rules, meeting.organId, item.kind)) warnings.push('notAnnounced');
  return warnings;
}

const itemsOf = (db: DbOrTx, meetingId: string) => db.select().from(governanceAgendaItems).where(eq(governanceAgendaItems.meetingId, meetingId)).orderBy(asc(governanceAgendaItems.position), asc(governanceAgendaItems.id)).all();

/** Die Tagesordnung einer Sitzung in ihrer Reihenfolge, mit Hinweisen. */
export function agendaViewsInternal(deps: DayDeps, db: DbOrTx, meeting: MeetingRow): AgendaItemView[] {
  return itemsOf(db, meeting.id).map((item) => ({ ...item, warnings: warningsOf(deps, db, item, meeting) }));
}

export const agendaItemViewInternal = (deps: DayDeps, db: DbOrTx, itemId: string): AgendaItemView => {
  const item = db.select().from(governanceAgendaItems).where(eq(governanceAgendaItems.id, itemId)).get()!;
  return { ...item, warnings: warningsOf(deps, db, item, meetingRowInternal(db, item.meetingId)!) };
};

/** Nummeriert die Punkte einer Sitzung lückenlos in der gegebenen Reihenfolge. */
function renumber(tx: DbOrTx, ids: string[]): void {
  ids.forEach((itemId, index) => tx.update(governanceAgendaItems).set({ position: index + 1 }).where(eq(governanceAgendaItems.id, itemId)).run());
}

/**
 * Was ins Protokoll geht (G-27): Titel, Einladungstext, Antrag und Wortlaut sind Freitext, oft mit Namen — sie stehen
 * nur am Datensatz; das Protokoll nennt, ob sie gesetzt sind.
 */
function auditValues<T extends { title: string; invitationText: string | null; proposal: string | null; wordingChanges: unknown[] }>(v: T) {
  const { title: _t, invitationText, proposal, wordingChanges, ...rest } = v;
  return { ...rest, invitationText: invitationText !== null, proposal: proposal !== null, wordingChanges: wordingChanges.length };
}

/** Der Antrag zeigt auf seinen TOP (G-21), wie bei der Aufnahme eines späten Antrags; ein abgelöster verliert den Bezug. */
function linkMotionInternal(tx: DbOrTx, now: string, itemId: string, was: string | null, next: string | null): void {
  if (was === next) return;
  if (was) tx.update(governanceMotions).set({ agendaItemId: null, updatedAt: now }).where(and(eq(governanceMotions.id, was), eq(governanceMotions.agendaItemId, itemId))).run();
  if (next) tx.update(governanceMotions).set({ agendaItemId: itemId, updatedAt: now }).where(eq(governanceMotions.id, next)).run();
}

/** Legt einen Punkt an (angehängt) oder ändert ihn — bis zur Einladung und danach als Nachtrag. */
export async function saveAgendaItem(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<AgendaItemView>> {
  const denied = requirePermission(ctx, 'governance.manage');
  if (denied) return denied;
  const parsed = validate(deps, agendaItemSaveSchema, input);
  if (!parsed.ok) return parsed;
  const { id: itemId, meetingId, ...v } = parsed.value;
  if (v.officeIds && v.officeIds.length > 0 && v.kind !== 'election') return invalid([{ path: 'officeIds', message: 'onlyElection' }]);
  if (v.wordingChanges && v.wordingChanges.length > 0 && !WORDING_KINDS.includes(v.kind)) return invalid([{ path: 'wordingChanges', message: 'wordingOnlyForStatute' }]);
  const meeting = meetingRowInternal(deps.db, meetingId);
  if (!meeting) return notFound('governanceMeeting', meetingId);
  const refused = refuseUnlessEditable(meeting);
  if (refused) return refused;
  const attachments = v.attachmentDocumentIds ?? [];
  if (attachments.length > 0) {
    const known = new Set(deps.db.select({ id: documents.id }).from(documents).where(inArray(documents.id, attachments)).all().map((d) => d.id));
    const missing = attachments.find((a) => !known.has(a));
    if (missing) return notFound('document', missing);
  }
  if (v.motionId && deps.db.select().from(governanceMotions).where(eq(governanceMotions.id, v.motionId)).get()?.meetingId !== meetingId) return invalid([{ path: 'motionId', message: 'otherMeeting' }]);
  const now = isoNow(deps.clock);
  const values = {
    kind: v.kind as AgendaKind,
    title: v.title,
    invitationText: v.invitationText ?? null,
    proposal: v.proposal ?? null,
    attachmentDocumentIds: attachments,
    officeIds: v.officeIds ?? [],
    fiscalYearId: v.fiscalYearId ?? null,
    statuteId: v.statuteId ?? null,
    motionId: v.motionId ?? null,
    wordingChanges: WORDING_KINDS.includes(v.kind) ? (v.wordingChanges ?? []) : [],
  };
  if (itemId === undefined) {
    return deps.db.transaction((tx: DbOrTx) => {
      const position = itemsOf(tx, meetingId).length + 1;
      const row: AgendaItemRow = { id: newId(), meetingId, position, ...values, minutesNote: null, addedDuring: meeting.invitedOn ? 'supplement' : 'preparation', createdAt: now, updatedAt: now };
      tx.insert(governanceAgendaItems).values(row).run();
      linkMotionInternal(tx, now, row.id, null, row.motionId);
      recordAudit(tx, deps, ctx, { action: 'governance.agenda.save', entityType: 'governanceAgendaItem', entityId: row.id, after: { meetingId, ...auditValues(values) }, params: { kind: row.kind, position } });
      return ok(agendaItemViewInternal(deps, tx, row.id));
    });
  }
  const before = deps.db.select().from(governanceAgendaItems).where(eq(governanceAgendaItems.id, itemId)).get();
  if (!before || before.meetingId !== meetingId) return notFound('governanceAgendaItem', itemId);
  return deps.db.transaction((tx: DbOrTx) => {
    tx.update(governanceAgendaItems).set({ ...values, updatedAt: now }).where(eq(governanceAgendaItems.id, itemId)).run();
    linkMotionInternal(tx, now, itemId, before.motionId, values.motionId);
    const { id: _i, meetingId: _m, createdAt: _c, updatedAt: _u, position: _p, addedDuring: _a, minutesNote: _n, ...was } = before;
    recordAudit(tx, deps, ctx, { action: 'governance.agenda.save', entityType: 'governanceAgendaItem', entityId: itemId, before: auditValues(was), after: auditValues(values), params: { kind: values.kind, position: before.position } });
    return ok(agendaItemViewInternal(deps, tx, itemId));
  });
}

/** Entfernt einen Punkt aus der Vorbereitung (nicht einen, der in der Sitzung entstand). */
export async function removeAgendaItem(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ id: string }>> {
  const denied = requirePermission(ctx, 'governance.manage');
  if (denied) return denied;
  const parsed = validate(deps, agendaItemIdSchema, input);
  if (!parsed.ok) return parsed;
  const item = deps.db.select().from(governanceAgendaItems).where(eq(governanceAgendaItems.id, parsed.value.id)).get();
  if (!item) return notFound('governanceAgendaItem', parsed.value.id);
  const refused = refuseUnlessEditable(meetingRowInternal(deps.db, item.meetingId)!);
  if (refused) return refused;
  if (item.addedDuring === 'meeting') return invalid([{ path: 'id', message: 'addedDuringMeeting' }]);
  return deps.db.transaction((tx: DbOrTx) => {
    tx.delete(governanceAgendaItems).where(eq(governanceAgendaItems.id, item.id)).run();
    renumber(tx, itemsOf(tx, item.meetingId).map((i) => i.id));
    const { id: _i, createdAt: _c, updatedAt: _u, ...was } = item;
    recordAudit(tx, deps, ctx, { action: 'governance.agenda.remove', entityType: 'governanceAgendaItem', entityId: item.id, before: was, params: { kind: item.kind } });
    return ok({ id: item.id });
  });
}

/** Neue Reihenfolge: die vollständige Liste der Punkte (Muster `members_types_reorder`). */
export async function reorderAgenda(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<AgendaItemView[]>> {
  const denied = requirePermission(ctx, 'governance.manage');
  if (denied) return denied;
  const parsed = validate(deps, agendaReorderSchema, input);
  if (!parsed.ok) return parsed;
  const { meetingId, itemIds } = parsed.value;
  const meeting = meetingRowInternal(deps.db, meetingId);
  if (!meeting) return notFound('governanceMeeting', meetingId);
  const refused = refuseUnlessEditable(meeting);
  if (refused) return refused;
  const current = itemsOf(deps.db, meetingId).map((i) => i.id);
  if (itemIds.length !== current.length || new Set(itemIds).size !== itemIds.length || itemIds.some((i) => !current.includes(i))) return invalid([{ path: 'itemIds', message: 'agendaOrderIncomplete' }]);
  return deps.db.transaction((tx: DbOrTx) => {
    renumber(tx, itemIds);
    recordAudit(tx, deps, ctx, { action: 'governance.agenda.reorder', entityType: 'governanceMeeting', entityId: meetingId, before: { itemIds: current }, after: { itemIds }, params: { count: itemIds.length } });
    return ok(agendaViewsInternal(deps, tx, meeting));
  });
}

export { itemsOf as agendaItemsInternal, renumber as renumberAgendaInternal };
