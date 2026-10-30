import { invalid, isoNow, newId, notFound, ok, recordAudit, requirePermission, validate, type CallContext, type DbOrTx, type Deps, type Failure, type Result } from '@kompass/core';
import { contacts } from '@kompass/module-contacts';
import { memberMemberships, membershipViews } from '@kompass/module-members';
import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { governanceConflict } from './errors';
import { organMembersOnInternal } from './invitation/board';
import { invitationRecipientsInternal } from './invitation/runs';
import { meetingRowInternal } from './meetings';
import { ATTENDANCE_ROLES, governanceAttendance, governanceOrgans, type AttendanceRow, type MeetingRow } from './schema';
import { requireWriterInternal } from './session';
import { presentFromRows, type PresentAt } from './live/presence';

const TIME = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const id = z.string().min(1);

export type AttendanceView = AttendanceRow;
export type { PresentAt } from './live/presence';

export const attendancePrefillSchema = z.object({ meetingId: id });
export const attendanceSaveSchema = z.object({
  id: id.optional(),
  meetingId: id,
  contactId: id.optional(),
  /** Nur Gäste: Funktion als Text, kein Pflichtname (Spec § 5.4). */
  guestLabel: z.string().trim().min(1).max(200).optional(),
  role: z.enum(ATTENDANCE_ROLES),
  /** Vorgabe: Gast nein, Mitglied nach Mitgliedsart am Sitzungstag, sonst ja. */
  votingRight: z.boolean().optional(),
  note: z.string().trim().max(1000).nullable().optional(),
});
export const attendanceTimeSchema = z.object({ attendanceId: id, at: TIME });

/** Wer zur Uhrzeit `at` anwesend ist; vom Stimmrecht Ausgeschlossene zählt der Beschluss selbst ab. */
export function presentAtInternal(db: DbOrTx, meetingId: string, at: string): PresentAt {
  const all = db.select().from(governanceAttendance).where(eq(governanceAttendance.meetingId, meetingId)).all();
  const meeting = meetingRowInternal(db, meetingId);
  // Nachgetragen ohne Zeiten (Spec § 5.7): Anwesenheit nur als Zahl; erfasste Personen (Gründer) zählen für das Stimmverbot.
  if (meeting?.backfilled && meeting.backfillPresent !== null && all.every((r) => r.periods.length === 0)) {
    const persons = all.filter((r) => !r.guest);
    const voting = meeting.backfillVoting ?? 0;
    const ids = (rows: AttendanceRow[]) => rows.flatMap((r) => (r.contactId ? [r.contactId] : []));
    return { persons: meeting.backfillPresent, members: voting, voting, organMembers: voting, contactIds: ids(persons), votingContactIds: ids(persons.filter((r) => r.votingRight)) };
  }
  return presentFromRows(all, at);
}

const rowsOf = (db: DbOrTx, meetingId: string) => db.select().from(governanceAttendance).where(eq(governanceAttendance.meetingId, meetingId)).orderBy(asc(governanceAttendance.createdAt), asc(governanceAttendance.id)).all();
const rowOf = (db: DbOrTx, attendanceId: string) => db.select().from(governanceAttendance).where(eq(governanceAttendance.id, attendanceId)).get() ?? null;

/** Rechte, Eingabe, Sitzung, Schreibende — der gemeinsame Anfang der schreibenden Dienste. */
function writable<T>(deps: Deps, ctx: CallContext, schema: z.ZodType<T>, input: unknown, meetingIdOf: (v: T) => string | null): { ok: true; value: T; meeting: MeetingRow } | Failure {
  const denied = requirePermission(ctx, 'governance.record');
  if (denied) return denied;
  const parsed = validate(deps, schema, input);
  if (!parsed.ok) return parsed;
  const meetingId = meetingIdOf(parsed.value);
  const meeting = meetingId ? meetingRowInternal(deps.db, meetingId) : null;
  if (!meeting) return notFound('governanceMeeting', meetingId ?? '');
  const refused = requireWriterInternal(deps.db, ctx, meeting);
  if (refused) return refused;
  return { ok: true, value: parsed.value, meeting };
}

