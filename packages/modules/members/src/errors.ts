import { localizedConflict, type Failure } from '@kompass/core';

/**
 * Die Fehlerbilder des Moduls: Grund und Abhilfe stehen in der Sprachdatei unter `members.errors.<code>.reason` und
 * `.remedy`; Oberfläche und MCP setzen daraus denselben Text zusammen. Werte sind Nummern, Tage (`YYYY-MM-DD`) und
 * Zahlen — nie Namen.
 */
export const MEMBERS_ERRORS = {
  memberTypeKeyTaken: ['key'],
  memberTypeInUse: ['count'],
  memberTypeInactive: [],
  memberNumberTooLow: ['last'],
  membershipRunning: [],
  membershipNotApplied: [],
  membershipNotActive: [],
  membershipEnded: [],
  membershipNotDue: ['retainUntil'],
  feeScheduleLocked: ['count'],
  feeScheduleDateTaken: ['validFrom'],
  feeScheduleLast: [],
  feeBelowMinimum: ['minimumCents'],
  intervalNotAllowed: [],
  feeRunRunning: ['year'],
  feeRunNothingToCreate: ['year'],
  feeRunDone: [],
  membershipFeeCategoryMissing: [],
  feeHasPayment: [],
  feeChargeNotOpen: [],
  membershipHasFees: [],
  membershipHasOpenFees: ['count'],
  addressMissing: [],
  runNothingToPrint: [],
  runNothingToDispatch: [],
  // Plan N3 (U6): ein stornierter Brief des Laufs, beim Vermerken genannt.
  runLetterVoided: [],
  // V2 (Retest N3): ohne Auswahl, die übrigen Briefe storniert oder schon vermerkt.
  runRestVoided: [],
  runPostGroupEmpty: [],
  dunningRunRunning: [],
  dunningRunNothingReady: [],
  dunningRunWaitingForMatch: ['count'],
  membershipNotInYear: ['year'],
  paymentRequestNeedsReturn: [],
  resignationExists: ['endsOn'],
  runLetterQueued: [],
  dunningRunDone: [],
} as const satisfies Record<string, readonly string[]>;
export type MembersErrorCode = keyof typeof MEMBERS_ERRORS;

export function membersConflict(code: MembersErrorCode, params: Record<string, string | number> = {}, amounts: string[] = []): Failure {
  return localizedConflict(code, `members.errors.${code}`, params, amounts);
}

/** Bricht eine Transaktion mit einem Fachfehler ab (alles oder nichts), etwa wenn die Finanzen einen Posten ablehnen. */
export class MembersAborted extends Error {
  constructor(readonly failure: Failure) {
    super('members aborted');
    this.name = 'MembersAborted';
  }
}

/** Führt `fn` aus; ein `MembersAborted` darin wird zum Fehlerwert, jeder andere Fehler bleibt einer. */
export function catchAborted<T>(fn: () => T): T | Failure {
  try {
    return fn();
  } catch (error) {
    if (error instanceof MembersAborted) return error.failure;
    throw error;
  }
}
