import { type DbOrTx, type Deps } from '@kompass/core';
import { addCalendarDays } from '@kompass/module-finance';
import { documents } from '@kompass/module-dms';
import { eq } from 'drizzle-orm';
import { noticeDeadlineInternal } from '../deadlines/notice';
import { meetingRowInternal } from '../meetings';
import { resolveRule } from '../rules/resolve';
import { governanceInvitationRuns, governanceOrgans, governanceRunLetters } from '../schema';
import { statuteRulesOnInternal } from '../statutes';

/**
 * Ist rechtzeitig eingeladen? (Spec § 5.3) Je Brief des Einladungslaufs der Zugang aus Versandtag und Laufzeit des Wegs
 * (bei Frist ab Zugang), sonst der Versandtag. `missing`: Mitgliedschaften ohne Brief. `ok` ist `null` ohne Frist.
 * G3 schlägt daraus „ordnungsgemäß eingeladen“ vor, G4 schreibt eine Unterschreitung ins Protokoll.
 */
export interface InvitationCompliance {
  lastReceiptDay: string | null;
  letters: number;
  unsent: number;
  late: number;
  missing: number;
  ok: boolean | null;
}

export function invitationComplianceInternal(db: DbOrTx, _deps: Deps | null, meetingId: string): InvitationCompliance {
  const meeting = meetingRowInternal(db, meetingId)!;
  const deadline = noticeDeadlineInternal(db, meeting.organId, meeting.heldOn);
  const transit = resolveRule(statuteRulesOnInternal(db, meeting.heldOn).rules, meeting.organId, 'transitDays').value ?? { email: 1, post: 3 };
  const receipt = (sentAt: string, via: 'email' | 'post') => (deadline.from === 'received' ? addCalendarDays(sentAt, transit[via]) : sentAt);
  const organ = db.select().from(governanceOrgans).where(eq(governanceOrgans.id, meeting.organId)).get();
  let sent: { sentAt: string | null; via: 'email' | 'post' }[] = [];
  let missing = 0;
  if (meeting.backfilled && meeting.invitedOn) {
    // Nachgetragen: Es gibt keinen Lauf, das Schreiben liegt nur als Scan vor; zählt wie ein Vermerk.
    sent = [{ sentAt: meeting.invitedOn, via: 'email' }];
  } else if (organ?.kind === 'assembly') {
    const run = db.select().from(governanceInvitationRuns).where(eq(governanceInvitationRuns.meetingId, meetingId)).all().find((r) => r.kind === 'invitation');
    if (run) {
      missing = run.refused.length;
      sent = db
        .select({ sentAt: documents.sentAt, sentVia: documents.sentVia, status: documents.status })
        .from(governanceRunLetters)
        .innerJoin(documents, eq(documents.id, governanceRunLetters.documentId))
        .where(eq(governanceRunLetters.runId, run.id))
        .all()
        .filter((d) => d.status !== 'voided')
        .map((d) => ({ sentAt: d.sentAt, via: d.sentVia === 'email' ? 'email' : 'post' }));
    }
  } else if (meeting.invitationDocumentId) {
    const doc = db.select().from(documents).where(eq(documents.id, meeting.invitationDocumentId)).get();
    sent = [{ sentAt: doc?.sentAt ?? null, via: doc?.sentVia === 'post' ? 'post' : 'email' }];
  } else if (meeting.invitedOn) {
    // Vermerk ohne Dokument (Messenger): elektronisch, Laufzeit wie Mail.
    sent = [{ sentAt: meeting.invitedOn, via: 'email' }];
  }
  const unsent = sent.filter((s) => s.sentAt === null).length;
  const late = deadline.lastReceiptDay === null ? 0 : sent.filter((s) => s.sentAt !== null && receipt(s.sentAt, s.via) > deadline.lastReceiptDay!).length;
  return { lastReceiptDay: deadline.lastReceiptDay, letters: sent.length, unsent, late, missing, ok: deadline.lastReceiptDay === null ? null : sent.length > 0 && unsent === 0 && late === 0 && missing === 0 };
}
