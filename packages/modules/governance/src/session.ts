import { forbidden, hasPermission, invalid, isoNow, notFound, ok, recordAudit, requirePermission, todayIn, validate, type CallContext, type DbOrTx, type Deps, type Failure, type Result } from '@kompass/core';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { governanceConflict } from './errors';
import { meetingRowInternal, meetingStateOf, meetingView, type MeetingView } from './meetings';
import { minutesVersionsInternal } from './minutes/signed';
import { governanceMeetings, type MeetingRow } from './schema';

const TIME = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const id = z.string().min(1);

export const meetingStartSchema = z.object({ meetingId: id, /** Tatsächlicher Beginn `HH:MM`, wenn er vom geplanten abweicht. */ startsAt: TIME.optional() });
export const meetingSessionSchema = z.object({ meetingId: id });
export const meetingEndSchema = z.object({ meetingId: id, endedAt: TIME });

/**
 * Darf `ctx` im Mitlauf schreiben? (Spec § 5.4: genau eine Person schreibt.) `meetingNotRunning`, wenn die Sitzung
 * nicht läuft; `notWriter`, wenn eine andere Person die Protokollführung hat. Alle schreibenden Dienste des Mitlaufs
 * rufen es. G4 lässt nachgetragene Sitzungen mit `governance.manage` durch.
 */
export function requireWriterInternal(_db: DbOrTx, ctx: CallContext, meeting: MeetingRow): Failure | null {
  // Nachgetragen (Spec § 5.7): kein Mitlauf, keine Schreibende — wer Gremien führt, trägt bis zum Festschreiben nach.
  if (meeting.backfilled && !meeting.sealedAt) return hasPermission(ctx, 'governance.manage') ? null : forbidden('governance.manage');
  if (meetingStateOf(meeting) !== 'running') return governanceConflict('meetingNotRunning');
  if (meeting.writerUserId !== ctx.userId) return governanceConflict('notWriter');
  return null;
}

function load<T extends { meetingId: string }>(deps: Deps, ctx: CallContext, schema: z.ZodType<T>, input: unknown): { ok: true; meeting: MeetingRow; value: T } | Failure {
  const denied = requirePermission(ctx, 'governance.record');
  if (denied) return denied;
  const parsed = validate(deps, schema, input);
  if (!parsed.ok) return parsed;
  const meeting = meetingRowInternal(deps.db, parsed.value.meetingId);
  if (!meeting) return notFound('governanceMeeting', parsed.value.meetingId);
  return { ok: true, meeting, value: parsed.value };
}

type AuditEntry = { before: Record<string, unknown>; after: Partial<MeetingRow> };

/** Schreibt die Felder und protokolliert über `audit` — die Aktion steht dort als fester Text (Wächter `audit-actions`). */
function write(deps: Deps, ctx: CallContext, meeting: MeetingRow, set: Partial<MeetingRow>, audit: (tx: DbOrTx, entry: AuditEntry) => void): Result<MeetingView> {
  return deps.db.transaction((tx: DbOrTx) => {
    tx.update(governanceMeetings).set({ ...set, updatedAt: isoNow(deps.clock) }).where(eq(governanceMeetings.id, meeting.id)).run();
    const before = Object.fromEntries(Object.keys(set).map((k) => [k, meeting[k as keyof MeetingRow]]));
    audit(tx, { before, after: set });
    return ok(meetingView(tx, meetingRowInternal(tx, meeting.id)!));
  });
}

/** „Sitzung beginnen“: aus `planned`/`invited` nach `running`; wer beginnt, schreibt. */
export async function startMeeting(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<MeetingView>> {
  const loaded = load(deps, ctx, meetingStartSchema, input);
  if (!loaded.ok) return loaded;
  const { meeting, value } = loaded;
  const state = meetingStateOf(meeting);
  if (state !== 'planned' && state !== 'invited') return governanceConflict('meetingNotStartable');
  const set: Partial<MeetingRow> = { startedAt: isoNow(deps.clock), startedOn: todayIn(deps), writerUserId: ctx.userId, ...(value.startsAt ? { startsAt: value.startsAt } : {}) };
  return write(deps, ctx, meeting, set, (tx, e) => recordAudit(tx, deps, ctx, { action: 'governance.meeting.start', entityType: 'governanceMeeting', entityId: meeting.id, ...e, params: { kind: meeting.kind, heldOn: meeting.heldOn } }));
}

/** „Protokollführung übernehmen“: Die aufrufende Person schreibt ab jetzt (nur `running`). */
export async function takeOverMinutes(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<MeetingView>> {
  const loaded = load(deps, ctx, meetingSessionSchema, input);
  if (!loaded.ok) return loaded;
  const { meeting } = loaded;
  if (meetingStateOf(meeting) !== 'running') return governanceConflict('meetingNotRunning');
  return write(deps, ctx, meeting, { writerUserId: ctx.userId }, (tx, e) => recordAudit(tx, deps, ctx, { action: 'governance.meeting.takeOver', entityType: 'governanceMeeting', entityId: meeting.id, ...e, params: { kind: meeting.kind, heldOn: meeting.heldOn } }));
}

/** „Sitzung beenden“: nur die Schreibende; `running → recorded`. Ein Ende vor dem Beginn ist ein Datenfehler. */
export async function endMeeting(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<MeetingView>> {
  const loaded = load(deps, ctx, meetingEndSchema, input);
  if (!loaded.ok) return loaded;
  const { meeting, value } = loaded;
  const refused = requireWriterInternal(deps.db, ctx, meeting);
  if (refused) return refused;
  if (value.endedAt < meeting.startsAt) return invalid([{ path: 'endedAt', message: 'endBeforeStart' }]);
  return write(deps, ctx, meeting, { endedAt: value.endedAt }, (tx, e) => recordAudit(tx, deps, ctx, { action: 'governance.meeting.end', entityType: 'governanceMeeting', entityId: meeting.id, ...e, params: { kind: meeting.kind, heldOn: meeting.heldOn, endedAt: value.endedAt } }));
}

/** Öffnet den Mitlauf wieder (`recorded → running`), solange keine unterschriebene Fassung abgelegt ist; wer öffnet, schreibt. */
export async function reopenMeeting(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<MeetingView>> {
  const loaded = load(deps, ctx, meetingSessionSchema, input);
  if (!loaded.ok) return loaded;
  const { meeting } = loaded;
  if (meetingStateOf(meeting) !== 'recorded') return governanceConflict('meetingNotRecorded');
  // Mit abgelegter unterschriebener Fassung gilt diese; der Mitlauf öffnet nicht mehr (Plan G4 Task 6).
  if (minutesVersionsInternal(deps.db, meeting.id).length > 0) return governanceConflict('minutesFiled');
  return write(deps, ctx, meeting, { endedAt: null, writerUserId: ctx.userId }, (tx, e) => recordAudit(tx, deps, ctx, { action: 'governance.meeting.reopen', entityType: 'governanceMeeting', entityId: meeting.id, ...e, params: {} }));
}
