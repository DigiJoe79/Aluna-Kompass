import { INTERVAL_MONTHS } from './fee-period';
import type { FeeInterval } from './schema';

export type JoinYearRule = 'full' | 'proRataMonths' | 'nextYear';
export type ChargeSkip = 'noRule' | 'exempt';

export interface ComputeChargesInput {
  year: number;
  joinedOn: string;
  /** Letzter Tag der Mitgliedschaft. */
  endsOn: string | null;
  typeAt: (day: string) => { typeId: string; exempt: boolean };
  feeAt: (typeId: string, day: string) => { amountCents: number; interval: FeeInterval } | null;
  joinYearRule: JoinYearRule;
}

export interface ComputedCharge {
  periodStart: string;
  periodEnd: string;
  amountCents: number;
  dueOn: string;
  skip?: ChargeSkip;
}

const pad = (n: number) => String(n).padStart(2, '0');
const monthStart = (year: number, month: number) => `${year}-${pad(month)}-01`;
const monthEnd = (year: number, month: number) => `${year}-${pad(month)}-${pad(new Date(Date.UTC(year, month, 0)).getUTCDate())}`;

type State = { skip: ChargeSkip; typeId: string } | { typeId: string; amountCents: number; interval: FeeInterval };

/**
 * Welche Beiträge in einem Kalenderjahr anfallen (Plan M3, Task 3) — rein, ohne Datenbank.
 *
 * - Zeiträume nach dem Rhythmus der am Zeitraumbeginn geltenden Art; fällig am Zeitraumbeginn.
 * - Eintrittsjahr: `full` — der Zeitraum mit dem Eintritt zählt ganz, fällig am Eintritt; `proRataMonths` — anteilig
 *   nach Monaten ab dem Eintrittsmonat (kaufmännisch gerundet); `nextYear` — nichts.
 * - Austritt: Ein Zeitraum, der bis zum letzten Tag beginnt, bleibt ganz (Erstattung regelt die Satzung).
 * - Wechselt der Rhythmus mitten in einem Zeitraum, beginnt der neue Zeitraum am Wechsel und zählt anteilig.
 * - Beitragsfrei oder ohne Regel: eine Zeile mit `skip` bis zum nächsten Wechsel, Betrag 0.
 */
export function computeCharges(input: ComputeChargesInput): ComputedCharge[] {
  const { year, joinedOn } = input;
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;
  if (joinedOn > yearEnd) return [];
  if (input.endsOn !== null && input.endsOn < yearStart) return [];
  const joinYear = joinedOn >= yearStart;
  if (joinYear && input.joinYearRule === 'nextYear') return [];
  const lastStart = input.endsOn !== null && input.endsOn < yearEnd ? input.endsOn : yearEnd;

  const stateAt = (day: string): State => {
    const type = input.typeAt(day);
    if (type.exempt) return { skip: 'exempt', typeId: type.typeId };
    const fee = input.feeAt(type.typeId, day);
    return fee ? { typeId: type.typeId, ...fee } : { skip: 'noRule', typeId: type.typeId };
  };

  const firstMonth = joinYear ? Number(joinedOn.slice(5, 7)) : 1;
  const out: ComputedCharge[] = [];
  let month = firstMonth;
  while (month <= 12 && monthStart(year, month) <= lastStart) {
    const cursor = monthStart(year, month);
    const joinPeriod = joinYear && month === firstMonth;
    const state = stateAt(joinPeriod ? joinedOn : cursor);

    if ('skip' in state) {
      let end = month;
      while (end < 12 && monthStart(year, end + 1) <= lastStart) {
        const next = stateAt(monthStart(year, end + 1));
        if (!('skip' in next) || next.skip !== state.skip || next.typeId !== state.typeId) break;
        end++;
      }
      out.push({ periodStart: cursor, periodEnd: monthEnd(year, end), amountCents: 0, dueOn: joinPeriod && joinedOn > cursor ? joinedOn : cursor, skip: state.skip });
      month = end + 1;
      continue;
    }

    const months = INTERVAL_MONTHS[state.interval];
    const alignedFirst = Math.floor((month - 1) / months) * months + 1;
    const lastMonth = alignedFirst + months - 1;
    const share = (lastMonth - month + 1) / months;
    let startMonth = alignedFirst;
    let amountCents = state.amountCents;
    if (joinPeriod) {
      if (input.joinYearRule === 'proRataMonths' && alignedFirst < month) amountCents = Math.round(state.amountCents * share);
    } else if (alignedFirst < month) {
      // Rhythmus gewechselt mitten im Zeitraum: kein Zeitraum doppelt, der neue zählt ab dem Wechsel anteilig.
      startMonth = month;
      amountCents = Math.round(state.amountCents * share);
    }
    const periodStart = monthStart(year, startMonth);
    out.push({ periodStart, periodEnd: monthEnd(year, lastMonth), amountCents, dueOn: joinPeriod && joinedOn > periodStart ? joinedOn : periodStart });
    month = lastMonth + 1;
  }
  return out;
}

/**
 * Plan R1 (M2): Ein neu berechneter Zeitraum, der sich mit behaltenen Beiträgen (bezahlt, gestundet, eingereicht)
 * überschneidet, zerfällt in die Monate davor und danach, die keiner deckt — je Stück anteilig nach derselben Regel wie
 * beim Wechsel mitten im Zeitraum (`rate`: Betrag und Rhythmus am Zeitraumbeginn), fällig an seinem Beginn. Ohne
 * Überschneidung unverändert; ganz gedeckt oder ohne Satz: nichts.
 */
export function splitAroundKept(c: ComputedCharge, kept: readonly { periodStart: string; periodEnd: string }[], rate: { amountCents: number; interval: FeeInterval } | null): ComputedCharge[] {
  const overlapping = kept.filter((k) => k.periodStart <= c.periodEnd && c.periodStart <= k.periodEnd);
  if (overlapping.length === 0) return [c];
  if (c.skip || !rate) return [];
  const covered = (day: string) => overlapping.some((k) => k.periodStart <= day && day <= k.periodEnd);
  const pieces: string[][] = [];
  let piece: string[] = [];
  for (let y = Number(c.periodStart.slice(0, 4)), m = Number(c.periodStart.slice(5, 7)); monthStart(y, m) <= c.periodEnd; m === 12 ? ((y += 1), (m = 1)) : (m += 1)) {
    if (covered(monthStart(y, m))) {
      if (piece.length > 0) pieces.push(piece);
      piece = [];
    } else piece.push(monthStart(y, m));
  }
  if (piece.length > 0) pieces.push(piece);
  return pieces.map((months) => {
    const [y, m] = months.at(-1)!.split('-').map(Number) as [number, number];
    return { periodStart: months[0]!, periodEnd: monthEnd(y, m), amountCents: Math.round((rate.amountCents * months.length) / INTERVAL_MONTHS[rate.interval]), dueOn: months[0]! };
  });
}
