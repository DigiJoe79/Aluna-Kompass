import type { DbOrTx, Deps } from '@kompass/core';
import { asc, eq } from 'drizzle-orm';
import { agendaViewsInternal } from '../agenda';
import { EMPTY_FINDINGS, findingsViewInternal } from '../findings';
import { invitationComplianceInternal } from '../invitation/compliance';
import { electionViewInternal } from '../elections';
import { meetingRowInternal, meetingView } from '../meetings';
import { resolutionViewInternal } from '../resolutions';
import { governanceResolutions } from '../schema';
import type { MinutesDefectKind } from './words';

/** Ein Mangel der Sitzung (Spec § 5.5): steht mit der Begründung der Leitung im Entwurf, sperrt nie (Anti-Ziel 1). */
export type MinutesDefect = { kind: MinutesDefectKind; agendaItemId: string | null; reason: string | null };

/** Gegen die Zählung: Feststellung und Vorschlag sind beide gesetzt und verschieden. */
const against = (found: boolean | null | undefined, suggested: boolean | null) => found !== null && found !== undefined && suggested !== null && found !== suggested;

/**
 * Die Mängel einer Sitzung: zuerst die der ganzen Sitzung (Frist, Versand, Beschlussfähigkeit, Feststellungen), dann
 * je TOP in der Reihenfolge der Tagesordnung (Ergebnis gegen die Zählung, Gegenstand nicht angekündigt).
 */
export function meetingDefectsInternal(db: DbOrTx, deps: Deps, meetingId: string): MinutesDefect[] {
  const meeting = meetingRowInternal(db, meetingId)!;
  const findings = { ...EMPTY_FINDINGS, ...meeting.findings };
  const defects: MinutesDefect[] = [];
  const compliance = invitationComplianceInternal(db, deps, meetingId);
  const view = findingsViewInternal(db, deps, meeting);
  const findingAgainstNotice = against(findings.invitationProper, view.suggested.invitationProper);
  // L-5: Frist unterschritten und dennoch „ordnungsgemäß“ festgestellt — ein Mangel mit einer Begründung, nicht zwei.
  if (compliance.late > 0) defects.push({ kind: findingAgainstNotice ? 'noticeShortFoundProper' : 'noticeShort', agendaItemId: null, reason: findings.invitationNote });
  if (compliance.unsent > 0 || compliance.missing > 0) defects.push({ kind: 'unsentInvitations', agendaItemId: null, reason: null });
  // G-10: gar keine Einladung vermerkt — nachgetragene Sitzungen und die Gründung ausgenommen.
  if (compliance.letters === 0 && !meeting.backfilled && meeting.kind !== 'founding') defects.push({ kind: 'notInvited', agendaItemId: null, reason: findings.invitationNote });
  // G-9: Hinweise an Sitzung und Beschlüssen, die die Wirksamkeit berühren, stehen auch im Protokoll.
  if (meetingView(db, meeting).warnings.includes('formNotAllowed')) defects.push({ kind: 'formNotAllowed', agendaItemId: null, reason: null });
  if (view.suggested.quorum.met === false) defects.push({ kind: 'quorumNotMet', agendaItemId: null, reason: findings.quorumNote });
  if (findingAgainstNotice && compliance.late === 0) defects.push({ kind: 'findingAgainstNotice', agendaItemId: null, reason: findings.invitationNote });
  if (against(findings.quorate, view.suggested.quorum.met)) defects.push({ kind: 'findingAgainstCount', agendaItemId: null, reason: findings.quorumNote });

  const resolutions = db.select().from(governanceResolutions).where(eq(governanceResolutions.meetingId, meetingId)).orderBy(asc(governanceResolutions.votedAt), asc(governanceResolutions.createdAt), asc(governanceResolutions.id)).all();
  for (const item of agendaViewsInternal(deps, db, meeting)) {
    for (const row of resolutions.filter((r) => r.agendaItemId === item.id)) {
      const warnings: string[] = row.kind === 'election' ? electionViewInternal(db, deps, row).warnings : resolutionViewInternal(db, deps, row).warnings;
      if (warnings.includes('outcomeAgainstCount')) defects.push({ kind: 'outcomeAgainstCount', agendaItemId: item.id, reason: row.outcomeReason });
      if (warnings.includes('remunerationWithoutStatute')) defects.push({ kind: 'remunerationWithoutStatute', agendaItemId: item.id, reason: null });
      if (warnings.includes('remunerationWrongOrgan')) defects.push({ kind: 'remunerationWrongOrgan', agendaItemId: item.id, reason: null });
      if (warnings.includes('incompatible')) defects.push({ kind: 'incompatible', agendaItemId: item.id, reason: null });
    }
    if (item.warnings.includes('notAnnounced')) defects.push({ kind: 'notAnnounced', agendaItemId: item.id, reason: null });
  }
  return defects;
}
