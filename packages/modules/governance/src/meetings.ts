import { invalid, isoNow, newId, notFound, ok, recordAudit, requirePermission, validate, type CallContext, type DbOrTx, type Deps, type Result } from '@kompass/core';
import { documentLinks } from '@kompass/module-dms';
import { memberMemberships } from '@kompass/module-members';
import { and, asc, eq, isNotNull, lte, ne } from 'drizzle-orm';
import { z } from 'zod';
import { invitationComplianceInternal } from './invitation/compliance';
import { governanceConflict } from './errors';
import { resolveRule } from './rules/resolve';
import { governanceAgendaItems, governanceInvitationRuns, governanceMeetings, governanceMotions, governanceRunLetters, governanceOrgans, MEETING_FORMS, MEETING_KINDS, type MeetingRow } from './schema';
import { statuteRulesOnInternal } from './statutes';

const DAY = z.iso.date();
const TIME = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const id = z.string().min(1);

/** Zustand einer Sitzung (Spec § 5.1); G3 ergänzt `running`/`recorded`, G4 `signed`. */
export type MeetingState = 'planned' | 'invited' | 'running' | 'recorded' | 'signed' | 'cancelled';
export const MEETING_STATES = ['planned', 'invited', 'running', 'recorded', 'signed', 'cancelled'] as const;
/** Hinweise, keine Sperren (Anti-Ziel 1). */
/**
 * `startedOtherDay`: der Mitlauf begann an einem anderen Tag als dem Sitzungstag (G-25). `beforeMemberRecords`: eine
 * nachgetragene Mitgliederversammlung liegt vor der ersten Mitgliedschaft, die Kompass führt — wer stimmberechtigt
 * war, kennt Kompass dann nicht (G-25).
 */
/** `noticeShort`: mindestens eine Einladung ging nach der Frist zu (W-14) — wie im Lauf und im Protokoll. */
export type MeetingWarning = 'formNotAllowed' | 'remoteNoteMissing' | 'repeatWithoutRule' | 'startedOtherDay' | 'beforeMemberRecords' | 'noticeShort';
export type MeetingView = MeetingRow & { state: MeetingState; warnings: MeetingWarning[] };

const headFields = {
  heldOn: DAY,
  startsAt: TIME,
  form: z.enum(MEETING_FORMS),
  place: z.string().trim().max(300).nullable().optional(),
  access: z.string().trim().max(1000).nullable().optional(),
  remoteNote: z.string().trim().max(2000).nullable().optional(),
  plannedChairContactId: id.nullable().optional(),
  plannedMinuteTakerContactId: id.nullable().optional(),
  repeatOfId: id.nullable().optional(),
  assemblyRequestId: id.nullable().optional(),
};
export const meetingCreateSchema = z.object({ organId: id, kind: z.enum(MEETING_KINDS), ...headFields });
export const meetingUpdateSchema = z.object({ id, kind: z.enum(MEETING_KINDS).optional(), ...headFields, heldOn: DAY.optional(), startsAt: TIME.optional(), form: z.enum(MEETING_FORMS).optional() });
export const meetingIdSchema = z.object({ id });
export const meetingListSchema = z.object({ organId: id.optional(), year: z.number().int().min(1900).max(9999).optional(), states: z.array(z.enum(MEETING_STATES)).max(6).optional() });
export const meetingCancelSchema = z.object({ id, cancelledOn: DAY, reason: z.string().trim().min(1).max(2000) });

/**
 * Der Zustand aus den Stempeln: `cancelled` vor allem anderen, dann `signed` (festgeschrieben), `recorded` (Ende; auch
 * nachgetragen und noch nicht festgeschrieben), `running` (Beginn), `invited`, sonst `planned`.
 */
export function meetingStateOf(row: Pick<MeetingRow, 'cancelledOn' | 'invitedOn' | 'startedAt' | 'endedAt' | 'sealedAt'>): MeetingState {
  if (row.cancelledOn) return 'cancelled';
  if (row.sealedAt) return 'signed';
  if (row.endedAt) return 'recorded';
  if (row.startedAt) return 'running';
  if (row.invitedOn) return 'invited';
  return 'planned';
}

