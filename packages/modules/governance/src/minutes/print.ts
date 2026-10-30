import { buildContext, formatTime, notFound, ok, prepare, readSetting, requirePermission, todayIn, validate, type CallContext, type Deps, type Result } from '@kompass/core';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { governanceConflict } from '../errors';
import { meetingRowInternal, meetingStateOf } from '../meetings';
import { governanceOrgans, type MeetingRow } from '../schema';
import { composeMinutesInternal, type MinutesInput } from './compose';
import { meetingDefectsInternal, type MinutesDefect } from './defects';
import { attendanceListMissingInternal } from './signed';
import { BOARD_MINUTES_PRINT_TEMPLATE_KEY, MINUTES_PRINT_TEMPLATE_KEY } from './template';
import { MINUTES_WORDS } from './words';
import { day, meetingTitle } from '../invitation/words';

export const minutesMeetingSchema = z.object({ meetingId: z.string().min(1) });

/** Ab `recorded` gibt es einen Entwurf; davor läuft die Sitzung noch oder hat nicht begonnen. */
export function recordedMeetingInternal(deps: Deps, meetingId: string): Result<MeetingRow> {
  const meeting = meetingRowInternal(deps.db, meetingId);
  if (!meeting) return notFound('governanceMeeting', meetingId);
  const state = meetingStateOf(meeting);
  if (state !== 'recorded' && state !== 'signed') return governanceConflict('meetingNotRecorded');
  return ok(meeting);
}

/** Die Vorlage nach Organ: Mitgliederversammlung → Protokoll (`PRT`), sonst Vorstandsprotokoll (`VSP`). */
export function minutesTemplateKeyInternal(deps: Deps, meeting: MeetingRow): string {
  const organ = deps.db.select().from(governanceOrgans).where(eq(governanceOrgans.id, meeting.organId)).get();
  return organ?.kind === 'assembly' ? MINUTES_PRINT_TEMPLATE_KEY : BOARD_MINUTES_PRINT_TEMPLATE_KEY;
}

/**
 * `governance.record`: den Protokollentwurf drucken — ohne Ablage, ohne Nummer, mit dem Wasserzeichen eines Entwurfs.
 * Liefert Bytes: kein MCP-Werkzeug (Agenten lesen `governance_minutes_text`).
 */
export async function printMinutesDraft(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ bytes: Uint8Array; filename: string }>> {
  const denied = requirePermission(ctx, 'governance.record');
  if (denied) return denied;
  const parsed = validate(deps, minutesMeetingSchema, input);
  if (!parsed.ok) return parsed;
  const meeting = recordedMeetingInternal(deps, parsed.value.meetingId);
  if (!meeting.ok) return meeting;
  const organ = deps.db.select().from(governanceOrgans).where(eq(governanceOrgans.id, meeting.value.organId)).get()!;
  const shortTitle = `${meetingTitle(meeting.value.kind, organ.name)} ${day(meeting.value.heldOn)}`;
  const footerNote = MINUTES_WORDS.footer(shortTitle, todayIn(deps), formatTime(deps.clock.now(), readSetting<string>(deps, 'organization.timeZone')));
  const minutesInput = { ...composeMinutesInternal(deps.db, deps, meeting.value.id), footerNote };
  const prepared = await prepare(deps, ctx, { templateKey: minutesTemplateKeyInternal(deps, meeting.value), input: minutesInput }, { number: '' });
  if (!prepared.ok) return prepared;
  const { built, baseId, bodyTypst, images } = prepared.value;
  const context = await buildContext(deps, ctx, '');
  const { bytes } = await deps.documents.render({ baseId, bodyTypst, slots: built.slots, context, images });
  return ok({ bytes, filename: `Protokoll-Entwurf-${meeting.value.heldOn}.pdf` });
}

/** `governance.read`: der Entwurf als Text samt den Mängeln — damit ein Agent ihn vor dem Druck prüfen kann. */
export async function getMinutesText(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<MinutesInput & { defectList: MinutesDefect[]; attachmentsMissing: 'attendanceList'[] }>> {
  const denied = requirePermission(ctx, 'governance.read');
  if (denied) return denied;
  const parsed = validate(deps, minutesMeetingSchema, input);
  if (!parsed.ok) return parsed;
  const meeting = recordedMeetingInternal(deps, parsed.value.meetingId);
  if (!meeting.ok) return meeting;
  // W-9: Das Protokoll nennt die Anwesenheitsliste als Anlage — fehlt sie, sagt es die Antwort vor Ablage und Festschreiben.
  return ok({ ...composeMinutesInternal(deps.db, deps, meeting.value.id), defectList: meetingDefectsInternal(deps.db, deps, meeting.value.id), attachmentsMissing: attendanceListMissingInternal(deps.db, meeting.value) ? ['attendanceList'] : [] });
}
