import { isoDay, paperDate } from '@kompass/core';

/**
 * Betreffe der Dokumente, die das Finanzmodul im Namen eines Vorgangs in der
 * Akte ablegt. Sie nennen Namen, Nummern oder Daten — bis 0.2.6 stand hier die
 * ULID des Vorgangs, und die sah jeder in Akte, Eingangskorb und Belegliste.
 * Deutsch wie alle Startwerte des Moduls; der Betreff gehört danach dem Verein.
 * Daten stehen deutsch (TT.MM.JJJJ, `ledger/dates.ts`), nie ISO.
 */

const SUBJECT_MAX = 300;

export const ULID_PATTERN = /[0-9A-HJKMNP-TV-Z]{26}/;

export type ReserveResolutionKind = 'resolution' | 'carryForward' | 'movement';

const RESERVE_PREFIX: Record<ReserveResolutionKind, string> = {
  resolution: 'Beschluss für zurückgelegtes Geld',
  carryForward: 'Beschluss zum Vortrag von zurückgelegtem Geld',
  movement: 'Beschluss für einen Vorgang an zurückgelegtem Geld',
};

function fit(text: string): string {
  return text.length > SUBJECT_MAX ? `${text.slice(0, SUBJECT_MAX - 1)}…` : text;
}

export function reserveResolutionSubject(kind: ReserveResolutionKind, reserveName: string): string {
  return fit(`${RESERVE_PREFIX[kind]} „${reserveName}“`);
}

export function transferResolutionSubject(fromName: string | null, toName: string | null): string {
  const from = fromName === null ? 'freien Mitteln' : `„${fromName}“`;
  const to = toName === null ? 'freien Mitteln' : `„${toName}“`;
  return fit(`Beschluss für Umwidmung von ${from} zu ${to}`);
}

/** Nie die Person: Der Beleg liegt in der Akte, die mehr Menschen sehen als die Auslage. */
export function expenseReceiptSubject(o: { claimNumber: string | null; positionDate: string | null; today: string; position: number }): string {
  const which = o.claimNumber ?? `vom ${paperDate(isoDay(o.positionDate ?? o.today))}`;
  return fit(`Beleg zu Auslage ${which} · Position ${o.position}`);
}
