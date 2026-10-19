/**
 * Gutschrift eines Einzugs (Plan L3, Spec Mitglieder und Lastschrift § 7.6, Weg b): Eine Sammelgutschrift ohne
 * Einzelzeilen passt zu einem eingereichten Einzug, wenn sie auf seinem Konto ab dem Fälligkeitstag eingeht und
 * die Laufsumme trifft — oder darunter liegt, weil die Bank Entgelte abzieht (höchstens die Gebührentoleranz).
 * Rein — Wächter `suggest-purity.test.ts`.
 */
import type { RawLike } from './pair';

export interface RunLike {
  id: string;
  accountId: string;
  collectionDate: string;
  sumCents: number;
}

/** Die Einzüge, zu denen eine Sammelgutschrift passt: mit voller Summe (`exact`) und abzüglich Entgelt (`short`). */
export function findRunsForCredit<T extends RunLike>(target: RawLike & { endToEndId?: string | null }, runs: readonly T[], opts: { feeToleranceCents: number }): { exact: T[]; short: T[] } {
  if (target.amountCents <= 0 || target.endToEndId) return { exact: [], short: [] };
  const fitting = runs.filter((r) => r.accountId === target.accountId && r.collectionDate <= target.bookingDate && r.sumCents > 0);
  return {
    exact: fitting.filter((r) => r.sumCents === target.amountCents),
    short: fitting.filter((r) => r.sumCents > target.amountCents && r.sumCents - target.amountCents <= opts.feeToleranceCents),
  };
}
