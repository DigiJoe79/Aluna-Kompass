import { notFound, ok, requirePermission, validate, type CallContext, type DbOrTx, type Deps, type Result } from '@kompass/core';
import { agendaViewsInternal, type AgendaItemView } from './agenda';
import { noticeDeadlineInternal, type NoticeDeadline } from './deadlines/notice';
import { meetingIdSchema, meetingRowInternal, meetingView, type MeetingView } from './meetings';
import { invitationRunsInternal, type InvitationRunView } from './invitation/runs';
import { motionViewsInternal, type MotionView } from './motions';
import { asc, eq } from 'drizzle-orm';
import { attendanceOfInternal, type AttendanceView } from './attendance';
import { electionViewInternal, type ElectionView } from './elections';
import { findingsViewInternal, type FindingsView } from './findings';
import { resolutionViewInternal, type ResolutionView } from './resolutions';
import { governanceResolutions, type MeetingRow } from './schema';

/**
 * Eine Sitzung mit allem, was zu Vorbereitung und Mitlauf gehört: Tagesordnung, Fristen, Anträge, Einladungsläufe,
 * Anwesenheit, Feststellungen (ab Beginn, sonst `null`) und Beschlüsse.
 */
export type MeetingDetail = Omit<MeetingView, 'findings'> & {
  agenda: AgendaItemView[];
  deadlines: NoticeDeadline;
  motions: MotionView[];
  runs: InvitationRunView[];
  attendance: AttendanceView[];
  findings: FindingsView | null;
  resolutions: (ResolutionView | ElectionView)[];
};

export function meetingDetailInternal(db: DbOrTx, deps: Deps, row: MeetingRow): MeetingDetail {
  const view = meetingView(db, row);
  const started = view.state === 'running' || view.state === 'recorded' || view.state === 'signed';
  const resolutions = db.select().from(governanceResolutions).where(eq(governanceResolutions.meetingId, row.id)).orderBy(asc(governanceResolutions.votedAt), asc(governanceResolutions.createdAt), asc(governanceResolutions.id)).all();
  return {
    ...view,
    agenda: agendaViewsInternal(deps, db, row),
    deadlines: noticeDeadlineInternal(db, row.organId, row.heldOn),
    motions: motionViewsInternal(db, row),
    runs: invitationRunsInternal(db, deps, row.id),
    attendance: attendanceOfInternal(db, row.id),
    findings: started ? findingsViewInternal(db, deps, row) : null,
    resolutions: resolutions.map((r) => (r.kind === 'election' ? electionViewInternal(db, deps, r) : resolutionViewInternal(db, deps, r))),
  };
}

export async function getMeeting(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<MeetingDetail>> {
  const denied = requirePermission(ctx, 'governance.read');
  if (denied) return denied;
  const parsed = validate(deps, meetingIdSchema, input);
  if (!parsed.ok) return parsed;
  const row = meetingRowInternal(deps.db, parsed.value.id);
  if (!row) return notFound('governanceMeeting', parsed.value.id);
  return ok(meetingDetailInternal(deps.db, deps, row));
}
