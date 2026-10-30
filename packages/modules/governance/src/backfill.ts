import { forbidden, invalid, isoNow, newId, notFound, ok, recordAudit, requirePermission, validate, type CallContext, type DbOrTx, type Deps, type Result } from '@kompass/core';
import { canReadDocumentType, documents, linkDocumentInternal } from '@kompass/module-dms';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { governanceConflict } from './errors';
import { EMPTY_FINDINGS } from './findings';
import { checkKind, meetingRowInternal, meetingView, type MeetingView } from './meetings';
import { governanceMeetings, governanceResolutions, MEETING_FORMS, MEETING_KINDS, type MeetingRow } from './schema';

const DAY = z.iso.date();
const TIME = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const id = z.string().min(1);
const count = z.number().int().min(0).max(100000);

export const backfillMeetingSchema = z.object({
  organId: id,
  kind: z.enum(MEETING_KINDS),
  heldOn: DAY,
  startsAt: TIME,
  endedAt: TIME,
  form: z.enum(MEETING_FORMS),
  place: z.string().trim().max(300).nullable().optional(),
  /** Anwesenheit nur als Zahl (Spec § 5.7); eine Liste ist optional. */
  present: count,
  voting: count,
  chairContactId: id.nullable().optional(),
  minuteTakerContactId: id.nullable().optional(),
  /** Gründung: „mit Einverständnis aller“ (`consent`). */
  chairBy: z.enum(['statute', 'elected', 'consent']).nullable().optional(),
});

export const backfillCorrectSchema = z.object({
  id,
  kind: z.enum(MEETING_KINDS).optional(),
  heldOn: DAY.optional(),
  startsAt: TIME.optional(),
  endedAt: TIME.optional(),
  form: z.enum(MEETING_FORMS).optional(),
  place: z.string().trim().max(300).nullable().optional(),
  present: count.optional(),
  voting: count.optional(),
  invitedOn: DAY.nullable().optional(),
  invitationDocumentId: id.nullable().optional(),
  invitationNote: z.string().trim().min(1).max(500).nullable().optional(),
});

/** Felder der Korrektur → Spalten; `present`/`voting` heißen in der Zeile `backfillPresent`/`backfillVoting`. */
const COLUMN = { present: 'backfillPresent', voting: 'backfillVoting' } as const;

/**
 * `governance.manage`: den Kopf einer nachgetragenen, noch nicht festgeschriebenen Sitzung berichtigen (Befund 21) —
 * der Nachtrag steht sofort auf `recorded`, Kopf ändern und Absagen greifen dort nicht. Der Tag zieht `startedOn` und
 * den Beschlusstag mit.
 */
