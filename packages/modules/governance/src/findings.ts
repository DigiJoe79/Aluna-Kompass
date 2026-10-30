import { invalid, isoNow, notFound, ok, recordAudit, requirePermission, validate, type CallContext, type DbOrTx, type Deps, type Result } from '@kompass/core';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { attendanceOfInternal } from './attendance';
import { invitationComplianceInternal } from './invitation/compliance';
import { meetingRowInternal } from './meetings';
import { quorumInternal, type QuorumResult } from './quorum';
import { governanceMeetings, type MeetingFindings, type MeetingRow } from './schema';
import { requireWriterInternal } from './session';

const TIME = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const id = z.string().min(1);
const note = z.string().trim().min(1).max(2000).nullable();

export type Findings = MeetingFindings;
/**
 * `minuteTakerAbsent`: die Protokollführung ist nicht als anwesend erfasst (G-25). `reasonMissing`: gegen den Vorschlag
 * festgestellt ohne Begründung — gespeichert wie bei `resolution_decide`, hält erst das Festschreiben auf (G-11).
 */
export type FindingsWarning = 'findingAgainstCount' | 'reasonMissing' | 'minuteTakerAbsent';
/** Die Feststellungen mit dem, was Kompass vorrechnet (Spec § 5.4). */
export type FindingsView = Findings & { suggested: { invitationProper: boolean | null; quorum: QuorumResult }; warnings: FindingsWarning[] };

export const EMPTY_FINDINGS: Findings = { invitationProper: null, invitationNote: null, quorate: null, quorumNote: null, chairContactId: null, minuteTakerContactId: null, chairBy: null, agendaApproved: null };
export const findingsSchema = z.strictObject({
  invitationProper: z.boolean().nullable(),
  /** Begründung, wenn die Feststellung von Kompass' Vorschlag abweicht. */
  invitationNote: note,
  quorate: z.boolean().nullable(),
  quorumNote: note,
  chairContactId: id.nullable(),
  minuteTakerContactId: id.nullable(),
  chairBy: z.enum(['statute', 'elected', 'consent']).nullable(),
  agendaApproved: z.boolean().nullable(),
});
export const findingsSaveSchema = z.object({
  meetingId: id,
  findings: findingsSchema.partial(),
  /** Uhrzeit, zu der die Beschlussfähigkeit festgestellt wird (Vorgabe: Beginn). */
  at: TIME.optional(),
});

/** Gegen die Zählung: Feststellung und Vorschlag sind beide gesetzt und verschieden. */
const against = (found: boolean | null, suggested: boolean | null) => found !== null && suggested !== null && found !== suggested;

export function findingsViewInternal(db: DbOrTx, deps: Deps, meeting: MeetingRow, at = meeting.startsAt): FindingsView {
  const findings = { ...EMPTY_FINDINGS, ...meeting.findings };
  const suggested = { invitationProper: invitationComplianceInternal(db, deps, meeting.id).ok, quorum: quorumInternal(db, deps, meeting.id, at) };
  const againstInvitation = against(findings.invitationProper, suggested.invitationProper);
  const againstQuorum = against(findings.quorate, suggested.quorum.met);
  const warnings: FindingsWarning[] = againstInvitation || againstQuorum ? ['findingAgainstCount'] : [];
  if ((againstInvitation && !findings.invitationNote) || (againstQuorum && !findings.quorumNote)) warnings.push('reasonMissing');
  if (findings.minuteTakerContactId && !meeting.backfilled && !attendanceOfInternal(db, meeting.id).some((r) => r.contactId === findings.minuteTakerContactId && r.periods.length > 0)) warnings.push('minuteTakerAbsent');
  return { ...findings, suggested, warnings };
}

/**
 * Feststellungen zu Beginn (Spec § 5.4): ordnungsgemäße Einladung, Beschlussfähigkeit, Leitung, Protokollführung.
 * Kompass schlägt vor; eine Feststellung gegen den Vorschlag warnt, ohne Begründung trägt sie `reasonMissing` und hält
 * das Festschreiben auf (G-11, wie `resolution_decide`).
 */
export async function saveFindings(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<FindingsView>> {
  const denied = requirePermission(ctx, 'governance.record');
  if (denied) return denied;
  const parsed = validate(deps, findingsSaveSchema, input);
  if (!parsed.ok) return parsed;
  const { meetingId, findings: changes, at } = parsed.value;
  const meeting = meetingRowInternal(deps.db, meetingId);
  if (!meeting) return notFound('governanceMeeting', meetingId);
  const refused = requireWriterInternal(deps.db, ctx, meeting);
  if (refused) return refused;
  const fields = Object.keys(changes) as (keyof Findings)[];
  if (fields.length === 0) return invalid([{ path: 'findings', message: 'nothingChanged' }]);
  const next = { ...EMPTY_FINDINGS, ...meeting.findings, ...changes };
  const view = findingsViewInternal(deps.db, deps, { ...meeting, findings: next }, at);
  return deps.db.transaction((tx: DbOrTx) => {
    tx.update(governanceMeetings).set({ findings: next, updatedAt: isoNow(deps.clock) }).where(eq(governanceMeetings.id, meeting.id)).run();
    // Nur Feldnamen: Begründungen und Personen stehen am Datensatz.
    recordAudit(tx, deps, ctx, { action: 'governance.findings.save', entityType: 'governanceMeeting', entityId: meeting.id, params: { fields: fields.join(', ') } });
    return ok(view);
  });
}
