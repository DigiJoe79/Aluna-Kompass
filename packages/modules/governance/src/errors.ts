import { localizedConflict, type Failure } from '@kompass/core';

/**
 * Die Fehlerbilder des Moduls: Grund und Abhilfe stehen in der Sprachdatei unter `governance.errors.<code>.reason` und
 * `.remedy`; Oberfläche und MCP setzen daraus denselben Text zusammen. Werte sind Tage (`YYYY-MM-DD`) und Zahlen — nie
 * Namen.
 */
export const GOVERNANCE_ERRORS = {
  organRequired: [],
  officeOccupied: [],
  officeFull: ['seats'],
  roleRowAdopted: [],
  statuteNotResolved: [],
  statuteNotDraft: [],
  foundingExists: [],
  meetingNotDeletable: [],
  meetingStarted: [],
  meetingNotBackfilled: [],
  meetingCancelled: [],
  agendaNotEmpty: [],
  runNotForOrgan: [],
  invitationExists: [],
  invitationNotDone: [],
  cancellationWithoutLetters: [],
  invitationRunDone: [],
  invitationMissing: [],
  runNothingToPrint: [],
  runLetterQueued: [],
  runNothingToDispatch: [],
  meetingNotStartable: [],
  meetingNotRunning: [],
  meetingNotRecorded: [],
  notWriter: [],
  attendanceNotEmpty: [],
  circularSealed: [],
  minutesFiled: [],
  minutesMissing: [],
  meetingSealed: [],
  meetingInFuture: ['heldOn'],
  meetingNotSealed: [],
  outcomeMissing: [],
  reasonMissing: [],
  statuteResolutionInvalid: [],
  occasionFiled: [],
  filingRegistered: [],
  filingNotSubmitted: [],
  filingNotDissolution: [],
  registerDataEmpty: [],
} as const satisfies Record<string, readonly string[]>;
export type GovernanceErrorCode = keyof typeof GOVERNANCE_ERRORS;

export function governanceConflict(code: GovernanceErrorCode, params: Record<string, string | number> = {}): Failure {
  return localizedConflict(code, `governance.errors.${code}`, params);
}

/** Bricht eine Transaktion mit einem Fachfehler ab (alles oder nichts); die öffentlichen Dienste geben ihn als `Result` zurück. */
export class GovernanceAborted extends Error {
  constructor(readonly failure: Failure) {
    super('governance aborted');
    this.name = 'GovernanceAborted';
  }
}

/** Führt `fn` aus; ein `GovernanceAborted` darin wird zum Fehlerwert, jeder andere Fehler bleibt einer. */
export function catchAborted<T>(fn: () => T): T | Failure {
  try {
    return fn();
  } catch (error) {
    if (error instanceof GovernanceAborted) return error.failure;
    throw error;
  }
}
