import { fractionNeeded, type Comparison, type Fraction, type Majority } from '@kompass/module-governance/live';
import type { OrganKind } from '@kompass/module-governance';

/** Die vier Bezugsgrößen des Bruchfelds (Rückmeldung Phase 2) und die gespeicherte fünfte der Beschlussfähigkeit (Entscheidung 2). */
export type FractionBase = 'allMembers' | 'presentVoting' | 'cast' | 'organMembers';
export type FractionFieldBase = FractionBase | 'votingMembers';
export interface FractionValue {
  comparison: Comparison;
  num: number;
  den: number;
  base: FractionFieldBase;
}
type QuorumFraction = { kind: 'fraction'; fraction: Fraction; base: 'allMembers' | 'votingMembers' | 'organMembers'; comparison: Comparison };

/** Mehrheit → Feld. `simple` erscheint als „mehr als 1/2“ (Review Focus 2). `all` ist bei der Versammlung „aller (stimmberechtigten) Mitglieder“, sonst das Organ. */
export function fromMajority(m: Majority, organKind: OrganKind): FractionValue {
  const base: FractionBase = m.base === 'cast' ? 'cast' : m.base === 'present' ? 'presentVoting' : organKind === 'assembly' ? 'allMembers' : 'organMembers';
  if (m.fraction === 'simple') return { comparison: 'moreThan', num: 1, den: 2, base };
  return { comparison: m.comparison ?? 'atLeast', num: m.fraction.num, den: m.fraction.den, base };
}

/** Feld → Mehrheit. „mehr als 1/2“ wird `simple` (damit `tie` greift); Enthaltungen aus dem alten Wert, sonst übergangen. */
export function toMajority(v: FractionValue, keep: Pick<Majority, 'abstentions'> | null): Majority {
  const base: Majority['base'] = v.base === 'cast' ? 'cast' : v.base === 'presentVoting' ? 'present' : 'all';
  const abstentions = keep?.abstentions ?? 'ignored';
  if (v.comparison === 'moreThan' && v.num * 2 === v.den) return { fraction: 'simple', base, abstentions };
  return { fraction: { num: v.num, den: v.den }, base, abstentions, comparison: v.comparison };
}

export function fromQuorum(q: { fraction: Fraction; base: 'allMembers' | 'votingMembers' | 'organMembers'; comparison?: Comparison }): FractionValue {
  return { comparison: q.comparison ?? 'atLeast', num: q.fraction.num, den: q.fraction.den, base: q.base };
}

export function toQuorum(v: FractionValue): QuorumFraction {
  const base = v.base === 'votingMembers' || v.base === 'organMembers' ? v.base : 'allMembers';
  return { kind: 'fraction', fraction: { num: v.num, den: v.den }, base, comparison: v.comparison };
}

/** Nötige Zahl für die heutige Bezugsgröße — dieselbe Rechnung wie im Modul (`fractionNeeded`), nie eine Kopie. */
export function exampleNeeded(v: FractionValue, sample: number): number {
  return fractionNeeded({ num: v.num, den: v.den }, sample, v.comparison);
}