export const meetingRowInternal = (db: DbOrTx, meetingId: string): MeetingRow | null => db.select().from(governanceMeetings).where(eq(governanceMeetings.id, meetingId)).get() ?? null;

/** Führt Kompass am Tag schon eine Mitgliedschaft (aufgenommen am oder vor dem Tag)? */
const memberRecordsOnInternal = (db: DbOrTx, day: string): boolean => !!db.select({ id: memberMemberships.id }).from(memberMemberships).where(and(isNotNull(memberMemberships.admittedOn), lte(memberMemberships.admittedOn, day))).get();

/** Hinweise aus dem Regelwerk des Sitzungstags. */
function warningsOf(db: DbOrTx, row: MeetingRow): MeetingWarning[] {
  const { rules } = statuteRulesOnInternal(db, row.heldOn);
  const warnings: MeetingWarning[] = [];
  const forms = resolveRule(rules, row.organId, 'formsAllowed').value ?? ['inPerson', 'hybrid'];
  if (!forms.includes(row.form)) warnings.push('formNotAllowed');
  if (row.form !== 'inPerson' && !row.remoteNote?.trim()) warnings.push('remoteNoteMissing');
  if (row.kind === 'repeat' && !resolveRule(rules, row.organId, 'repeatMeeting').value) warnings.push('repeatWithoutRule');
  if (row.startedOn && row.startedOn !== row.heldOn) warnings.push('startedOtherDay');
  if (!row.cancelledOn && invitationComplianceInternal(db, null, row.id).late > 0) warnings.push('noticeShort');
  if (row.backfilled && row.kind !== 'founding' && !memberRecordsOnInternal(db, row.heldOn) && db.select().from(governanceOrgans).where(eq(governanceOrgans.id, row.organId)).get()?.kind === 'assembly') warnings.push('beforeMemberRecords');
  return warnings;
}

export const meetingView = (db: DbOrTx, row: MeetingRow): MeetingView => ({ ...row, state: meetingStateOf(row), warnings: warningsOf(db, row) });

/** Art und Organ passen zusammen; eine Wiederholung zeigt auf eine Sitzung desselben Organs. */
export function checkKind(db: DbOrTx, row: Pick<MeetingRow, 'id' | 'organId' | 'kind' | 'repeatOfId'>): Result<void> {
  const organ = db.select().from(governanceOrgans).where(eq(governanceOrgans.id, row.organId)).get();
  if (!organ) return notFound('governanceOrgan', row.organId);
  const boardLike = organ.kind !== 'assembly';
  if ((row.kind === 'board') !== boardLike) return invalid([{ path: 'kind', message: 'kindNotForOrgan' }]);
  if (row.kind === 'repeat') {
    const original = row.repeatOfId ? meetingRowInternal(db, row.repeatOfId) : null;
    if (!original || original.organId !== row.organId || original.id === row.id) return invalid([{ path: 'repeatOfId', message: 'required' }]);
  }
  if (row.kind === 'founding' && db.select({ id: governanceMeetings.id }).from(governanceMeetings).all().some((m) => m.id !== row.id && meetingRowInternal(db, m.id)?.kind === 'founding')) return governanceConflict('foundingExists');
  return ok(undefined);
}

