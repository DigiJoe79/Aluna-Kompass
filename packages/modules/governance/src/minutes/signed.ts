import { forbidden, invalid, isoNow, newId, notFound, ok, recordAudit, requireHumanChannel, requirePermission, validate, type CallContext, type DbOrTx, type Deps, type Result } from '@kompass/core';
import { abortReceive, canReadDocumentType, documentLinks, documentRelations, documents, insertRelation, linkDocumentInternal, receiveGeneratedUpload, voidDocumentInternal, type DocumentRow } from '@kompass/module-dms';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { catchAborted, GovernanceAborted, governanceConflict } from '../errors';
import { day, meetingTitle } from '../invitation/words';
import { meetingRowInternal, meetingStateOf } from '../meetings';
import { governanceMinutesVersions, governanceOrgans, type MeetingRow, type MinutesVersionRow } from '../schema';

export type MinutesVersionView = MinutesVersionRow & { documentNumber: string | null };

const id = z.string().min(1);
const bytes = z.custom<Uint8Array>((val) => val instanceof Uint8Array, { message: 'invalidBytes' });
export const minutesFileSchema = z.object({ meetingId: id, bytes, /** Vorgabe: `minutes` (MV) bzw. `governance-board-minutes`; jede aktive Art geht (Spec § 9.2). */ typeKey: z.string().min(1).optional() });
export const minutesAttachSchema = z.object({ meetingId: id, documentId: id });
/** G-13 (B): Grund der Ersetzung; steht am stornierten Dokument (höchstens 300 Zeichen wie beim Storno der Akte). */
export const minutesReplaceSchema = z.object({ meetingId: id, reason: z.string().trim().min(1).max(300) });

export const MINUTES_MAX_BYTES = 10 * 1024 * 1024;
export const isPdf = (b: Uint8Array): boolean => b.length >= 5 && new TextDecoder().decode(b.subarray(0, 5)) === '%PDF-';

/** Die Anlagen, die am Protokoll hängen: Anwesenheitsliste, Registerangaben, Einladung (`attachmentOf`). */
const ATTACHMENT_TYPES = ['governance-attendance', 'governance-register-data'];

/** Alle Fassungen, auch ersetzte (stornierte) — für die fortlaufende Nummer. */
const allMinutesVersionsInternal = (db: DbOrTx, meetingId: string): MinutesVersionRow[] =>
  db.select().from(governanceMinutesVersions).where(eq(governanceMinutesVersions.meetingId, meetingId)).orderBy(asc(governanceMinutesVersions.version)).all();

/**
 * Die geltenden Fassungen: ohne die vor dem Festschreiben ersetzten, deren Dokument storniert ist (G-13). Ob eine
 * Fassung gilt, wird aus dem Dokument gelesen, nicht gespeichert (Prinzip 5).
 */
export const minutesVersionsInternal = (db: DbOrTx, meetingId: string): MinutesVersionRow[] =>
  allMinutesVersionsInternal(db, meetingId).filter((v) => db.select({ status: documents.status }).from(documents).where(eq(documents.id, v.documentId)).get()?.status !== 'voided');

export function minutesVersionView(db: DbOrTx, row: MinutesVersionRow): MinutesVersionView {
  return { ...row, documentNumber: db.select({ number: documents.number }).from(documents).where(eq(documents.id, row.documentId)).get()?.number ?? null };
}

/** Vorgabe-Art nach Organ: Mitgliederversammlung → `minutes` (`PRT`), sonst Vorstandsprotokoll (`VSP`). */
export function minutesTypeKeyInternal(db: DbOrTx, meeting: MeetingRow): string {
  return db.select().from(governanceOrgans).where(eq(governanceOrgans.id, meeting.organId)).get()?.kind === 'assembly' ? 'minutes' : 'governance-board-minutes';
}

/** Der Betreff ohne Namen: „Protokoll Ordentliche Mitgliederversammlung 05.09.2026“. */
export function minutesSubjectInternal(db: DbOrTx, meeting: MeetingRow): string {
  const organ = db.select().from(governanceOrgans).where(eq(governanceOrgans.id, meeting.organId)).get()!;
  return `Protokoll ${meetingTitle(meeting.kind, organ.name)} ${day(meeting.heldOn)}`;
}

/**
 * Nennt das Protokoll die Anwesenheitsliste als Anlage, ohne dass eine ausgestellt ist (W-9)? Nur bei einer Sitzung
 * im Mitlauf und nur bei der Versammlung, wo die Oberfläche die Liste ausstellt — eine nachgetragene führt nur Zahlen.
 */
