import type { FinancePledgeRow } from '../schema';
import { addCalendarMonths } from './business-days';

/**
 * Raten einer Dauerspenden-Zusage (Spec § 7.3, Nachtrag Phase 2): berechnet aus der Zusage, nie gespeichert und nie
 * ein offener Posten. Die Zustände kommen aus den Einzügen (`inRun`), den Buchungen (`booked`), den Rückgaben
 * (`returned`, Plan L3) und den Markierungen (`skipped`) — die Funktion nimmt ihre Quellen als Parameter. Rein.
 */
/** `missed` (Plan N1, M40): per Lastschrift erwartet, aber mehr als 30 Tage vorbei — Kompass zieht sie nicht mehr ein. */
export type RateState = 'expected' | 'inRun' | 'booked' | 'returned' | 'skipped' | 'missed';

export interface PledgeRate {
  dueOn: string;
  amountCents: number;
  state: RateState;
  entryId?: string;
  entryNumber?: string;
  /** Plan L3: zurückgegeben, und „Rückgabe klären“ hat „erneut einziehen“ entschieden — Unterzeile „wird erneut eingezogen“. */
  recollect?: true;
  /** Plan L3: nach einer Rückgabe zur Überweisung aufgefordert — wieder erwartet, aber nicht mehr per Lastschrift. */
  transfer?: true;
  /** Der jüngste Einzug mit dieser Rate (Spalte „Einzug“, `getPledge`). */
  run?: { id: string; collectionDate: string };
  /** Eine offene Rückgabe dieser Rate — „Rückgabe klären“ an der Zusage. */
  returnId?: string;
}

export type RatePledge = Pick<FinancePledgeRow, 'amountCents' | 'interval' | 'firstDueOn' | 'lastDueOn' | 'endedOn' | 'pausedFrom' | 'pausedUntil'>;

export interface RateSources {
  from: string;
  to: string;
  /** Ausgelassene Raten (`finance_pledge_rate_marks`). */
  marks: readonly { dueOn: string; mark: 'skipped' }[];
  /** Raten in einem Einzug (ab L2), ohne zurückgegebene. */
  runItems: readonly { dueOn: string; state: 'inRun' }[];
  /** Zurückgegebene Raten (Plan L3) mit dem Weg aus „Rückgabe klären“; `null` = noch offen. */
  returns?: readonly { dueOn: string; resolution: 'recollect' | 'requestTransfer' | 'waive' | 'alreadyPaid' | null }[];
  /** Gebuchte Raten (ab L2): die Buchung, die die Rate trägt. */
  bookedLines: readonly { dueOn: string; entryId: string; entryNumber: string }[];
  /** Bei Lastschrift: Raten davor, die noch erwartet wären, sind verpasst (`MISSED_RATE_DAYS` vor dem Stichtag). */
  missedBefore?: string;
}

const MONTHS: Record<FinancePledgeRow['interval'], number> = { monthly: 1, quarterly: 3, halfYearly: 6, yearly: 12 };

/**
 * Die Fälligkeiten von `from` bis `to`: ab der ersten Rate im Rhythmus, je von der ersten aus gerechnet (der 31. bleibt
 * der Monatsletzte), höchstens bis zur letzten Rate und bis zum Ende der Zusage.
 */
export function pledgeDueDates(pledge: RatePledge, from: string, to: string): string[] {
  const out: string[] = [];
  const step = MONTHS[pledge.interval];
  for (let k = 0; ; k += 1) {
    const dueOn = addCalendarMonths(pledge.firstDueOn, k * step);
    if (dueOn > to || (pledge.lastDueOn && dueOn > pledge.lastDueOn) || (pledge.endedOn && dueOn > pledge.endedOn)) break;
    if (dueOn >= from) out.push(dueOn);
  }
  return out;
}

/** Ruht die Zusage an diesem Tag? `pausedUntil` leer: ruht ohne Ende. */
export function pledgePausedOn(pledge: Pick<RatePledge, 'pausedFrom' | 'pausedUntil'>, day: string): boolean {
  return !!pledge.pausedFrom && pledge.pausedFrom <= day && (!pledge.pausedUntil || day <= pledge.pausedUntil);
}

/**
 * Die Raten im Zeitraum mit Zustand; Vorrang: gebucht, im Einzug, ausgelassen, zurückgegeben (offen oder „erneut
 * einziehen“), erwartet. Eine geklärte Rückgabe wechselt den Zustand (Nachtrag Phase 2): im Einzug, sobald sie in einem
 * neuen Einzug steckt, ausgelassen, oder bei Überweisung wieder erwartet.
 */
export function pledgeRates(pledge: RatePledge, sources: RateSources): PledgeRate[] {
  return pledgeDueDates(pledge, sources.from, sources.to).map((dueOn): PledgeRate => {
    const base = { dueOn, amountCents: pledge.amountCents };
    const booked = sources.bookedLines.find((b) => b.dueOn === dueOn);
    if (booked) return { ...base, state: 'booked', entryId: booked.entryId, entryNumber: booked.entryNumber };
    if (sources.runItems.some((r) => r.dueOn === dueOn)) return { ...base, state: 'inRun' };
    if (sources.marks.some((m) => m.dueOn === dueOn) || pledgePausedOn(pledge, dueOn)) return { ...base, state: 'skipped' };
    const back = (sources.returns ?? []).filter((r) => r.dueOn === dueOn).at(-1);
    if (back?.resolution === null) return { ...base, state: 'returned' };
    if (back?.resolution === 'recollect') return { ...base, state: 'returned', recollect: true };
    if (back?.resolution === 'requestTransfer') return { ...base, state: 'expected', transfer: true };
    if (sources.missedBefore && dueOn < sources.missedBefore) return { ...base, state: 'missed' };
    return { ...base, state: 'expected' };
  });
}
