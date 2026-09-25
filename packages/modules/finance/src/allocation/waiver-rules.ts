/**
 * Frist des Verzichts auf einen Erstattungsanspruch (F8a Annahme 9; BMF
 * 25.11.2014 i. d. F. 24.08.2016, EStH Anhang 37 III): bei einmaligen
 * Ansprüchen binnen `oneOffMonths` (ausgeliefert 3), bei regelmäßigen binnen
 * `claimMonths` (12) nach Fälligkeit — Fälligkeit ist das Positionsdatum.
 * Rein: Die Monate kommen aus der datierten Reihe (`waiverOneOffMonths`,
 * `waiverClaimMonths`) am Positionsdatum, der Dienst liest sie.
 */
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Letzter Tag, an dem der Verzicht noch rechtzeitig ist: Positionsdatum plus Monate, am Monatsende gekappt (30.11. + 3 → 28.02.). */
export function waiverDeadline(positionDate: string, recurring: boolean, months: { claimMonths: number; oneOffMonths: number }): string {
  const match = ISO_DATE.exec(positionDate);
  if (!match) throw new RangeError(`waiverDeadline: malformed date ${JSON.stringify(positionDate)}`);
  const add = recurring ? months.claimMonths : months.oneOffMonths;
  const total = Number(match[1]) * 12 + (Number(match[2]) - 1) + add;
  const year = Math.floor(total / 12);
  const month = total % 12; // 0-basiert
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const day = Math.min(Number(match[3]), lastDay);
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Rechtzeitig bis einschließlich zum letzten Tag der Frist. */
export function waiverIsTimely(declaredOn: string, deadline: string): boolean {
  return declaredOn <= deadline;
}