export function attendanceListMissingInternal(db: DbOrTx, meeting: MeetingRow): boolean {
  if (meeting.backfilled || db.select().from(governanceOrgans).where(eq(governanceOrgans.id, meeting.organId)).get()?.kind !== 'assembly') return false;
  return !db
    .select({ id: documents.id })
    .from(documentLinks)
    .innerJoin(documents, eq(documents.id, documentLinks.documentId))
    .where(and(eq(documentLinks.entityType, 'governanceMeeting'), eq(documentLinks.entityId, meeting.id), eq(documents.typeKey, 'governance-attendance'), eq(documents.status, 'issued')))
    .get();
}

/** Schreibt die Fassung und hängt Anwesenheitsliste, Registerangaben und Einladung als Anlage an — an jede Fassung, auch die berichtigte (W-9). */
export function insertMinutesVersionInternal(tx: DbOrTx, deps: Deps, ctx: CallContext, meeting: MeetingRow, documentId: string, reason: string | null): MinutesVersionRow {
  const version = allMinutesVersionsInternal(tx, meeting.id).length + 1;
  const row: MinutesVersionRow = { id: newId(), meetingId: meeting.id, version, documentId, reason, filedAt: isoNow(deps.clock), filedByUserId: ctx.userId ?? null };
  tx.insert(governanceMinutesVersions).values(row).run();
  {
    const protocol = tx.select().from(documents).where(eq(documents.id, documentId)).get()!;
    const linked = tx.select({ documentId: documentLinks.documentId }).from(documentLinks).where(and(eq(documentLinks.entityType, 'governanceMeeting'), eq(documentLinks.entityId, meeting.id))).all().map((l) => l.documentId);
    const ids = [...new Set([...linked, ...(meeting.invitationDocumentId ? [meeting.invitationDocumentId] : [])])].filter((d) => d !== documentId);
    const attachments: DocumentRow[] = ids.length ? tx.select().from(documents).where(inArray(documents.id, ids)).all() : [];
    for (const doc of attachments.filter((d) => d.status !== 'voided' && (ATTACHMENT_TYPES.includes(d.typeKey) || d.id === meeting.invitationDocumentId))) {
      // Im Altbestand kann die Akte die Anlage schon kennen (0.5.0 Nr. 26).
      const known = tx.select({ id: documentRelations.id }).from(documentRelations).where(and(eq(documentRelations.documentId, doc.id), eq(documentRelations.relatedDocumentId, protocol.id), eq(documentRelations.kind, 'attachmentOf'))).get();
      if (!known) insertRelation(tx, deps, ctx, { documentId: doc.id, relatedDocumentId: protocol.id, kind: 'attachmentOf' }, doc, protocol);
    }
  }
  return row;
}

/** Vor dem Festschreiben, ab `recorded`, und nur einmal (danach Berichtigung). */
function refuseUnlessFileable(db: DbOrTx, meeting: MeetingRow) {
  const state = meetingStateOf(meeting);
  if (state === 'signed') return governanceConflict('meetingSealed');
  if (state !== 'recorded') return governanceConflict('meetingNotRecorded');
  if (minutesVersionsInternal(db, meeting.id).length > 0) return governanceConflict('minutesFiled');
  return null;
}

/**
 * `governance.manage`: das unterschriebene Protokoll (Scan, PDF bis 10 MB) in die Akte legen, als Fassung 1 an der
 * Sitzung (Muster `fileHandoverProtocol`). Gültig ist diese Fassung, nicht der Entwurf. Kein Festschreiben — das ist
 * ein eigener Schritt eines Menschen.
 */
