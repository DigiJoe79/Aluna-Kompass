import { parseAmount } from '@/lib/finance/amount';

/**
 * Die Regeln des Dialogs „Zahlung zuordnen“ (Spec Zahlung zuordnen § 3.5, Design 1a–3c), ohne Oberfläche: was
 * vorgewählt ist, wie viel höchstens geht und welcher Beitrag zuerst gilt.
 */
export interface AssignChoice {
  moneyLineId: string;
  freeCents: number;
  blockedBy: string | null;
}

/** Die erste wählbare Zeile — die Liste kommt schon in der Reihenfolge der Spec (passend ohne Hinweis zuerst). */
export function firstSelectable<T extends AssignChoice>(candidates: readonly T[]): T | null {
  return candidates.find((c) => c.blockedBy === null) ?? null;
}

/** Höchstens das Kleinere aus offenem Rest und freiem Betrag der Zahlung. */
export function assignCap(openCents: number, freeCents: number): number {
  return Math.max(0, Math.min(openCents, freeCents));
}

/** Was am eingegebenen Betrag nicht stimmt, bevor er an den Dienst geht; `null`, wenn er passt. */
export function assignAmountProblem(text: string, capCents: number): 'format' | 'tooHigh' | null {
  const cents = parseAmount(text);
  if (cents === null || cents <= 0) return 'format';
  return cents > capCents ? 'tooHigh' : null;
}

/** § 366 Abs. 2 BGB: ohne Bestimmung zuerst der älteste fällige Beitrag; nicht fällige nach den fälligen. */
export function oldestDueFirst<T extends { dueOn: string | null }>(items: readonly T[], today: string): T[] {
  const due = (i: T) => i.dueOn !== null && i.dueOn <= today;
  return [...items].sort((a, b) => Number(due(b)) - Number(due(a)) || (a.dueOn ?? '9999').localeCompare(b.dueOn ?? '9999'));
}
