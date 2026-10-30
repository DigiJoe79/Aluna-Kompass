import type { OrganKind } from '../schema';
import type { ResolvedRule } from './resolve';
import type { Fraction, Majority, OrganRules } from './schema';

/**
 * Papierwörter einer Regel (Plan U2) — fest deutsch im Modul wie der übrige Wortlaut von Einladung und Protokoll
 * (Prinzip 7, Ausnahme Vorlage). Die Oberfläche spricht über die Sprachdatei.
 */
const FRACTION_WORDS: Record<string, string> = { '1/2': 'die Hälfte', '1/3': 'ein Drittel', '2/3': 'zwei Drittel', '1/4': 'ein Viertel', '3/4': 'drei Viertel', '1/10': 'ein Zehntel', '9/10': 'neun Zehntel' };

/** Ein Bruch in Worten, sonst „n/m“. */
export const fractionWords = (f: Fraction): string => FRACTION_WORDS[`${f.num}/${f.den}`] ?? `${f.num}/${f.den}`;

/** „aller Mitglieder des Organs“ — beim Vorstand „aller Vorstandsmitglieder“, bei der Versammlung die stimmberechtigten. */
function allWords(organKind: OrganKind): string {
  if (organKind === 'assembly') return 'aller stimmberechtigten Mitglieder';
  return organKind === 'board' ? 'aller Vorstandsmitglieder' : 'aller Mitglieder des Organs';
}

function baseWords(base: Majority['base'], organKind: OrganKind): string {
  if (base === 'cast') return 'der abgegebenen Stimmen';
  if (base === 'present') return 'der stimmberechtigten Anwesenden';
  return allWords(organKind);
}

/** Eine Mehrheit auf Papier: „die Mehrheit der abgegebenen Stimmen“, „drei Viertel …“, „die Zustimmung aller …“. */
export function majorityPhrase(m: Majority, organKind: OrganKind): string {
  const base = baseWords(m.base, organKind);
  if (m.fraction === 'simple') return `die Mehrheit ${base}`;
  if (m.fraction.num === m.fraction.den) return `die Zustimmung ${base.replace(/^der /, 'aller ')}`;
  const prefix = m.comparison === 'moreThan' ? 'mehr als ' : '';
  return `${prefix}${fractionWords(m.fraction)} ${base}`;
}

/** Die Beschlussfähigkeit auf Papier. */
export function quorumPhrase(q: NonNullable<OrganRules['quorum']>, organKind: OrganKind): string {
  if (q.kind === 'none') return 'ohne Mindestzahl';
  if (q.kind === 'absolute') return `mindestens ${q.count} Anwesende`;
  const base = q.base === 'allMembers' ? 'aller Mitglieder' : q.base === 'votingMembers' ? 'aller stimmberechtigten Mitglieder' : organKind === 'board' ? 'aller Vorstandsmitglieder' : 'aller Mitglieder des Organs';
  return `${q.comparison === 'moreThan' ? 'mehr als ' : ''}${fractionWords(q.fraction)} ${base}`;
}

/** Fundstelle einer Regel, sonst die Norm des Rückfalls; ohne beides „Satzung“. */
export const referenceOf = (r: ResolvedRule<unknown>): string => r.reference ?? r.norm ?? 'Satzung';
