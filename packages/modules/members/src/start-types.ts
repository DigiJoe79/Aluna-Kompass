import type { LocalizedText } from '@kompass/core';

/**
 * Grundausstattung der Mitgliedsarten (Spec § 3.1) — Nutzdaten aus einer Sprachtabelle (Prinzip 7). Ein Verein benennt
 * um, deaktiviert, ergänzt; was er gelöscht hat, kommt nie zurück (`provisionOnce`).
 */
export const START_MEMBER_TYPES: readonly { key: string; name: LocalizedText; hasVotingRight: boolean; feeExempt: boolean }[] = [
  { key: 'regular', name: { de: 'Ordentliches Mitglied', en: 'Full member' }, hasVotingRight: true, feeExempt: false },
  { key: 'supporting', name: { de: 'Fördermitglied', en: 'Supporting member' }, hasVotingRight: false, feeExempt: false },
  { key: 'honorary', name: { de: 'Ehrenmitglied', en: 'Honorary member' }, hasVotingRight: true, feeExempt: true },
];

/** Der Name je eingerichteter Sprache; eine Sprache ohne Eintrag in der Tabelle bekommt den deutschen Namen. */
export function startName(name: LocalizedText, locales: readonly string[]): LocalizedText {
  return Object.fromEntries(locales.map((l) => [l, name[l] ?? name.de ?? '']));
}
