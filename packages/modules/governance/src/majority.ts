import { fractionNeeded, type Majority } from './rules/schema';

/** Stimmen eines Beschlusses. Ungültig zählt wie Enthaltung nicht als abgegeben (BGHZ 83, 35). */
export type Votes = { yes: number; no: number; abstain: number; invalid: number };
/**
 * `presentVoting`: stimmberechtigt Anwesende zur Abstimmung, `allVoting`: alle Stimmberechtigten des Organs am Tag,
 * `excluded`: davon vom Stimmrecht Ausgeschlossene (§ 34 BGB) — sie verlassen die Bezugsgröße `present`/`all`.
 */
export type MajorityInput = { majority: Majority; votes: Votes; presentVoting: number; allVoting: number; excluded: number; tie: 'rejected' | 'chairDecides' };
/** `reached` ist `null` bei Gleichstand, wenn die Leitung entscheidet. */
export type MajorityResult = { denominator: number; needed: number; reached: boolean | null; tie: boolean };

/**
 * Rechnet die Mehrheit vor (Spec § 4.2) — rein, ohne Sperre: Die Leitung stellt fest (Anti-Ziel 1). Bei `base 'cast'`
 * mit `abstentions 'ignored'` ist die einfache Mehrheit `yes > no` (§ 32 Abs. 1 S. 3 BGB); ein Bruch heißt „mindestens“ oder
 * „mehr als“ (`comparison`, fehlt er: „mindestens“).
 */
export function evaluateMajority(input: MajorityInput): MajorityResult {
  const { majority: m, votes: v } = input;
  const cast = v.yes + v.no + (m.abstentions === 'asNo' ? v.abstain : 0);
  const denominator = m.base === 'cast' ? cast : (m.base === 'present' ? input.presentVoting : input.allVoting) - input.excluded;
  const contra = denominator - v.yes;
  if (m.fraction === 'simple') {
    const tie = v.yes === contra && denominator > 0;
    return { denominator, needed: Math.floor(denominator / 2) + 1, tie, reached: tie ? (input.tie === 'chairDecides' ? null : false) : v.yes > contra };
  }
  const needed = fractionNeeded(m.fraction, denominator, m.comparison);
  return { denominator, needed, tie: false, reached: denominator > 0 && v.yes >= needed };
}

/** Nicht mehr Stimmen als stimmberechtigt Anwesende ohne die Ausgeschlossenen — sonst ein Datenfehler. */
export function votesValid(v: Votes, presentVoting: number, excluded: number): boolean {
  return v.yes + v.no + v.abstain + v.invalid <= presentVoting - excluded;
}
