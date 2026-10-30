import type { MeetingState, OrganKind } from '@kompass/module-governance';

export type MeetingStepKey = 'prepare' | 'invite' | 'meeting' | 'minutes' | 'seal';
export const MEETING_STEP_KEYS: readonly MeetingStepKey[] = ['prepare', 'invite', 'meeting', 'minutes', 'seal'];

export interface MeetingStepInput {
  state: MeetingState;
  heldOn: string;
  organKind: OrganKind;
  invitedOn: string | null;
  /** Versand des Einladungslaufs fertig; `null` ohne Lauf (Vorstand, noch nichts ausgestellt). */
  dispatchDone: boolean | null;
  /** Eine unterschriebene Fassung ist abgelegt. */
  minutesFiled: boolean;
  /** Offene Punkte aus dem Mitlauf — halten nicht auf (Board 2c). */
  openPoints: number;
}

/**
 * Die fünf Schritte einer Sitzung (Plan U1 Task 5, Board 2a–2d): höchstens einer aktiv. Festgeschrieben → alle
 * erledigt; protokolliert → Protokoll, bis eine Fassung abgelegt ist, dann Festschreiben; laufend oder ab dem
 * Sitzungstag → Sitzung; eingeladen vorher → Einladen, solange der Versand offen ist; geplant vorher → Vorbereiten.
 */
export function meetingSteps(input: MeetingStepInput, today: string): { active: MeetingStepKey | null; done: Record<MeetingStepKey, boolean> } {
  const none: Record<MeetingStepKey, boolean> = { prepare: false, invite: false, meeting: false, minutes: false, seal: false };
  if (input.state === 'cancelled') return { active: null, done: none };
  if (input.state === 'signed') return { active: null, done: { prepare: true, invite: true, meeting: true, minutes: true, seal: true } };
  const invited = input.invitedOn !== null && input.dispatchDone !== false;
  let active: MeetingStepKey;
  if (input.state === 'recorded') active = input.minutesFiled ? 'seal' : 'minutes';
  else if (input.state === 'running' || today >= input.heldOn) active = 'meeting';
  else if (input.state === 'invited') active = input.dispatchDone === false ? 'invite' : 'meeting';
  else active = 'prepare';
  const order = MEETING_STEP_KEYS.indexOf(active);
  const done = { ...none };
  done.prepare = input.state !== 'planned' || order >= MEETING_STEP_KEYS.indexOf('meeting');
  done.invite = invited && active !== 'invite';
  done.meeting = input.state === 'recorded';
  done.minutes = input.state === 'recorded' && input.minutesFiled;
  return { active, done };
}