/** Die laufende Mitgliedschaft eines Kontakts am Tag, mit Stimmrecht nach Mitgliedsart. */
function membershipOn(db: DbOrTx, deps: Deps, contactId: string, day: string) {
  const rows = db.select().from(memberMemberships).where(eq(memberMemberships.contactId, contactId)).all();
  return membershipViews(db, deps, rows, day).find((m) => m.status === 'active' || m.status === 'ending') ?? null;
}

/**
 * Belegt die leere Liste vor (Spec § 5.4): Mitgliederversammlung → jede am Sitzungstag laufende Mitgliedschaft mit
 * Stimmrecht nach Mitgliedsart; Vorstand und andere Organe → die Amtsinhaber am Sitzungstag; Gründung → leer. Alle
 * zunächst abwesend.
 */
export async function prefillAttendance(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<AttendanceView[]>> {
  const loaded = writable(deps, ctx, attendancePrefillSchema, input, (v) => v.meetingId);
  if (!loaded.ok) return loaded;
  const { meeting } = loaded;
  if (rowsOf(deps.db, meeting.id).length > 0) return governanceConflict('attendanceNotEmpty');
  const organ = deps.db.select().from(governanceOrgans).where(eq(governanceOrgans.id, meeting.organId)).get();
  type Seed = Pick<AttendanceRow, 'contactId' | 'membershipId' | 'role' | 'votingRight'>;
  let seeds: Seed[] = [];
  if (meeting.kind === 'founding') seeds = [];
  else if (organ?.kind === 'assembly') seeds = invitationRecipientsInternal(deps.db, deps, meeting.heldOn).map((m) => ({ contactId: m.contactId, membershipId: m.id, role: 'member', votingRight: m.hasVotingRight }));
  else seeds = organMembersOnInternal(deps.db, meeting.organId, meeting.heldOn).map((contactId) => ({ contactId, membershipId: null, role: 'officeHolder', votingRight: true }));
  const now = isoNow(deps.clock);
  return deps.db.transaction((tx: DbOrTx) => {
    for (const seed of seeds) tx.insert(governanceAttendance).values({ id: newId(), meetingId: meeting.id, ...seed, guest: false, guestLabel: null, periods: [], note: null, createdAt: now, updatedAt: now }).run();
    recordAudit(tx, deps, ctx, { action: 'governance.attendance.prefill', entityType: 'governanceMeeting', entityId: meeting.id, after: { count: seeds.length }, params: { count: seeds.length } });
    return ok(rowsOf(tx, meeting.id));
  });
}

/** Trägt eine Person nach (Gründer, Gast, Nachzügler) oder ändert Rolle, Stimmrecht und Vermerk. */
export async function saveAttendance(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<AttendanceView>> {
  const loaded = writable(deps, ctx, attendanceSaveSchema, input, (v) => v.meetingId);
  if (!loaded.ok) return loaded;
  const { value: v, meeting } = loaded;
  const guest = v.role === 'guest';
  if (!guest && !v.contactId) return invalid([{ path: 'contactId', message: 'required' }]);
  if (!guest && v.guestLabel) return invalid([{ path: 'guestLabel', message: 'onlyGuest' }]);
  if (guest && v.votingRight) return invalid([{ path: 'votingRight', message: 'guestWithoutVote' }]);
  if (v.contactId && !deps.db.select({ id: contacts.id }).from(contacts).where(eq(contacts.id, v.contactId)).get()) return notFound('contact', v.contactId);
  const before = v.id ? rowOf(deps.db, v.id) : null;
  if (v.id && (!before || before.meetingId !== meeting.id)) return notFound('governanceAttendance', v.id);
  const membership = v.contactId && v.role === 'member' ? membershipOn(deps.db, deps, v.contactId, meeting.heldOn) : null;
  const values = {
    contactId: v.contactId ?? null,
    membershipId: membership?.id ?? null,
    guest,
    guestLabel: guest ? (v.guestLabel ?? null) : null,
    role: v.role,
    votingRight: guest ? false : (v.votingRight ?? (v.role === 'member' ? (membership?.hasVotingRight ?? false) : true)),
    note: v.note ?? null,
  };
  const now = isoNow(deps.clock);
  return deps.db.transaction((tx: DbOrTx) => {
    const rowId = before?.id ?? newId();
    if (before) tx.update(governanceAttendance).set({ ...values, updatedAt: now }).where(eq(governanceAttendance.id, rowId)).run();
    else tx.insert(governanceAttendance).values({ id: rowId, meetingId: meeting.id, ...values, periods: [], createdAt: now, updatedAt: now }).run();
    recordAudit(tx, deps, ctx, {
      action: 'governance.attendance.save',
      entityType: 'governanceAttendance',
      entityId: rowId,
      ...(before ? { before: { role: before.role, votingRight: before.votingRight } } : {}),
      after: { role: values.role, votingRight: values.votingRight },
      params: { role: values.role, contactId: values.contactId },
    });
    return ok(rowOf(tx, rowId)!);
  });
}

async function stamp(deps: Deps, ctx: CallContext, input: unknown, kind: 'arrive' | 'leave'): Promise<Result<AttendanceView>> {
  const denied = requirePermission(ctx, 'governance.record');
  if (denied) return denied;
  const parsed = validate(deps, attendanceTimeSchema, input);
  if (!parsed.ok) return parsed;
  const row = rowOf(deps.db, parsed.value.attendanceId);
  if (!row) return notFound('governanceAttendance', parsed.value.attendanceId);
  const loaded = writable(deps, ctx, attendanceTimeSchema, input, () => row.meetingId);
  if (!loaded.ok) return loaded;
  const { at } = parsed.value;
  const last = row.periods.at(-1);
  const open = last && last.to === null ? last : null;
  let periods = row.periods;
  if (kind === 'arrive') {
    if (open) return invalid([{ path: 'at', message: 'alreadyPresent' }]);
    if (last && last.to !== null && at < last.to) return invalid([{ path: 'at', message: 'beforeDeparture' }]);
    periods = [...row.periods, { from: at, to: null }];
  } else {
    if (!open) return invalid([{ path: 'attendanceId', message: 'notPresent' }]);
    if (at < open.from) return invalid([{ path: 'at', message: 'beforeArrival' }]);
    periods = [...row.periods.slice(0, -1), { from: open.from, to: at }];
  }
  return deps.db.transaction((tx: DbOrTx) => {
    tx.update(governanceAttendance).set({ periods, updatedAt: isoNow(deps.clock) }).where(eq(governanceAttendance.id, row.id)).run();
    const entry = { entityType: 'governanceAttendance', entityId: row.id, before: { periods: row.periods }, after: { periods }, params: { at, contactId: row.contactId } };
    if (kind === 'arrive') recordAudit(tx, deps, ctx, { action: 'governance.attendance.arrive', ...entry });
    else recordAudit(tx, deps, ctx, { action: 'governance.attendance.leave', ...entry });
    return ok(rowOf(tx, row.id)!);
  });
}

/** Kommen (`HH:MM`); wer schon da ist, kommt nicht noch einmal. */
export async function recordArrival(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<AttendanceView>> {
  return stamp(deps, ctx, input, 'arrive');
}

/** Gehen (`HH:MM`); ohne offenes Kommen oder vor dem Kommen ist es ein Datenfehler. */
export async function recordDeparture(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<AttendanceView>> {
  return stamp(deps, ctx, input, 'leave');
}

/** Die Anwesenheitsliste einer Sitzung in der Reihenfolge der Erfassung. */
export const attendanceOfInternal = rowsOf;