export async function fileSignedMinutes(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<MinutesVersionView>> {
  const denied = requirePermission(ctx, 'governance.manage');
  if (denied) return denied;
  const parsed = validate(deps, minutesFileSchema, input);
  if (!parsed.ok) return parsed;
  const v = parsed.value;
  if (v.bytes.length > MINUTES_MAX_BYTES) return invalid([{ path: 'bytes', message: 'tooLarge' }]);
  if (!isPdf(v.bytes)) return invalid([{ path: 'bytes', message: 'notPdf' }]);
  const meeting = meetingRowInternal(deps.db, v.meetingId);
  if (!meeting) return notFound('governanceMeeting', v.meetingId);
  const refused = refuseUnlessFileable(deps.db, meeting);
  if (refused) return refused;
  const filed = await receiveGeneratedUpload(deps, ctx, {
    bytes: v.bytes,
    typeKey: v.typeKey ?? minutesTypeKeyInternal(deps.db, meeting),
    subject: minutesSubjectInternal(deps.db, meeting),
    documentDate: meeting.heldOn,
    links: [{ entityType: 'governanceMeeting', entityId: meeting.id }],
    afterReceive: (tx, doc) => {
      const again = refuseUnlessFileable(tx, meetingRowInternal(tx, meeting.id)!);
      if (again) abortReceive(again);
      const row = insertMinutesVersionInternal(tx, deps, ctx, meeting, doc.id, null);
      recordAudit(tx, deps, ctx, { action: 'governance.minutes.file', entityType: 'governanceMeeting', entityId: meeting.id, after: { documentId: doc.id, version: row.version }, params: { documentNumber: doc.number, version: row.version } });
      return minutesVersionView(tx, row);
    },
  });
  if (!filed.ok) return filed;
  return ok(filed.value.after!);
}

/** `governance.manage`: ein schon vorhandenes Dokument der Akte (Altbestand, etwa `PRT-2026-001`) als Fassung 1 verknüpfen. */
export async function attachSignedMinutes(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<MinutesVersionView>> {
  const denied = requirePermission(ctx, 'governance.manage');
  if (denied) return denied;
  const parsed = validate(deps, minutesAttachSchema, input);
  if (!parsed.ok) return parsed;
  const meeting = meetingRowInternal(deps.db, parsed.value.meetingId);
  if (!meeting) return notFound('governanceMeeting', parsed.value.meetingId);
  const doc = deps.db.select().from(documents).where(eq(documents.id, parsed.value.documentId)).get();
  if (!doc) return notFound('document', parsed.value.documentId);
  // Wer verknüpft, muss das Dokument lesen dürfen — sonst würde es über die Sitzung lesbar.
  if (!canReadDocumentType(deps, ctx, doc.typeKey)) return forbidden('dms.view');
  const refused = refuseUnlessFileable(deps.db, meeting);
  if (refused) return refused;
  return deps.db.transaction((tx: DbOrTx) => {
    linkDocumentInternal(tx, deps, { documentId: doc.id, entityType: 'governanceMeeting', entityId: meeting.id });
    const row = insertMinutesVersionInternal(tx, deps, ctx, meeting, doc.id, null);
    recordAudit(tx, deps, ctx, { action: 'governance.minutes.attach', entityType: 'governanceMeeting', entityId: meeting.id, after: { documentId: doc.id, version: row.version }, params: { documentNumber: doc.number ?? '' } });
    return ok(minutesVersionView(tx, row));
  });
}

/**
 * **humanOnly**, `governance.manage` (G-13 B): vor dem Festschreiben die abgelegte unterschriebene Fassung ersetzen —
 * etwa nach einer Fehlablage. Das Dokument wird in der Akte storniert (nie gelöscht), der Grund steht daran und im
 * Protokoll. Danach lässt sich der Mitlauf wieder öffnen oder eine neue Fassung ablegen; nach dem Festschreiben bleibt
 * nur die Berichtigung.
 */
export async function replaceSignedMinutes(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ meetingId: string; voidedDocumentId: string; documentNumber: string | null }>> {
  const denied = requirePermission(ctx, 'governance.manage');
  if (denied) return denied;
  const human = requireHumanChannel(deps, ctx, 'governance.mcpHumanOnlyAllowed');
  if (human) return human;
  const parsed = validate(deps, minutesReplaceSchema, input);
  if (!parsed.ok) return parsed;
  const meeting = meetingRowInternal(deps.db, parsed.value.meetingId);
  if (!meeting) return notFound('governanceMeeting', parsed.value.meetingId);
  if (meetingStateOf(meeting) === 'signed') return governanceConflict('meetingSealed');
  const current = minutesVersionsInternal(deps.db, meeting.id).at(-1);
  if (!current) return governanceConflict('minutesMissing');
  return catchAborted(() =>
    deps.db.transaction((tx: DbOrTx) => {
      const voided = voidDocumentInternal(tx, deps, ctx, { id: current.documentId, reason: parsed.value.reason });
      if (!voided.ok) throw new GovernanceAborted(voided);
      recordAudit(tx, deps, ctx, { action: 'governance.minutes.replace', entityType: 'governanceMeeting', entityId: meeting.id, before: { documentId: current.documentId, version: current.version }, after: { reason: parsed.value.reason }, params: { documentNumber: voided.value.number ?? '', version: current.version } });
      return ok({ meetingId: meeting.id, voidedDocumentId: current.documentId, documentNumber: voided.value.number });
    }),
  );
}