/** Eine Sitzung anlegen (`planned`). */
export async function createMeeting(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<MeetingView>> {
  const denied = requirePermission(ctx, 'governance.manage');
  if (denied) return denied;
  const parsed = validate(deps, meetingCreateSchema, input);
  if (!parsed.ok) return parsed;
  const v = parsed.value;
  const now = isoNow(deps.clock);
  const row: MeetingRow = {
    id: newId(),
    organId: v.organId,
    kind: v.kind,
    heldOn: v.heldOn,
    startsAt: v.startsAt,
    form: v.form,
    place: v.place ?? null,
    access: v.access ?? null,
    remoteNote: v.remoteNote ?? null,
    plannedChairContactId: v.plannedChairContactId ?? null,
    plannedMinuteTakerContactId: v.plannedMinuteTakerContactId ?? null,
    repeatOfId: v.repeatOfId ?? null,
    assemblyRequestId: v.assemblyRequestId ?? null,
    invitedOn: null,
    invitationDocumentId: null,
    invitationNote: null,
    cancelledOn: null,
    cancelReason: null,
    startedAt: null,
    startedOn: null,
    endedAt: null,
    writerUserId: null,
    findings: {},
    sealedAt: null,
    sealedByUserId: null,
    backfilled: false,
    backfillPresent: null,
    backfillVoting: null,
    createdAt: now,
    updatedAt: now,
  };
  const checked = checkKind(deps.db, row);
  if (!checked.ok) return checked;
  return deps.db.transaction((tx: DbOrTx) => {
    tx.insert(governanceMeetings).values(row).run();
    recordAudit(tx, deps, ctx, { action: 'governance.meeting.create', entityType: 'governanceMeeting', entityId: row.id, after: { organId: row.organId, kind: row.kind, heldOn: row.heldOn, form: row.form }, params: { kind: row.kind, heldOn: row.heldOn } });
    return ok(meetingView(tx, row));
  });
}

/** Ein Zustand, in dem der Kopf noch änderbar ist; sonst der Grund. */
export function refuseUnlessPreparing(row: MeetingRow) {
  const state = meetingStateOf(row);
  if (state === 'cancelled') return governanceConflict('meetingCancelled');
  if (state !== 'planned' && state !== 'invited') return governanceConflict('meetingStarted');
  return null;
}

/** Kopf ändern — bis zur Einladung und danach, solange die Sitzung nicht begonnen hat. */
export async function updateMeeting(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<MeetingView>> {
  const denied = requirePermission(ctx, 'governance.manage');
  if (denied) return denied;
  const parsed = validate(deps, meetingUpdateSchema, input);
  if (!parsed.ok) return parsed;
  const { id: meetingId, ...changes } = parsed.value;
  const before = meetingRowInternal(deps.db, meetingId);
  if (!before) return notFound('governanceMeeting', meetingId);
  const refused = refuseUnlessPreparing(before);
  if (refused) return refused;
  const fields = (Object.keys(changes) as (keyof typeof changes)[]).filter((k) => changes[k] !== undefined);
  if (fields.length === 0) return invalid([{ path: '', message: 'nothingChanged' }]);
  const set = Object.fromEntries(fields.map((k) => [k, changes[k] ?? null])) as Partial<MeetingRow>;
  const next: MeetingRow = { ...before, ...set };
  const checked = checkKind(deps.db, next);
  if (!checked.ok) return checked;
  return deps.db.transaction((tx: DbOrTx) => {
    tx.update(governanceMeetings).set({ ...set, updatedAt: isoNow(deps.clock) }).where(eq(governanceMeetings.id, meetingId)).run();
    const was = Object.fromEntries(fields.map((k) => [k, before[k as keyof MeetingRow]]));
    recordAudit(tx, deps, ctx, { action: 'governance.meeting.update', entityType: 'governanceMeeting', entityId: meetingId, before: was, after: set, params: { kind: next.kind, heldOn: next.heldOn, fields: fields.join(', ') } });
    return ok(meetingView(tx, meetingRowInternal(tx, meetingId)!));
  });
}

/** Sitzungen nach Tag, gefiltert nach Organ, Jahr und Zustand. */
export async function listMeetings(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<MeetingView[]>> {
  const denied = requirePermission(ctx, 'governance.read');
  if (denied) return denied;
  const parsed = validate(deps, meetingListSchema, input ?? {});
  if (!parsed.ok) return parsed;
  const { organId, year, states } = parsed.value;
  const rows = deps.db
    .select()
    .from(governanceMeetings)
    .where(organId ? eq(governanceMeetings.organId, organId) : undefined)
    .orderBy(asc(governanceMeetings.heldOn), asc(governanceMeetings.startsAt), asc(governanceMeetings.id))
    .all();
  return ok(
    rows
      .filter((r) => year === undefined || r.heldOn.startsWith(`${year}-`))
      .map((r) => meetingView(deps.db, r))
      .filter((v) => !states || states.length === 0 || states.includes(v.state)),
  );
}

/** Was eine geplante Sitzung vor dem Löschen bewahrt, außer dem Zustand: Anträge und verknüpfte Dokumente. */
function keptBy(db: DbOrTx, meetingId: string): boolean {
  if (db.select({ id: governanceMotions.id }).from(governanceMotions).where(eq(governanceMotions.meetingId, meetingId)).get()) return true;
  return !!db.select({ id: documentLinks.id }).from(documentLinks).where(and(eq(documentLinks.entityType, 'governanceMeeting'), eq(documentLinks.entityId, meetingId))).get();
}

/** Löscht eine geplante Sitzung ohne Einladung, Anträge und Dokumente — Arbeitsmaterial (`deletionRules`). */
export async function deleteMeeting(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ id: string }>> {
  const denied = requirePermission(ctx, 'governance.manage');
  if (denied) return denied;
  const parsed = validate(deps, meetingIdSchema, input);
  if (!parsed.ok) return parsed;
  const row = meetingRowInternal(deps.db, parsed.value.id);
  if (!row) return notFound('governanceMeeting', parsed.value.id);
  if (meetingStateOf(row) !== 'planned' || keptBy(deps.db, row.id)) return governanceConflict('meetingNotDeletable');
  return deps.db.transaction((tx: DbOrTx) => {
    tx.delete(governanceAgendaItems).where(eq(governanceAgendaItems.meetingId, row.id)).run();
    tx.delete(governanceMeetings).where(eq(governanceMeetings.id, row.id)).run();
    recordAudit(tx, deps, ctx, { action: 'governance.meeting.delete', entityType: 'governanceMeeting', entityId: row.id, before: { organId: row.organId, kind: row.kind, heldOn: row.heldOn }, params: { kind: row.kind, heldOn: row.heldOn } });
    return ok({ id: row.id });
  });
}

/** Hat ein Einladungslauf der Sitzung schon Briefe ausgestellt? (Absagebriefe über denselben Versand.) */
function lettersIssued(db: DbOrTx, meetingId: string): boolean {
  return !!db
    .select({ id: governanceRunLetters.id })
    .from(governanceRunLetters)
    .innerJoin(governanceInvitationRuns, eq(governanceInvitationRuns.id, governanceRunLetters.runId))
    .where(and(eq(governanceInvitationRuns.meetingId, meetingId), ne(governanceInvitationRuns.kind, 'cancellation')))
    .get();
}

/** Sagt eine Sitzung ab (Grund nur am Datensatz). */
export async function cancelMeeting(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<MeetingView & { cancellationLettersDue: boolean }>> {
  const denied = requirePermission(ctx, 'governance.manage');
  if (denied) return denied;
  const parsed = validate(deps, meetingCancelSchema, input);
  if (!parsed.ok) return parsed;
  const row = meetingRowInternal(deps.db, parsed.value.id);
  if (!row) return notFound('governanceMeeting', parsed.value.id);
  const refused = refuseUnlessPreparing(row);
  if (refused) return refused;
  return deps.db.transaction((tx: DbOrTx) => {
    tx.update(governanceMeetings).set({ cancelledOn: parsed.value.cancelledOn, cancelReason: parsed.value.reason, updatedAt: isoNow(deps.clock) }).where(eq(governanceMeetings.id, row.id)).run();
    recordAudit(tx, deps, ctx, { action: 'governance.meeting.cancel', entityType: 'governanceMeeting', entityId: row.id, before: { cancelledOn: null }, after: { cancelledOn: parsed.value.cancelledOn }, params: { kind: row.kind, heldOn: row.heldOn, cancelledOn: parsed.value.cancelledOn } });
    const view = meetingView(tx, meetingRowInternal(tx, row.id)!);
    return ok({ ...view, cancellationLettersDue: lettersIssued(tx, row.id) });
  });
}