export async function correctBackfill(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<MeetingView>> {
  const denied = requirePermission(ctx, 'governance.manage');
  if (denied) return denied;
  const parsed = validate(deps, backfillCorrectSchema, input);
  if (!parsed.ok) return parsed;
  const { id: meetingId, ...changes } = parsed.value;
  const before = meetingRowInternal(deps.db, meetingId);
  if (!before) return notFound('governanceMeeting', meetingId);
  if (!before.backfilled || before.sealedAt) return governanceConflict('meetingNotBackfilled');
  const fields = (Object.keys(changes) as (keyof typeof changes)[]).filter((k) => changes[k] !== undefined);
  if (fields.length === 0) return invalid([{ path: '', message: 'nothingChanged' }]);
  const set = Object.fromEntries(fields.map((k) => [COLUMN[k as keyof typeof COLUMN] ?? k, changes[k] ?? null])) as Partial<MeetingRow>;
  if (changes.heldOn) set.startedOn = changes.heldOn;
  const next: MeetingRow = { ...before, ...set };
  if (next.backfillVoting! > next.backfillPresent!) return invalid([{ path: 'voting', message: 'votingExceedsPresent' }]);
  if (next.endedAt! < next.startsAt) return invalid([{ path: 'endedAt', message: 'endBeforeStart' }]);
  const checked = checkKind(deps.db, next);
  if (!checked.ok) return checked;
  const documentId = changes.invitationDocumentId;
  const doc = documentId ? deps.db.select().from(documents).where(eq(documents.id, documentId)).get() : null;
  if (documentId && !doc) return notFound('document', documentId);
  if (doc && !canReadDocumentType(deps, ctx, doc.typeKey)) return forbidden('dms.view');
  return deps.db.transaction((tx: DbOrTx) => {
    tx.update(governanceMeetings).set({ ...set, updatedAt: isoNow(deps.clock) }).where(eq(governanceMeetings.id, meetingId)).run();
    if (changes.heldOn) tx.update(governanceResolutions).set({ decidedOn: changes.heldOn }).where(eq(governanceResolutions.meetingId, meetingId)).run();
    if (doc) linkDocumentInternal(tx, deps, { documentId: doc.id, entityType: 'governanceMeeting', entityId: meetingId });
    const columns = Object.keys(set) as (keyof MeetingRow)[];
    recordAudit(tx, deps, ctx, { action: 'governance.meeting.backfillCorrect', entityType: 'governanceMeeting', entityId: meetingId, before: Object.fromEntries(columns.map((c) => [c, before[c]])), after: set, params: { kind: next.kind, heldOn: next.heldOn, fields: fields.join(', ') } });
    return ok(meetingView(tx, meetingRowInternal(tx, meetingId)!));
  });
}

/**
 * `governance.manage`: eine abgeschlossene Sitzung nachtragen (Spec § 5.7, Alunas Altbestand) — derselbe Datensatz,
 * ohne Einladung und Mitlauf, Zustand `recorded`. Danach TOPs, Beschlüsse, Wahlen und Gründer über dieselben Dienste
 * (mit `governance.manage` statt Schreibender), das vorhandene Protokoll verknüpfen, Vorschau, Festschreiben (Mensch).
 * Das Regelwerk ist das am Sitzungstag gültige; vor dem ersten Stand gilt das BGB (Gründung).
 */
export async function backfillMeeting(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<MeetingView>> {
  const denied = requirePermission(ctx, 'governance.manage');
  if (denied) return denied;
  const parsed = validate(deps, backfillMeetingSchema, input);
  if (!parsed.ok) return parsed;
  const v = parsed.value;
  if (v.voting > v.present) return invalid([{ path: 'voting', message: 'votingExceedsPresent' }]);
  if (v.endedAt < v.startsAt) return invalid([{ path: 'endedAt', message: 'endBeforeStart' }]);
  const now = isoNow(deps.clock);
  const row: MeetingRow = {
    id: newId(),
    organId: v.organId,
    kind: v.kind,
    heldOn: v.heldOn,
    startsAt: v.startsAt,
    form: v.form,
    place: v.place ?? null,
    access: null,
    remoteNote: null,
    plannedChairContactId: null,
    plannedMinuteTakerContactId: null,
    repeatOfId: null,
    assemblyRequestId: null,
    invitedOn: null,
    invitationDocumentId: null,
    invitationNote: null,
    cancelledOn: null,
    cancelReason: null,
    startedAt: now,
    startedOn: v.heldOn,
    endedAt: v.endedAt,
    writerUserId: null,
    findings: { ...EMPTY_FINDINGS, chairContactId: v.chairContactId ?? null, minuteTakerContactId: v.minuteTakerContactId ?? null, chairBy: v.chairBy ?? null },
    sealedAt: null,
    sealedByUserId: null,
    backfilled: true,
    backfillPresent: v.present,
    backfillVoting: v.voting,
    createdAt: now,
    updatedAt: now,
  };
  const checked = checkKind(deps.db, row);
  if (!checked.ok) return checked;
  return deps.db.transaction((tx: DbOrTx) => {
    tx.insert(governanceMeetings).values(row).run();
    recordAudit(tx, deps, ctx, { action: 'governance.meeting.backfill', entityType: 'governanceMeeting', entityId: row.id, after: { organId: row.organId, kind: row.kind, heldOn: row.heldOn, present: v.present, voting: v.voting }, params: { kind: row.kind, heldOn: row.heldOn, present: v.present, voting: v.voting } });
    return ok(meetingView(tx, row));
  });
}
