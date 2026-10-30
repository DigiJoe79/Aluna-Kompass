import { invalid, notFound, ok, recordAudit, requireHumanChannel, requirePermission, validate, type CallContext, type Deps, type Result } from '@kompass/core';
import { abortReceive, documents, insertRelation, receiveGeneratedUpload } from '@kompass/module-dms';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { governanceConflict } from '../errors';
import { meetingRowInternal, meetingStateOf } from '../meetings';
import { insertMinutesVersionInternal, isPdf, MINUTES_MAX_BYTES, minutesFileSchema, minutesSubjectInternal, minutesTypeKeyInternal, minutesVersionsInternal, minutesVersionView, type MinutesVersionView } from './signed';

export const minutesCorrectSchema = minutesFileSchema.extend({ /** Grund der Berichtigung — nur am Datensatz, nie im Protokoll. */ reason: z.string().trim().min(1).max(2000) });

/**
 * **humanOnly**, `governance.manage`: Berichtigung eines festgeschriebenen Protokolls (Spec § 5.1, Rechtsprüfung S8) —
 * eine neue unterschriebene Fassung ersetzt die vorige (Relation `replaces`), die vorige bleibt. Folgen werden nicht
 * zurückgedreht; sie sind einzeln über die Dienste der Ämter und Stände zu korrigieren. Dass dieselben Personen
 * unterschrieben haben, prüft Kompass nicht (die Hilfe nennt es).
 */
export async function correctMinutes(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<MinutesVersionView>> {
  const denied = requirePermission(ctx, 'governance.manage');
  if (denied) return denied;
  const human = requireHumanChannel(deps, ctx, 'governance.mcpHumanOnlyAllowed');
  if (human) return human;
  const parsed = validate(deps, minutesCorrectSchema, input);
  if (!parsed.ok) return parsed;
  const v = parsed.value;
  if (v.bytes.length > MINUTES_MAX_BYTES) return invalid([{ path: 'bytes', message: 'tooLarge' }]);
  if (!isPdf(v.bytes)) return invalid([{ path: 'bytes', message: 'notPdf' }]);
  const meeting = meetingRowInternal(deps.db, v.meetingId);
  if (!meeting) return notFound('governanceMeeting', v.meetingId);
  if (meetingStateOf(meeting) !== 'signed') return governanceConflict('meetingNotSealed');
  const filed = await receiveGeneratedUpload(deps, ctx, {
    bytes: v.bytes,
    typeKey: v.typeKey ?? minutesTypeKeyInternal(deps.db, meeting),
    subject: minutesSubjectInternal(deps.db, meeting),
    documentDate: meeting.heldOn,
    links: [{ entityType: 'governanceMeeting', entityId: meeting.id }],
    afterReceive: (tx, doc) => {
      const previous = minutesVersionsInternal(tx, meeting.id).at(-1);
      if (!previous) abortReceive(governanceConflict('minutesMissing'));
      const row = insertMinutesVersionInternal(tx, deps, ctx, meeting, doc.id, v.reason);
      const [neu, old] = [doc.id, previous!.documentId].map((id) => tx.select().from(documents).where(eq(documents.id, id)).get()!);
      insertRelation(tx, deps, ctx, { documentId: neu!.id, relatedDocumentId: old!.id, kind: 'replaces' }, neu!, old!);
      recordAudit(tx, deps, ctx, { action: 'governance.minutes.correct', entityType: 'governanceMeeting', entityId: meeting.id, after: { documentId: doc.id, version: row.version }, params: { documentNumber: doc.number, version: row.version } });
      return minutesVersionView(tx, row);
    },
  });
  if (!filed.ok) return filed;
  return ok(filed.value.after!);
}
