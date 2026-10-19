import type { FeeInterval } from './schema';

/** Monate je Zeitraum eines Rhythmus. */
export const INTERVAL_MONTHS: Record<FeeInterval, number> = { yearly: 12, halfYearly: 6, quarterly: 3, monthly: 1 };

const pad = (n: number) => String(n).padStart(2, '0');
const lastDayOfMonth = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();

/** Die Zeiträume eines Kalenderjahres nach Rhythmus, jeweils erster und letzter Tag. */
export function periodsOfYear(year: number, interval: FeeInterval): { periodStart: string; periodEnd: string }[] {
  const months = INTERVAL_MONTHS[interval];
  const out: { periodStart: string; periodEnd: string }[] = [];
  for (let first = 1; first <= 12; first += months) {
    const last = first + months - 1;
    out.push({ periodStart: `${year}-${pad(first)}-01`, periodEnd: `${year}-${pad(last)}-${pad(lastDayOfMonth(year, last))}` });
  }
  return out;
}

/**
 * Der Zeitraum, wie Zahlungsreferenz und Beschriftung ihn nennen: `2027`, `2027 H1`, `2027 Q3`, `2027-03`. Ohne „·“ —
 * Banken kürzen Sonderzeichen (Plan M3).
 */
export function periodLabel(periodStart: string, periodEnd: string): string {
  const year = periodStart.slice(0, 4);
  const first = Number(periodStart.slice(5, 7));
  const months = Number(periodEnd.slice(5, 7)) - first + 1;
  const aligned = (first - 1) % months === 0;
  if (months === 12) return year;
  if (months === 6 && aligned) return `${year} H${first === 1 ? 1 : 2}`;
  if (months === 3 && aligned) return `${year} Q${(first - 1) / 3 + 1}`;
  if (months === 1) return `${year}-${pad(first)}`;
  // Ein Zeitraum ab einem Wechsel des Rhythmus (`computeCharges`): erster und letzter Monat.
  return `${year}-${pad(first)}/${pad(first + months - 1)}`;
}

/** Die Zahlungsreferenz eines Beitragspostens, wörtlich: `Beitrag 2027 Mitglied 0001`. */
export const feePaymentReference = (periodStart: string, periodEnd: string, memberNumber: string): string => `Beitrag ${periodLabel(periodStart, periodEnd)} Mitglied ${memberNumber}`;
